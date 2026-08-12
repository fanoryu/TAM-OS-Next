/* ============================================================
   v2.2.1 — STABILIZATION LAYER
   Additive only. Save coordinator, non-destructive normalization,
   reusable validators, the integrity checker, and shared UI/a11y
   helpers. No storage keys renamed, no business logic changed.
   ============================================================ */

/* ---------- unified persistence fan-out (Phase 4) ----------
   Persists every dataset through StorageAdapter in one call, for flows that
   change several collections at once (Smart Import commit/undo, employee merge).

   RESULT CONTRACT (SPR-079):
     true  — EVERY required write returned success.
     false — one or more required writes failed.

   Before SPR-079 this function discarded every underlying boolean and returned
   `true` unconditionally, so callers reported success even when storage had
   rejected writes (ATR-011). It now inspects every result.

   WHAT `false` DOES **NOT** MEAN — read this before writing a failure message:
   this is NOT an atomic operation and makes NO rollback claim. It writes one
   storage key per dataset; the browser gives atomicity per key only, never
   across keys. A `false` result therefore means "the operation did not complete
   successfully", NOT "nothing was written" — earlier writes in the fan-out may
   well have persisted. Never tell the user their data was rolled back. The
   honest recovery path is that reloading restores whatever was last persisted.

   Deliberately NOT introduced here (SPR-079 scope): retry, compensation,
   rollback, journaling, recovery markers, operation ids, or any transaction /
   unit-of-work / coordinator abstraction.

   Failure detail goes to the console only. Each underlying write already
   surfaces its own user-facing failure through StorageAdapter (quota/unavailable
   toasts), so this layer adds no duplicate notification. */
async function saveAllData(){
  // v2.5.2 — persist every dataset, so Smart Import audit batches, overtime,
  // adjustments and employee-merge audits are durable.
  // Labels are positionally aligned with the promise list below. Promise.all
  // preserves input order in its results regardless of completion order, so the
  // mapping stays deterministic and verifiable.
  const labels = ['transactions', 'settings', 'backups', ...Object.keys(HR_KEYS)];
  const results = await Promise.all([
    persist(), saveSettings(), saveBackups(),
    ...Object.keys(HR_KEYS).map(k=>persistHR(k)),
  ]);
  // Strict check — every underlying persist function returns `ok === true`, so
  // anything else (false, undefined) is a failure. No truthy/falsy ambiguity.
  const failed = labels.filter((_, i) => results[i] !== true);
  if(failed.length){
    console.error('saveAllData: ' + failed.length + ' dataset(s) were NOT persisted: ' + failed.join(', '));
    return false;
  }
  return true;
}

/* ---------- non-destructive normalization migration (Phase 2) ---------- */
// Runs once. Fills MISSING id / createdAt / updatedAt on every entity so
// diagnostics and future features can rely on them. Never edits an existing
// value, never touches a financial amount, never renames a key. Relationships
// already use IDs (employeeId / contractId / payrollPlanId) and are left as-is.
function isValidDate(iso){ if(!iso) return false; const d = new Date(String(iso).length<=10 ? iso+'T00:00:00' : iso); return !isNaN(d.getTime()); }
async function migrateNormalizeEntities(){
  try{
    const flag = await StorageAdapter.get('tam_migrated_norm_v221');
    if(flag && flag.value==='done'){ if(!State.settings.lastMigrationAt){ /* record for older sessions */ } return; }
    let changed = 0; const nowIso = new Date().toISOString();
    const norm = (arr, prefix)=>{ (arr||[]).forEach(r=>{
      if(r && typeof r==='object'){
        if(!r.id){ r.id = uid(prefix); changed++; }
        if(!r.createdAt){ r.createdAt = r.updatedAt || nowIso; changed++; }
        if(!r.updatedAt){ r.updatedAt = r.createdAt; changed++; }
      }
    }); };
    norm(State.employees,'emp'); norm(State.contracts,'ct'); norm(State.payrollPlans,'pp');
    norm(State.recurringExpenses,'re'); norm(State.monthlyPlans,'mp');
    // Give transactions a stable createdAt from their first history entry where
    // one exists — additive, no financial value is read or written.
    State.txns.forEach(t=>{ if(t && !('createdAt' in t)){ t.createdAt = (t.history && t.history[0] && t.history[0].ts) || null; } });
    if(changed){
      // Backup-before-migration, only when something is actually normalized.
      State.backups.unshift({id:uid('backup'), monthKey:'__all__', monthLabel:'Pre-2.2.1 normalization', timestamp:nowIso, txns:JSON.parse(JSON.stringify(State.txns)), migration:true});
      await saveBackups();
      await Promise.all(['employees','contracts','payrollPlans','recurringExpenses','monthlyPlans'].map(persistHR));
      await persist();
    }
    State.settings.lastMigrationAt = nowIso;
    await saveSettings();
    await StorageAdapter.set('tam_migrated_norm_v221','done');
  }catch(e){ showError('Normalization step skipped — existing data is unchanged.', e); }
}

/* ---------- reusable validators (Phase 9) ----------
   Every validator returns {valid, errors[], warnings[]}. errors block; warnings
   inform. Shared by forms, imports, the integrity checker, and restore. */
