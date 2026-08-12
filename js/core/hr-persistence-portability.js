/* ============================================================
   PEOPLE & CONTRACTS PERSISTENCE (v2.2.0)
   New storage keys, loaded/saved through StorageAdapter alongside
   the existing finance data. All keys are additive — existing
   transaction/settings/backup keys are never touched here.
   ============================================================ */
const HR_KEYS = {
  employees: 'tam_employees_v1',
  contracts: 'tam_contracts_v1',
  payrollPlans: 'tam_payroll_plans_v1',
  recurringExpenses: 'tam_recurring_expenses_v1',
  monthlyPlans: 'tam_monthly_plans_v1',
  overtimeRecords: 'tam_overtime_records_v1', // v2.3.0
  importBatches: 'tam_import_batches_v1',      // v2.4.0 Smart Import audit + undo
  payrollAdjustments: 'tam_payroll_adjustments_v1', // v2.5.0 recurring payroll adjustments
  employeeMerges: 'tam_employee_merges_v1',    // v2.5.2 employee dedup/merge audit
  companyAccounts: 'tam_company_accounts_v1',   // v2.6.9 structured Company Bank Accounts
  supplementalPayments: 'tam_supplemental_payments_v1', // v2.7.0 Supplemental Payroll Engine
};
async function loadHRData(){
  for(const [stateKey, storeKey] of Object.entries(HR_KEYS)){
    try{
      const res = await StorageAdapter.get(storeKey);
      const parsed = (res && res.value) ? safeParse(res.value, stateKey) : null;
      State[stateKey] = Array.isArray(parsed) ? parsed : [];
    }catch(e){ console.error('loadHRData error for '+storeKey, e); State[stateKey] = []; }
  }
}
async function persistHR(stateKey){
  const storeKey = HR_KEYS[stateKey];
  if(!storeKey){ console.error('persistHR: unknown key '+stateKey); return false; }
  const ok = await StorageAdapter.set(storeKey, JSON.stringify(State[stateKey]));
  if(!ok) console.error('persistHR: '+stateKey+' was not persisted');
  return ok === true;
}
async function persistEmployees(){ return persistHR('employees'); }
async function persistContracts(){ return persistHR('contracts'); }
async function persistPayrollPlans(){ return persistHR('payrollPlans'); }
async function persistRecurring(){ return persistHR('recurringExpenses'); }
async function persistMonthlyPlans(){ return persistHR('monthlyPlans'); }
async function persistOvertime(){ return persistHR('overtimeRecords'); }
async function persistPayrollAdjustments(){ return persistHR('payrollAdjustments'); }
async function persistEmployeeMerges(){ return persistHR('employeeMerges'); }
async function persistCompanyAccounts(){ return persistHR('companyAccounts'); }
async function persistSupplementalPayments(){ return persistHR('supplementalPayments'); }
// v2.6.9 — one-time, guarded, non-destructive seed of structured Company Bank Accounts
// from the legacy BANK_ACCOUNTS strings, for backward compatibility (existing
// transactions store one of those strings in `bankAccount`, and the seeded accounts'
// labels match those strings so they keep resolving). A FRESH install stays EMPTY —
// nothing is seeded unless the install already carries business data. Existing account
// data is never overwritten. No schema/storage-shape change.
async function migrateSeedCompanyAccounts(){
  try{
    const flagRes = await StorageAdapter.get('tam_migrated_bankaccts_v269');
    if(flagRes && flagRes.value) return;
    if(!Array.isArray(State.companyAccounts)) State.companyAccounts = [];
    const hasData = (State.txns&&State.txns.length) || (State.employees&&State.employees.length)
      || (State.recurringExpenses&&State.recurringExpenses.length) || (State.monthlyPlans&&State.monthlyPlans.length);
    if(State.companyAccounts.length===0 && hasData){
      const now = new Date().toISOString();
      // Metadata for the known legacy labels; the label list itself is the single source
      // of truth (BANK_ACCOUNTS in constants.js) so the two never drift.
      const META = {
        'Mandiri Operational':{bankName:'Bank Mandiri', purpose:'Operational'},
        'Mandiri Payroll':    {bankName:'Bank Mandiri', purpose:'Payroll'},
        'BCA':                {bankName:'BCA', purpose:'Operational'},
        'BSI':                {bankName:'Bank Syariah Indonesia', purpose:'Payroll'},
        'Cash':               {bankName:'', purpose:'Petty Cash'},
      };
      BANK_ACCOUNTS.forEach(label=>{
        const m = META[label] || {bankName:'', purpose:'Other'};
        State.companyAccounts.push({
          id:uid('cacc'), label, bankName:m.bankName, holder:'', accountNumber:'',
          purpose:m.purpose, status:'Active', notes:'Seeded from legacy bank list (v2.6.9)',
          createdAt:now, updatedAt:now,
        });
      });
      await persistCompanyAccounts();
    }
    await StorageAdapter.set('tam_migrated_bankaccts_v269','done');
  }catch(e){ console.error('migrateSeedCompanyAccounts error', e); }
}
// Part 13 — one-time, guarded, non-destructive upgrade to the v2.5.2 dedup schema.
// Ensures the merge-audit array exists and takes a safety backup. NEVER merges
// existing duplicates automatically — they are only detected and surfaced.
async function migrateToDedupSchema(){
  try{
    const flag = await StorageAdapter.get('tam_migrated_dedup_v252');
    if(flag && flag.value==='done') return;
    if(!Array.isArray(State.employeeMerges)) State.employeeMerges=[];
    if(State.txns.length){
      State.backups.unshift({id:uid('backup'), monthKey:'__all__', monthLabel:'Pre-2.5.2 (Employee Deduplication) migration', timestamp:new Date().toISOString(), txns:JSON.parse(JSON.stringify(State.txns)), migration:true});
      await saveBackups();
    }
    await persistHR('employeeMerges');
    await StorageAdapter.set('tam_migrated_dedup_v252','done');
  }catch(e){ console.error('dedup migration error', e); }
}

