/* ============================================================
   EMPLOYEES
   ============================================================ */
/* v2.6.1 — Employees incremental list: filtered set, row markup, and a refresh that
   swaps only the <tbody>. The search box and filter dropdowns call applyEmployeeFilter
   so the search input keeps focus/caret/selection and the table keeps its scroll. */
/* ============================================================
   PR-7B "THE CONDUIT" — the single official UI-to-Transport execution seam.
   ------------------------------------------------------------
   Every migrated aggregate-backed browser operation reaches the Domain ONLY
   through here, over the canonical application path:

     UI -> uiExecute() -> TransportAdapter.execute() -> ApplicationGateway.execute()
        -> Domain.command()/Domain.query() -> Aggregate -> Handler -> Persistence

   It builds the canonical Transport request { kind, name, args, meta? }, AWAITS
   the Transport, and DISTINGUISHES a Transport/Gateway BOUNDARY failure
   (response.ok === false) from the Domain BUSINESS outcome (response.ok === true,
   whose `result` is returned VERBATIM — a business rejection stays { success:false }
   inside that result). It owns NO business behavior: it mutates nothing, persists
   nothing, writes no history, performs no rollback, and NEVER calls Domain, an
   Aggregate, or a Handler directly. On a boundary failure it returns a typed, safe
   { success:false, boundary:true } shape so existing callers surface the failure
   through their normal feedback and never dereference undefined. TransportAdapter is
   a top-level const resolved at call time (this file loads before the transport, but
   the seam only runs from user events, long after all scripts have loaded).
   ============================================================ */
async function uiExecute(kind, name, args, meta){
  const request = { kind: kind, name: name, args: Array.isArray(args) ? args : [] };
  if (meta !== undefined) request.meta = meta;
  const response = await TransportAdapter.execute(request);
  if (!response || response.ok !== true){
    // BOUNDARY failure (Transport/Gateway) — NOT a business rejection. Kept
    // distinguishable via `boundary:true`; never collapses Gateway/Domain semantics.
    const be = (response && response.error) ? response.error : { source: 'transport', code: 'NO_RESPONSE', message: 'No transport response.' };
    return { success: false, boundary: true, error: (be.message || be.code || 'Transport failure'), transportError: be };
  }
  // Completed THROUGH the Platform boundary — hand back the Domain result VERBATIM.
  return response.result;
}

/* Readiness-1 — the Employees list is a principal-scoped READ. It starts from
   getScopedRecords('employee') instead of the canonical State.employees, so a CEO
   still sees the whole company and an Employee sees only their own record. The
   canonical State is untouched; only this read is narrowed. */