function vNew(){ return {valid:true, errors:[], warnings:[]}; }
function vDone(r){ r.valid = r.errors.length===0; return r; }
function isNum(v){ return v!==null && v!==undefined && v!=='' && isFinite(Number(v)); }
function validateEmployee(e){
  const r = vNew();
  if(!e || typeof e!=='object'){ r.errors.push('Employee record is not an object'); return vDone(r); }
  if(!e.id) r.errors.push('Missing stable id');
  if(!String(e.fullName||'').trim()) r.errors.push('Full name is required');
  if(e.employmentStatus && !EMPLOYMENT_STATUSES.includes(e.employmentStatus)) r.warnings.push('Unrecognized employment status: '+e.employmentStatus);
  if(e.monthlyBaseSalary!=null && (!isNum(e.monthlyBaseSalary) || Number(e.monthlyBaseSalary)<0)) r.warnings.push('Base salary is negative or non-numeric');
  if(e.joinDate && !isValidDate(e.joinDate)) r.warnings.push('Join date is not a valid date');
  return vDone(r);
}
function validateContract(c){
  const r = vNew();
  if(!c || typeof c!=='object'){ r.errors.push('Contract record is not an object'); return vDone(r); }
  if(!c.id) r.errors.push('Missing stable id');
  if(!c.employeeId) r.errors.push('Contract has no employeeId link');
  else if(!empById(c.employeeId)) r.warnings.push('Contract references an employee that no longer exists');
  if(!String(c.contractNumber||'').trim()) r.errors.push('Contract number is required');
  if(!isValidDate(c.startDate)) r.errors.push('Start date is missing or invalid');
  if(!isNum(c.durationMonths) || Number(c.durationMonths)<1) r.errors.push('Duration must be a positive number of months');
  if(c.monthlySalary!=null && (!isNum(c.monthlySalary) || Number(c.monthlySalary)<0)) r.warnings.push('Monthly salary is negative or non-numeric');
  if(c.status && !CONTRACT_STORED_STATUSES.includes(c.status)) r.warnings.push('Unrecognized stored contract status: '+c.status);
  return vDone(r);
}
function validatePayrollPlan(p){
  const r = vNew();
  if(!p || typeof p!=='object'){ r.errors.push('Payroll plan is not an object'); return vDone(r); }
  if(!p.id) r.errors.push('Missing stable id');
  if(!p.monthKey) r.errors.push('Missing monthKey');
  if(!p.employeeId) r.errors.push('Missing employeeId link'); else if(!empById(p.employeeId)) r.warnings.push('Payroll plan references a missing employee');
  if(!p.contractId) r.warnings.push('Missing contractId link'); else if(!contractById(p.contractId)) r.warnings.push('Payroll plan references a missing contract');
  ['baseSalary','overtime','allowance','deduction','bonus','benefits','otherAdjustment'].forEach(k=>{ if(p[k]!=null && !isNum(p[k])) r.warnings.push(`Component ${k} is non-numeric`); });
  if(p.plannedAmount!=null && !isNum(p.plannedAmount)) r.warnings.push('Planned amount is non-numeric');
  return vDone(r);
}
function validateRecurring(x){
  const r = vNew();
  if(!x || typeof x!=='object'){ r.errors.push('Recurring template is not an object'); return vDone(r); }
  if(!x.id) r.errors.push('Missing stable id');
  if(!String(x.name||'').trim()) r.errors.push('Name is required');
  if(x.defaultAmount!=null && (!isNum(x.defaultAmount) || Number(x.defaultAmount)<0)) r.warnings.push('Default amount is negative or non-numeric');
  if(x.frequency && !RECUR_FREQUENCIES[x.frequency]) r.warnings.push('Unrecognized frequency: '+x.frequency);
  if(x.startMonth && !/^\d{4}-\d{2}$/.test(x.startMonth)) r.warnings.push('Start month should be YYYY-MM');
  if(x.endMonth && !/^\d{4}-\d{2}$/.test(x.endMonth)) r.warnings.push('End month should be YYYY-MM');
  return vDone(r);
}
function validateMonthlyPlan(m){
  const r = vNew();
  if(!m || typeof m!=='object'){ r.errors.push('Monthly plan is not an object'); return vDone(r); }
  if(!m.id) r.errors.push('Missing stable id');
  if(!m.monthKey) r.errors.push('Missing monthKey');
  if(m.status && !PLAN_STATUSES.includes(m.status)) r.warnings.push('Unrecognized plan status: '+m.status);
  if(m.committedTxnIds && !Array.isArray(m.committedTxnIds)) r.errors.push('committedTxnIds must be an array');
  return vDone(r);
}
function validateTransaction(t){
  const r = vNew();
  if(!t || typeof t!=='object'){ r.errors.push('Transaction is not an object'); return vDone(r); }
  if(!t.id) r.errors.push('Missing stable id');
  if(!t.monthKey) r.errors.push('Missing monthKey');
  if(t.uraian===undefined) r.errors.push('Missing description (uraian)');
  if(t.planned!=null && !isNum(t.planned)) r.warnings.push('Planned amount is non-numeric');
  if(t.actual!=null && !isNum(t.actual)) r.warnings.push('Actual amount is non-numeric');
  if(t.planned!=null && Number(t.planned)<0) r.warnings.push('Planned amount is negative');
  return vDone(r);
}
// Imported row (pre-transaction) — used by the Excel/CSV import review.
function validateImportedRow(it){
  const r = vNew();
  if(!it || typeof it!=='object'){ r.errors.push('Row is not an object'); return vDone(r); }
  if(!String(it.uraian||'').trim()) r.warnings.push('Row has no description');
  if(it.planned!=null && !isNum(it.planned)) r.warnings.push('Planned amount is non-numeric');
  return vDone(r);
}
// Overtime record validator (v2.3.0).
function validateOvertime(o){
  const r = vNew();
  if(!o || typeof o!=='object'){ r.errors.push('Overtime record is not an object'); return vDone(r); }
  if(!o.id) r.errors.push('Missing stable id');
  if(!o.employeeId) r.errors.push('Missing employeeId link'); else if(!empById(o.employeeId)) r.warnings.push('Overtime references a missing employee');
  if(o.contractId && !contractById(o.contractId)) r.warnings.push('Overtime references a missing contract');
  if(!o.monthKey) r.errors.push('Missing monthKey');
  if(num(o.overtimeHours)<0) r.errors.push('Overtime hours are negative');
  if(o.status && !OVERTIME_STATUSES.includes(o.status)) r.warnings.push('Unrecognized overtime status: '+o.status);
  if(!(num(o.monthlyStandardHours)>0)) r.warnings.push('Invalid monthly standard hours snapshot');
  return vDone(r);
}
// Backup JSON — thin wrapper over the existing structural validator so imports
// and restore share one entry point returning the standard shape.
function validateBackupJSON(data){
  const base = validateCompleteBackup(data);
  return {valid: base.ok, errors: base.errors||[], warnings: [], info: base.info};
}

