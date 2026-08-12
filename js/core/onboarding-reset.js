/* ============================================================
   ONBOARDING, EMPTY STATES, DATA RESET, DEMO, DASHBOARD OT (v2.3.0)
   ============================================================ */

/* ---------- actionable empty states (Part 16) ---------- */
function actionEmptyState(title, sub, btnLabel, targetView){
  return `<div class="card" style="max-width:640px;"><div class="empty">
    <div class="big">▢</div>
    <div style="color:var(--text);font-weight:600;margin-bottom:6px;">${escapeHtml(title)}</div>
    <div class="stack-section">${escapeHtml(sub)}</div>
    ${btnLabel?`<button class="btn btn-accent" data-empty-nav="${targetView}">${escapeHtml(btnLabel)}</button>`:''}
  </div></div>`;
}
function bindActionEmptyState(main){
  main.querySelectorAll('[data-empty-nav]').forEach(b=>b.addEventListener('click', ()=>{ State.view=b.dataset.emptyNav; render(); }));
}

/* ---------- first-run onboarding checklist (Part 2) ----------
   v2.6.6 — "Configure company settings" completion is derived purely from PERSISTED
   settings (tam_settings_v1), never from transient UI state, so it stays correct across
   navigation and reload. The company profile counts as configured when the user has made at
   least one meaningful change to the company identity: a non-default Company Name OR a
   non-default Product Name OR an Opening Cash Balance that has been set. Unchanged shipped
   defaults do NOT count (a fresh install is "not configured"), and a theme-only save does not
   count (Appearance is not a company-identity field). Optional blank fields never block it. */
// v2.7.1 — legacy inference retained ONLY as a conservative one-time fallback for
// settings/backups saved before the explicit marker existed (see companySettingsConfigured).
function legacyMeaningfulCompanyProfile(s){
  s = s || (typeof State!=='undefined' && State.settings) || {};
  const name = (s.companyName||'').trim();
  const product = (s.productName||'').trim();
  const nameSet = !!name && name !== COMPANY_NAME_DEFAULT;      // intentional, non-default company name
  const productSet = !!product && product !== APP_NAME;         // intentional, non-default product name
  const cashSet = s.openingCashBalance != null;                 // opening cash balance supplied
  return nameSet || productSet || cashSet;
}
// v2.7.1 — completion is driven by an explicit persisted marker set only after a successful
// Settings save (companySettingsConfiguredAt); the legacy inference is a fallback for older
// data so pre-marker backups with a meaningful identity stay checked. A fresh install has
// neither, so it is correctly "not configured".
function companySettingsConfigured(s){
  s = s || (typeof State!=='undefined' && State.settings) || {};
  return Boolean(s.companySettingsConfiguredAt || legacyMeaningfulCompanyProfile(s));
}
function onboardingSteps(){
  return [
    {label:'Configure company settings', done: companySettingsConfigured(State.settings), view:'settings'},
    {label:'Add employees', done: ((typeof getScopedRecords === 'function') ? getScopedRecords('employee') : State.employees).length>0, view:'employees'},
    {label:'Add employee contracts', done: State.contracts.length>0, view:'contracts'},
    {label:'Configure employee work schedules', done: ((typeof getScopedRecords === 'function') ? getScopedRecords('employee') : State.employees).some(e=>readSchedule(e))||State.contracts.some(c=>readSchedule(c)), view:'employees'},
    {label:'Configure recurring expenses', done: State.recurringExpenses.length>0, view:'recurring'},
    {label:'Generate payroll', done: State.payrollPlans.length>0, view:'payroll'},
    {label:'Create monthly plan', done: State.monthlyPlans.some(p=>p.status==='Committed'), view:'monthlyplan'},
    {label:'Execute transactions', done: State.txns.some(t=>['completed','partial'].includes(statusOf(t))), view:'executioncenter'},
  ];
}
function onboardingChecklistHTML(){
  if(State.settings.onboardingDismissed) return '';
  const steps = onboardingSteps(); const done = steps.filter(s=>s.done).length;
  if(done===steps.length) return '';
  return `<div class="card" style="margin-bottom:var(--space-4);border-left:3px solid var(--accent);">
    <h3>Getting Started <span class="tag">${done}/${steps.length} complete</span><button class="btn btn-sm" id="dismissOnb" style="float:right;">Dismiss</button></h3>
    <p class="hint" style="margin:-6px 0 12px;">Set up TAM OS with your real data. Click any step to jump there. This checklist never blocks navigation.</p>
    <div class="insight-list">${steps.map((s,i)=>`<div class="insight-item ${s.done?'good':''}" style="cursor:pointer;" data-onb="${s.view}"><b style="min-width:18px;display:inline-block;">${s.done?'✓':(i+1)+'.'}</b> ${escapeHtml(s.label)}</div>`).join('')}</div>
  </div>`;
}
function bindOnboarding(main){
  const d = main.querySelector('#dismissOnb');
  if(d) d.addEventListener('click', async e=>{ e.stopPropagation();
    // UX-006C2C-4 (row 28) — dismissing onboarding writes a setting: settings.manage.
    if(!can(ACTIONS.SETTINGS_MANAGE)){ showWarning('You do not have permission to change settings.'); return; }
    State.settings.onboardingDismissed=true; await saveSettings(); render(); });
  main.querySelectorAll('[data-onb]').forEach(b=>b.addEventListener('click', ()=>{ State.view=b.dataset.onb; render(); }));
}