function employeesFiltered(){
  const f = State.empFilter;
  let rows = (typeof getScopedRecords === 'function') ? getScopedRecords('employee') : State.employees.slice();
  if(f.status!=='all') rows = rows.filter(e=>e.employmentStatus===f.status);
  if(f.department!=='all') rows = rows.filter(e=>e.department===f.department);
  if(f.active==='active') rows = rows.filter(e=>e.active!==false);
  if(f.active==='inactive') rows = rows.filter(e=>e.active===false);
  if(f.search.trim()){ const s=normStr(f.search); rows = rows.filter(e=>[e.fullName,e.employeeId,e.jobTitle,e.department,e.email,e.phone].some(x=>normStr(x||'').includes(s))); }
  rows.sort((a,b)=>String(a.fullName||'').localeCompare(String(b.fullName||'')));
  return rows;
}
function employeeRowsHTMLFrom(list){
  // PR-7B — pure row builder from a supplied Employee[] (the read now arrives via
  // the canonical UI-to-Transport seam; see fillEmployeeRows). Markup is unchanged.
  return (list||[]).map(e=>{
    const ct = activeContractToday(e.id);
    const calc = ct ? contractCalc(ct, todayKey()) : null;
    return `<tr>
      <td><button class="linklike" data-emp-detail="${e.id}"><b>${escapeHtml(e.fullName||'—')}</b></button><div class="faint" style="font-size:10.5px;">${escapeHtml(e.employeeId||'')}</div></td>
      <td class="dim">${escapeHtml(e.jobTitle||'—')}</td>
      <td class="dim">${escapeHtml(e.department||'—')}</td>
      <td>${hrStatusBadge(e.employmentStatus||'Inactive', EMP_STATUS_META)}${e.active===false?' <span class="pill pill-status-archived">record off</span>':''}</td>
      <td>${ct?`<span class="dim">${escapeHtml(ct.contractNumber||'—')}</span> <span class="pill pill-status-scheduled">${calc.progress}</span>`:'<span class="faint">none</span>'}</td>
      <td class="num">${fmtIDR(e.monthlyBaseSalary)}</td>
      <td>${hrActionsMenu('emp', e.id, [
        ['emp-detail','View Detail'],
        ['emp-edit','Edit'],
        e.active===false?['emp-reactivate','Reactivate']:['emp-deactivate','Deactivate'],
        ['emp-delete','Delete']
      ])}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" class="empty">No employees match. Click “+ Add Employee” to create the first record.</td></tr>`;
}
/* UX-005B — Employees grid contract. Column definitions (R1) drive sortability and
   comparator selection; "Active Contract" stays non-sortable in v1 (derived per-row,
   no cheap stable key). Feature flags (R9) are UI capability only. Export semantics
   are UNCHANGED (exportEmployeesCsv exports ALL employees, masked). */
const EMP_COLUMNS = [
  { id:'name',       label:'Employee',        sortable:true,  type:'text',     dir:'asc',  getter:e=>e.fullName },
  { id:'jobTitle',   label:'Job Title',       sortable:true,  type:'text',     dir:'asc',  getter:e=>e.jobTitle },
  { id:'department', label:'Department',      sortable:true,  type:'text',     dir:'asc',  getter:e=>e.department },
  { id:'status',     label:'Status',          sortable:true,  type:'text',     dir:'asc',  getter:e=>e.employmentStatus },
  { id:'contract',   label:'Active Contract', sortable:false },
  { id:'salary',     label:'Base Salary',     sortable:true,  type:'currency', dir:'desc', align:'num', getter:e=>e.monthlyBaseSalary },
  { id:'actions',    label:'',                sortable:false },
];
const EMP_FEATURES = { pagination:true, sorting:true, search:true, export:true, rowActions:true, resultCount:true };
async function fillEmployeeRows(main){
  const area = document.getElementById('empGridArea'); if(!area) return;
  const g = State.grid.employees;
  // PR-7B "The Conduit" — the employee list read flows through the canonical path
  // (seam -> Transport -> Gateway -> the employee.filtered query). UX-005B wraps the
  // RETURNED array with the shared grid pipeline; the seam is not bypassed.
  const result = await uiExecute('query', 'employee.filtered', []);
  const rows = Array.isArray(result) ? result : [];
  const paged = gridApply(rows, g, EMP_COLUMNS, EMP_FEATURES); // sort+paginate a COPY
  const body = paged.pageRows.length
    ? employeeRowsHTMLFrom(paged.pageRows)
    : (((typeof getScopedRecords === 'function') ? getScopedRecords('employee').length : State.employees.length)
        ? '<tr><td colspan="7" class="empty">No employees match your current filters. <button class="linklike" data-emp-clear>Clear filters</button></td></tr>'
        : '<tr><td colspan="7" class="empty">No employees match. Click “+ Add Employee” to create the first record.</td></tr>');
  area.innerHTML = `<div class="table-wrap" style="max-height:620px;overflow-y:auto;">
      <table>${gridTheadHTML(EMP_COLUMNS, g.sort)}<tbody id="empRows">${body}</tbody></table>
    </div>${gridFeatureEnabled(EMP_FEATURES,'pagination')?gridPagerHTML(paged):''}`;
  const c = document.getElementById('empCount'); if(c) c.textContent = rows.length.toLocaleString('id-ID'); // filtered N, pre-pagination
  const tw = area.querySelector('.table-wrap'); if(tw) tw.scrollTop = 0;
  bindGridControls(area, 'employees', g, EMP_COLUMNS, ()=>fillEmployeeRows(main));
  const clr = area.querySelector('[data-emp-clear]');
  if(clr) clr.addEventListener('click', ()=>{ State.empFilter={search:'', status:'all', department:'all', active:'all'}; g.page=1; render(); });
  bindHRActions(main);
}
function applyEmployeeFilter(main){
  fillEmployeeRows(main);
}
function renderEmployees(main){
  const f = State.empFilter;
  if(!State.grid.employees.sort) State.grid.employees = gridInitState('employees'); // UX-005B session-only grid state
  /* Readiness-1 — every figure and facet on this page derives from the SAME scoped
     dataset as the rows. A scoped list beside a company-wide "of N employees" count
     or a department dropdown listing every department would leak exactly what the
     scoping removed. */
  const scoped = (typeof getScopedRecords === 'function') ? getScopedRecords('employee') : State.employees.slice();
  const depts = [...new Set(scoped.map(e=>e.department).filter(Boolean))].sort();
  const activeCount = scoped.filter(empEligible).length;
  const totalCount = scoped.length;

  main.innerHTML = `
    <div class="page-head">
      <div><h1>Employees</h1><p class="desc">Master data — <span id="empCount">${totalCount}</span> of ${totalCount} employee${totalCount===1?'':'s'} shown, ${activeCount} active. This is the source of truth for payroll planning.</p></div>
      <div class="head-controls">
        <button class="btn btn-accent" id="addEmp">+ Add Employee</button>
        <button class="btn" id="dedupEmp">Duplicate Review${(function(){const g=findEmployeeDuplicateGroups();return g.length?` (${g.length})`:'';})()}</button>
        <button class="btn" id="expEmp">Export CSV</button>
      </div>
    </div>
    ${(function(){const g=findEmployeeDuplicateGroups();return g.length?`<div class="card" style="border-left:3px solid var(--brick);margin-bottom:var(--space-4);"><b style="color:var(--brick);">${g.length} duplicate employee group(s) detected</b> — the same person exists under multiple records. <button class="linklike" id="dedupEmp2">Open Employee Duplicate Review</button> to consolidate them safely (nothing is deleted, no amounts change).</div>`:'';})()}
    <div class="card">
      <div class="form-grid" style="grid-template-columns:1.6fr 1fr 1fr 1fr;margin-bottom:var(--space-4);">
        <div class="field"><label>Search (name, ID, title, contact)</label><input class="input" id="eSearch" placeholder="Search…" value="${escapeHtml(f.search)}"></div>
        <div class="field"><label>Employment Status</label>
          <select class="input" id="eStatus"><option value="all">All statuses</option>${EMPLOYMENT_STATUSES.map(s=>`<option ${f.status===s?'selected':''}>${s}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Department</label>
          <select class="input" id="eDept"><option value="all">All departments</option>${depts.map(d=>`<option ${f.department===d?'selected':''}>${escapeHtml(d)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Record</label>
          <select class="input" id="eActive">
            <option value="all" ${f.active==='all'?'selected':''}>Active &amp; inactive</option>
            <option value="active" ${f.active==='active'?'selected':''}>Active records</option>
            <option value="inactive" ${f.active==='inactive'?'selected':''}>Inactive records</option>
          </select>
        </div>
      </div>
      <div id="empGridArea"></div>
    </div>`;
  // UX-005B — a filter/search change resets to page 1; search is debounced (Enter flushes).
  const reapply = ()=>{ State.grid.employees.page=1; applyEmployeeFilter(main); };
  const debSearch = debounce(reapply, 250);
  const eSearch = document.getElementById('eSearch');
  eSearch.addEventListener('input', e=>{ State.empFilter.search=e.target.value; debSearch(); });
  eSearch.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); debSearch.flush(); } });
  document.getElementById('eStatus').addEventListener('change', e=>{ State.empFilter.status=e.target.value; reapply(); });
  document.getElementById('eDept').addEventListener('change', e=>{ State.empFilter.department=e.target.value; reapply(); });
  document.getElementById('eActive').addEventListener('change', e=>{ State.empFilter.active=e.target.value; reapply(); });
  document.getElementById('addEmp').addEventListener('click', ()=>openEmployeeModal(null));
  document.getElementById('expEmp').addEventListener('click', exportEmployeesCsv);
  const goDedup=()=>{ State.view='employeeDedup'; render(); };
  const db1=document.getElementById('dedupEmp'); if(db1) db1.addEventListener('click', goDedup);
  const db2=document.getElementById('dedupEmp2'); if(db2) db2.addEventListener('click', goDedup);
  fillEmployeeRows(main);
}

