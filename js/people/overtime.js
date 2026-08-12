/* ============================================================
   OVERTIME ENGINE (v2.3.0)
   TAM Internal Overtime Calculation Method:
     Monthly Standard Hours = hours/day × days/week × weeks/month
     Hourly Rate            = Monthly Salary ÷ Monthly Standard Hours   (full precision)
     Overtime Amount        = Overtime Hours × Hourly Rate              (round ONLY the final payable)
   Each employee/contract carries its own schedule — no global assumption.
   ============================================================ */

/* ---------- work schedule resolution (Part 3) ---------- */
function readSchedule(o){
  if(!o) return null;
  const h=Number(o.workHoursPerDay), d=Number(o.workDaysPerWeek), w=Number(o.weeksPerMonth);
  if(o.workHoursPerDay||o.workDaysPerWeek||o.weeksPerMonth){
    return {hoursPerDay:h||0, daysPerWeek:d||0, weeksPerMonth:w||0, effectiveDate:o.scheduleEffectiveDate||null, notes:o.scheduleNotes||null};
  }
  return null;
}
// Precedence: contract schedule → employee schedule → company default settings.
function effectiveSchedule(emp, contract){
  const fromCt = readSchedule(contract), fromEmp = readSchedule(emp);
  const base = fromCt || fromEmp || {
    hoursPerDay:Number(State.settings.companyWorkHoursPerDay)||8,
    daysPerWeek:Number(State.settings.companyWorkDaysPerWeek)||5,
    weeksPerMonth:Number(State.settings.companyWeeksPerMonth)||4,
    effectiveDate:null, notes:'Company default schedule',
  };
  const source = fromCt?'contract':fromEmp?'employee':'company';
  const valid = base.hoursPerDay>0 && base.daysPerWeek>0 && base.weeksPerMonth>0;
  return {...base, source, valid};
}
// Shared work-schedule form fields for the employee and contract modals (Part 3).
// Blank = inherit (employee inherits company; contract inherits employee).
function scheduleFieldsHTML(v, scopeLabel){
  return `
    <div class="field" style="grid-column:span 2;"><div class="divider" style="margin:6px 0;"></div><label style="font-weight:600;">Work Schedule <span class="faint">(${scopeLabel} — leave blank to inherit)</span></label></div>
    <div class="field"><label>Working Hours / Day</label><input class="input" type="number" step="0.5" min="0" name="workHoursPerDay" value="${v.workHoursPerDay??''}" placeholder="e.g. 6 or 8"></div>
    <div class="field"><label>Working Days / Week</label><input class="input" type="number" step="1" min="0" name="workDaysPerWeek" value="${v.workDaysPerWeek??''}" placeholder="default 5"></div>
    <div class="field"><label>Weeks / Month</label><input class="input" type="number" step="1" min="0" name="weeksPerMonth" value="${v.weeksPerMonth??''}" placeholder="default 4"></div>
    <div class="field"><label>Schedule Effective Date</label><input class="input" type="date" name="scheduleEffectiveDate" value="${escapeHtml(v.scheduleEffectiveDate||'')}"></div>
    <div class="field" style="grid-column:span 2;"><label>Schedule Notes</label><input class="input" name="scheduleNotes" value="${escapeHtml(v.scheduleNotes||'')}"></div>`;
}
function applyScheduleFromForm(fd, rec){
  const h=fd.get('workHoursPerDay'), d=fd.get('workDaysPerWeek'), w=fd.get('weeksPerMonth');
  rec.workHoursPerDay = (h===''||h==null)?null:Number(h);
  rec.workDaysPerWeek = (d===''||d==null)?null:Number(d);
  rec.weeksPerMonth   = (w===''||w==null)?null:Number(w);
  rec.scheduleEffectiveDate = fd.get('scheduleEffectiveDate')||null;
  rec.scheduleNotes = (fd.get('scheduleNotes')||'').trim()||null;
}

/* ---------- overtime calculation (Parts 4, 5) ---------- */
function roundOvertime(v){
  const rule = OVERTIME_ROUNDING[State.settings.overtimeRounding] || OVERTIME_ROUNDING.rupiah;
  if(!rule.step) return v;                 // no rounding
  return Math.round(v/rule.step)*rule.step; // round only the final payable amount
}
// Full-precision calculation. The hourly rate is NEVER rounded before it is
// multiplied by hours — only the payable amount is rounded (per settings).
function overtimeCalc(salary, sched, hours){
  const standardHours = (Number(sched.hoursPerDay)||0)*(Number(sched.daysPerWeek)||0)*(Number(sched.weeksPerMonth)||0);
  const hourlyRate = standardHours>0 ? (Number(salary)||0)/standardHours : 0;
  const rawAmount = hourlyRate * (Number(hours)||0);
  return {standardHours, hourlyRate, rawAmount, amount: roundOvertime(rawAmount)};
}
// Salary basis for overtime: active contract's monthly salary, else employee base.
function overtimeSalaryBasis(emp, contract){
  if(contract && contract.monthlySalary!=null) return Number(contract.monthlySalary)||0;
  return Number(emp && emp.monthlyBaseSalary)||0;
}
function fmtIDRfull(n){ if(n==null||isNaN(n)) return '—'; return 'Rp'+Number(n).toLocaleString('id-ID',{maximumFractionDigits:4}); }