/* ---------- meaningful-data detection (v2.5.2 fresh-install fix) ----------
   Existing company data is present ONLY when at least one real business dataset
   has records. Empty arrays, default settings, migration flags, schema version,
   empty backups/audit arrays, UI/theme/sidebar prefs and storage test keys are
   never counted. Import batches count only when they created/generated records. */
function meaningfulDataCounts(){
  const batchRecords = b => (b && b.created) ? ((b.created.employees||[]).length + (b.created.contracts||[]).length + (b.created.payrollPlans||[]).length + (b.created.txns||[]).length) : (b && b.counts ? ((b.counts.employees||0)+(b.counts.contracts||0)+(b.counts.payrollPlans||0)+(b.counts.txns||0)) : 0);
  return {
    'Transactions': State.txns.length,
    'Employees': ((typeof getScopedRecords === 'function') ? getScopedRecords('employee') : State.employees).length,
    'Contracts': State.contracts.length,
    'Payroll Plans': State.payrollPlans.length,
    'Recurring Expenses': State.recurringExpenses.length,
    'Monthly Plans': State.monthlyPlans.length,
    'Overtime Records': State.overtimeRecords.length,
    'Payroll Adjustments': State.payrollAdjustments.length,
    'Import Batches': State.importBatches.filter(b=>!b.undone && batchRecords(b)>0).length,
  };
}
function hasMeaningfulBusinessData(){
  const c = meaningfulDataCounts();
  return Object.keys(c).some(k=>c[k]>0);
}

/* ---------- first-run data-safety choice (Part 1) ---------- */
async function maybeShowFirstRunChoice(){
  if(!hasMeaningfulBusinessData()) return;          // fresh install — no real business data
  const ack = await StorageAdapter.get('tam_v23_ack');
  if(ack && ack.value==='done') return;             // already acknowledged
  const counts = meaningfulDataCounts();
  const nonZero = Object.keys(counts).filter(k=>counts[k]>0);
  const list = nonZero.map(k=>`<b>${counts[k]} ${escapeHtml(k.toLowerCase())}</b>`).join(', ');
  openModalHTML(`
    <h3>Existing data detected</h3>
    <p class="dim" style="font-size:13px;line-height:1.7;">TAM OS v${APP_VERSION} ships clean, but this browser already holds data from an earlier version — ${list}. Your data has <b>not</b> been changed. Choose how to proceed:</p>
    <div style="display:flex;flex-direction:column;gap:8px;margin-top:var(--space-4);">
      <button class="btn btn-accent" id="frKeep">Keep Existing Data</button>
      <button class="btn" id="frFresh">Export Backup &amp; Start Fresh…</button>
      <button class="btn" id="frCancel">Cancel (decide later)</button>
    </div>`, {width:520, onMount:(root)=>{
      root.querySelector('#frKeep').addEventListener('click', async ()=>{ await StorageAdapter.set('tam_v23_ack','done'); closeModal(); showSuccess('Keeping your existing data.'); });
      root.querySelector('#frFresh').addEventListener('click', ()=>{ closeModal(); startFresh(); });
      root.querySelector('#frCancel').addEventListener('click', closeModal);
    }});
}

