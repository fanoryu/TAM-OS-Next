/* ============================================================
   EMPLOYEE DEDUPLICATION & MASTER DATA CONSOLIDATION (v2.5.2)
   Employees are master data — one record per real person. Smart Import
   builds ONE canonical employee index across the whole workbook and all
   existing TAM data, then reuses the same employeeId across every month.
   ============================================================ */

// Part 2 — shared employee-name normalization. Trims, collapses spaces,
// removes line breaks, normalizes apostrophes/hyphens and trailing harmless
// punctuation, case-insensitive. The original display name is preserved
// separately by the caller. Genuinely different names are never merged.
function normalizeEmployeeName(name){
  return String(name==null?'':name)
    .replace(/[\r\n\t]+/g,' ')                 // remove accidental line breaks
    .replace(/[‘’ʼ`´']/g,"'")  // normalize apostrophes
    .replace(/[‐-―−\-]+/g,'-')  // normalize hyphens/dashes
    .replace(/\s+/g,' ')                        // collapse repeated spaces
    .trim()
    .replace(/[.,;:]+$/,'')                     // trailing harmless punctuation
    .trim()
    .toLowerCase();
}

// Part 6 helpers — how many linked records reference an employee, contact/bank
// completeness, and the employee sequence number (from the EMP-xxx code).
function employeeLinkCount(id){
  return State.contracts.filter(c=>c.employeeId===id).length
    + State.payrollPlans.filter(p=>p.employeeId===id).length
    + State.txns.filter(t=>t.employeeId===id).length
    + State.overtimeRecords.filter(o=>o.employeeId===id).length
    + State.payrollAdjustments.filter(a=>a.employeeId===id).length;
}
function employeeCompleteness(e){
  let s=0; ['bankAccount','email','phone','department','jobTitle','joinDate','monthlyBaseSalary'].forEach(f=>{ if(e[f]!=null && String(e[f]).trim()!=='') s++; }); return s;
}
function employeeSeqNum(e){ const m=/(\d+)/.exec(e&&e.employeeId||''); return m?+m[1]:Infinity; }
// Canonical-record priority: most linked records → most complete profile → oldest createdAt → lowest sequence.
function pickCanonicalEmployee(list){
  return list.slice().sort((a,b)=>{
    const lc=employeeLinkCount(b.id)-employeeLinkCount(a.id); if(lc) return lc;
    const cc=employeeCompleteness(b)-employeeCompleteness(a); if(cc) return cc;
    const ta=Date.parse(a.createdAt||'')||Infinity, tb=Date.parse(b.createdAt||'')||Infinity; if(ta!==tb) return ta-tb;
    return employeeSeqNum(a)-employeeSeqNum(b);
  })[0];
}

// Part 3 — resolve one workbook candidate to an existing employee using the
// matching priority: (2) existing contract already linked to a person, then
// (3) exact normalized full name. Bank/email/salary are supporting evidence
// only — never merge on fuzzy similarity or on salary alone.
function resolveEmployeeCandidate(cand){
  for(const cn of cand.contractNumbers){
    const ct = State.contracts.find(c=>c.contractNumber && normStr(c.contractNumber)===normStr(cn) && c.employeeId);
    if(ct){ const e=State.employees.find(x=>x.id===ct.employeeId); if(e) return {matchedEmployee:e, matchedEmployeeId:e.id, status:'Exact Existing Match', confidence:0.98, via:'contract'}; }
  }
  const byName = State.employees.filter(e=>normalizeEmployeeName(e.fullName)===cand.key);
  if(byName.length===1) return {matchedEmployee:byName[0], matchedEmployeeId:byName[0].id, status:'Exact Existing Match', confidence:1, via:'name'};
  if(byName.length>1){
    const canon = pickCanonicalEmployee(byName);
    return {matchedEmployee:canon, matchedEmployeeId:canon.id, status:'Possible Duplicate', confidence:0.9, via:'name-dup', possibleDuplicate:true, dupGroupIds:byName.map(e=>e.id)};
  }
  return {matchedEmployee:null, matchedEmployeeId:null, status:'New Employee', confidence: cand.sourceNames.size>1?0.85:0.95, via:'new'};
}

// Parts 1 & 4 — scan ALL workbook rows first and group into unique employee
// candidates (one per normalized name). Every monthly row for the same person
// references the same candidate. Sets row._candidateKey. Returns a Map.
function buildEmployeeCandidates(rows){
  const map = new Map();
  (rows||[]).forEach(row=>{
    const key = normalizeEmployeeName(row.employeeName);
    if(!key){ row._candidateKey=null; return; }
    let cand = map.get(key);
    if(!cand){
      cand = {key, canonicalName:(row.employeeName||'').trim(), sourceNames:new Set(), workbookMonths:new Set(),
        contractNumbers:new Set(), salariesObserved:new Set(), bankAccountsObserved:new Set(), emailsObserved:new Set(), sourceRowIds:[]};
      map.set(key, cand);
    }
    if(row.employeeName) cand.sourceNames.add(String(row.employeeName).trim());
    if(row.monthKey) cand.workbookMonths.add(row.monthKey);
    if(row.contractNumber) cand.contractNumbers.add(row.contractNumber);
    if(row.salary) cand.salariesObserved.add(row.salary);
    if(row.bankAccount) cand.bankAccountsObserved.add(String(row.bankAccount));
    if(row.email) cand.emailsObserved.add(String(row.email).toLowerCase());
    cand.sourceRowIds.push(row.importRowId);
    row._candidateKey = key;
  });
  map.forEach(cand=>{ Object.assign(cand, resolveEmployeeCandidate(cand)); });
  return map;
}

// Map a resolved candidate to the empMatch shape the rest of Smart Import expects.
function candidateEmpMatch(cand){
  if(!cand) return {status:'No Match', employee:null, confidence:0, candidateStatus:null};
  if(cand.status==='Exact Existing Match') return {status:'Exact', employee:cand.matchedEmployee, confidence:cand.confidence, candidateStatus:cand.status};
  if(cand.status==='Possible Duplicate')  return {status:'Needs Review', employee:cand.matchedEmployee, confidence:cand.confidence, candidateStatus:cand.status, possibleDuplicate:true};
  return {status:'No Match', employee:null, confidence:cand.confidence, candidateStatus:cand.status};
}

/* ---------- model (Part 7) ---------- */
function buildSmartImport(rawBatches, fileName){
  const rows = smartExtractRows(rawBatches);
  const months = [...new Set(rows.map(r=>r.monthKey))];
  const candidates = buildEmployeeCandidates(rows);   // workbook-wide grouping (Parts 1,4); sets row._candidateKey
  const items = rows.map(row=>{
    const cand = row._candidateKey ? candidates.get(row._candidateKey) : null;
    const empMatch = candidateEmpMatch(cand);
    const ctMatch = smartMatchContract(row, empMatch);
    const reviewRequired = empMatch.status==='Needs Review' || ctMatch.status==='Conflict' || ctMatch.missingInfo || !row.employeeName || !!(cand&&cand.possibleDuplicate);
    const actions = {
      createEmployee: !!(cand && !cand.matchedEmployeeId) && !!row.employeeName,  // resolved once per candidate at commit
      linkEmployee: !!(cand && cand.matchedEmployeeId),
      createContract: ctMatch.status==='New',
      updateContract: false,          // never auto-update
      generatePayroll: true,
      createTransaction: true,
      skip: false,
    };
    const proposed = {
      contractNumber: row.contractNumber || null,
      start: ctMatch.inferredStart, duration: row.progressTotal || Number(State.settings.defaultContractDuration)||12,
      salary: row.salary,
    };
    return {row, candidateKey: row._candidateKey, empMatch, ctMatch, actions, reviewRequired, proposed, selected: !reviewRequired};
  });
  // Record workbook-wide unique-employee count for diagnostics.
  State.lastSmartImportUnique = {ts:new Date().toISOString(), fileName, rows:rows.length, uniqueEmployees:candidates.size,
    newEmployees:[...candidates.values()].filter(c=>!c.matchedEmployeeId).length,
    matchedEmployees:[...candidates.values()].filter(c=>c.matchedEmployeeId).length};
  return {fileName, createdAt:new Date().toISOString(), batchId:uid('imp'), rows, items, months, candidates,
    mapping: LAST_COLUMN_MAPPING ? Object.assign({}, LAST_COLUMN_MAPPING) : null,
    source: (rawBatches[0] && rawBatches[0].source) || (LAST_COLUMN_MAPPING && LAST_COLUMN_MAPPING.source) || 'unknown'};
}

// v2.5.1 — rebuild the whole Smart Import model from a manually overridden generic column map.
function rebuildSmartImportFromOverride(model, overrideColMap){
  const map = model.mapping;
  if(!map || map.source!=='generic' || !map.rows) return model;
  const items = buildGenericItems(map.rows, map.headerIdx, overrideColMap);
  const batches = groupGenericBatches(items);
  // refresh mapping report so recognized/unrecognized reflect the override
  parseGenericTable(map.rows); // recomputes LAST_COLUMN_MAPPING base
  if(LAST_COLUMN_MAPPING){ LAST_COLUMN_MAPPING.colMap = Object.assign({}, overrideColMap); LAST_COLUMN_MAPPING.rows = map.rows; LAST_COLUMN_MAPPING.sheetName = map.sheetName; }
  const fresh = buildSmartImport(batches, model.fileName);
  return fresh;
}
function smartCounts(model){
  const c={months:model.months.length, rows:model.items.length, employees:0, matchedEmp:0, newEmp:0, contracts:0, matchedCt:0, newCt:0, conflicts:0, reviewRequired:0, ready:0, skipped:0, payroll:0, txns:0, duplicates:0,
    uniqueEmployees:0, existingMatched:0, newEmployees:0, possibleDuplicates:0};
  // v2.5.2 — employee counts are workbook-wide UNIQUE candidates, not per-row.
  const cands = model.candidates ? [...model.candidates.values()] : [];
  c.uniqueEmployees = cands.length;
  c.existingMatched = cands.filter(x=>x.matchedEmployeeId && !x.possibleDuplicate).length;
  c.newEmployees   = cands.filter(x=>!x.matchedEmployeeId).length;
  c.possibleDuplicates = cands.filter(x=>x.possibleDuplicate).length;
  c.matchedEmp = c.existingMatched; c.newEmp = c.newEmployees; c.employees = c.uniqueEmployees;
  // Unique contracts = distinct (candidate + contract number), plus one AUTO contract per candidate that has missing-info rows.
  const ctKeys = new Set(), matchedCtIds = new Set(), autoEmp = new Set();
  model.items.forEach(i=>{
    if(i.ctMatch.status==='Conflict') c.conflicts++;
    if(i.reviewRequired) c.reviewRequired++;
    if(i.actions.skip) c.skipped++;
    else if(!i.reviewRequired) c.ready++;
    if(i.actions.generatePayroll) c.payroll++;
    if(i.actions.createTransaction) c.txns++;
    if(i.ctMatch.contract){ matchedCtIds.add(i.ctMatch.contract.id); }
    else if(i.row.contractNumber){ ctKeys.add((i.candidateKey||'?')+'|'+normStr(i.row.contractNumber)); }
    else if(i.candidateKey){ autoEmp.add(i.candidateKey); }
    // duplicate payroll (employee+contract+month already exists)
    const emp=i.empMatch.employee; const ct=i.ctMatch.contract;
    if(emp && State.payrollPlans.some(p=>p.monthKey===i.row.monthKey && p.employeeId===emp.id && (ct?p.contractId===ct.id:true))) c.duplicates++;
  });
  c.newCt = ctKeys.size + autoEmp.size;
  c.matchedCt = matchedCtIds.size;
  c.contracts = c.newCt + c.matchedCt;
  return c;
}

/* ---------- commit (Parts 9, 10, 11) ---------- */
async function commitSmartImport(model){
  // UX-006C2C-2 — single top gate at the commit boundary (import.commit, CEO-only).
  // Denied means nothing is written at all: not the pre-import safety backup, not a
  // record, not an audit entry. Preview/parse stays unguarded (reads are scope's job).
  if(!can(ACTIONS.IMPORT_COMMIT)) return { ok:false, error:'NotAuthorized', audit:null };
  const now = new Date().toISOString(), batchId = model.batchId;
  // Part 11 — automatic safety backup + audit before commit.
  State.backups.unshift({id:uid('backup'), monthKey:'__all__', monthLabel:'Pre-Smart-Import backup ('+model.fileName+')', timestamp:now, txns:JSON.parse(JSON.stringify(State.txns)), migration:true});
  await saveBackups();
  const created = {employees:[], contracts:[], payrollPlans:[], txns:[], monthlyPlanTxns:[]};
  let skipped=0, dupSkipped=0, contractConflicts=0;
  // Part 9 — ONE shared employee-resolution map for the whole commit, plus a
  // per-employee contract map so the same contract number is never duplicated
  // across months. Employees are never created independently per monthly row.
  const empMap = new Map();       // candidateKey -> employeeId
  const ctMap  = new Map();       // employeeId + '|' + contractKey -> contractId
  const candidateMap = {};        // candidateKey -> employeeId (persisted for re-import stability)

  // Phase A — resolve or create each unique employee candidate exactly once.
  const selByCand = new Map();
  model.items.forEach(i=>{ if(!i.selected || i.actions.skip || !i.candidateKey) return; if(!selByCand.has(i.candidateKey)) selByCand.set(i.candidateKey, []); selByCand.get(i.candidateKey).push(i); });
  selByCand.forEach((items, key)=>{
    const cand = model.candidates.get(key);
    const existingId = cand && cand.matchedEmployeeId;
    if(existingId && State.employees.some(e=>e.id===existingId)){ empMap.set(key, existingId); candidateMap[key]=existingId; return; }
    const first = items[0].row;
    const emp = {id:uid('emp'), employeeId:nextEmployeeCode(), fullName:(cand&&cand.canonicalName)||first.employeeName, employmentStatus:'Active', active:true,
      monthlyBaseSalary: first.salary||null,
      bankAccount: (items.map(x=>x.row.bankAccount).find(Boolean))||null,
      email: (items.map(x=>x.row.email).find(Boolean))||null,
      source:'Smart Import', importBatchId:batchId, candidateKey:key, createdAt:now, updatedAt:now,
      history:[{event:'created', ts:now, note:'Created by Smart Import from '+model.fileName+' — canonical across '+((cand&&cand.workbookMonths.size)||1)+' month(s)'}]};
    State.employees.push(emp); created.employees.push(emp.id); empMap.set(key, emp.id); candidateMap[key]=emp.id;
  });

  // Phase B — contracts (deduped per employee + contract number), payroll, transactions.
  for(const item of model.items){
    if(!item.selected || item.actions.skip){ skipped++; continue; }
    const row = item.row;
    const empId = item.candidateKey ? empMap.get(item.candidateKey) : null;
    const emp = empId ? State.employees.find(e=>e.id===empId) : null;
    if(!emp){ skipped++; continue; }
    let ct = item.ctMatch.contract || null;   // existing matched contract (reused)
    if(!ct){
      const cnKey = row.contractNumber ? normStr(row.contractNumber) : 'AUTO';
      const mapKey = emp.id+'|'+cnKey;
      if(ctMap.has(mapKey)){ ct = State.contracts.find(c=>c.id===ctMap.get(mapKey)) || null; } // reuse within this commit
      // v2.5.2 — re-import safety for missing-info rows: reuse this employee's existing AUTO
      // contract instead of creating a duplicate one (AUTO contracts have no number to match).
      if(!ct && !row.contractNumber){
        const existingAuto = State.contracts.find(c=>c.employeeId===emp.id && (/^AUTO-/.test(c.contractNumber||'') || (c.importEvidence && c.importEvidence.startInferred)));
        if(existingAuto){ ct = existingAuto; ctMap.set(mapKey, ct.id); }
      }
      if(!ct && row.contractNumber){
        // Part 5 — same contract number on a DIFFERENT employee = critical conflict; never link across people.
        const clash = State.contracts.find(c=>c.contractNumber && normStr(c.contractNumber)===cnKey && c.employeeId && c.employeeId!==emp.id);
        if(clash) contractConflicts++;
      }
      if(!ct && item.actions.createContract){
        const start = item.proposed.start || (row.monthKey+'-01');
        ct = {id:uid('ct'), employeeId:emp.id, employeeName:emp.fullName,
          contractNumber: row.contractNumber || ('AUTO-'+emp.employeeId),
          startDate:start, durationMonths:item.proposed.duration, monthlySalary:item.proposed.salary||row.salary||null,
          status:'Active', source:'Smart Import', importBatchId:batchId,
          importEvidence:{progress: row.progressCurrent!=null?(row.progressCurrent+'/'+row.progressTotal):null, fromMonth:row.monthKey, contractNumberRaw:row.contractNumber, startInferred:!row.contractNumber},
          createdAt:now, updatedAt:now,
          history:[{event:'created', ts:now, note:'Created by Smart Import — start '+(row.contractNumber?'from contract evidence':'inferred from payroll month + progress')}]};
        State.contracts.push(ct); created.contracts.push(ct.id); ctMap.set(mapKey, ct.id);
      }
    }
    if(item.actions.generatePayroll){
      const dup = State.payrollPlans.find(p=>p.monthKey===row.monthKey && p.employeeId===emp.id && (ct? p.contractId===ct.id : true));
      if(dup){ dupSkipped++; continue; } // Prevent duplicates: Employee + Contract + Month
      const mo = keyToMonthObj(row.monthKey);
      const plannedAmt = (row.planned||row.salary||0) + num(row.overtime) + num(row.allowance) - num(row.deduction);
      // v2.5.1 — progress snapshot derives from the structured contract when available
      // (calculated from start + duration + month); raw N/M is only a fallback label.
      const progress = ct ? contractCalc(ct,row.monthKey).progress : (row.progressCurrent!=null ? (Math.round(row.progressCurrent)+'/'+(row.progressTotal||'')) : null);
      const pp = {id:uid('pp'), monthKey:row.monthKey, month:mo.month, year:mo.year, monthNum:mo.monthNum,
        employeeId:emp.id, employeeName:emp.fullName, contractId:ct?ct.id:null, contractNumber:ct?ct.contractNumber:row.contractNumber, contractProgress:progress,
        baseSalary:row.salary||0, overtime:num(row.overtime), allowance:num(row.allowance), deduction:num(row.deduction), bonus:0, benefits:0, otherAdjustment:0, overtimeIds:[],
        plannedAmount:plannedAmt, actual:(row.actual!=null?row.actual:null), notes:'Imported', status:'Committed',
        source:'Smart Import', importBatchId:batchId, importRowId:row.importRowId, createdAt:now, updatedAt:now};
      State.payrollPlans.push(pp); created.payrollPlans.push(pp.id);
      if(item.actions.createTransaction){
        const mplan = ensureMonthlyPlan(row.monthKey);
        const uraian = `${emp.fullName}${ct?' · '+ct.contractNumber:''}${progress?' · '+progress:''}`;
        const txn = {id:uid('pay'), monthKey:row.monthKey, month:mo.month, year:mo.year, monthNum:mo.monthNum,
          category:State.settings.defaultPayrollCategory||'Gaji', categoryCode:'A', no:null, uraian, vol:1, satuan:'bulan', hargaSatuan:plannedAmt,
          planned:plannedAmt, actual:(row.actual!=null?row.actual:null), type:'expense', txnDate:null, source:'payroll', unplanned:false,
          scheduledDate:null, paymentMethod:null, bankAccount:null, referenceNumber:null, notes:'Smart Import', vendor:null,
          execution:null, status:'planned', employeeId:emp.id, contractId:ct?ct.id:null, payrollPlanId:pp.id, overtimeIds:[],
          monthlyPlanId:mplan.id, importBatchId:batchId, importRowId:row.importRowId,
          payrollMeta:{employeeName:emp.fullName, contractNumber:ct?ct.contractNumber:row.contractNumber, contractProgress:progress},
          history:[{event:'created', ts:now, note:'Created by Smart Import'}]};
        if(txn.actual!=null){ txn.status = computeStatus(txn); if(txn.actual>0){ txn.execution={executionDate:null, actualAmount:txn.actual, method:null, bank:null, reference:null, notes:'Imported as realized', executedBy:'—', executionId:uid('exec'), ts:now}; txn.history.push({event:'executed', ts:now, note:'Imported realized amount '+fmtIDR(txn.actual), amount:txn.actual}); } }
        State.txns.push(txn); pp.committedTxnId=txn.id; created.txns.push(txn.id);
        if(!mplan.committedTxnIds.includes(txn.id)){ mplan.committedTxnIds.push(txn.id); created.monthlyPlanTxns.push(txn.id); }
        mplan.status='Committed';
      }
    }
  }
  const audit = {batchId, fileName:model.fileName, ts:now, mode:'smart', created, candidateMap,
    uniqueEmployees: Object.keys(candidateMap).length,
    counts:{employees:created.employees.length, contracts:created.contracts.length, payrollPlans:created.payrollPlans.length, txns:created.txns.length, skipped, duplicatesSkipped:dupSkipped, contractConflicts, uniqueEmployees:Object.keys(candidateMap).length}, undone:false};
  State.importBatches.unshift(audit);
  // SPR-079 — the fan-out result is now inspected. A failed write must never be
  // recorded as a completed import: the success audit entry below is written ONLY
  // after every required write succeeded. No rollback is performed and none is
  // claimed — the pre-import safety backup (taken and persisted above) is
  // untouched, and reloading restores whatever was last persisted. Re-running the
  // import is safe: duplicate employee+contract+month rows are skipped by design.
  const saved = await saveAllData();
  if(saved !== true) return { ok:false, audit };
  const c=audit.counts;
  logActivity({type:'import.commit', module:'Import', entity:model.fileName||'Smart Import', entityId:batchId,
    desc:`Committed — ${c.employees} employee(s), ${c.contracts} contract(s), ${c.payrollPlans} payroll plan(s), ${c.txns} transaction(s)${c.skipped?', '+c.skipped+' skipped':''}`,
    refs:{importBatchId:batchId}});
  return { ok:true, audit };
}

/* ---------- undo (Part 11) ---------- */
/* Readiness-3 (truthful rollback reporting).
   This previously reported the raw CREATED counts (`c.employees.length` etc.) as the
   counts that would be REMOVED. Those are not the same number: the undo deliberately
   RETAINS any created record still reachable from a transaction it may not delete —
   an executed or modified transaction is never rolled back (Finance integrity), its
   payroll plan survives with it, and the contract/employee those reference survive in
   turn. Importing TAM's standard workbook with a `Realisasi` column produces exactly
   that shape, so the common case reported removals that then correctly did not happen:
   the confirm dialog overstated the damage, and — worse — the `import.undo` audit entry
   recorded deletions that never occurred.

   The retention rules are now evaluated HERE, once, using the same predicates the undo
   applies, and the undo consumes these sets rather than recomputing them. Nothing about
   WHAT is removed changes — only that the numbers reported are the numbers acted on. */
function smartRollbackPreview(batch){
  const c = batch.created;
  const removableTxns = c.txns.filter(id=>{ const t=findTxn(id); return t && t.actual==null && statusOf(t)==='planned' && (!t.history || t.history.length<=1); });
  const removeTxn = new Set(removableTxns);
  // A created plan survives when the transaction that committed it survives.
  const keptPlanIds = new Set(State.payrollPlans
    .filter(p=>c.payrollPlans.includes(p.id) && p.committedTxnId && !removeTxn.has(p.committedTxnId))
    .map(p=>p.id));
  // Resolve references against the state as it WILL BE after the removals above.
  const survivingTxns = State.txns.filter(t=>!removeTxn.has(t.id));
  const survivingPlans = State.payrollPlans.filter(p=>!c.payrollPlans.includes(p.id) || keptPlanIds.has(p.id));
  const refEmp = new Set([].concat(survivingTxns.map(t=>t.employeeId), survivingPlans.map(p=>p.employeeId)).filter(Boolean));
  const refCt  = new Set([].concat(survivingTxns.map(t=>t.contractId), survivingPlans.map(p=>p.contractId)).filter(Boolean));
  const keptContractIds = new Set(c.contracts.filter(id=>refCt.has(id)));
  const keptEmployeeIds = new Set(c.employees.filter(id=>refEmp.has(id)));
  return {
    removableTxns,
    blockedTxns: c.txns.length - removableTxns.length,
    // Reported counts are what will actually be removed…
    employees:    c.employees.length    - keptEmployeeIds.size,
    contracts:    c.contracts.length    - keptContractIds.size,
    payrollPlans: c.payrollPlans.length - keptPlanIds.size,
    // …and these are what is deliberately retained, so the operator is told why.
    keptEmployees: keptEmployeeIds.size,
    keptContracts: keptContractIds.size,
    keptPayrollPlans: keptPlanIds.size,
    keptPlanIds, keptContractIds, keptEmployeeIds
  };
}
async function undoLastSmartImport(){
  // UX-006C2C-3 (row 1) — reversing a committed import DELETES the records it created
  // across four domains (transactions, payroll plans, contracts, employees), and the undo
  // is itself irreversible. Authorized ONCE here, before the batch lookup and before any
  // mutation, persistence or completion marker: denied means nothing happened at all.
  if(!can(ACTIONS.IMPORT_UNDO)){ showWarning('You do not have permission to undo a Smart Import.'); return; }
  const batch = State.importBatches.find(b=>!b.undone);
  if(!batch){ showWarning('No Smart Import batch available to undo.'); return; }
  const pv = smartRollbackPreview(batch);
  const keptNote = (pv.keptPayrollPlans || pv.keptContracts || pv.keptEmployees)
    ? `\n${pv.keptEmployees} employee(s), ${pv.keptContracts} contract(s) and ${pv.keptPayrollPlans} payroll plan(s) will be KEPT because the executed transaction(s) above still reference them.`
    : '';
  if(!confirmAction(`Undo Smart Import "${batch.fileName}"?\n\nWill remove: ${pv.employees} employee(s), ${pv.contracts} contract(s), ${pv.payrollPlans} payroll plan(s), ${pv.removableTxns.length} planned transaction(s).\n${pv.blockedTxns?('\n'+pv.blockedTxns+' executed or modified transaction(s) will be KEPT (rollback never removes them).'):''}${keptNote}`)) return;
  const c = batch.created;
  const removeTxn = new Set(pv.removableTxns);
  State.txns = State.txns.filter(t=>!removeTxn.has(t.id));
  // Drop created payroll plans unless their transaction survived (executed/kept), and
  // keep the created contracts/employees the survivors still reference. The retained
  // sets come from smartRollbackPreview so what is REPORTED and what is REMOVED are
  // computed once, from the same predicates, and cannot drift apart.
  State.payrollPlans = State.payrollPlans.filter(p=>!c.payrollPlans.includes(p.id) || pv.keptPlanIds.has(p.id));
  State.contracts = State.contracts.filter(ct=>!c.contracts.includes(ct.id) || pv.keptContractIds.has(ct.id));
  State.employees = State.employees.filter(e=>!c.employees.includes(e.id) || pv.keptEmployeeIds.has(e.id));
  // Clean removed txn ids out of monthly plans.
  State.monthlyPlans.forEach(mp=>{ if(Array.isArray(mp.committedTxnIds)) mp.committedTxnIds = mp.committedTxnIds.filter(id=>!removeTxn.has(id)); });
  // The `undone` completion flag must be SET before the write, because it is part
  // of the importBatches payload being persisted.
  batch.undone = true; batch.undoneAt = new Date().toISOString(); batch.keptTxns = pv.blockedTxns;
  const saved = await saveAllData();
  if(saved !== true){
    // SPR-079 — the flag is a COMPLETION MARKER, and the operation did not
    // complete. It also selects the batch to undo (`find(b=>!b.undone)` above), so
    // leaving it set would both misrepresent completion in memory AND block any
    // further attempt for the rest of the session — the next click would report
    // "No Smart Import batch available to undo" and never reach storage again.
    // Clearing it restores the honest in-memory state and makes an immediate retry
    // possible once storage recovers.
    //
    // This is NOT a rollback and must never be described as one: only the marker
    // is cleared. The record removals above remain applied in memory, and whatever
    // the fan-out already wrote stays written. Re-running the undo is safe because
    // it recomputes purely from `batch.created` — removing already-removed records
    // is a no-op.
    batch.undone = false; delete batch.undoneAt; delete batch.keptTxns;
    showError('Some data could not be saved. The undo was not completed successfully — you can try again, or reload the page to return to the last saved state.', null, 9000);
    render();
    return;
  }
  // UX-006C2C-3 — the undo now leaves an audit entry, like its commit counterpart. It is
  // written ONLY after authorization succeeded AND the write succeeded, so a denied or
  // failed undo never claims one occurred.
  logActivity({type:'import.undo', module:'Import', entity:batch.fileName||'Smart Import', entityId:batch.batchId,
    desc:`Undone — removed ${pv.removableTxns.length} transaction(s), ${pv.payrollPlans} payroll plan(s), ${pv.contracts} contract(s), ${pv.employees} employee(s)${pv.blockedTxns?`; ${pv.blockedTxns} executed/modified transaction(s) preserved`:''}${(pv.keptPayrollPlans||pv.keptContracts||pv.keptEmployees)?`; ${pv.keptEmployees} employee(s), ${pv.keptContracts} contract(s), ${pv.keptPayrollPlans} payroll plan(s) retained as still referenced`:''}`,
    refs:{importBatchId:batch.batchId}});
  showSuccess(`Smart Import undone.${pv.blockedTxns?(' '+pv.blockedTxns+' executed/modified record(s) preserved.'):''}`, 6000);
  render();
}