/* ---------- data integrity checker (Phase 14) ----------
   Read-only. Never deletes or edits anything. Returns findings ranked
   Critical → Warning → Info. */
function runIntegrityCheck(){
  const findings = [];
  const add = (severity, category, message)=>findings.push({severity, category, message});
  const empIds = new Set(State.employees.map(e=>e.id));
  const ctIds = new Set(State.contracts.map(c=>c.id));
  const ppIds = new Set(State.payrollPlans.map(p=>p.id));
  const txIds = new Set(State.txns.map(t=>t.id));

  // duplicate IDs (critical)
  const dupIds = (arr, label)=>{ const seen=new Set(), dup=new Set(); arr.forEach(r=>{ if(r&&r.id){ if(seen.has(r.id)) dup.add(r.id); else seen.add(r.id); } }); if(dup.size) add('critical','duplicate-id',`${dup.size} duplicate id(s) in ${label}`); };
  dupIds(State.txns,'transactions'); dupIds(State.employees,'employees'); dupIds(State.contracts,'contracts');
  dupIds(State.payrollPlans,'payroll plans'); dupIds(State.recurringExpenses,'recurring expenses'); dupIds(State.monthlyPlans,'monthly plans');

  // broken links (warning)
  let brokenEmp=0, brokenCt=0, brokenPay=0;
  State.contracts.forEach(c=>{ if(c.employeeId && !empIds.has(c.employeeId)) brokenEmp++; });
  State.payrollPlans.forEach(p=>{ if(p.employeeId && !empIds.has(p.employeeId)) brokenEmp++; if(p.contractId && !ctIds.has(p.contractId)) brokenCt++; });
  State.txns.forEach(t=>{ if(t.employeeId && !empIds.has(t.employeeId)) brokenEmp++; if(t.contractId && !ctIds.has(t.contractId)) brokenCt++; if(t.payrollPlanId && !ppIds.has(t.payrollPlanId)) brokenPay++; });
  if(brokenEmp) add('warning','broken-employee-link',`${brokenEmp} record(s) reference a missing employee`);
  if(brokenCt) add('warning','broken-contract-link',`${brokenCt} record(s) reference a missing contract`);
  if(brokenPay) add('warning','broken-payroll-link',`${brokenPay} transaction(s) reference a missing payroll plan`);

  // duplicate payroll rows (warning)
  const seenPay={}; let dupPay=0;
  State.payrollPlans.forEach(p=>{ const k=p.monthKey+'|'+p.employeeId+'|'+p.contractId; if(seenPay[k]) dupPay++; else seenPay[k]=1; });
  if(dupPay) add('warning','duplicate-payroll',`${dupPay} duplicate payroll plan row(s) (same month + employee + contract)`);
  // duplicate payroll transactions
  const seenTx={}; let dupTx=0;
  State.txns.filter(t=>t.source==='payroll').forEach(t=>{ const k=t.monthKey+'|'+t.employeeId+'|'+t.contractId; if(seenTx[k]) dupTx++; else seenTx[k]=1; });
  if(dupTx) add('warning','duplicate-payroll-txn',`${dupTx} duplicate payroll transaction(s) for the same month/employee/contract`);

  // overlapping active contracts (warning)
  let overlap=0; State.employees.forEach(e=>{ overlap += overlappingActiveContracts(e.id).length; });
  if(overlap) add('warning','overlapping-contracts',`${overlap} pair(s) of overlapping active contracts`);

  // orphan payroll transactions (warning)
  let orphan=0; State.txns.filter(t=>t.source==='payroll').forEach(t=>{ if(!t.employeeId || !t.contractId) orphan++; });
  if(orphan) add('warning','orphan-transaction',`${orphan} payroll transaction(s) missing an employee or contract link`);

  // invalid dates (warning)
  let badDates=0; State.contracts.forEach(c=>{ if(!isValidDate(c.startDate)) badDates++; }); State.employees.forEach(e=>{ if(e.joinDate && !isValidDate(e.joinDate)) badDates++; });
  if(badDates) add('warning','invalid-date',`${badDates} record(s) with a missing or invalid date`);

  // negative / invalid amounts (warning)
  let badAmt=0;
  State.txns.forEach(t=>{ if(t.planned!=null && (!isNum(t.planned)||Number(t.planned)<0)) badAmt++; });
  State.payrollPlans.forEach(p=>{ if(p.plannedAmount!=null && (!isNum(p.plannedAmount)||Number(p.plannedAmount)<0)) badAmt++; });
  State.contracts.forEach(c=>{ if(c.monthlySalary!=null && (!isNum(c.monthlySalary)||Number(c.monthlySalary)<0)) badAmt++; });
  if(badAmt) add('warning','invalid-amount',`${badAmt} record(s) with a negative or non-numeric amount`);

  // corrupt monthly-plan references (warning)
  let badRefs=0; State.monthlyPlans.forEach(m=>{ (m.committedTxnIds||[]).forEach(id=>{ if(!txIds.has(id)) badRefs++; }); });
  if(badRefs) add('warning','corrupt-plan-ref',`${badRefs} monthly-plan transaction reference(s) point to a missing transaction`);

  // SPR-082 — RULE M: monthly-plan transaction with no reverse linkage. The
  // Monthly Plan commit writes transactions FIRST and the monthly plan SECOND.
  // If the transactions write succeeds and the monthlyPlans write fails, a
  // reload leaves a real planned transaction carrying monthlyPlanId while the
  // plan neither lists it in committedTxnIds nor records the commit. The
  // existing corrupt-plan-ref rule only walks committedTxnIds, so it cannot see
  // a transaction that was never added to that list — this direction was
  // previously invisible.
  //
  // Scoped to NON-payroll transactions on purpose: payroll-sourced rows (which
  // includes Smart Import, whose transactions are source:'payroll') are covered
  // by payroll-orphan-transaction and payroll-missing-monthlyplan. Detection
  // only — nothing here repairs, and the underlying operation is not blocked.
  State.txns.filter(t=>t.source!=='payroll' && t.monthlyPlanId).forEach(t=>{
    const mp = State.monthlyPlans.find(m=>m.id===t.monthlyPlanId);
    if(!mp){
      // The plan is ABSENT, not merely unlinked. When the commit creates the
      // month's plan for the first time and only the transactions write lands,
      // a reload restores the transactions but no plan at all — so walking
      // committedTxnIds (corrupt-plan-ref) cannot see this, and neither can the
      // linked-back check below. Reported, never repaired.
      add('critical','monthlyplan-orphan-transaction',
        `Finance transaction ${t.id} (${fmtIDR(t.planned)}, ${t.monthKey}) references monthly plan ${t.monthlyPlanId}, but no such monthly plan exists. The Monthly Plan commit did not complete. Review this transaction before committing that month again.`);
      return;
    }
    if((mp.committedTxnIds||[]).includes(t.id)) return; // healthy
    add('critical','monthlyplan-orphan-transaction',
      `Finance transaction ${t.id} (${fmtIDR(t.planned)}, ${t.monthKey}) references monthly plan ${mp.id} (${mp.month} ${mp.year}, status ${mp.status}) but that plan does not list it as a committed row. The Monthly Plan commit did not complete. Review the plan and this transaction before committing that month again.`);
  });

  // ----- Overtime integrity (v2.3.0) -----
  dupIds(State.overtimeRecords,'overtime records');
  let otBrokenEmp=0, otBrokenCt=0, otBrokenPay=0, otNegHours=0, otBadSnap=0, otOutside=0;
  State.overtimeRecords.forEach(o=>{
    if(o.employeeId && !empIds.has(o.employeeId)) otBrokenEmp++;
    if(o.contractId && !ctIds.has(o.contractId)) otBrokenCt++;
    if(o.payrollPlanId && !ppIds.has(o.payrollPlanId)) otBrokenPay++;
    if(num(o.overtimeHours)<0) otNegHours++;
    if(!(num(o.monthlyStandardHours)>0) || !(num(o.hourlyRate)>=0) || !isNum(o.calculatedAmount)) otBadSnap++;
    if(o.contractId){ const c=contractById(o.contractId); if(c && !contractCalc(c, o.monthKey).coversMonth) otOutside++; }
  });
  if(otBrokenEmp) add('warning','overtime-broken-employee',`${otBrokenEmp} overtime record(s) reference a missing employee`);
  if(otBrokenCt) add('warning','overtime-broken-contract',`${otBrokenCt} overtime record(s) reference a missing contract`);
  if(otBrokenPay) add('warning','overtime-broken-payroll',`${otBrokenPay} overtime record(s) reference a missing payroll plan`);
  if(otNegHours) add('critical','overtime-negative-hours',`${otNegHours} overtime record(s) have negative hours`);
  if(otBadSnap) add('warning','overtime-bad-snapshot',`${otBadSnap} overtime record(s) have an invalid calculation snapshot`);
  if(otOutside) add('warning','overtime-outside-contract',`${otOutside} overtime record(s) fall outside their contract's covered months`);
  // approved overtime committed twice (same record referenced by >1 payroll plan)
  const otCommitRefCount={};
  State.payrollPlans.forEach(p=>{ (p.overtimeIds||[]).forEach(id=>{ otCommitRefCount[id]=(otCommitRefCount[id]||0)+1; }); });
  const otDoubleCommit = Object.values(otCommitRefCount).filter(n=>n>1).length;
  if(otDoubleCommit) add('critical','overtime-double-commit',`${otDoubleCommit} overtime record(s) are committed to more than one payroll plan`);
  // payroll amount inconsistent with linked overtime
  let otMismatch=0;
  State.payrollPlans.forEach(p=>{ if(isPayrollCommitted(p) && Array.isArray(p.overtimeIds) && p.overtimeIds.length){ const sum=p.overtimeIds.map(id=>overtimeById(id)).filter(Boolean).reduce((s,o)=>s+num(o.approvedAmount!=null?o.approvedAmount:o.calculatedAmount),0); if(Math.abs(sum-num(p.overtimeAmount!=null?p.overtimeAmount:p.overtime))>1) otMismatch++; } });
  if(otMismatch) add('warning','overtime-payroll-mismatch',`${otMismatch} payroll plan(s) have an overtime total that differs from their linked overtime records`);

  // ----- Smart Import integrity (v2.4.0) -----
  let payNoEmp=0; State.payrollPlans.forEach(p=>{ if(!p.employeeId || !empIds.has(p.employeeId)) payNoEmp++; });
  if(payNoEmp) add('warning','payroll-without-employee',`${payNoEmp} payroll plan(s) have no valid employee`);
  // duplicate employees (same normalized name or same employeeId code)
  const seenName={}, seenCode={}; let dupName=0, dupCode=0;
  State.employees.forEach(e=>{ const n=normStr(e.fullName); if(n){ if(seenName[n]) dupName++; else seenName[n]=1; } if(e.employeeId){ if(seenCode[e.employeeId]) dupCode++; else seenCode[e.employeeId]=1; } });
  if(dupName) add('warning','duplicate-employee',`${dupName} employee(s) share a name with another record`);
  if(dupCode) add('warning','duplicate-employee-id',`${dupCode} employee(s) share an Employee ID with another record`);
  // duplicate payroll plans (employee+contract+month)
  const seenPP={}; let dupPP=0; State.payrollPlans.forEach(p=>{ const k=p.monthKey+'|'+p.employeeId+'|'+p.contractId; if(seenPP[k]) dupPP++; else seenPP[k]=1; });
  if(dupPP) add('warning','duplicate-payroll-plan',`${dupPP} duplicate payroll plan(s) (same employee + contract + month)`);
  // broken import links: records referencing a missing import batch
  const batchIds = new Set(State.importBatches.map(b=>b.batchId));
  let brokenImport=0;
  State.txns.concat(State.payrollPlans, State.employees, State.contracts).forEach(r=>{ if(r && r.importBatchId && !batchIds.has(r.importBatchId)) brokenImport++; });
  if(brokenImport) add('warning','broken-import-link',`${brokenImport} record(s) reference a missing import batch`);
  // rollback conflicts: undone batch whose created records still exist and are executed
  let rbConflict=0; State.importBatches.filter(b=>b.undone).forEach(b=>{ (b.created&&b.created.txns||[]).forEach(id=>{ const t=findTxn(id); if(t && t.actual!=null) rbConflict++; }); });
  if(rbConflict) add('info','rollback-preserved',`${rbConflict} executed transaction(s) were preserved from an undone import (expected, informational)`);
  // invalid contract evidence
  let badEvidence=0; State.contracts.forEach(c=>{ if(c.importEvidence && c.startDate && !isValidDate(c.startDate)) badEvidence++; });
  if(badEvidence) add('warning','invalid-contract-evidence',`${badEvidence} imported contract(s) have invalid start-date evidence`);

  // ----- Native Payroll Operations integrity (v2.5.0) -----
  let pNoEmp=0, pNoCt=0, pOutside=0, pNeg=0, pInconsistent=0, pMissingPlan=0, pMissingTxn=0, pTxnMismatch=0, pOverrideNoReason=0, pDupMonth=0, pOtBroken=0;
  const seenPM={};
  State.payrollPlans.forEach(p=>{
    if(p.status==='Cancelled') return;
    if(!p.employeeId || !empIds.has(p.employeeId)) pNoEmp++;
    if(!p.contractId || !ctIds.has(p.contractId)) pNoCt++;
    else { const c=contractById(p.contractId); if(c && !contractCalc(c, p.monthKey).coversMonth) pOutside++; }
    if(computePayrollPlanned(p)<0) pNeg++;
    if(p.plannedAmount!=null && Math.abs(num(p.plannedAmount)-computePayrollPlanned(p))>1) pInconsistent++;
    if(p.monthlyPlanId && !State.monthlyPlans.some(m=>m.id===p.monthlyPlanId)) pMissingPlan++;
    if(isPayrollCommitted(p)){ const t=payrollTxnOf(p); if(!t) pMissingTxn++; else if(t.actual==null && Math.abs(num(t.planned)-num(p.plannedAmount))>1) pTxnMismatch++; }
    if(p.salaryOverride && !String(p.salaryOverride.reason||'').trim()) pOverrideNoReason++;
    const k=p.monthKey+'|'+p.employeeId; if(seenPM[k]) pDupMonth++; else seenPM[k]=1;
    (p.overtimeIds||[]).forEach(oid=>{ if(!overtimeById(oid)) pOtBroken++; });
  });
  if(pNoEmp) add('warning','payroll-no-employee',`${pNoEmp} payroll plan(s) without a valid employee`);
  if(pNoCt) add('warning','payroll-no-contract',`${pNoCt} payroll plan(s) without a valid contract`);
  if(pOutside) add('warning','payroll-outside-contract',`${pOutside} payroll plan(s) outside their contract's covered months`);
  if(pDupMonth) add('warning','payroll-duplicate-month',`${pDupMonth} duplicate employee payroll for the same month`);
  if(pNeg) add('critical','payroll-negative',`${pNeg} payroll plan(s) with a negative final amount`);
  if(pOtBroken) add('warning','payroll-overtime-broken',`${pOtBroken} broken overtime link(s) in payroll plans`);
  if(pInconsistent) add('warning','payroll-total-inconsistent',`${pInconsistent} payroll plan(s) whose stored total differs from the component sum`);
  if(pMissingPlan) add('warning','payroll-missing-monthlyplan',`${pMissingPlan} payroll plan(s) linked to a missing monthly plan`);
  if(pMissingTxn) add('warning','payroll-missing-transaction',`${pMissingTxn} committed payroll plan(s) with no linked transaction`);
  if(pTxnMismatch) add('warning','payroll-txn-mismatch',`${pTxnMismatch} transaction(s) whose amount differs from the payroll plan`);
  if(pOverrideNoReason) add('warning','payroll-override-no-reason',`${pOverrideNoReason} salary override(s) without a reason`);

  /* ---------- SPR-081 partial-payroll-posting detection (READ-ONLY) ----------
     Payroll posting writes four collections one after another and is NOT atomic.
     SPR-080 proved two partial states that previously produced NO finding at all
     and were silently financial. Both rules below only REPORT: they never repair
     a link, never change an overtime status, never delete a transaction, never
     rewrite a snapshot, and never persist anything. Detection is not recovery. */

  // RULE A — orphan payroll transaction. A finance transaction points at a payroll
  // plan, but that plan is not committed, or does not point back at this
  // transaction. This is the state left by a failed payrollPlans write after the
  // txns write succeeded; before SPR-081 a retry created a SECOND transaction.
  const orphanPayrollTxns=[];
  State.txns.forEach(t=>{
    if(!t || t.source!=='payroll' || !t.payrollPlanId) return;
    const pp = payrollPlanById(t.payrollPlanId);
    if(!pp) return;                                   // missing plan is covered by broken-payroll-link
    const linkedBack = (pp.committedTxnId===t.id || pp.transactionId===t.id);
    const committed = isPayrollCommitted(pp);
    if(committed && linkedBack) return;               // healthy
    orphanPayrollTxns.push({t, pp, reason: !committed ? 'the payroll row is not committed (stage: '+payrollStage(pp)+')' : 'the payroll row does not link back to this transaction'});
  });
  orphanPayrollTxns.forEach(({t, pp, reason})=>{
    add('critical','payroll-orphan-transaction',
      `Finance transaction ${t.id} (${fmtIDR(t.planned)}, ${t.monthKey}) references payroll row ${pp.id} — ${pp.employeeName||'—'}, ${pp.monthKey} — but ${reason}. Do not post this payroll again until the transaction and the payroll linkage have been reviewed.`);
  });

  // RULE C — committed payroll referencing still-Approved overtime. The overtime
  // write failed after the payroll and transaction writes landed, so the overtime
  // was never flipped to "Committed to Payroll" and remains eligible for a LATER
  // payroll month — i.e. it can be paid twice.
  State.payrollPlans.forEach(pp=>{
    if(!isPayrollCommitted(pp)) return;
    (pp.overtimeIds||[]).forEach(oid=>{
      const o = overtimeById(oid);
      if(!o || o.status!=='Approved') return;         // only the still-Approved case
      add('critical','payroll-overtime-uncommitted',
        `Payroll row ${pp.id} (${pp.employeeName||'—'}, ${pp.monthKey}) is committed but its linked overtime ${o.id} (${fmtIDR(o.approvedAmount!=null?o.approvedAmount:o.calculatedAmount)}) is still "${o.status}" instead of "Committed to Payroll". It can be included in another payroll and paid twice. Do not include or approve this overtime in another payroll until it has been reviewed.`);
    });
  });
  // recurring adjustment outside effective period is prevented at generation; flag stored snapshots that fall outside
  let adjOutside=0; State.payrollAdjustments.forEach(a=>{ if(a.endMonth && a.startMonth && a.endMonth < a.startMonth) adjOutside++; });
  if(adjOutside) add('warning','adjustment-invalid-period',`${adjOutside} recurring adjustment(s) with an end month before the start month`);

  // ----- Employee deduplication integrity (v2.5.2) -----
  const dupGroups = findEmployeeDuplicateGroups();
  if(dupGroups.length){
    const dupRecords = dupGroups.reduce((n,g)=>n+g.employees.length,0);
    add('critical','duplicate-employee-name',`${dupGroups.length} duplicate employee name group(s) covering ${dupRecords} record(s) — same person under multiple IDs (open Employee Duplicate Review)`);
    let splitPay=0, splitOt=0, conflictContact=0, orphanDup=0;
    dupGroups.forEach(g=>{
      const ids=new Set(g.employees.map(e=>e.id));
      if(new Set(State.payrollPlans.filter(p=>ids.has(p.employeeId)).map(p=>p.employeeId)).size>1) splitPay++;
      if(new Set(State.overtimeRecords.filter(o=>ids.has(o.employeeId)).map(o=>o.employeeId)).size>1) splitOt++;
      ['bankAccount','email'].forEach(f=>{ if(new Set(g.employees.map(e=>e[f]).filter(v=>v&&String(v).trim())).size>1) conflictContact++; });
      g.employees.forEach(e=>{ if(employeeLinkCount(e.id)===0) orphanDup++; });
    });
    if(splitPay) add('warning','payroll-split-across-duplicates',`${splitPay} person(s) have payroll plans split across multiple duplicate employee IDs`);
    if(splitOt) add('warning','overtime-split-across-duplicates',`${splitOt} person(s) have overtime split across multiple duplicate employee IDs`);
    if(conflictContact) add('info','duplicate-contact-conflict',`${conflictContact} duplicate group(s) have conflicting bank account or email values to reconcile`);
    if(orphanDup) add('info','orphan-duplicate-employee',`${orphanDup} duplicate employee record(s) have no linked data (safe to merge or remove)`);
  }
  // contract number linked to more than one employee (critical)
  const cnToEmp={}; let cnMultiEmp=0;
  State.contracts.forEach(c=>{ if(!c.contractNumber) return; const k=normStr(c.contractNumber); (cnToEmp[k]=cnToEmp[k]||new Set()).add(c.employeeId); });
  Object.values(cnToEmp).forEach(s=>{ if(s.size>1) cnMultiEmp++; });
  if(cnMultiEmp) add('critical','contract-multiple-employees',`${cnMultiEmp} contract number(s) linked to more than one employee`);
  // Smart Import batch that created multiple employees for a single candidate
  let batchMultiCand=0;
  (State.importBatches||[]).forEach(b=>{ if(b.undone || !b.candidateMap) return; const created=(b.created&&b.created.employees)||[]; if(created.length > new Set(Object.values(b.candidateMap)).size) batchMultiCand++; });
  if(batchMultiCand) add('warning','import-multiple-employees-per-candidate',`${batchMultiCand} Smart Import batch(es) created more than one employee for a single candidate`);

  // ----- Payroll historical source-of-truth & Supplemental integrity (v2.7.1) -----
  // NEVER auto-repairs; only detects and classifies. Uses the immutable transaction as truth.
  let pPostedNoTxn=0, pTxnNoPlanId=0, pPlanTxnTotalDiff=0, pPlanTxnOtDiff=0, pMissingOtIds=0, pNewNoSnapshot=0, pSnapTxnDiff=0;
  State.payrollPlans.forEach(p=>{
    if(p.status==='Cancelled') return;
    const stage = (typeof payrollStage==='function') ? payrollStage(p) : (isPayrollCommitted(p)?'Posted':'Draft');
    if(stage!=='Posted' && stage!=='Executed') return;
    const t = payrollTxnOf(p);
    if(!t){ pPostedNoTxn++; return; }
    if(!t.payrollPlanId) pTxnNoPlanId++;
    const planTotal = num(p.plannedAmount!=null?p.plannedAmount:computePayrollPlanned(p));
    const planOt = num(p.overtimeAmount!=null?p.overtimeAmount:p.overtime);
    if(Math.abs(planTotal-num(t.planned))>1) pPlanTxnTotalDiff++;
    if(Math.abs(planOt-num(t.overtimeAmount))>1) pPlanTxnOtDiff++;
    if(num(t.overtimeAmount)>0 && !((p.overtimeIds||[]).length) && !((t.overtimeIds||[]).length)) pMissingOtIds++;
    // v2.7.1-committed rows must carry a frozen snapshot; legacy rows are exempt (warning only if new)
    if(p.committedSnapshot){ if(Math.abs(num(p.committedSnapshot.totalPayroll)-num(t.planned))>1) pSnapTxnDiff++; }
    else if(p.committedAt && new Date(p.committedAt).getTime() >= Date.parse('2026-07-31')) pNewNoSnapshot++;
  });
  if(pPostedNoTxn) add('critical','payroll-posted-no-transaction',`${pPostedNoTxn} Posted/Executed payroll(s) with no linked finance transaction`);
  if(pTxnNoPlanId) add('warning','payroll-txn-missing-planid',`${pTxnNoPlanId} linked payroll transaction(s) missing payrollPlanId`);
  if(pPlanTxnTotalDiff) add('warning','payroll-plan-txn-total-diff',`${pPlanTxnTotalDiff} payroll plan total(s) differ from the linked transaction planned amount`);
  if(pPlanTxnOtDiff) add('warning','payroll-plan-txn-overtime-diff',`${pPlanTxnOtDiff} payroll plan overtime amount(s) differ from the committed transaction overtime`);
  if(pMissingOtIds) add('warning','payroll-missing-overtime-ids',`${pMissingOtIds} committed payroll transaction(s) carry overtime but no linked overtime IDs`);
  if(pNewNoSnapshot) add('warning','payroll-missing-committed-snapshot',`${pNewNoSnapshot} newly posted payroll(s) are missing the immutable overtime snapshot`);
  if(pSnapTxnDiff) add('warning','payroll-snapshot-txn-diff',`${pSnapTxnDiff} committed payroll snapshot total(s) differ from the linked transaction`);

  const supps = State.supplementalPayments||[];
  let sMissingTxn=0, sOrphanTxn=0, sDupOtId=0, sPostedNoSnapLegacy=0, sPostedNoSnapModern=0, sMutable=0;
  // Source-overtime snapshots are frozen at Approve only since v2.7.1 (Payroll Integrity release).
  // A Posted/Executed supplemental approved BEFORE that date legitimately has none — a legacy
  // display-provenance gap, not a data-integrity fault. One approved on/after that date should have
  // one, so its absence is a genuine concern worth investigating.
  const V271_SNAPSHOT_DATE = Date.parse('2026-07-31');
  supps.forEach(s=>{
    if(s.financeTransactionId && !txIds.has(s.financeTransactionId)) sMissingTxn++;
    if(['Posted','Executed'].includes(s.status) && !(Array.isArray(s.sourceOvertimeSnapshot) && s.sourceOvertimeSnapshot.length)){
      const ts = Date.parse(s.approvedAt||s.postedAt||s.createdAt||s.updatedAt||'') || 0;
      if(ts && ts >= V271_SNAPSHOT_DATE) sPostedNoSnapModern++; else sPostedNoSnapLegacy++;
    }
    if(['Posted','Executed'].includes(s.status)){
      // amount must equal the frozen source snapshot / source IDs basis (mutation detection)
      const basis = (Array.isArray(s.sourceOvertimeSnapshot)&&s.sourceOvertimeSnapshot.length)
        ? s.sourceOvertimeSnapshot.reduce((n,o)=>n+num(o.approvedAmount!=null?o.approvedAmount:o.calculatedAmount),0)
        : null;
      if(basis!=null && Math.abs(basis-num(s.amount))>1) sMutable++;
    }
  });
  // finance transaction linked to a missing supplemental
  State.txns.forEach(t=>{ if(t.supplementalId && !supps.some(s=>s.id===t.supplementalId)) sOrphanTxn++; });
  // an overtime ID captured by more than one non-cancelled supplemental anywhere
  const suppOtCount={};
  supps.filter(s=>s.status!=='Cancelled').forEach(s=>{ (s.sourceOvertimeIds||[]).forEach(id=>{ suppOtCount[id]=(suppOtCount[id]||0)+1; }); });
  sDupOtId = Object.values(suppOtCount).filter(n=>n>1).length;
  if(sMissingTxn) add('critical','supplemental-missing-transaction',`${sMissingTxn} supplemental(s) linked to a missing finance transaction`);
  if(sOrphanTxn) add('critical','supplemental-orphan-transaction',`${sOrphanTxn} finance transaction(s) linked to a missing supplemental`);
  if(sDupOtId) add('critical','supplemental-overtime-double-capture',`${sDupOtId} overtime record(s) captured by more than one non-cancelled supplemental`);
  if(sPostedNoSnapModern) add('warning','supplemental-missing-source-snapshot',`${sPostedNoSnapModern} Posted/Executed supplemental(s) approved under v2.7.1+ are missing a frozen source snapshot — investigate (source overtime may have been unresolvable at approval)`);
  if(sPostedNoSnapLegacy) add('info','supplemental-missing-source-snapshot-legacy',`${sPostedNoSnapLegacy} legacy (pre-v2.7.1) Posted/Executed supplemental(s) have no frozen source snapshot — display-only; the payment and its amount are unaffected`);
  if(sMutable) add('warning','supplemental-amount-drift',`${sMutable} Posted/Executed supplemental(s) whose amount differs from their frozen source snapshot`);

  // run schema validators across every entity, roll warnings/errors up
  let vErr=0, vWarn=0;
  const runV = (arr, fn)=>arr.forEach(x=>{ const r=fn(x); vErr+=r.errors.length; vWarn+=r.warnings.length; });
  runV(State.employees, validateEmployee); runV(State.contracts, validateContract);
  runV(State.payrollPlans, validatePayrollPlan); runV(State.recurringExpenses, validateRecurring);
  runV(State.monthlyPlans, validateMonthlyPlan); runV(State.txns, validateTransaction);
  runV(State.overtimeRecords, validateOvertime);
  if(vErr) add('critical','schema-error',`${vErr} field-level validation error(s) across all records`);
  if(vWarn) add('info','schema-warning',`${vWarn} field-level validation warning(s) across all records`);

  const order = {critical:0, warning:1, info:2};
  findings.sort((a,b)=>order[a.severity]-order[b.severity]);
  const counts = {critical:findings.filter(f=>f.severity==='critical').length, warning:findings.filter(f=>f.severity==='warning').length, info:findings.filter(f=>f.severity==='info').length};
  const status = counts.critical? 'Critical issues found' : counts.warning? 'Warnings found' : 'Healthy';
  const result = {findings, counts, status, ranAt:new Date().toISOString()};
  State.lastIntegrity = result;
  return result;
}