// One-time, guarded upgrade to the v2.2 People & Contracts schema. Creates a
// pre-migration safety backup of transactions (existing finance data is never
// modified or deleted), then seeds empty master-data collections if absent.
async function migrateToHRSchema(){
  try{
    const flagRes = await StorageAdapter.get('tam_migrated_hr_v22');
    if(flagRes && flagRes.value==='done') return;
    // Safety backup of current transactions before the new schema (skip when empty).
    if(State.txns.length){
      State.backups.unshift({
        id: uid('backup'), monthKey:'__all__', monthLabel:'Pre-2.2 (People & Contracts) migration',
        timestamp: new Date().toISOString(), txns: JSON.parse(JSON.stringify(State.txns)), migration:true,
      });
      await saveBackups();
    }
    // Ensure the new collections exist and are persisted exactly once.
    ['employees','contracts','payrollPlans','recurringExpenses','monthlyPlans'].forEach(k=>{ if(!Array.isArray(State[k])) State[k]=[]; });
    await Promise.all(['employees','contracts','payrollPlans','recurringExpenses','monthlyPlans'].map(persistHR));
    await StorageAdapter.set('tam_migrated_hr_v22', 'done');
    if(State.txns.length) toast('Upgraded to the Employee, Contract & Monthly Planning Engine.', 4000);
  }catch(e){
    console.error('HR migration error', e);
  }
}