/* ---------- overtime record operations (Parts 6, 7) ---------- */
function overtimeById(id){ return State.overtimeRecords.find(o=>o.id===id); }
function overtimeForEmployeeMonth(empId, monthKey){ return State.overtimeRecords.filter(o=>o.employeeId===empId && o.monthKey===monthKey); }
// Overtime that should feed payroll for an employee/month: approved (not yet
// committed) plus anything already committed for that employee/month.
function approvedOvertimeForMonth(empId, monthKey){
  const recs = overtimeForEmployeeMonth(empId, monthKey).filter(o=>o.status==='Approved' || o.status==='Committed to Payroll');
  const amount = recs.reduce((s,o)=>s+num(o.approvedAmount!=null?o.approvedAmount:o.calculatedAmount),0);
  return {records:recs, amount, ids:recs.map(o=>o.id)};
}
function buildOvertimeRecord(fields){
  const emp = empById(fields.employeeId);
  const contract = fields.contractId ? contractById(fields.contractId) : (emp?activeContractToday(emp.id):null);
  const sched = effectiveSchedule(emp, contract);
  const salary = overtimeSalaryBasis(emp, contract);
  const hours = Math.max(0, num(fields.overtimeHours));
  const calc = overtimeCalc(salary, sched, hours);
  const mo = keyToMonthObj(fields.monthKey);
  const now = new Date().toISOString();
  return {
    id: uid('ot'), employeeId: emp?emp.id:null, employeeName: emp?emp.fullName:'', contractId: contract?contract.id:null, contractNumber: contract?contract.contractNumber:null,
    payrollPlanId:null, committedTxnId:null,
    monthKey: fields.monthKey, month:mo.month, year:mo.year, monthNum:mo.monthNum,
    overtimeDate: fields.overtimeDate||null, overtimeHours: hours, workDescription: fields.workDescription||'', project: fields.project||null,
    // snapshots — preserved even if schedule/salary later change
    snapHoursPerDay: sched.hoursPerDay, snapDaysPerWeek: sched.daysPerWeek, snapWeeksPerMonth: sched.weeksPerMonth, snapMonthlySalary: salary, scheduleSource: sched.source,
    monthlyStandardHours: calc.standardHours, hourlyRate: calc.hourlyRate,
    calculatedAmount: calc.amount, rawAmount: calc.rawAmount, approvedAmount: null,
    status: 'Draft', notes: fields.notes||'', createdAt: now, updatedAt: now,
    history:[{event:'created', ts:now, note:'Overtime record created'}],
  };
}
async function addOvertimeRecord(fields){
  const rec = buildOvertimeRecord(fields);
  // UX-006C2B — authorize the candidate (own + Draft for Employee; CEO pass-through)
  // BEFORE it enters State or is persisted (SE-0). Returns null on denial.
  if(!can(ACTIONS.OVERTIME_CREATE_SELF_DRAFT, rec)) return null;
  State.overtimeRecords.push(rec);
  await persistOvertime();
  return rec;
}
async function updateOvertimeRecord(id, fields){
  const o = overtimeById(id); if(!o) return false;
  // UX-006C2B — authorize the CANONICAL pre-mutation record (own + Draft for Employee;
  // CEO pass-through) BEFORE any field change (SE-0).
  if(!can(ACTIONS.OVERTIME_UPDATE_SELF_DRAFT, o)) return false;
  // Snapshot for atomic rollback if the post-mutation candidate fails re-authorization
  // (ownership-change / status-change protection, §8).
  const idx = State.overtimeRecords.indexOf(o);
  const snapshot = JSON.parse(JSON.stringify(o));
  Object.assign(o, fields);
  // recompute from snapshots + new hours (snapshots stay fixed unless re-derived)
  const hours = Math.max(0, num(o.overtimeHours));
  const sched = {hoursPerDay:o.snapHoursPerDay, daysPerWeek:o.snapDaysPerWeek, weeksPerMonth:o.snapWeeksPerMonth};
  const calc = overtimeCalc(o.snapMonthlySalary, sched, hours);
  o.overtimeHours=hours; o.monthlyStandardHours=calc.standardHours; o.hourlyRate=calc.hourlyRate; o.calculatedAmount=calc.amount; o.rawAmount=calc.rawAmount;
  o.updatedAt=new Date().toISOString();
  (o.history=o.history||[]).push({event:'edited', ts:o.updatedAt, note:'Overtime record edited'});
  // UX-006C2B — POST-update re-check: the resulting candidate must STILL authorize.
  // For an Employee this rejects an ownership change (employeeId → other) or a status
  // change out of Draft; for CEO it stays a pass-through. Rollback fully on denial (SE-0).
  if(!can(ACTIONS.OVERTIME_UPDATE_SELF_DRAFT, o)){
    if(idx !== -1) State.overtimeRecords[idx] = snapshot;
    return false;
  }
  await persistOvertime();
  return true;
}
async function setOvertimeStatus(id, status){
  const o = overtimeById(id); if(!o) return;
  // UX-006C2B — split the generic status boundary: the ONLY Employee-permitted
  // transition is own Draft -> Submitted (overtime.submitSelf). Every other transition
  // (approve/reject/commit/arbitrary) is company management (overtime.manage). Authorize
  // BEFORE any mutation (SE-0). Employees can never reach overtime.manage.
  const isSelfSubmit = (status === 'Submitted' && o.status === 'Draft');
  const statusAction = isSelfSubmit ? ACTIONS.OVERTIME_SUBMIT_SELF : ACTIONS.OVERTIME_MANAGE;
  if(!can(statusAction, o)){ showWarning('You do not have permission to change this overtime record.'); return; }
  if(isPayrollLocked(o.monthKey)){ showWarning('That payroll period is locked — overtime cannot be modified.'); return; }
  if(o.status==='Committed to Payroll'){ showWarning('This overtime is already committed to payroll and cannot change status.'); return; }
  o.status = status;
  if(status==='Approved' && o.approvedAmount==null) o.approvedAmount = o.calculatedAmount;
  o.updatedAt = new Date().toISOString();
  (o.history=o.history||[]).push({event:status.toLowerCase(), ts:o.updatedAt, note:'Status → '+status});
  await persistOvertime();
  const otEmp=empById(o.employeeId); const otName=(otEmp&&otEmp.fullName)||o.employeeName||'Employee';
  logActivity({type:'overtime.'+status.toLowerCase().replace(/\s+/g,'-'), module:'Overtime', entity:otName, entityId:o.id,
    desc:`${otName}: overtime ${status}${o.overtimeDate?' ('+o.overtimeDate+')':''}`,
    refs:{employeeId:o.employeeId, monthKey:o.monthKey}});
  showSuccess('Overtime '+status.toLowerCase()+'.'); render();
}
async function duplicateOvertimeRecord(id){
  const o = overtimeById(id); if(!o) return;
  if(isPayrollLocked(o.monthKey)){ showWarning('That payroll period is locked — overtime cannot be added.'); return; }
  const copy = JSON.parse(JSON.stringify(o));
  copy.id = uid('ot'); copy.status='Draft'; copy.approvedAmount=null; copy.payrollPlanId=null; copy.committedTxnId=null;
  copy.createdAt = copy.updatedAt = new Date().toISOString();
  copy.history = [{event:'created', ts:copy.createdAt, note:'Duplicated from '+(o.workDescription||o.id)}];
  // UX-006C2B — duplication IS a create of a new own Draft; authorize the candidate copy
  // (createSelfDraft: CEO pass-through; Employee only when the copy is own + Draft) BEFORE
  // it enters State or is persisted (SE-0).
  if(!can(ACTIONS.OVERTIME_CREATE_SELF_DRAFT, copy)){ showWarning('You do not have permission to duplicate this overtime record.'); return; }
  State.overtimeRecords.push(copy);
  await persistOvertime(); showSuccess('Overtime duplicated as Draft.'); render();
}
async function deleteOvertimeRecord(id){
  const o = overtimeById(id); if(!o) return;
  // UX-006C2B — authorize (own + Draft for Employee; CEO pass-through) BEFORE the lock/
  // committed guards, confirm, array removal, persist, or audit (SE-0).
  if(!can(ACTIONS.OVERTIME_DELETE_SELF_DRAFT, o)){ showWarning('You do not have permission to delete this overtime record.'); return; }
  if(isPayrollLocked(o.monthKey)){ showWarning('That payroll period is locked — overtime cannot be deleted.'); return; }
  if(o.status==='Committed to Payroll'){ showWarning('Committed overtime cannot be deleted. Reject is unavailable after commit.'); return; }
  if(!confirmAction('Delete this overtime record? This cannot be undone.')) return;
  State.overtimeRecords = State.overtimeRecords.filter(x=>x.id!==id);
  await persistOvertime(); showSuccess('Overtime deleted.'); render();
}