function openEmployeeModal(id){
  const e = id ? empById(id) : null;
  const isNew = !e;
  const v = e || {employeeId: nextEmployeeCode(), employmentStatus:'Active', contractType:'Fixed-Term (PKWT)', active:true};
  openModalHTML(`
    <h3>${isNew?'Add Employee':'Edit Employee'}</h3>
    <form id="empForm">
      <div class="form-grid" style="grid-template-columns:1fr 1fr;">
        <div class="field"><label>Employee ID</label><input class="input" name="employeeId" value="${escapeHtml(v.employeeId||'')}" required></div>
        <div class="field"><label>Full Name</label><input class="input" name="fullName" value="${escapeHtml(v.fullName||'')}" required></div>
        <div class="field"><label>Job Title</label><input class="input" name="jobTitle" value="${escapeHtml(v.jobTitle||'')}"></div>
        <div class="field"><label>Department</label><input class="input" name="department" value="${escapeHtml(v.department||'')}"></div>
        <div class="field"><label>Employment Status</label><select class="input" name="employmentStatus">${EMPLOYMENT_STATUSES.map(s=>`<option ${v.employmentStatus===s?'selected':''}>${s}</option>`).join('')}</select></div>
        <div class="field"><label>Join Date</label><input class="input" type="date" name="joinDate" value="${escapeHtml(v.joinDate||'')}"></div>
        <div class="field"><label>Contract Type</label><select class="input" name="contractType">${CONTRACT_TYPES.map(s=>`<option ${v.contractType===s?'selected':''}>${s}</option>`).join('')}</select></div>
        <div class="field"><label>Monthly Base Salary (Rp)</label><input class="input" type="number" step="any" name="monthlyBaseSalary" value="${v.monthlyBaseSalary??''}"></div>
        <div class="field"><label>Bank</label><select class="input" name="bankName">${employeeBankSelectHTML(v.bankName)}</select></div>
        <div class="field"><label>Account Holder</label><input class="input" name="bankAccountHolder" value="${escapeHtml(v.bankAccountHolder||v.accountHolder||'')}" placeholder="Name on the account"></div>
        <div class="field"><label>Bank Account Number</label><input class="input" name="bankAccountNumber" value="${escapeHtml(v.bankAccountNumber||v.bankAccount||'')}" autocomplete="off"></div>
        <div class="field"><label>Email</label><input class="input" type="email" name="email" value="${escapeHtml(v.email||'')}"></div>
        <div class="field"><label>Phone</label><input class="input" name="phone" value="${escapeHtml(v.phone||'')}"></div>
        <div class="field" style="grid-column:span 2;"><label>Notes</label><textarea class="input" name="notes">${escapeHtml(v.notes||'')}</textarea></div>
        ${scheduleFieldsHTML(v, 'employee default')}
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" id="empCancel">Cancel</button>
        <button type="submit" class="btn btn-accent">${isNew?'Create Employee':'Save Changes'}</button>
      </div>
    </form>`, {width:640, onMount:(root)=>{
      root.querySelector('#empCancel').addEventListener('click', closeModal);
      root.querySelector('#empForm').addEventListener('submit', async ev=>{
        ev.preventDefault();
        // UX-006C2A — authorize at the mutation boundary BEFORE any State/persist/
        // audit/render side effect (SE-0). Create requires employee.create; editing
        // an existing record requires employee.update on that in-scope record.
        if(!can(isNew ? ACTIONS.EMPLOYEE_CREATE : ACTIONS.EMPLOYEE_UPDATE, isNew ? undefined : e)){
          toast('You do not have permission to perform this action.'); return;
        }
        const fd = new FormData(ev.target);
        const rec = e || {id:uid('emp'), createdAt:new Date().toISOString(), active:true, history:[]};
        rec.employeeId=(fd.get('employeeId')||'').trim();
        rec.fullName=(fd.get('fullName')||'').trim();
        rec.jobTitle=(fd.get('jobTitle')||'').trim();
        rec.department=(fd.get('department')||'').trim();
        rec.employmentStatus=fd.get('employmentStatus');
        rec.joinDate=fd.get('joinDate')||null;
        rec.contractType=fd.get('contractType');
        const sal=fd.get('monthlyBaseSalary'); rec.monthlyBaseSalary=(sal===''||sal==null)?null:Number(sal);
        rec.bankName=(fd.get('bankName')||'').trim();
        rec.bankAccountNumber=(fd.get('bankAccountNumber')||'').trim();
        rec.bankAccountHolder=(fd.get('bankAccountHolder')||'').trim();
        // v2.6.9 — keep the legacy `bankAccount` field (used by Smart Import / dedup) in
        // sync with the canonical `bankAccountNumber` so both readers stay consistent.
        rec.bankAccount=rec.bankAccountNumber;
        rec.email=(fd.get('email')||'').trim();
        rec.phone=(fd.get('phone')||'').trim();
        rec.notes=(fd.get('notes')||'').trim();
        applyScheduleFromForm(fd, rec);
        rec.updatedAt=new Date().toISOString();
        if(!rec.history) rec.history=[];
        rec.history.push({event:isNew?'created':'edited', ts:rec.updatedAt, note:isNew?'Employee record created':'Employee record edited'});
        if(isNew) State.employees.push(rec);
        await persistEmployees();
        closeModal(); toast(isNew?'Employee added.':'Employee updated.'); render();
      });
    }});
}

async function setEmployeeActive(id, active){
  const e = empById(id); if(!e) return;
  // UX-006C2A — active/inactive is an employee update; authorize before mutating
  // the canonical record (SE-0: no field change, persist, audit, or render on deny).
  if(!can(ACTIONS.EMPLOYEE_UPDATE, e)){ toast('You do not have permission to perform this action.'); return; }
  e.active = active;
  if(!active && e.employmentStatus==='Active') e.employmentStatus='Inactive';
  e.updatedAt = new Date().toISOString();
  (e.history=e.history||[]).push({event:active?'reactivated':'deactivated', ts:e.updatedAt, note:active?'Record reactivated':'Record deactivated'});
  await persistEmployees(); toast(active?'Employee reactivated.':'Employee deactivated.'); render();
}
async function deleteEmployee(id){
  const e = empById(id); if(!e) return;
  // UX-006C2A — authorize the delete on the in-scope record BEFORE the history
  // guard, confirm, State removal, persist, or audit (SE-0).
  if(!can(ACTIONS.EMPLOYEE_DELETE, e)){ toast('You do not have permission to perform this action.'); return; }
  if(empHasHistory(id)){
    toast('This employee has linked payroll or transactions and cannot be deleted. Deactivate instead.', 6000);
    return;
  }
  if(!confirm(`Permanently delete ${e.fullName}? This is only allowed because the record has no linked payroll or transactions.`)) return;
  State.employees = State.employees.filter(x=>x.id!==id);
  await persistEmployees();
  logActivity({type:'employee.delete', module:'Employees', entity:e.fullName, entityId:e.id, desc:`Employee "${e.fullName}" deleted (no linked payroll/transactions)`, refs:{employeeId:e.id}});
  toast('Employee deleted.'); render();
}

/* ============================================================
   PR-5C.1 — narrow Employee CONTACT-UPDATE command.
   Mutates ONLY the approved contact fields (phone/email/notes). It never
   touches salary, employment status, active state, contract/bank data,
   department, job title, or schedule. Reuses empById + persistEmployees +
   the existing `history` audit style, and returns a typed command outcome.
   Atomic: on a failed persist it reverts the fields and the audit entry.
   This is the ONLY handler routed through Domain.command in this PR; the
   full employee save (openEmployeeModal) is unchanged and still direct.
   ============================================================ */