// One-time, guarded upgrade to the v2.3 Overtime schema. Backs up current data
// only when data exists, then ensures the overtime collection is present.
// No historical transaction actual amount or payroll total is altered.
async function migrateToOvertimeSchema(){
  try{
    const flagRes = await StorageAdapter.get('tam_migrated_overtime_v23');
    if(flagRes && flagRes.value==='done'){ if(!Array.isArray(State.overtimeRecords)) State.overtimeRecords=[]; return; }
    if(State.txns.length || State.employees.length){
      State.backups.unshift({
        id: uid('backup'), monthKey:'__all__', monthLabel:'Pre-2.3 (Overtime Engine) migration',
        timestamp: new Date().toISOString(), txns: JSON.parse(JSON.stringify(State.txns)), migration:true,
      });
      await saveBackups();
    }
    if(!Array.isArray(State.overtimeRecords)) State.overtimeRecords = [];
    await persistOvertime();
    await StorageAdapter.set('tam_migrated_overtime_v23', 'done');
    if(State.employees.length) toast('Upgraded to the Payroll Overtime Engine (v2.3.0).', 4000);
  }catch(e){ console.error('Overtime migration error', e); }
}
// v2.5.0 — one-time, backed-up upgrade to the Native Payroll Operations schema.
// Normalizes ONLY missing fields on existing payroll plans (review status,
// snapshots, split addition/deduction, history). Never rewrites historical
// totals or transaction actual amounts.
async function migrateToPayrollOpsSchema(){
  try{
    const flagRes = await StorageAdapter.get('tam_migrated_payrollops_v25');
    if(flagRes && flagRes.value==='done'){ if(!Array.isArray(State.payrollAdjustments)) State.payrollAdjustments=[]; return; }
    if(State.payrollPlans.length || State.txns.length){
      State.backups.unshift({id:uid('backup'), monthKey:'__all__', monthLabel:'Pre-2.5 (Native Payroll Operations) migration',
        timestamp:new Date().toISOString(), txns:JSON.parse(JSON.stringify(State.txns)), migration:true});
      await saveBackups();
    }
    if(!Array.isArray(State.payrollAdjustments)) State.payrollAdjustments = [];
    let touched=false;
    State.payrollPlans.forEach(p=>{
      // Map legacy lowercase 'committed' → 'Committed'; default others to Draft.
      if(!p.status || p.status==='committed'){ p.status = p.status==='committed'?'Committed':'Draft'; touched=true; }
      else if(!['Draft','Reviewed','Ready','Committed','Cancelled'].includes(p.status)){ p.status='Committed'; touched=true; }
      if(p.otherAddition===undefined){ p.otherAddition = 0; touched=true; }
      if(p.otherDeduction===undefined){ p.otherDeduction = 0; touched=true; }
      if(p.overtimeAmount===undefined){ p.overtimeAmount = num(p.overtime); touched=true; }
      if(p.baseSalarySnapshot===undefined){ p.baseSalarySnapshot = num(p.baseSalary); touched=true; }
      if(p.contractProgressSnapshot===undefined){ p.contractProgressSnapshot = p.contractProgress||null; touched=true; }
      if(!Array.isArray(p.recurringAdjustmentIds)){ p.recurringAdjustmentIds = []; touched=true; }
      if(p.transactionId===undefined){ p.transactionId = p.committedTxnId||null; touched=true; }
      if(!Array.isArray(p.history)){ p.history = [{event:'generated', ts:p.createdAt||null, note:'Existing payroll plan (pre-2.5)'}]; touched=true; }
      if(!p.createdAt){ p.createdAt = new Date().toISOString(); touched=true; }
      if(!p.updatedAt){ p.updatedAt = p.createdAt; touched=true; }
    });
    if(touched) await persistPayrollPlans();
    await persistHR('payrollAdjustments');
    await StorageAdapter.set('tam_migrated_payrollops_v25', 'done');
    if(State.payrollPlans.length) toast('Upgraded to the Native Payroll Operations Engine (v2.5.0).', 4000);
  }catch(e){ console.error('Payroll ops migration error', e); }
}

/* ============================================================
   DATA PORTABILITY (v2.1.1) — complete backup export / restore.
   Moves the full dataset (transactions + settings + backups)
   between browsers, or between the Claude Artifact and the
   standalone HTML file.
   ============================================================ */