/* ---------- Start Fresh (Part 1): backup → typed confirm → clear TAM keys ---------- */
const TAM_DATA_KEYS = ['tam_txns_v1','tam_settings_v1','tam_backups_v1'].concat(Object.values(HR_KEYS)).concat(['tam_migrated_exec_v21','tam_migrated_hr_v22','tam_migrated_norm_v221','tam_migrated_overtime_v23','tam_migrated_payrollops_v25','tam_migrated_dedup_v252','tam_v23_ack']);
async function startFresh(){
  // UX-006C2C-3 (row 7) — clears every TAM storage key including migration flags and
  // reloads into an empty state. Authorized before the backup download, the typed
  // confirmation and any StorageAdapter.remove.
  if(!can(ACTIONS.DATA_RESET)){ showWarning('You do not have permission to reset application data.'); return; }
  // 1. Force a complete JSON backup download first (never destroy without a copy).
  downloadBlob(JSON.stringify(buildCompleteBackup(),null,2), `${FILE_BASE}-pre-reset-backup-${new Date().toISOString().slice(0,10)}.json`, 'application/json');
  // 2. Typed confirmation.
  const typed = window.prompt('A complete backup has just been downloaded.\n\nThis permanently clears ALL TAM OS data in this browser and reloads into an empty state.\n\nType exactly:  DELETE ALL TAM DATA');
  if(typed !== 'DELETE ALL TAM DATA'){ showWarning('Reset cancelled — confirmation text did not match.'); return; }
  // 3. Clear only TAM keys (settings return to defaults on reload).
  for(const k of TAM_DATA_KEYS){ await StorageAdapter.remove(k); }
  // 4. Persist an audit record that survives the reset (separate key, not cleared).
  try{ const log = JSON.parse(window.localStorage.getItem('tam_audit_log_v1')||'[]'); log.unshift({event:'reset', ts:new Date().toISOString(), note:'Start Fresh — all TAM data cleared after backup and typed confirmation'}); window.localStorage.setItem('tam_audit_log_v1', JSON.stringify(log.slice(0,50))); }catch(e){}
  showSuccess('All TAM data cleared. Reloading into a clean empty state…', 3000);
  setTimeout(()=>location.reload(), 700);
}
function lastResetAudit(){
  try{ const log = JSON.parse(window.localStorage.getItem('tam_audit_log_v1')||'[]'); return log.find(x=>x.event==='reset')||null; }catch(e){ return null; }
}

/* ---------- optional Demo data (clearly labelled) ---------- */
async function loadDemoData(){
  // UX-006C2C-3 (row 8) — this creates employees and contracts, so it is exactly
  // employee.create (frozen ruling R4); no demo-specific action was introduced.
  if(!can(ACTIONS.EMPLOYEE_CREATE)){ showWarning('You do not have permission to create employees.'); return; }
  if(!confirmAction('Load a small DEMO dataset (2 employees with 6-hour and 8-hour schedules, active contracts)? It is clearly labelled DEMO and can be removed later with Start Fresh.')) return;
  const now = new Date().toISOString();
  const start = todayKey()+'-01';
  const mkEmp = (name, hours)=>({id:uid('emp'), employeeId:nextEmployeeCode(), fullName:name, jobTitle:'Demo Staff', department:'Demo', employmentStatus:'Active', active:true, monthlyBaseSalary:3500000, contractType:'Fixed-Term (PKWT)', joinDate:start, workHoursPerDay:hours, workDaysPerWeek:5, weeksPerMonth:4, demo:true, createdAt:now, updatedAt:now, history:[{event:'created', ts:now, note:'Demo data'}]});
  const a = mkEmp('DEMO — Employee A (6h)', 6); State.employees.push(a);
  const b = mkEmp('DEMO — Employee B (8h)', 8); State.employees.push(b);
  const mkCt = (emp, no)=>({id:uid('ct'), employeeId:emp.id, employeeName:emp.fullName, contractNumber:no, startDate:start, durationMonths:12, monthlySalary:3500000, status:'Active', demo:true, createdAt:now, updatedAt:now, history:[{event:'created', ts:now, note:'Demo contract'}]});
  State.contracts.push(mkCt(a,'DEMO-A/1')); State.contracts.push(mkCt(b,'DEMO-B/1'));
  await persistEmployees(); await persistContracts();
  showSuccess('Demo data loaded (labelled DEMO). Open Overtime and add 7.5 hours to see the calculation.', 5000);
  render();
}