const EMPLOYEE_CONTACT_FIELDS = ['phone','email','notes'];
async function updateEmployeeContact(id, patch){
  const e = empById(id);
  if(!e) return { success:false, error:'EmployeeNotFound' };
  // UX-006C2A — repository-seam mutation boundary: authorize (employee.update on
  // the in-scope record) before any field/history/persist side effect (SE-0).
  if(!can(ACTIONS.EMPLOYEE_UPDATE, e)) return { success:false, error:'NotAuthorized' };
  patch = patch || {};
  const before = {}, applied = {};
  // Allowlist: only approved contact fields are considered; all else is ignored.
  EMPLOYEE_CONTACT_FIELDS.forEach(k=>{
    if(Object.prototype.hasOwnProperty.call(patch, k)){
      before[k] = e[k];
      applied[k] = (patch[k]==null ? '' : String(patch[k])).trim();
    }
  });
  if(Object.keys(applied).length===0) return { success:false, error:'NoContactFieldsProvided' };
  const prevUpdatedAt = e.updatedAt;
  Object.keys(applied).forEach(k=> e[k] = applied[k]);
  e.updatedAt = new Date().toISOString();
  (e.history = e.history || []).push({ event:'contact-edited', ts:e.updatedAt, note:'Contact details updated ('+Object.keys(applied).join(', ')+')' });
  // PR-8A "The Repository" — persistence mechanics now go through the Repository
  // boundary (EmployeeRepository.save() -> persistEmployees() -> StorageAdapter).
  // The handler still owns mutation, updatedAt, history, the single persistence
  // invocation, and rollback; the Repository only normalizes the write result.
  const persisted = await EmployeeRepository.save();
  if(persisted.ok !== true){
    // Atomic rollback — no partial field update, no audit-success entry retained.
    Object.keys(before).forEach(k=> e[k] = before[k]);
    e.history.pop();
    e.updatedAt = prevUpdatedAt;
    return { success:false, error:'PersistFailed' };
  }
  return { success:true, data:e };
}

// Narrow contact-only editor. The ONE migrated UI path: it routes through the
// Domain command seam and never calls updateEmployeeContact directly.
function openEmployeeContactModal(id){
  const e = empById(id); if(!e) return;
  openModalHTML(`
    <h3>Edit Contact</h3>
    <form id="empContactForm">
      <div class="form-grid" style="grid-template-columns:1fr 1fr;">
        <div class="field"><label>Email</label><input class="input" type="email" name="email" value="${escapeHtml(e.email||'')}"></div>
        <div class="field"><label>Phone</label><input class="input" name="phone" value="${escapeHtml(e.phone||'')}"></div>
        <div class="field" style="grid-column:span 2;"><label>Notes</label><textarea class="input" name="notes">${escapeHtml(e.notes||'')}</textarea></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" id="empContactCancel">Cancel</button>
        <button type="submit" class="btn btn-accent">Save Contact</button>
      </div>
    </form>`, {width:520, onMount:(root)=>{
      root.querySelector('#empContactCancel').addEventListener('click', closeModal);
      root.querySelector('#empContactForm').addEventListener('submit', async ev=>{
        ev.preventDefault();
        const fd = new FormData(ev.target);
        const outcome = await uiExecute('command', 'employee.contact.update', [id, {
          email: fd.get('email'), phone: fd.get('phone'), notes: fd.get('notes')
        }]);
        if(outcome && outcome.success){ closeModal(); toast('Contact updated.'); render(); }
        else { toast('Could not update contact'+(outcome && outcome.error ? ': '+outcome.error : '')+'.', 5000); }
      });
    }});
}

/* ============================================================
   PR-5E — narrow Employee EMPLOYMENT-UPDATE command.
   Mutates ONLY the approved employment fields (jobTitle/department/
   employmentStatus/joinDate/contractType). It never touches salary, active
   state, contact/bank data, schedule, contracts, payroll, or finance.
   Reuses empById + persistEmployees + the existing `history` audit style,
   and returns a typed command outcome. Atomic: on a failed persist it
   reverts the fields, updatedAt, and the audit entry. The business authority
   is EmployeeEmploymentAggregate (PR-5E); this handler keeps its own guards
   (defense in depth) and remains the implementation authority.
   ============================================================ */
const EMPLOYEE_EMPLOYMENT_FIELDS = ['jobTitle','department','employmentStatus','joinDate','contractType'];
async function updateEmployeeEmployment(id, patch){
  const e = empById(id);
  if(!e) return { success:false, error:'EmployeeNotFound' };
  // UX-006C2A — repository-seam mutation boundary: authorize before any side effect (SE-0).
  if(!can(ACTIONS.EMPLOYEE_UPDATE, e)) return { success:false, error:'NotAuthorized' };
  patch = patch || {};
  const before = {}, applied = {};
  // Allowlist: only approved employment fields are considered; all else is ignored.
  EMPLOYEE_EMPLOYMENT_FIELDS.forEach(k=>{
    if(Object.prototype.hasOwnProperty.call(patch, k)){
      let v = (patch[k]==null ? '' : String(patch[k])).trim();
      if(k==='joinDate' && v==='') v = null;   // normalize empty date to null
      before[k] = e[k];
      applied[k] = v;
    }
  });
  if(Object.keys(applied).length===0) return { success:false, error:'NoEmploymentFieldsProvided' };
  // Defense-in-depth validation (the aggregate validates first).
  if(Object.prototype.hasOwnProperty.call(applied,'employmentStatus') && EMPLOYMENT_STATUSES.indexOf(applied.employmentStatus)===-1) return { success:false, error:'InvalidEmploymentStatus' };
  if(Object.prototype.hasOwnProperty.call(applied,'contractType') && CONTRACT_TYPES.indexOf(applied.contractType)===-1) return { success:false, error:'InvalidContractType' };
  const prevUpdatedAt = e.updatedAt;
  Object.keys(applied).forEach(k=> e[k] = applied[k]);
  e.updatedAt = new Date().toISOString();
  (e.history = e.history || []).push({ event:'employment-edited', ts:e.updatedAt, note:'Employment details updated ('+Object.keys(applied).join(', ')+')' });
  // PR-9A "The Adoption" — persistence mechanics now go through the Repository
  // boundary (EmployeeRepository.save() -> persistEmployees() -> StorageAdapter),
  // matching the contact slice (PR-8A). The handler still owns mutation, updatedAt,
  // history, the single persistence invocation, and rollback; the Repository only
  // normalizes the write result.
  const persisted = await EmployeeRepository.save();
  if(persisted.ok !== true){
    // Atomic rollback — no partial field update, no audit-success entry retained.
    Object.keys(before).forEach(k=> e[k] = before[k]);
    e.history.pop();
    e.updatedAt = prevUpdatedAt;
    return { success:false, error:'PersistFailed' };
  }
  return { success:true, data:e };
}