/* ---------- Overtime page (Part 7) ---------- */
/* v2.6.1 — Overtime incremental list. applyOvertimeFilter updates only the <tbody>
   and the filter-dependent summary tiles (Records Shown / Total Hours / Total Amount). */
function overtimeFiltered(){
  const f = State.overtimeFilter;
  // Readiness-1 — principal-scoped READ; an Employee sees only their own overtime.
  let rows = (typeof getScopedRecords === 'function') ? getScopedRecords('overtime') : State.overtimeRecords.slice();
  if(f.status!=='all') rows = rows.filter(o=>o.status===f.status);
  if(f.month!=='all') rows = rows.filter(o=>o.monthKey===f.month);
  if(f.search.trim()){ const s=normStr(f.search); rows = rows.filter(o=>[o.employeeName,o.workDescription,o.contractNumber,o.notes].some(x=>normStr(x||'').includes(s))); }
  rows.sort((a,b)=> String(b.monthKey).localeCompare(String(a.monthKey)) || String(b.overtimeDate||'').localeCompare(String(a.overtimeDate||'')));
  return rows;
}
function overtimeRowsHTML(){
  return overtimeFiltered().map(o=>`<tr>
            <td><button class="linklike" data-ot-view="${o.id}"><b>${escapeHtml(o.employeeName||'—')}</b></button><div class="faint" style="font-size:10px;">${escapeHtml(o.contractNumber||'')} · ${o.snapHoursPerDay}h/day</div></td>
            <td class="dim">${escapeHtml(o.month)} ${o.year}</td>
            <td class="dim">${escapeHtml(o.overtimeDate||'—')}</td>
            <td class="num">${num(o.overtimeHours).toLocaleString('id-ID',{maximumFractionDigits:2})}</td>
            <td class="num">${fmtIDRfull(o.hourlyRate)}</td>
            <td class="num">${fmtIDR(o.approvedAmount!=null?o.approvedAmount:o.calculatedAmount)}</td>
            <td>${hrStatusBadge(o.status, OVERTIME_STATUS_META)}</td>
            <td>${hrActionsMenu('ot', o.id, [
              ['ot-view','View Breakdown'],
              o.status==='Draft'||o.status==='Reviewed'?['ot-edit','Edit']:null,
              ['ot-duplicate','Duplicate'],
              o.status!=='Approved'&&o.status!=='Committed to Payroll'&&o.status!=='Rejected'?['ot-review','Mark Reviewed']:null,
              o.status!=='Committed to Payroll'&&o.status!=='Approved'?['ot-approve','Approve']:null,
              o.status!=='Committed to Payroll'&&o.status!=='Rejected'?['ot-reject','Reject']:null,
              o.status!=='Committed to Payroll'?['ot-delete','Delete']:null,
            ])}</td>
          </tr>`).join('') || `<tr><td colspan="8" class="empty">No overtime records match. Click “+ Add Overtime”.</td></tr>`;
}
function bindOvertimeRows(main){
  main.querySelectorAll('[data-ot-view]').forEach(b=>b.addEventListener('click', ()=>openOvertimeBreakdown(b.dataset.otView)));
  bindHRActions(main);
}
function applyOvertimeFilter(main){
  const tb = document.getElementById('otRows'); if(!tb) return;
  const rows = overtimeFiltered();
  tb.innerHTML = overtimeRowsHTML();
  const totalHours = rows.reduce((s,o)=>s+num(o.overtimeHours),0);
  const totalAmount = rows.reduce((s,o)=>s+num(o.approvedAmount!=null?o.approvedAmount:o.calculatedAmount),0);
  const set=(id,v)=>{ const el=document.getElementById(id); if(el) el.textContent=v; };
  set('otStatShown', rows.length);
  set('otStatHours', totalHours.toLocaleString('id-ID',{maximumFractionDigits:2}));
  set('otStatAmount', fmtIDRShort(totalAmount));
  bindOvertimeRows(main);
}
function renderOvertime(main){
  const f = State.overtimeFilter;
  let rows = overtimeFiltered();
  // Readiness-1 — facets and counters derive from the SAME scoped dataset as the rows.
  const otScoped = (typeof getScopedRecords === 'function') ? getScopedRecords('overtime') : State.overtimeRecords.slice();
  const months = [...new Set(otScoped.map(o=>o.monthKey))].sort();
  const totalHours = rows.reduce((s,o)=>s+num(o.overtimeHours),0);
  const totalAmount = rows.reduce((s,o)=>s+num(o.approvedAmount!=null?o.approvedAmount:o.calculatedAmount),0);
  const pending = otScoped.filter(o=>['Draft','Submitted','Reviewed'].includes(o.status)).length;

  if(!((typeof getScopedRecords === 'function') ? getScopedRecords('employee') : State.employees).length){
    main.innerHTML = pageHeader('Overtime','Record and calculate overtime using the TAM Internal Overtime Calculation Method.') +
      actionEmptyState('No employees yet','Add employees and contracts first — overtime is calculated from each employee’s salary and work schedule.','Add Employee','employees');
    bindActionEmptyState(main); return;
  }

  main.innerHTML = pageHeader('Overtime',
      `${otScoped.length} record(s) · ${pending} pending review. ${escapeHtml(State.settings.overtimeMethodLabel||'TAM Internal Overtime Calculation Method')}.`,
      `<button class="btn btn-accent" id="addOt">+ Add Overtime</button><button class="btn" id="otSheet">Monthly Worksheet</button><button class="btn" id="otCsv">Export CSV</button>`)
    + `
    <div class="insight-item" style="margin-bottom:var(--space-4);display:block;">This calculation follows the internal method configured in TAM OS. Verify separately when statutory payroll compliance calculations are required.</div>
    ${payrollDriftBannerHTML(State.payrollPlans)}
    <div class="grid grid-4 stack-section">
      <div class="card stat-card"><div class="stat-label">Records Shown</div><div class="stat-value" id="otStatShown">${rows.length}</div></div>
      <div class="card stat-card"><div class="stat-label">Total Overtime Hours</div><div class="stat-value" id="otStatHours">${totalHours.toLocaleString('id-ID',{maximumFractionDigits:2})}</div></div>
      <div class="card stat-card"><div class="stat-label">Total Overtime Amount</div><div class="stat-value" id="otStatAmount">${fmtIDRShort(totalAmount)}</div></div>
      <div class="card stat-card"><div class="stat-label">Pending Review</div><div class="stat-value">${pending}</div></div>
    </div>
    <div class="card">
      <div class="form-grid" style="grid-template-columns:1.6fr 1fr 1fr;margin-bottom:var(--space-4);">
        <div class="field"><label>Search (employee, description, contract)</label><input class="input" id="otSearch" placeholder="Search…" value="${escapeHtml(f.search)}"></div>
        <div class="field"><label>Status</label><select class="input" id="otStatus"><option value="all">All statuses</option>${OVERTIME_STATUSES.map(s=>`<option ${f.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
        <div class="field"><label>Month</label><select class="input" id="otMonth"><option value="all">All months</option>${months.map(k=>{const o=keyToMonthObj(k);return `<option value="${k}" ${f.month===k?'selected':''}>${o.month} ${o.year}</option>`;}).join('')}</select></div>
      </div>
      <div class="table-wrap" style="max-height:560px;overflow-y:auto;">
        <table>
          <thead><tr><th>Employee</th><th>Month</th><th>Date</th><th class="num">Hours</th><th class="num">Hourly Rate</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead>
          <tbody id="otRows">${overtimeRowsHTML()}</tbody>
        </table>
      </div>
    </div>`;
  document.getElementById('otSearch').addEventListener('input', e=>{ State.overtimeFilter.search=e.target.value; applyOvertimeFilter(main); });
  document.getElementById('otStatus').addEventListener('change', e=>{ State.overtimeFilter.status=e.target.value; applyOvertimeFilter(main); });
  document.getElementById('otMonth').addEventListener('change', e=>{ State.overtimeFilter.month=e.target.value; applyOvertimeFilter(main); });
  document.getElementById('addOt').addEventListener('click', ()=>openOvertimeModal(null));
  document.getElementById('otSheet').addEventListener('click', ()=>hrNavTo('overtimeSheet'));
  document.getElementById('otCsv').addEventListener('click', exportOvertimeCsv);
  bindOvertimeRows(main);
}

function openOvertimeModal(id){
  const o = id ? overtimeById(id) : null;
  const isNew = !o;
  // Readiness-1 (identity closure) — this picker is reachable in an Employee-AUTHORIZED
  // workflow (own-Draft overtime), so its options must obey Employee read scope or the
  // dropdown discloses the whole roster the scoped views hide.
  const emps = ((typeof getScopedRecords === 'function') ? getScopedRecords('employee') : State.employees).filter(empEligible).sort((a,b)=>String(a.fullName||'').localeCompare(String(b.fullName||'')));
  const v = o || {monthKey:todayKey(), overtimeHours:'', employeeId:emps[0]?emps[0].id:''};
  openModalHTML(`
    <h3>${isNew?'Add Overtime':'Edit Overtime'}</h3>
    <form id="otForm">
      <div class="form-grid" style="grid-template-columns:1fr 1fr;">
        <div class="field" style="grid-column:span 2;"><label>Employee</label><select class="input" name="employeeId" ${isNew?'':'disabled'} required><option value="">— select —</option>${emps.map(e=>`<option value="${e.id}" ${v.employeeId===e.id?'selected':''}>${escapeHtml(e.fullName)} (${escapeHtml(e.employeeId||'')})</option>`).join('')}</select></div>
        <div class="field"><label>Month</label><input class="input" name="monthKey" value="${escapeHtml(v.monthKey||'')}" placeholder="YYYY-MM" required></div>
        <div class="field"><label>Overtime Date</label><input class="input" type="date" name="overtimeDate" value="${escapeHtml(v.overtimeDate||'')}"></div>
        <div class="field"><label>Overtime Hours</label><input class="input" type="number" step="0.25" min="0" name="overtimeHours" value="${v.overtimeHours??''}" required></div>
        <div class="field"><label>Work Description</label><input class="input" name="workDescription" value="${escapeHtml(v.workDescription||'')}"></div>
        <div class="field" style="grid-column:span 2;"><label>Notes</label><textarea class="input" name="notes">${escapeHtml(v.notes||'')}</textarea></div>
      </div>
      <div class="card" id="otPreview" style="margin-top:var(--space-4);padding:14px 16px;background:var(--surface-2);"></div>
      <div class="modal-actions"><button type="button" class="btn" id="otCancel">Cancel</button><button type="submit" class="btn btn-accent">${isNew?'Create (Draft)':'Save Changes'}</button></div>
    </form>`, {width:600, onMount:(root)=>{
      const form = root.querySelector('#otForm');
      const preview = ()=>{
        const empId = form.employeeId.value || v.employeeId;
        const emp = empById(empId);
        const contract = emp?activeContractToday(emp.id):null;
        const sched = effectiveSchedule(emp, contract);
        const salary = overtimeSalaryBasis(emp, contract);
        const hours = Math.max(0, num(form.overtimeHours.value));
        const calc = overtimeCalc(salary, sched, hours);
        const warn = !sched.valid ? `<div class="insight-item warn" style="display:block;margin-bottom:8px;">No valid work schedule for this employee — configure one on the employee or contract, or set company defaults in Settings.</div>` : '';
        root.querySelector('#otPreview').innerHTML = `${warn}
          <h4 style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-faint);">Live Calculation · schedule from ${escapeHtml(sched.source)}</h4>
          <div style="font-size:12.5px;line-height:1.9;">
            <div>Base Salary: <b class="mono">${fmtIDR(salary)}</b></div>
            <div>Schedule: <b>${sched.hoursPerDay} h/day × ${sched.daysPerWeek} d/week × ${sched.weeksPerMonth} wk/mo</b></div>
            <div>Monthly Standard Hours: <b class="mono">${calc.standardHours}</b></div>
            <div>Hourly Rate: <b class="mono">${fmtIDRfull(calc.hourlyRate)}</b></div>
            <div>Overtime Hours: <b class="mono">${hours}</b></div>
            <div style="margin-top:4px;">Calculated Overtime Amount: <b class="mono" style="color:var(--accent);">${fmtIDR(calc.amount)}</b> <span class="faint">(raw ${fmtIDRfull(calc.rawAmount)}, rounding: ${escapeHtml(OVERTIME_ROUNDING[State.settings.overtimeRounding].label)})</span></div>
          </div>`;
      };
      form.employeeId.addEventListener('change', preview);
      form.overtimeHours.addEventListener('input', preview);
      preview();
      root.querySelector('#otCancel').addEventListener('click', closeModal);
      form.addEventListener('submit', async ev=>{
        ev.preventDefault();
        const fd = new FormData(ev.target);
        const hours = num(fd.get('overtimeHours'));
        if(hours<0){ showWarning('Overtime hours cannot be negative.'); return; }
        const fields = {
          employeeId: isNew?fd.get('employeeId'):o.employeeId,
          monthKey:(fd.get('monthKey')||'').trim(), overtimeDate:fd.get('overtimeDate')||null,
          overtimeHours:hours, workDescription:(fd.get('workDescription')||'').trim(), notes:(fd.get('notes')||'').trim(),
        };
        const targetMonth = isNew ? fields.monthKey : o.monthKey;
        if(isPayrollLocked(targetMonth)){ showWarning('That payroll period is locked — overtime cannot be modified. Unlock the period in the Payroll Workspace first.'); return; }
        // UX-006C2B — gate the success feedback on the domain boundary's authorization
        // result; a denied mutation must not show success or close as if it succeeded (SE-0).
        if(isNew){
          if(!fields.employeeId){ showWarning('Select an employee.'); return; }
          const rec = await addOvertimeRecord(fields);
          if(!rec){ showWarning('You do not have permission to perform this action.'); return; }
          showSuccess('Overtime record created (Draft).');
        } else {
          const ok = await updateOvertimeRecord(o.id, fields);
          if(!ok){ showWarning('You do not have permission to perform this action.'); return; }
          showSuccess('Overtime record updated.');
        }
        closeModal(); render();
      });
    }});
}

function overtimeBreakdownHTML(o){
  return `<div style="font-size:12.5px;line-height:1.95;">
    <div>Employee: <b>${escapeHtml(o.employeeName||'—')}</b> · Contract: <b>${escapeHtml(o.contractNumber||'—')}</b></div>
    <div>Month: <b>${escapeHtml(o.month)} ${o.year}</b>${o.overtimeDate?` · Date: <b>${escapeHtml(o.overtimeDate)}</b>`:''}</div>
    <div class="divider" style="margin:10px 0;"></div>
    <div>Base Salary (snapshot): <b class="mono">${fmtIDR(o.snapMonthlySalary)}</b></div>
    <div>Schedule (snapshot): <b>${o.snapHoursPerDay} h/day × ${o.snapDaysPerWeek} d/week × ${o.snapWeeksPerMonth} wk/mo</b> <span class="faint">(${escapeHtml(o.scheduleSource||'—')})</span></div>
    <div>Monthly Standard Hours: <b class="mono">${o.monthlyStandardHours}</b></div>
    <div>Hourly Rate: <b class="mono">${fmtIDRfull(o.hourlyRate)}</b></div>
    <div>Overtime Hours: <b class="mono">${num(o.overtimeHours)}</b></div>
    <div style="margin-top:4px;">Calculated Amount: <b class="mono" style="color:var(--accent);">${fmtIDR(o.calculatedAmount)}</b>${o.approvedAmount!=null?` · Approved: <b class="mono">${fmtIDR(o.approvedAmount)}</b>`:''}</div>
    <div>Status: ${hrStatusBadge(o.status, OVERTIME_STATUS_META)}</div>
    ${o.workDescription?`<div class="dim" style="margin-top:6px;">${escapeHtml(o.workDescription)}</div>`:''}
    ${o.notes?`<div class="dim">${escapeHtml(o.notes)}</div>`:''}
  </div>`;
}
function openOvertimeBreakdown(id){
  const o = overtimeById(id); if(!o) return;
  openModalHTML(`<h3>Overtime Breakdown</h3>${overtimeBreakdownHTML(o)}
    <div class="modal-actions"><button type="button" class="btn" id="otbClose">Close</button></div>`, {onMount:(root)=>{ root.querySelector('#otbClose').addEventListener('click', closeModal); }});
}

function exportOvertimeCsv(){
  const headers = ['Employee','Contract','Month','Date','Hours','Hours/Day','Days/Week','Weeks/Month','Monthly Salary','Standard Hours','Hourly Rate','Calculated Amount','Approved Amount','Status','Description','Notes'];
  const lines = [`# ${APP_NAME} v${APP_VERSION} — Overtime Records (${escapeHtml(State.settings.overtimeMethodLabel||'TAM Internal')})`, headers.join(',')];
  // Readiness-1 — an export is a read: it carries the current principal's scope.
  ((typeof getScopedRecords === 'function') ? getScopedRecords('overtime') : State.overtimeRecords).forEach(o=>lines.push([o.employeeName,o.contractNumber,o.monthKey,o.overtimeDate||'',o.overtimeHours,o.snapHoursPerDay,o.snapDaysPerWeek,o.snapWeeksPerMonth,o.snapMonthlySalary,o.monthlyStandardHours,o.hourlyRate,o.calculatedAmount,o.approvedAmount??'',o.status,o.workDescription,o.notes].map(csvSafe).join(',')));
  downloadBlob(lines.join('\n'), `${FILE_BASE}-overtime.csv`, 'text/csv');
  showSuccess('Overtime exported.');
}