/* ---------- dashboard overtime KPIs & alerts (Part 13) ---------- */
function overtimeMonthStats(monthKey){
  const recs = State.overtimeRecords.filter(o=>o.monthKey===monthKey);
  const hours = recs.reduce((s,o)=>s+num(o.overtimeHours),0);
  const cost = recs.reduce((s,o)=>s+num(o.approvedAmount!=null?o.approvedAmount:o.calculatedAmount),0);
  const emps = new Set(recs.filter(o=>num(o.overtimeHours)>0).map(o=>o.employeeId)).size;
  const pending = recs.filter(o=>['Draft','Submitted','Reviewed'].includes(o.status)).length;
  const approvedNotCommitted = recs.filter(o=>o.status==='Approved').length;
  return {hours, cost, emps, pending, approvedNotCommitted, count:recs.length};
}
/* UX-002B Phase 3 — Overtime Hours and Overtime Cost are merged. Hours remains the
   headline; cost stays visible as a secondary value on the same card, alongside the
   employee count it always carried. Pending Review and Approved-Not-Committed are
   preserved as their own tiles — they are the two actionable numbers here.
   overtimeMonthStats() is untouched: no overtime calculation changes. */
function overtimeStripHTML(monthKey){
  const s = overtimeMonthStats(monthKey);
  return `<div class="card stat-card"><div class="stat-label">Overtime (${escapeHtml(keyToMonthObj(monthKey).month)})</div><div class="stat-value">${s.hours.toLocaleString('id-ID',{maximumFractionDigits:2})} <span class="dim" style="font-size:var(--fs-2);">hrs</span></div><div class="stat-sub dim">cost <b class="mono">${fmtIDRShort(s.cost)}</b> · ${s.emps} employee(s)</div></div>
    <div class="card stat-card"><div class="stat-label">Pending Review</div><div class="stat-value" style="color:${s.pending?'var(--accent)':'inherit'}">${s.pending}</div><div class="stat-sub dim">draft / submitted / reviewed</div></div>
    <div class="card stat-card"><div class="stat-label">Approved, Not Committed</div><div class="stat-value" style="color:${s.approvedNotCommitted?'var(--brick)':'inherit'}">${s.approvedNotCommitted}</div><div class="stat-sub dim">not yet in payroll</div></div>`;
}
function overtimeDashboardAlerts(monthKey){
  const alerts = [];
  const s = overtimeMonthStats(monthKey);
  if(s.approvedNotCommitted) alerts.push({type:'warn', text:`${s.approvedNotCommitted} approved overtime record(s) for ${escapeHtml(keyToMonthObj(monthKey).month)} are not yet included in payroll.`});
  // employee with overtime but no active contract
  State.overtimeRecords.filter(o=>o.monthKey===monthKey).forEach(o=>{ if(!coveringContract(o.employeeId, monthKey)) alerts.push({type:'warn', text:`${escapeHtml(o.employeeName)} has overtime but no active contract covering ${escapeHtml(keyToMonthObj(monthKey).month)}.`}); });
  // missing work schedule
  // Readiness-1 (identity closure) — these alerts NAME employees.
  ((typeof getScopedRecords === 'function') ? getScopedRecords('employee') : State.employees).filter(empEligible).forEach(e=>{ const sched=effectiveSchedule(e, activeContractToday(e.id)); if(!sched.valid) alerts.push({type:'warn', text:`${escapeHtml(e.fullName)} has no valid work schedule — overtime cannot be calculated.`}); });
  // unusually high overtime vs prior month
  const prev = prevMonthKey(monthKey); const prevH = overtimeMonthStats(prev).hours;
  if(prevH>0 && s.hours > prevH*2 && s.hours>=(Number(State.settings.highOvertimeWarningHours)||40)) alerts.push({type:'warn', text:`Overtime hours this month (${s.hours}) are more than double last month (${prevH}).`});
  // dedupe safety
  const seen={}; let dup=0; State.overtimeRecords.filter(o=>o.monthKey===monthKey).forEach(o=>{ const k=o.employeeId+'|'+o.overtimeDate+'|'+o.overtimeHours; if(seen[k]) dup++; else seen[k]=1; });
  if(dup) alerts.push({type:'warn', text:`${dup} possible duplicate overtime record(s) this month.`});
  return alerts;
}

/* ---------- payroll operations dashboard (Part 16) ---------- */
/* UX-002B Phase 3 — the Payroll Cycle tile is promoted into the Executive Dashboard's
   primary row (payrollCycleTileHTML below), so the strip carries the three remaining
   payroll figures. "Total Payroll Planned" is the survivor of its merge with the HR
   strip's duplicate "Payroll Planned" and now shows the committed-plan count too.
   The composite "Committed / Contracts Soon" is SPLIT: Committed keeps its own tile,
   and the expiring-soon value is rendered once, on Active Contracts in the HR strip.
   No payroll calculation changes — payrollMonthTotals()/payrollCycleStatus() are as
   they were, and contract-expiry semantics are untouched. */