// Narrow employment-only editor. Routes through the Domain command seam and
// never calls updateEmployeeEmployment directly.
function openEmployeeEmploymentModal(id){
  const e = empById(id); if(!e) return;
  const statusOpts = EMPLOYMENT_STATUSES.map(s=>`<option value="${escapeHtml(s)}"${e.employmentStatus===s?' selected':''}>${escapeHtml(s)}</option>`).join('');
  const typeOpts = ['<option value="">—</option>'].concat(CONTRACT_TYPES.map(t=>`<option value="${escapeHtml(t)}"${e.contractType===t?' selected':''}>${escapeHtml(t)}</option>`)).join('');
  openModalHTML(`
    <h3>Edit Employment</h3>
    <form id="empEmploymentForm">
      <div class="form-grid" style="grid-template-columns:1fr 1fr;">
        <div class="field"><label>Job Title</label><input class="input" name="jobTitle" value="${escapeHtml(e.jobTitle||'')}"></div>
        <div class="field"><label>Department</label><input class="input" name="department" value="${escapeHtml(e.department||'')}"></div>
        <div class="field"><label>Employment Status</label><select class="input" name="employmentStatus">${statusOpts}</select></div>
        <div class="field"><label>Join Date</label><input class="input" type="date" name="joinDate" value="${escapeHtml(e.joinDate||'')}"></div>
        <div class="field"><label>Contract Type</label><select class="input" name="contractType">${typeOpts}</select></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" id="empEmploymentCancel">Cancel</button>
        <button type="submit" class="btn btn-accent">Save Employment</button>
      </div>
    </form>`, {width:560, onMount:(root)=>{
      root.querySelector('#empEmploymentCancel').addEventListener('click', closeModal);
      root.querySelector('#empEmploymentForm').addEventListener('submit', async ev=>{
        ev.preventDefault();
        const fd = new FormData(ev.target);
        const outcome = await uiExecute('command', 'employee.employment.update', [id, {
          jobTitle: fd.get('jobTitle'), department: fd.get('department'),
          employmentStatus: fd.get('employmentStatus'), joinDate: fd.get('joinDate'),
          contractType: fd.get('contractType')
        }]);
        if(outcome && outcome.success){ closeModal(); toast('Employment updated.'); render(); }
        else { toast('Could not update employment'+(outcome && outcome.error ? ': '+outcome.error : '')+'.', 5000); }
      });
    }});
}

/* ============================================================
   PR-5G — narrow Employee LIFECYCLE-TRANSITION command.
   Applies a supported lifecycle state-machine transition over the existing
   employmentStatus field (Active↔Resigned, Active↔Terminated) and nothing
   else. It never touches salary, contact/bank data, job/department, schedule,
   contracts, payroll, or finance. Reuses empById + persistEmployees + the
   existing `history` audit style, and returns a typed command outcome. Atomic:
   on a failed persist it reverts the status, updatedAt, and the audit entry.
   The business authority is EmployeeLifecycleAggregate (PR-5G); this handler
   keeps its own defense-in-depth guard against the same transition map and
   remains the implementation authority.
   ============================================================ */
async function transitionEmployeeLifecycle(id, transition){
  const e = empById(id);
  if(!e) return { success:false, error:'EmployeeNotFound' };
  transition = transition || {};
  const to = transition.to;
  const from = e.employmentStatus;
  // Defense-in-depth: only supported transitions from the CURRENT state proceed.
  const allowed = (typeof EMPLOYEE_LIFECYCLE_TRANSITIONS !== 'undefined' && EMPLOYEE_LIFECYCLE_TRANSITIONS[from]) || [];
  if(!to || allowed.indexOf(to)===-1) return { success:false, error:'IllegalLifecycleTransition' };
  const prevStatus = e.employmentStatus, prevUpdatedAt = e.updatedAt;
  e.employmentStatus = to;
  e.updatedAt = new Date().toISOString();
  (e.history = e.history || []).push({ event:'lifecycle-transition', ts:e.updatedAt, note:'Lifecycle '+from+' → '+to });
  // PR-9B "The Adoption" — persistence mechanics now go through the Repository
  // boundary (EmployeeRepository.save() -> persistEmployees() -> StorageAdapter),
  // matching the contact (PR-8A) and employment (PR-9A) slices. The handler still
  // owns the lifecycle mutation, updatedAt, history, the single persistence
  // invocation, and rollback; the Repository only normalizes the write result.
  const persisted = await EmployeeRepository.save();
  if(persisted.ok !== true){
    // Atomic rollback — restore status, timestamp, and drop the audit entry.
    e.employmentStatus = prevStatus;
    e.history.pop();
    e.updatedAt = prevUpdatedAt;
    return { success:false, error:'PersistFailed' };
  }
  return { success:true, data:e };
}

// Narrow lifecycle editor. Routes through the Domain command seam and never
// calls transitionEmployeeLifecycle directly. It offers only the transitions
// that are legal from the employee's current state.
function openEmployeeLifecycleModal(id){
  const e = empById(id); if(!e) return;
  const from = e.employmentStatus;
  const targets = (typeof EMPLOYEE_LIFECYCLE_TRANSITIONS !== 'undefined' && EMPLOYEE_LIFECYCLE_TRANSITIONS[from]) || [];
  const body = targets.length
    ? `<form id="empLifecycleForm">
        <div class="field"><label>Current Status</label><input class="input" value="${escapeHtml(from||'—')}" disabled></div>
        <div class="field"><label>Transition To</label><select class="input" name="to">${targets.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}</select></div>
        <div class="modal-actions">
          <button type="button" class="btn" id="empLifecycleCancel">Cancel</button>
          <button type="submit" class="btn btn-accent">Apply Transition</button>
        </div>
      </form>`
    : `<p class="dim">No lifecycle transitions are available from the current status (${escapeHtml(from||'—')}).</p>
       <div class="modal-actions"><button type="button" class="btn" id="empLifecycleCancel">Close</button></div>`;
  openModalHTML(`<h3>Employee Lifecycle</h3>`+body, {width:480, onMount:(root)=>{
    root.querySelector('#empLifecycleCancel').addEventListener('click', closeModal);
    const form = root.querySelector('#empLifecycleForm');
    if(form) form.addEventListener('submit', async ev=>{
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const outcome = await uiExecute('command', 'employee.lifecycle.transition', [id, fd.get('to')]);
      if(outcome && outcome.success){ closeModal(); toast('Lifecycle updated.'); render(); }
      else { toast('Could not update lifecycle'+(outcome && outcome.error ? ': '+outcome.error : '')+'.', 5000); }
    });
  }});
}

/* ============================================================
   PR-5H — narrow Employee COMPENSATION-UPDATE command.
   Mutates ONLY monthlyBaseSalary. It never touches contact, employment,
   lifecycle, bank, schedule, contract, payroll, finance, overtime, or
   supplemental data, and it performs no payroll recalculation. Reuses
   empById + persistEmployees + the existing `history` audit style, and
   returns a typed command outcome. Atomic: on a failed persist it reverts
   the salary, updatedAt, and the audit entry. The business authority is
   EmployeeCompensationAggregate (PR-5H); this handler keeps its own
   defense-in-depth validation and remains the implementation authority.
   ============================================================ */