/* ---------- UX-006C3 — authorization-aware availability (AFFORDANCE ONLY) ----------
   The single shared mechanism for expressing "the current principal cannot perform this
   one capability" on a UI control. It returns the `disabled` attribute plus an explanatory
   title, or an empty string, and is evaluated at RENDER TIME from the current principal —
   never cached, never persisted, never stored in State (ruling C3-R5; the shell already
   re-renders whenever the acting principal changes, so availability recomputes for free).

   Deliberate constraints:
   - It is an AFFORDANCE, never an enforcement boundary (C3-R3). Every gated mutation keeps
     its own can(...) check; a disabled control that is bypassed programmatically still
     hits a denying boundary. The C3 harness proves exactly that.
   - Use it ONLY where a control maps to EXACTLY ONE frozen action (C3-R2). No aggregate,
     union or destination-wide capability rule is permitted.
   - It never hides anything, and it is never applied to navigation (C3-R1/C3-R4).
   - It duplicates no policy: it delegates to the frozen public can() and nothing else.
   `resource` is optional and exists only because some frozen actions are resource-bearing
   (payroll.manage takes the same `{employeeId:null}` company-scope probe its own boundary
   uses). It is passed straight through to can() — no scope logic lives here.

   UX-006D2 (presentation only) adds a `data-authz-denied` marker to the SAME denied
   branch. It changes no decision — the condition, the `disabled` attribute and the
   title are untouched — it only makes "disabled because this principal may not"
   visually and structurally distinguishable from "disabled for an ordinary
   operational reason". That distinction was previously invisible: #genPay, for
   example, is also disabled by a locked period, and both states rendered
   identically. The marker is an attribute on a control the shell re-renders, so it
   is derived per render exactly like the decision it accompanies. */