function buildCompleteBackup(){
  return {
    app: APP_NAME,
    version: APP_VERSION,
    release: APP_RELEASE_NAME,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    storageMode: StorageAdapter.mode,
    txns: State.txns,
    settings: State.settings,
    backups: State.backups,
    employees: State.employees,
    contracts: State.contracts,
    payrollPlans: State.payrollPlans,
    recurringExpenses: State.recurringExpenses,
    monthlyPlans: State.monthlyPlans,
    overtimeRecords: State.overtimeRecords,
    importBatches: State.importBatches,
    payrollAdjustments: State.payrollAdjustments,
    companyAccounts: State.companyAccounts,
    supplementalPayments: State.supplementalPayments,
  };
}
// Validates an uploaded complete-backup object. Returns {ok, errors, info}
// where info powers the pre-restore preview. Nothing is modified here.
function validateCompleteBackup(data){
  const errors = [];
  if(!data || typeof data!=='object' || Array.isArray(data)){
    return {ok:false, errors:['File is not a JSON object — expected a Complete Backup exported from Settings → Data Portability.'], info:null};
  }
  if(!Array.isArray(data.txns)){
    errors.push('Missing or invalid "txns" array — this does not look like a Complete Backup file.');
  } else {
    const bad = data.txns.filter(t=>!t || typeof t!=='object' || !t.id || !t.monthKey || t.uraian===undefined);
    if(bad.length) errors.push(bad.length+' transaction(s) are missing required fields (id, monthKey, uraian).');
  }
  if(data.settings!==undefined && data.settings!==null && (typeof data.settings!=='object' || Array.isArray(data.settings))) errors.push('"settings" is present but is not an object.');
  if(data.backups!==undefined && data.backups!==null && !Array.isArray(data.backups)) errors.push('"backups" is present but is not an array.');
  const info = errors.length ? null : {
    txnCount: data.txns.length,
    monthCount: new Set(data.txns.map(t=>t.monthKey)).size,
    hasSettings: !!data.settings,
    companyName: data.settings ? (data.settings.companyName||'—') : '—',
    backupCount: Array.isArray(data.backups) ? data.backups.length : 0,
    employeeCount: Array.isArray(data.employees) ? data.employees.length : 0,
    overtimeCount: Array.isArray(data.overtimeRecords) ? data.overtimeRecords.length : 0,
    companyAccountCount: Array.isArray(data.companyAccounts) ? data.companyAccounts.length : 0,
    supplementalCount: Array.isArray(data.supplementalPayments) ? data.supplementalPayments.length : 0,
    schemaVersion: (data.schemaVersion===undefined||data.schemaVersion===null) ? 'not recorded' : String(data.schemaVersion),
    sourceApp: data.app || 'unknown', sourceVersion: data.version || 'unknown',
    exportedAt: data.exportedAt || null,
  };
  return {ok: errors.length===0, errors, info};
}
// HR datasets carried by a Complete Backup (employeeMerges is audit-only and not exported/restored).
const RESTORE_HR_KEYS = ['employees','contracts','payrollPlans','recurringExpenses','monthlyPlans','overtimeRecords','importBatches','payrollAdjustments','companyAccounts','supplementalPayments'];
// v2.7.2 — transaction-safe Complete Backup restore. Validates first, keeps a full deep-cloned
// pre-restore snapshot, checks every write, and on ANY failure rolls the in-memory state back AND
// re-persists the original values to every key it had already overwritten. Returns {ok, reason}.
async function restoreCompleteBackup(data){
  // UX-006C2C-3 (row 5) — the Complete Backup restore replaces EVERY collection plus
  // settings and backups: the largest blast radius in the application. Authorized first,
  // before validation, before the pre-restore safety backup and before any write, so a
  // denial creates no safety backup and performs no storage write. Validation, snapshot,
  // multi-store replacement, write-result inspection and rollback-on-failure below are
  // unchanged.
  if(!can(ACTIONS.DATA_RESTORE)) return {ok:false, reason:'You do not have permission to restore data.'};
  // 1) Validate the whole file BEFORE mutating any State.
  const v = (typeof validateCompleteBackup==='function') ? validateCompleteBackup(data) : {ok:Array.isArray(data&&data.txns), errors:['Invalid backup.']};
  if(!v.ok) return {ok:false, reason:'Backup file failed validation: '+((v.errors&&v.errors[0])||'invalid file.')};

  // 2) Full deep-cloned snapshot of the pre-restore in-memory State (for rollback).
  const clone = x=>JSON.parse(JSON.stringify(x===undefined?null:x));
  const snap = {txns:clone(State.txns), settings:clone(State.settings), backups:clone(State.backups)};
  RESTORE_HR_KEYS.forEach(k=>{ snap[k]=clone(State[k]||[]); });

  // Automatic safety backup of the CURRENT data before anything is replaced.
  const safety = {
    id: uid('backup'), monthKey:'__all__',
    monthLabel:'Pre-restore safety backup (all months)',
    timestamp: new Date().toISOString(),
    txns: clone(State.txns),
    safety: true,
  };

  // 3) Apply the restore to State (in memory only).
  State.txns = data.txns.map(raw=>{
    const t = {...raw};
    if(!t.status) t.status = computeStatus(t);
    if(!t.history) t.history = [{event:'created', ts:null, note:'Restored from complete backup'}];
    return t;
  });
  if(data.settings) State.settings = {...DEFAULT_SETTINGS, ...data.settings, schemaVersion: SCHEMA_VERSION};
  RESTORE_HR_KEYS.forEach(k=>{ if(Array.isArray(data[k])) State[k] = clone(data[k]); });
  State.backups = [safety, ...(Array.isArray(data.backups)?data.backups:[])].slice(0,25); // safety first survives the cap

  // 4) Persist every dataset with explicit result checks.
  const writes = [];
  writes.push(['transactions', await persist()]);
  writes.push(['settings', await saveSettings()]);
  writes.push(['backups', await saveBackups()]);
  for(const k of RESTORE_HR_KEYS){ writes.push([k, await persistHR(k)]); }
  const failed = writes.filter(w=>!w[1]).map(w=>w[0]);

  if(failed.length){
    // 5) Roll back: restore in-memory state AND re-write the original values to every key.
    State.txns = snap.txns; State.settings = snap.settings; State.backups = snap.backups;
    RESTORE_HR_KEYS.forEach(k=>{ State[k] = snap[k]; });
    const rbFail = [];
    if(!(await persist())) rbFail.push('transactions');
    if(!(await saveSettings())) rbFail.push('settings');
    if(!(await saveBackups())) rbFail.push('backups');
    for(const k of RESTORE_HR_KEYS){ if(!(await persistHR(k))) rbFail.push(k); }
    if(rbFail.length){
      return {ok:false, reason:`Restore failed writing [${failed.join(', ')}], and the automatic rollback could not fully complete [${rbFail.join(', ')}]. Data may be partially changed — do NOT continue: reload the app, then restore from your original backup file. Storage is likely full or unavailable.`};
    }
    return {ok:false, reason:`Restore failed while writing [${failed.join(', ')}] (storage error). Your previous data was rolled back and is intact. Free up storage and try again.`};
  }

  // 6) Success — restored data already carries lifecycle fields; don't re-run those migrations.
  await StorageAdapter.set('tam_migrated_exec_v21', 'done');
  await StorageAdapter.set('tam_migrated_hr_v22', 'done');
  await StorageAdapter.set('tam_migrated_overtime_v23', 'done');
  const months = getMonths();
  State.selectedMonth = months.length ? months[months.length-1].key : null;
  return {ok:true};
}