function payrollCycleTileHTML(monthKey){
  const tot = payrollMonthTotals(monthKey);
  const cs = payrollCycleStatus(monthKey);
  const excluded = ((typeof getScopedRecords === 'function') ? getScopedRecords('employee') : State.employees).filter(e=>payrollExclusionReason(e, monthKey)).length;
  return `<div class="card stat-card">
    <div class="stat-label">Payroll Cycle (${escapeHtml(keyToMonthObj(monthKey).month)})</div>
    <div class="stat-value" style="font-size:15px;">${cycleStatusPill(cs)}</div>
    <div class="stat-sub dim">${tot.count} included · ${excluded} excluded</div>
  </div>`;
}
function payrollStripHTML(monthKey){
  const tot = payrollMonthTotals(monthKey);
  return `<div class="card stat-card"><div class="stat-label">Total Payroll Planned</div><div class="stat-value">${fmtIDRShort(tot.planned)}</div><div class="stat-sub dim">overtime ${fmtIDRShort(tot.overtime)}</div></div>
    <div class="card stat-card"><div class="stat-label">Payroll Paid / Remaining</div><div class="stat-value">${fmtIDRShort(tot.paid)}</div><div class="stat-sub dim">remaining ${fmtIDRShort(tot.remaining)}</div></div>
    <div class="card stat-card"><div class="stat-label">Committed</div><div class="stat-value">${tot.committed}</div><div class="stat-sub dim">payroll plans committed</div></div>`;
}
function payrollDashboardAlerts(monthKey){
  const alerts=[]; const mo=keyToMonthObj(monthKey); const cs=payrollCycleStatus(monthKey);
  const plans=payrollPlansForMonth(monthKey);
  // Readiness-1 — this Action Center generator names employees; scope its source.
  const eligible=((typeof getScopedRecords === 'function') ? getScopedRecords('employee') : State.employees).filter(e=>!payrollExclusionReason(e, monthKey));
  if(cs==='Not Generated' && eligible.length) alerts.push({type:'info', text:`Payroll not generated for ${escapeHtml(mo.month)} (${eligible.length} eligible employee(s)).`});
  if(plans.some(p=>p.status==='Draft')) alerts.push({type:'info', text:`Payroll generated but ${plans.filter(p=>p.status==='Draft').length} row(s) not yet reviewed for ${escapeHtml(mo.month)}.`});
  if(plans.some(p=>p.status==='Ready')) alerts.push({type:'warn', text:`${plans.filter(p=>p.status==='Ready').length} Ready payroll row(s) not yet committed for ${escapeHtml(mo.month)}.`});
  plans.forEach(p=>{
    if(payrollBaseSalary(p)<=0) alerts.push({type:'warn', text:`${escapeHtml(p.employeeName)} has missing salary in ${escapeHtml(mo.month)} payroll.`});
    if(p.workScheduleSnapshot && p.workScheduleSnapshot.valid===false) alerts.push({type:'warn', text:`${escapeHtml(p.employeeName)} has no valid work schedule.`});
    if(p.salaryOverride) alerts.push({type:'info', text:`Salary override used for ${escapeHtml(p.employeeName)} (${escapeHtml(p.salaryOverride.reason)}).`});
    if(p.otChanged && isPayrollCommitted(p)) alerts.push({type:'warn', text:`Approved overtime changed after commit for ${escapeHtml(p.employeeName)} — review the adjustment.`});
    else if(p.otChanged) alerts.push({type:'info', text:`Payroll for ${escapeHtml(p.employeeName)} changed (overtime updated) — re-review.`});
    const txn=payrollTxnOf(p);
    if(txn && statusOf(txn)==='partial') alerts.push({type:'info', text:`Partial payroll payment for ${escapeHtml(p.employeeName)}.`});
    if(txn && txn.actual==null){ const d=execScheduleDate(txn); if(d && d<isoToday()) alerts.push({type:'warn', text:`Payroll transaction overdue for ${escapeHtml(p.employeeName)} (${escapeHtml(d)}).`}); }
  });
  // approved overtime not included
  ((typeof getScopedRecords === 'function') ? getScopedRecords('employee') : State.employees).filter(empEligible).forEach(e=>{ const ot=approvedOvertimeForMonth(e.id, monthKey); const pp=plans.find(p=>p.employeeId===e.id); if(ot.ids.length && pp && !sameIdSet(pp.overtimeIds, ot.ids)) alerts.push({type:'warn', text:`Approved overtime for ${escapeHtml(e.fullName)} is not fully included in payroll.`}); });
  return alerts;
}