const EMPLOYEE_COMPENSATION_FIELDS = ['monthlyBaseSalary'];
async function updateEmployeeCompensation(id, patch){
  const e = empById(id);
  if(!e) return { success:false, error:'EmployeeNotFound' };
  // UX-006C2A — repository-seam mutation boundary: authorize before any side effect (SE-0).
  if(!can(ACTIONS.EMPLOYEE_UPDATE, e)) return { success:false, error:'NotAuthorized' };
  patch = patch || {};
  // Allowlist: only monthlyBaseSalary is considered; all else is ignored.
  if(!Object.prototype.hasOwnProperty.call(patch, 'monthlyBaseSalary')) return { success:false, error:'NoCompensationFieldsProvided' };
  // Defense-in-depth normalization/validation (the aggregate validates first).
  const raw = patch.monthlyBaseSalary;
  let value;
  if(raw === null || raw === undefined){ value = null; }
  else {
    const s = String(raw).trim();
    if(s === ''){ value = null; }
    else { const n = Number(s); if(!isFinite(n) || n < 0) return { success:false, error:'InvalidMonthlyBaseSalary' }; value = n; }
  }
  const before = e.monthlyBaseSalary, prevUpdatedAt = e.updatedAt;
  e.monthlyBaseSalary = value;
  e.updatedAt = new Date().toISOString();
  (e.history = e.history || []).push({ event:'compensation-edited', ts:e.updatedAt, note:'Monthly base salary updated' });
  // PR-9C "The Adoption" — persistence mechanics now go through the Repository
  // boundary (EmployeeRepository.save() -> persistEmployees() -> StorageAdapter),
  // completing Employee-aggregate adoption (contact/employment/lifecycle/compensation).
  // The handler still owns the compensation mutation, updatedAt, history, the single
  // persistence invocation, and rollback; the Repository only normalizes the result.
  const persisted = await EmployeeRepository.save();
  if(persisted.ok !== true){
    // Atomic rollback — restore the salary, timestamp, and drop the audit entry.
    e.monthlyBaseSalary = before;
    e.history.pop();
    e.updatedAt = prevUpdatedAt;
    return { success:false, error:'PersistFailed' };
  }
  return { success:true, data:e };
}

// Narrow compensation-only editor. Routes through the Domain command seam and
// never calls updateEmployeeCompensation directly.
function openEmployeeCompensationModal(id){
  const e = empById(id); if(!e) return;
  openModalHTML(`
    <h3>Edit Compensation</h3>
    <form id="empCompensationForm">
      <div class="field"><label>Monthly Base Salary</label><input class="input" type="number" min="0" step="any" name="monthlyBaseSalary" value="${escapeHtml(e.monthlyBaseSalary==null?'':String(e.monthlyBaseSalary))}"></div>
      <div class="modal-actions">
        <button type="button" class="btn" id="empCompensationCancel">Cancel</button>
        <button type="submit" class="btn btn-accent">Save Compensation</button>
      </div>
    </form>`, {width:460, onMount:(root)=>{
      root.querySelector('#empCompensationCancel').addEventListener('click', closeModal);
      root.querySelector('#empCompensationForm').addEventListener('submit', async ev=>{
        ev.preventDefault();
        const fd = new FormData(ev.target);
        const outcome = await uiExecute('command', 'employee.compensation.update', [id, { monthlyBaseSalary: fd.get('monthlyBaseSalary') }]);
        if(outcome && outcome.success){ closeModal(); toast('Compensation updated.'); render(); }
        else { toast('Could not update compensation'+(outcome && outcome.error ? ': '+outcome.error : '')+'.', 5000); }
      });
    }});
}