function authzDisabled(action, resource){
  return can(action, resource) ? '' : ' disabled data-authz-denied="1" title="You do not have permission to perform this action."';
}

/* ---------- small shared UI components (Phases 5/11) ----------
   Extracted for reuse by new code; existing pages keep their inline markup to
   avoid behavioural risk in this stabilization release. */
function pageHeader(title, desc, controlsHTML, hintHTML){
  return `<div class="page-head"><div><h1>${escapeHtml(title)}</h1>${desc?`<p class="desc">${desc}</p>`:''}${hintHTML?`<p class="hint" style="margin-top:4px;">${hintHTML}</p>`:''}</div>${controlsHTML?`<div class="head-controls">${controlsHTML}</div>`:''}</div>`;
}
function severityPill(sev){
  const map={critical:'pill-status-cancelled', warning:'pill-status-partial', info:'pill-status-scheduled'};
  return `<span class="pill ${map[sev]||'pill-other'}">${escapeHtml(sev)}</span>`;
}

/* ---------- accessibility / global UI handlers (Phase 12) ---------- */
function focusFirstIn(container){
  if(!container) return;
  const el = container.querySelector('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button');
  if(el){ try{ el.focus(); }catch(e){} }
}
let __installedGlobalUI = false;
function installGlobalUIHandlers(){
  if(__installedGlobalUI) return; __installedGlobalUI = true;
  // Escape closes any open modal (finance or HR) — installed exactly once so it
  // never accumulates across re-renders.
  // UX-005F (A2) — Tab / Shift+Tab focus containment for the open dialog, added on the
  // same single-install seam so no handler ever accumulates. Escape, overlay-click,
  // initial focus and opener focus-restoration are unchanged; this only wraps Tab at
  // the dialog boundary (drawer trap and Global Search keep their own handling). Mirrors
  // the proven drawer focusable-selector concept; zero focusables is handled safely.
  document.addEventListener('keydown', e=>{
    const root = document.getElementById('modal-root');
    const open = root && root.innerHTML.trim();
    if(!open) return;
    if(e.key==='Escape'){ e.preventDefault(); closeModal(); return; }
    if(e.key==='Tab'){
      const dialog = root.querySelector('.modal') || root;
      const f = Array.from(dialog.querySelectorAll('button, [href], input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter(el=>!el.disabled && el.offsetParent !== null);
      if(!f.length){ e.preventDefault(); return; }
      const first=f[0], last=f[f.length-1];
      const active=document.activeElement;
      if(e.shiftKey && (active===first || !dialog.contains(active))){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && (active===last || !dialog.contains(active))){ e.preventDefault(); first.focus(); }
    }
  });
  bindSystemThemeListener();
}

/* ---------- appearance / theme (Part 15) ---------- */
function resolveTheme(pref){
  pref = pref || (State.settings && State.settings.appearance) || 'system';
  if(pref==='dark') return 'dark';
  if(pref==='light') return 'light';
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}
// Sets the semantic theme on <html>; all CSS variables and charts follow it.
function applyTheme(){
  const eff = resolveTheme();
  document.documentElement.dataset.theme = eff;
  const tc = document.querySelector('meta[name="theme-color"]');
  if(tc) tc.setAttribute('content', eff==='light' ? '#F3F5F8' : '#0E1420');
  return eff;
}
let __themeMediaBound = false;
function bindSystemThemeListener(){
  if(__themeMediaBound || !window.matchMedia) return; __themeMediaBound = true;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  // Live-update only while the user is on "Follow System"; a manual override
  // ignores OS changes until they return to System.
  const handler = ()=>{ if(((State.settings && State.settings.appearance) || 'system')==='system'){ applyTheme(); if(State.storageReady) render(); } };
  if(mq.addEventListener) mq.addEventListener('change', handler);
  else if(mq.addListener) mq.addListener(handler);
}
// Read a theme-aware color from the CSS variables (charts call this at draw time).
function themeVar(name, fallback){
  try{ const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fallback; }
  catch(e){ return fallback; }
}