/* ---------- Bulk monthly overtime worksheet (Part 8) ---------- */
function renderOvertimeWorksheet(main){
  if(!State.overtimeMonth) State.overtimeMonth = todayKey();
  const monthKey = State.overtimeMonth;
  const mo = keyToMonthObj(monthKey);
  // Readiness-1 (identity closure) — the overtime worksheet renders ONE ROW PER
  // EMPLOYEE; unscoped it is a full roster.
  const eligible = ((typeof getScopedRecords === 'function') ? getScopedRecords('employee') : State.employees).filter(empEligible);
  // one worksheet row per eligible employee, prefilled from any existing draft OT for the month
  const rows = eligible.map(e=>{
    const contract = coveringContract(e.id, monthKey) || activeContractToday(e.id);
    const sched = effectiveSchedule(e, contract);
    const salary = overtimeSalaryBasis(e, contract);
    const existing = overtimeForEmployeeMonth(e.id, monthKey).filter(o=>o.status==='Draft');
    const hours = existing.reduce((s,o)=>s+num(o.overtimeHours),0);
    return {employeeId:e.id, employeeName:e.fullName, contract, contractNumber:contract?contract.contractNumber:null, sched, salary, hours, existingIds:existing.map(o=>o.id), validSched:sched.valid};
  });
  const yearOpts=[]; for(let y=mo.year-1;y<=mo.year+2;y++) yearOpts.push(y);

  main.innerHTML = pageHeader('Monthly Overtime Worksheet',
      `Enter overtime for several employees for ${escapeHtml(mo.month)} ${mo.year} in one screen.`,
      `<select class="input" id="wsMonthSel">${MONTH_ORDER.map((mn,i)=>`<option value="${i+1}" ${mo.monthNum===i+1?'selected':''}>${mn}</option>`).join('')}</select>
       <select class="input" id="wsYearSel">${yearOpts.map(y=>`<option ${y===mo.year?'selected':''}>${y}</option>`).join('')}</select>
       <button class="btn" id="wsBack">← Overtime</button>`)
    + `<div class="card"><div id="wsArea"></div></div>`;
  const sync = ()=>{ const m=+document.getElementById('wsMonthSel').value, y=+document.getElementById('wsYearSel').value; State.overtimeMonth=mkKey(y,m); renderOvertimeWorksheet(main); };
  document.getElementById('wsMonthSel').addEventListener('change', sync);
  document.getElementById('wsYearSel').addEventListener('change', sync);
  document.getElementById('wsBack').addEventListener('click', ()=>hrNavTo('overtime'));

  const area = document.getElementById('wsArea');
  if(!eligible.length){ area.innerHTML = `<div class="empty">No active employees. Add employees and contracts first.</div>`; return; }
  const draw = ()=>{
    let totalHours=0, totalAmt=0, withOt=0;
    rows.forEach(r=>{ const c=overtimeCalc(r.salary, r.sched, r.hours); r._calc=c; totalHours+=num(r.hours); totalAmt+=c.amount; if(num(r.hours)>0) withOt++; });
    const draftN = State.overtimeRecords.filter(o=>o.monthKey===monthKey && o.status==='Draft').length;
    const apprN = State.overtimeRecords.filter(o=>o.monthKey===monthKey && o.status==='Approved').length;
    const commN = State.overtimeRecords.filter(o=>o.monthKey===monthKey && o.status==='Committed to Payroll').length;
    area.innerHTML = `
      <div class="grid grid-4" style="margin-bottom:12px;">
        <div class="chart-mini-stat"><div class="lbl">Total OT Hours</div><div class="val">${totalHours.toLocaleString('id-ID',{maximumFractionDigits:2})}</div></div>
        <div class="chart-mini-stat"><div class="lbl">Total OT Amount</div><div class="val">${fmtIDRShort(totalAmt)}</div></div>
        <div class="chart-mini-stat"><div class="lbl">Employees w/ OT</div><div class="val">${withOt}</div></div>
        <div class="chart-mini-stat"><div class="lbl">Draft / Appr / Committed</div><div class="val" style="font-size:12px;">${draftN} / ${apprN} / ${commN}</div></div>
      </div>
      <div class="table-wrap" style="max-height:520px;overflow-y:auto;"><table>
        <thead><tr><th>Employee</th><th>Contract</th><th class="num">h/day</th><th class="num">Salary</th><th class="num">OT Hours</th><th class="num">Hourly Rate</th><th class="num">OT Amount</th></tr></thead>
        <tbody>${rows.map((r,i)=>`<tr>
          <td><b>${escapeHtml(r.employeeName)}</b>${r.validSched?'':' <span class="pill pill-status-cancelled">no schedule</span>'}</td>
          <td class="dim">${escapeHtml(r.contractNumber||'—')}</td>
          <td class="num">${r.sched.hoursPerDay}</td>
          <td class="num">${fmtIDR(r.salary)}</td>
          <td class="num"><input class="input" style="width:80px;text-align:right;padding:4px 6px;" type="number" step="0.25" min="0" data-ws="${i}" value="${num(r.hours)}"></td>
          <td class="num">${fmtIDRfull(r._calc.hourlyRate)}</td>
          <td class="num" id="wsamt-${i}"><b>${fmtIDR(r._calc.amount)}</b></td>
        </tr>`).join('')}</tbody>
      </table></div>
      <div class="modal-actions" style="justify-content:flex-start;margin-top:var(--space-4);flex-wrap:wrap;gap:8px;">
        <button class="btn btn-accent" id="wsSaveDraft">Save all as Draft</button>
        <button class="btn" id="wsApprove">Approve all with hours</button>
        <button class="btn" id="wsCommitInfo" disabled title="Commit happens from Payroll Planning">Commit via Payroll →</button>
      </div>
      <p class="hint" style="margin-top:6px;">Saving creates/updates Draft overtime records for this month. Approve them (here or on the Overtime page), then commit through Payroll Planning so the amounts flow into planned payroll.</p>`;
    area.querySelectorAll('[data-ws]').forEach(inp=>inp.addEventListener('input', e=>{ const i=+e.target.dataset.ws; rows[i].hours=e.target.value; const c=overtimeCalc(rows[i].salary, rows[i].sched, rows[i].hours); rows[i]._calc=c; const cell=area.querySelector(`#wsamt-${i}`); if(cell) cell.innerHTML=`<b>${fmtIDR(c.amount)}</b>`; }));
    area.querySelector('#wsSaveDraft').addEventListener('click', async ()=>{ await worksheetSave(monthKey, rows, false); renderOvertimeWorksheet(main); });
    area.querySelector('#wsApprove').addEventListener('click', async ()=>{ await worksheetSave(monthKey, rows, true); renderOvertimeWorksheet(main); });
  };
  draw();
}
async function worksheetSave(monthKey, rows, approve){
  // UX-006C2B — the worksheet is a BULK company-management path (creates/updates/approves
  // across employees). Authorize overtime.manage ONCE, BEFORE the first row is mutated, so
  // a denied principal (Employee/null) leaves State/persistence/audit untouched (atomic
  // SE-0). The empty object is a company-scope probe: CEO (ALL_COMPANY) passes; an Employee
  // (SELF) fails because it owns no record matching {}; null fails.
  if(!can(ACTIONS.OVERTIME_MANAGE, { employeeId: null })){ showWarning('You do not have permission to manage company overtime.'); return; }
  if(isPayrollLocked(monthKey)){ showWarning('That payroll period is locked — overtime cannot be modified.'); return; }
  let saved=0;
  for(const r of rows){
    const hours = num(r.hours);
    // find an existing draft to update, else create when hours>0
    let rec = State.overtimeRecords.find(o=>o.monthKey===monthKey && o.employeeId===r.employeeId && (o.status==='Draft'||(approve&&o.status==='Approved')));
    if(hours<=0){ continue; }
    if(rec){ await updateOvertimeRecord(rec.id, {overtimeHours:hours, workDescription:rec.workDescription||'Monthly worksheet entry'}); }
    else { rec = await addOvertimeRecord({employeeId:r.employeeId, monthKey, overtimeHours:hours, workDescription:'Monthly worksheet entry'}); }
    if(approve && rec){ const o=overtimeById(rec.id); if(o && o.status!=='Committed to Payroll'){ o.status='Approved'; if(o.approvedAmount==null) o.approvedAmount=o.calculatedAmount; o.updatedAt=new Date().toISOString(); } }
    saved++;
  }
  await persistOvertime();
  showSuccess(`${saved} employee overtime row(s) saved${approve?' and approved':' as Draft'}.`);
}