function renderEmployeeDetail(main){
  /* Readiness-1 — re-scope the id at RENDER time. State.detailEmpId may have been
     captured under a different principal (a list row, a search result or a deep link),
     so it is never trusted on its own. Out-of-scope and non-existent resolve to the
     SAME empty state: rendering a different message for a foreign record would leak
     its existence. */
  const e = (typeof getScopedRecordById === 'function') ? getScopedRecordById('employee', State.detailEmpId) : empById(State.detailEmpId);
  if(!e){ main.innerHTML = emptyState('Employee not found','It may have been deleted.'); return; }
  const cts = contractsForEmployee(e.id).slice().sort((a,b)=>String(b.startDate||'').localeCompare(String(a.startDate||'')));
  const ct = activeContractToday(e.id);
  const calc = ct?contractCalc(ct, todayKey()):null;
  const txns = txnsForEmployee(e.id).slice().sort((a,b)=>String(b.monthKey).localeCompare(String(a.monthKey)));
  const empPlans = payrollPlansForEmployee(e.id).slice().sort((a,b)=>String(b.monthKey).localeCompare(String(a.monthKey)));
  const empOt = State.overtimeRecords.filter(o=>o.employeeId===e.id).slice().sort((a,b)=>String(b.monthKey).localeCompare(String(a.monthKey)) || String(b.overtimeDate||'').localeCompare(String(a.overtimeDate||'')));
  const overlaps = overlappingActiveContracts(e.id);
  const alerts = [];
  if(!ct) alerts.push({type:'warn', text:'This employee has no active contract for the current month.'});
  if(overlaps.length) alerts.push({type:'warn', text:`${overlaps.length} overlapping active contract${overlaps.length>1?'s':''} detected — review contract dates.`});
  cts.forEach(c=>{ const cc=contractCalc(c); if(contractTimeline(c).withinWarningWindow) alerts.push({type:'warn', text:`Contract ${escapeHtml(c.contractNumber||'')} is expiring soon (${cc.daysUntilEnd} days left).`}); });

  main.innerHTML = `
    <div class="page-head">
      <div><h1>${escapeHtml(e.fullName||'Employee')}</h1><p class="desc">${escapeHtml(e.jobTitle||'—')} · ${escapeHtml(e.department||'—')} · ${escapeHtml(e.employeeId||'')}</p></div>
      <div class="head-controls">
        <button class="btn" id="backEmp">← Employees</button>
        <button class="btn" id="editContactD">Edit Contact</button>
        <button class="btn" id="editEmploymentD">Edit Employment</button>
        <button class="btn" id="editLifecycleD">Lifecycle</button>
        <button class="btn" id="editCompensationD">Edit Compensation</button>
        <button class="btn" id="editEmpD">Edit</button>
        <button class="btn btn-accent" id="newCtForEmp">+ New Contract</button>
      </div>
    </div>
    ${alerts.length?`<div class="insight-list stack-section">${alerts.map(a=>`<div class="insight-item ${a.type}">${a.text}</div>`).join('')}</div>`:''}
    <div class="grid grid-2" style="margin-bottom:var(--space-4);align-items:start;">
      <div class="card">
        <h3>Profile</h3>
        <div style="font-size:13px;line-height:1.75;">
          <div>Status: ${hrStatusBadge(e.employmentStatus||'Inactive', EMP_STATUS_META)} ${e.active===false?'<span class="pill pill-status-archived">record off</span>':''}</div>
          <div>Contract Type: <b>${escapeHtml(e.contractType||'—')}</b></div>
          <div>Join Date: <b>${fmtDateID(e.joinDate)}</b></div>
          <div>Monthly Base Salary: <b class="mono">${fmtIDR(e.monthlyBaseSalary)}</b></div>
          <div>Bank: <b>${escapeHtml(normalizeBankName(e.bankName)||'—')}</b> <span class="mono">${escapeHtml(maskAccountNumber(e.bankAccountNumber||e.bankAccount))}</span>${(e.bankAccountHolder||e.accountHolder)?` · <span class="dim">${escapeHtml(e.bankAccountHolder||e.accountHolder)}</span>`:''}</div>
          <div>Email: <b>${escapeHtml(e.email||'—')}</b></div>
          <div>Phone: <b>${escapeHtml(e.phone||'—')}</b></div>
          ${e.notes?`<div class="dim" style="margin-top:6px;">${escapeHtml(e.notes)}</div>`:''}
        </div>
      </div>
      <div class="card">
        <h3>Active Contract</h3>
        ${ct?`
          <div style="font-size:13px;line-height:1.7;">
            <div><b>${escapeHtml(ct.contractNumber||'—')}</b> ${contractPresentationBadge(ct)}</div>
            <div class="dim">${fmtDateID(calc.startDate)} → ${fmtDateID(calc.endDate)}</div>
            <div style="margin:8px 0 4px;">Progress <b>${calc.progress}</b> · ${escapeHtml(contractProgressNote(ct))}</div>
            ${progressBar(calc.pct)}
            <div style="margin-top:8px;">Monthly Salary: <b class="mono">${fmtIDR(ct.monthlySalary)}</b></div>
            <div style="margin-top:10px;"><button class="btn btn-sm" data-ct-detail="${ct.id}">Open Contract</button></div>
          </div>`:'<div class="empty">No active contract for the current month.</div>'}
      </div>
    </div>
    <div class="card stack-section">
      <h3>Contract History</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Contract #</th><th>Start</th><th>End</th><th>Progress</th><th class="num">Monthly</th><th>Status</th><th></th></tr></thead>
        <tbody>${cts.map(c=>{ const cc=contractCalc(c); return `<tr>
          <td><button class="linklike" data-ct-detail="${c.id}">${escapeHtml(c.contractNumber||'—')}</button></td>
          <td class="dim">${fmtDateID(cc.startDate)}</td><td class="dim">${fmtDateID(cc.endDate)}</td>
          <td>${cc.progress}</td><td class="num">${fmtIDR(c.monthlySalary)}</td>
          <td>${contractPresentationBadge(c)}</td>
          <td><button class="btn btn-sm" data-ct-renew="${c.id}">Renew</button></td>
        </tr>`; }).join('') || '<tr><td colspan="7" class="empty">No contracts yet.</td></tr>'}</tbody>
      </table></div>
    </div>
    <div class="card stack-section">
      <h3>Payroll History</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Period</th><th>Contract</th><th class="num">Base Payroll</th><th class="num">Payroll OT</th><th class="num">Supplemental</th><th class="num">Total Compensation</th><th>Stage</th></tr></thead>
        <tbody>${empPlans.map(p=>{ const tc=payrollTotalCompensation(p); return `<tr>
          <td class="dim">${escapeHtml(p.month||'')} ${p.year||''}</td>
          <td class="dim">${escapeHtml(p.contractNumber||'—')}</td>
          <td class="num">${fmtIDR(tc.baseSalary)}</td>
          <td class="num">${fmtIDR(tc.overtimeAmount)}</td>
          <td class="num">${tc.supplemental>0?`${fmtIDR(tc.supplemental)}<div class="faint" style="font-size:10px;">${tc.supplementalCount} Supplemental${tc.supplementalCount===1?'':'s'}</div>`:'<span class="dim">—</span>'}${tc.pendingSupplemental>0?`<div class="faint" style="font-size:10px;" title="Pending supplemental (Draft/Review/Approved) — not yet paid; excluded from Total Compensation">Pending ${fmtIDR(tc.pendingSupplemental)}</div>`:''}</td>
          <td class="num"><b>${fmtIDR(tc.totalCompensation)}</b>${payrollSnapshotHasIssue(p)?' <span class="pill pill-status-cancelled" title="Base payroll disagrees with its committed transaction — see Payroll Detail">!</span>':''}</td>
          <td style="font-weight:600;">${payrollStagePill(p)}</td>
        </tr>`; }).join('') || '<tr><td colspan="7" class="empty">No payroll generated for this employee yet.</td></tr>'}</tbody>
      </table></div>
      <p class="hint" style="margin-top:8px;">Total Compensation includes committed (Posted/Executed) Supplemental Payments. Base Payroll always remains immutable.</p>
    </div>
    <div class="card stack-section">
      <h3>Overtime History</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Period</th><th>Date</th><th class="num">Hours</th><th class="num">Amount</th><th>Status</th></tr></thead>
        <tbody>${empOt.map(o=>`<tr>
          <td class="dim">${escapeHtml(o.month||'')} ${o.year||''}</td>
          <td class="dim">${escapeHtml(o.overtimeDate||'—')}</td>
          <td class="num">${num(o.overtimeHours)}</td>
          <td class="num">${fmtIDR(o.approvedAmount!=null?o.approvedAmount:o.calculatedAmount)}</td>
          <td>${hrStatusBadge(o.status, OVERTIME_STATUS_META)}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="empty">No overtime records for this employee.</td></tr>'}</tbody>
      </table></div>
    </div>
    ${(typeof supplementalEmployeeSectionHTML==='function')?supplementalEmployeeSectionHTML(e.id):''}
    <div class="card">
      <h3>Finance Transactions</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Month</th><th>Description</th><th class="num">Planned</th><th class="num">Actual</th><th>Status</th></tr></thead>
        <tbody>${txns.map(t=>`<tr>
          <td class="dim">${escapeHtml(t.month)} ${t.year}</td>
          <td><button class="linklike" data-open-detail="${t.id}">${escapeHtml(t.uraian)}</button></td>
          <td class="num">${fmtIDR(t.planned)}</td>
          <td class="num">${t.actual!=null?fmtIDR(t.actual):'<span class="faint">—</span>'}</td>
          <td>${statusBadge(statusOf(t))}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="empty">No finance transactions yet. Post approved payroll to create them.</td></tr>'}</tbody>
      </table></div>
    </div>`;
  document.getElementById('backEmp').addEventListener('click', ()=>hrNavTo('employees'));
  document.getElementById('editContactD').addEventListener('click', ()=>openEmployeeContactModal(e.id));
  document.getElementById('editEmploymentD').addEventListener('click', ()=>openEmployeeEmploymentModal(e.id));
  document.getElementById('editLifecycleD').addEventListener('click', ()=>openEmployeeLifecycleModal(e.id));
  document.getElementById('editCompensationD').addEventListener('click', ()=>openEmployeeCompensationModal(e.id));
  document.getElementById('editEmpD').addEventListener('click', ()=>openEmployeeModal(e.id));
  document.getElementById('newCtForEmp').addEventListener('click', ()=>openContractModal(null, e.id));
  main.querySelectorAll('[data-ct-detail]').forEach(b=>b.addEventListener('click', ()=>hrNavTo('contractDetail', {detailContractId:b.dataset.ctDetail})));
  main.querySelectorAll('[data-ct-renew]').forEach(b=>b.addEventListener('click', ()=>openRenewModal(b.dataset.ctRenew)));
  main.querySelectorAll('[data-open-detail]').forEach(b=>b.addEventListener('click', ()=>openDetailModal(b.dataset.openDetail)));
  bindHRActions(main);
}

/* ---------- generic HR actions menu (mirrors the finance actions menu) ---------- */
// v2.6.9 — employee Bank <select> sourced from the Bank Master. Legacy short names
// (Mandiri, BCA, BNI, BSI, …) map to their canonical master entry; any other existing
// free-text value is preserved as a leading "(current)" option so nothing is lost and
// no bulk data migration occurs (the stored value only changes if the user re-saves).
function employeeBankSelectHTML(current){
  const cur = (current||'').trim();
  const mapped = normalizeBankName(cur);
  const inMaster = INDONESIAN_BANKS.includes(mapped);
  const custom = (cur && !inMaster) ? `<option value="${escapeHtml(cur)}" selected>${escapeHtml(cur)} (current)</option>` : '';
  const selected = inMaster ? mapped : '';
  return `<option value="" ${cur?'':'selected'}>— select —</option>${custom}`
    + BANK_MASTER_GROUPS.map(g=>`<optgroup label="${escapeHtml(g.group)}">${g.banks.map(b=>`<option ${b===selected?'selected':''}>${escapeHtml(b)}</option>`).join('')}</optgroup>`).join('');
}
function hrActionsMenu(kind, id, items){
  return `<div class="actions-menu">
    <button class="btn btn-sm actions-toggle" data-hr-actions="${kind}:${id}">Actions ▾</button>
    <div class="actions-dropdown" data-hr-menu="${kind}:${id}" style="display:none;">
      ${items.filter(Boolean).map(([a,l])=>`<button class="actions-item ${a.endsWith('delete')?'danger':''}" data-hr-action="${a}" data-hr-id="${id}">${l}</button>`).join('')}
    </div></div>`;
}
function bindHRActions(main){
  main.querySelectorAll('[data-hr-actions]').forEach(btn=>btn.addEventListener('click', e=>{
    e.stopPropagation();
    // v2.6.3b — floating menu portaled out of the table container (never clipped).
    if(isFloatingMenuOpenFor(btn)){ closeFloatingMenu(); return; }
    const menu = main.querySelector(`[data-hr-menu="${btn.dataset.hrActions}"]`);
    if(menu) openFloatingMenu(btn, menu);
  }));
  main.querySelectorAll('[data-hr-action]').forEach(btn=>btn.addEventListener('click', async e=>{
    e.stopPropagation();
    main.querySelectorAll('.actions-dropdown').forEach(m=>m.style.display='none');
    const id = btn.dataset.hrId, a = btn.dataset.hrAction;
    if(a==='emp-detail') hrNavTo('employeeDetail', {detailEmpId:id});
    else if(a==='emp-edit') openEmployeeModal(id);
    else if(a==='emp-deactivate') setEmployeeActive(id, false);
    else if(a==='emp-reactivate') setEmployeeActive(id, true);
    else if(a==='emp-delete') deleteEmployee(id);
    else if(a==='ct-detail') hrNavTo('contractDetail', {detailContractId:id});
    else if(a==='ct-edit') openContractModal(id);
    else if(a==='ct-renew') openRenewModal(id);
    else if(a==='ct-activate') requestContractStatusTransition(id, 'Active');
    else if(a==='ct-cancel') requestContractStatusTransition(id, 'Cancelled');
    else if(a==='ct-delete') deleteContract(id);
    else if(a==='re-edit') openRecurringModal(id);
    else if(a==='re-toggle') toggleRecurring(id);
    else if(a==='re-delete') deleteRecurring(id);
    else if(a==='padj-edit') openAdjustmentModal(id);
    else if(a==='padj-toggle') toggleAdjustment(id);
    else if(a==='padj-delete') deleteAdjustment(id);
    else if(a.startsWith('supp-')) handleSupplementalAction(a.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()), id);
    else if(a==='cacc-edit') openCompanyAccountModal(id);
    else if(a==='cacc-activate') setCompanyAccountStatus(id, 'Active');
    else if(a==='cacc-deactivate') setCompanyAccountStatus(id, 'Inactive');
    else if(a==='cacc-archive') setCompanyAccountStatus(id, 'Archived');
    else if(a==='prow-detail') hrNavTo('payrollDetail',{detailPayrollId:id});
    else if(a==='prow-review') { await requestPayrollLifecycle(id,'Reviewed'); render(); }
    else if(a==='prow-ready') { await requestPayrollLifecycle(id,'Ready'); render(); }
    else if(a==='prow-draft') { await requestPayrollLifecycle(id,'Draft'); render(); }
    else if(a==='prow-cancel') { if(confirmAction('Cancel this payroll row? It will not create a finance transaction.')){ await requestPayrollLifecycle(id,'Cancelled'); render(); } }
    else if(a==='prow-exec') { const pp=payrollPlanById(id); const t=pp&&payrollTxnOf(pp); if(t) focusTransactionInExecutionCenter(t.id); else { State.view='executioncenter'; render(); } }
    else if(a==='ot-view') openOvertimeBreakdown(id);
    else if(a==='ot-edit') openOvertimeModal(id);
    else if(a==='ot-duplicate') duplicateOvertimeRecord(id);
    else if(a==='ot-review') setOvertimeStatus(id, 'Reviewed');
    else if(a==='ot-approve') setOvertimeStatus(id, 'Approved');
    else if(a==='ot-reject') setOvertimeStatus(id, 'Rejected');
    else if(a==='ot-delete') deleteOvertimeRecord(id);
  }));
}

function exportEmployeesCsv(){
  // v2.7.0 CSV bank-account security policy: this general-purpose employee export MASKS the
  // account number (last 4 only). Full numbers are never written to a general CSV or logs;
  // import still accepts full numbers and stored values are not rewritten. See docs/DATA-SAFETY.md.
  const headers = ['Employee ID','Full Name','Job Title','Department','Employment Status','Record Active','Join Date','Contract Type','Active Contract','Monthly Base Salary','Bank','Bank Account (masked)','Email','Phone','Notes'];
  const lines = [`# ${APP_NAME} v${APP_VERSION} — Employees (bank account numbers masked)`, headers.join(',')];
  // Readiness-1 — an export is a read: it carries the current principal's scope.
  ((typeof getScopedRecords === 'function') ? getScopedRecords('employee') : State.employees).forEach(e=>{
    const ct = activeContractToday(e.id);
    lines.push([e.employeeId,e.fullName,e.jobTitle,e.department,e.employmentStatus,e.active===false?'No':'Yes',e.joinDate||'',e.contractType,ct?ct.contractNumber:'',e.monthlyBaseSalary??'',normalizeBankName(e.bankName),maskAccountNumber(e.bankAccountNumber||e.bankAccount),e.email,e.phone,e.notes].map(csvSafe).join(','));
  });
  downloadBlob(lines.join('\n'), `${FILE_BASE}-employees.csv`, 'text/csv');
  toast('Employees exported.');
}
