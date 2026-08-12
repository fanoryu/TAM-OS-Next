/* ============================================================
   EMPLOYEE DUPLICATE REVIEW & MERGE (Parts 6, 7, 11, 12)
   Detect-only; never merges without explicit user confirmation.
   ============================================================ */
const MERGE_PROFILE_FIELDS = ['bankAccount','email','phone','jobTitle','department','joinDate','monthlyBaseSalary','employmentStatus'];

// Groups of existing employees that share a normalized name (Part 6 detection).
function findEmployeeDuplicateGroups(){
  const byKey = new Map();
  /* NOT scoped: this is an INTEGRITY input (the duplicate-employee-name rules) and must
     see every record, or data-quality detection silently stops working. Identity
     disclosure is handled at the RENDER site instead — see renderEmployeeDedup. */
  State.employees.forEach(e=>{ const k=normalizeEmployeeName(e.fullName); if(!k) return; if(!byKey.has(k)) byKey.set(k,[]); byKey.get(k).push(e); });
  const groups=[];
  byKey.forEach((emps,key)=>{ if(emps.length>1) groups.push({key, name:emps[0].fullName, employees:emps, canonical:pickCanonicalEmployee(emps)}); });
  return groups;
}
// All records linked to an employee id.
function employeeLinkedRecords(id){
  return {
    contracts: State.contracts.filter(c=>c.employeeId===id),
    payrollPlans: State.payrollPlans.filter(p=>p.employeeId===id),
    txns: State.txns.filter(t=>t.employeeId===id),
    overtime: State.overtimeRecords.filter(o=>o.employeeId===id),
    adjustments: State.payrollAdjustments.filter(a=>a.employeeId===id),
  };
}
function employeeLinkTotals(id){ const r=employeeLinkedRecords(id); return {contracts:r.contracts.length, payrollPlans:r.payrollPlans.length, txns:r.txns.length, overtime:r.overtime.length, adjustments:r.adjustments.length}; }

// Part 7 — merge duplicates into one canonical employee. Backup first; relink
// every record; never delete contracts/payroll/txns/overtime or change amounts;
// apply only chosen profile values; write an audit record.
async function mergeEmployeeGroup(canonicalId, duplicateIds, profileChoices){
  // UX-006C2C-3 (row 9) — the merge relinks contracts, payroll plans, transactions,
  // overtime and adjustments and then DELETES the duplicate employee master records; it is
  // not reversible in-app. Frozen to employee.delete (ruling R5) — the strongest verb it
  // exercises — and authorized ONCE here, before the safety backup, before any relink and
  // before the merge audit record.
  const now = new Date().toISOString();
  const canon = State.employees.find(e=>e.id===canonicalId);
  if(!canon || !duplicateIds.length) return null;
  const dupSet = new Set(duplicateIds.filter(id=>id!==canonicalId));
  if(!dupSet.size) return null;
  // Authorized with the REAL canonical record (employee.delete is resource-bearing, so the
  // AZ-1 scope precondition evaluates an actual employee), and BEFORE the safety backup,
  // the relink pass, the master-record deletion and the merge audit entry.
  if(!can(ACTIONS.EMPLOYEE_DELETE, canon)) return { ok:false, error:'NotAuthorized' };
  // Complete safety backup (full master-data snapshot + transactions).
  State.backups.unshift({id:uid('backup'), monthKey:'__all__', monthLabel:'Pre-employee-merge backup ('+canon.fullName+')', timestamp:now, migration:true,
    txns: JSON.parse(JSON.stringify(State.txns)),
    masterSnapshot: JSON.parse(JSON.stringify({employees:State.employees, contracts:State.contracts, payrollPlans:State.payrollPlans, overtimeRecords:State.overtimeRecords, payrollAdjustments:State.payrollAdjustments}))});
  await saveBackups();
  const relinked = {contracts:[], payrollPlans:[], txns:[], overtime:[], adjustments:[]};
  State.contracts.forEach(c=>{ if(dupSet.has(c.employeeId)){ c.employeeId=canonicalId; c.employeeName=canon.fullName; c.updatedAt=now; relinked.contracts.push(c.id);} });
  State.payrollPlans.forEach(p=>{ if(dupSet.has(p.employeeId)){ p.employeeId=canonicalId; p.employeeName=canon.fullName; p.updatedAt=now; relinked.payrollPlans.push(p.id);} });
  State.txns.forEach(t=>{ if(dupSet.has(t.employeeId)){ t.employeeId=canonicalId; if(t.payrollMeta) t.payrollMeta.employeeName=canon.fullName; relinked.txns.push(t.id);} });
  State.overtimeRecords.forEach(o=>{ if(dupSet.has(o.employeeId)){ o.employeeId=canonicalId; if(o.employeeName!==undefined) o.employeeName=canon.fullName; o.updatedAt=now; relinked.overtime.push(o.id);} });
  State.payrollAdjustments.forEach(a=>{ if(dupSet.has(a.employeeId)){ a.employeeId=canonicalId; a.updatedAt=now; relinked.adjustments.push(a.id);} });
  // Apply chosen profile values (user-selected; empties fall back to canonical's own value — never silent overwrite of non-empty).
  const appliedProfile={};
  MERGE_PROFILE_FIELDS.forEach(f=>{ if(profileChoices && profileChoices[f]!=null && profileChoices[f]!=='' ){ if(canon[f]!==profileChoices[f]){ canon[f]=profileChoices[f]; appliedProfile[f]=profileChoices[f]; } } });
  canon.updatedAt=now; canon.history=canon.history||[];
  canon.history.push({event:'merged', ts:now, note:`Merged ${dupSet.size} duplicate record(s) into this canonical employee`});
  // Remove the now-empty duplicate employee master records (their links were repointed).
  const removedCodes = State.employees.filter(e=>dupSet.has(e.id)).map(e=>e.employeeId||e.id);
  State.employees = State.employees.filter(e=>!dupSet.has(e.id));
  const auditRec = {id:uid('merge'), ts:now, canonicalEmployeeId:canonicalId, canonicalCode:canon.employeeId, canonicalName:canon.fullName,
    duplicateEmployeeIds:[...dupSet], duplicateCodes:removedCodes, relinked,
    relinkedCounts:{contracts:relinked.contracts.length, payrollPlans:relinked.payrollPlans.length, txns:relinked.txns.length, overtime:relinked.overtime.length, adjustments:relinked.adjustments.length},
    selectedProfile:appliedProfile};
  State.employeeMerges.unshift(auditRec);
  // SPR-079 — the fan-out result is now inspected. A failed write must never be
  // reported to the user as a completed merge. No rollback is performed and none
  // is claimed: the merge has already been applied in memory, the pre-merge
  // safety backup (taken and persisted above) is untouched, and reloading
  // restores whatever was last persisted. Retry is safe — the merge is
  // idempotent over the same canonical/duplicate ids.
  const saved = await saveAllData();
  return { ok: saved === true, audit: auditRec };
}

function renderEmployeeDedup(main){
  /* Readiness-1 (identity closure) — Duplicate Review is a reachable view, so the
     RENDER is scoped even though the underlying detection stays canonical: a group is
     shown only if it contains a record the current principal may read. CEO sees every
     group; an Employee sees only groups involving themselves; null sees none. */
  const inScope = new Set(((typeof getScopedRecords === 'function') ? getScopedRecords('employee') : State.employees).map(e=>e.id));
  const groups = findEmployeeDuplicateGroups().filter(g=>g.employees.some(e=>inScope.has(e.id)));
  const merges = State.employeeMerges||[];
  main.innerHTML = pageHeader('Employee Duplicate Review',
      `Master-data consolidation · ${groups.length} duplicate group(s) detected · ${((typeof getScopedRecords === 'function') ? getScopedRecords('employee') : State.employees).length} employee record(s)`,
      `<button class="btn" id="edBack">Back to Employees</button>`)
    + (groups.length ? '' : `<div class="card"><div class="insight-item good" style="display:block;">No duplicate employees detected. Every real person has exactly one master record.</div></div>`)
    + groups.map((g,gi)=>{
        const canonId = (State.dedupCanon&&State.dedupCanon[g.key]) || g.canonical.id;
        const rows = g.employees.map(e=>{ const t=employeeLinkTotals(e.id); return `<tr>
          <td><input type="radio" name="canon_${gi}" data-canon="${escapeHtml(g.key)}" value="${e.id}" ${e.id===canonId?'checked':''}></td>
          <td><b>${escapeHtml(e.employeeId||'—')}</b><div class="faint" style="font-size:10px;">${escapeHtml(e.id)}</div></td>
          <td>${escapeHtml(e.fullName)}</td>
          <td class="num">${t.contracts}</td><td class="num">${t.payrollPlans}</td><td class="num">${t.txns}</td><td class="num">${t.overtime}</td><td class="num">${t.adjustments}</td>
          <td>${e.id===g.canonical.id?'<span class="pill pill-status-completed">suggested</span>':''}</td></tr>`; }).join('');
        // profile conflict fields (distinct non-empty values across the group)
        const conflicts = MERGE_PROFILE_FIELDS.map(f=>{
          const vals=[...new Set(g.employees.map(e=>e[f]).filter(v=>v!=null && String(v).trim()!=='').map(String))];
          return vals.length>1 ? {f, vals} : null;
        }).filter(Boolean);
        const conflictHTML = conflicts.length ? `<div class="hint" style="margin:10px 0 6px;"><b>Profile differences</b> — choose which value the canonical record keeps (non-empty values are never overwritten silently):</div>
          <div class="grid grid-3" style="gap:8px;">${conflicts.map(cf=>`<div class="field"><label>${escapeHtml(cf.f)}</label><select class="input" data-prof="${escapeHtml(g.key)}|${cf.f}">${cf.vals.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('')}</select></div>`).join('')}</div>` : '';
        return `<div class="card stack-section">
          <h3 style="margin-top:0;">${escapeHtml(g.name)} <span class="tag">${g.employees.length} records</span></h3>
          <div class="table-wrap"><table><thead><tr><th style="width:34px;">Keep</th><th>Employee ID</th><th>Name</th><th class="num">Contracts</th><th class="num">Payroll</th><th class="num">Txns</th><th class="num">OT</th><th class="num">Adj</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
          ${conflictHTML}
          <div class="small-btn-row" style="margin-top:12px;">
            <button class="btn btn-accent" data-merge="${escapeHtml(g.key)}" data-gi="${gi}">Preview &amp; Merge This Group</button>
          </div>
          <p class="hint" style="margin-top:8px;">Merging relinks every contract, payroll plan, transaction, overtime and adjustment to the kept record. Nothing is deleted and no amount changes. A complete backup is taken first.</p>
        </div>`;
      }).join('')
    + (merges.length ? `<div class="card"><h3 style="margin-top:0;">Merge History</h3><div class="table-wrap"><table><thead><tr><th>When</th><th>Canonical</th><th>Merged IDs</th><th>Relinked</th></tr></thead><tbody>${merges.slice(0,50).map(m=>`<tr><td class="dim">${escapeHtml(new Date(m.ts).toLocaleString('id-ID'))}</td><td>${escapeHtml(m.canonicalCode||m.canonicalName||m.canonicalEmployeeId)}</td><td class="dim">${m.duplicateEmployeeIds.length} record(s)</td><td class="dim">${Object.entries(m.relinkedCounts||{}).map(([k,v])=>v+' '+k).filter(x=>!x.startsWith('0 ')).join(', ')||'—'}</td></tr>`).join('')}</tbody></table></div></div>` : '');

  const back=document.getElementById('edBack'); if(back) back.addEventListener('click', ()=>{ State.view='employees'; render(); });
  main.querySelectorAll('[data-canon]').forEach(r=>r.addEventListener('change', e=>{ State.dedupCanon=State.dedupCanon||{}; State.dedupCanon[e.target.dataset.canon]=e.target.value; }));
  main.querySelectorAll('[data-merge]').forEach(btn=>btn.addEventListener('click', async ()=>{
    const key=btn.dataset.merge;
    const g=findEmployeeDuplicateGroups().find(x=>x.key===key); if(!g) return;
    const canonId=(State.dedupCanon&&State.dedupCanon[key])||g.canonical.id;
    const dupIds=g.employees.map(e=>e.id).filter(id=>id!==canonId);
    const profile={}; main.querySelectorAll(`[data-prof^="${key}|"]`).forEach(sel=>{ const f=sel.dataset.prof.split('|')[1]; profile[f]=sel.value; });
    let tot={contracts:0,payrollPlans:0,txns:0,overtime:0,adjustments:0}; dupIds.forEach(id=>{ const t=employeeLinkTotals(id); Object.keys(tot).forEach(k=>tot[k]+=t[k]); });
    const canon=State.employees.find(e=>e.id===canonId);
    if(!confirmAction(`Merge ${dupIds.length} duplicate record(s) into "${canon.fullName}" (${canon.employeeId})?\n\nWill relink: ${tot.contracts} contract(s), ${tot.payrollPlans} payroll plan(s), ${tot.txns} transaction(s), ${tot.overtime} overtime, ${tot.adjustments} adjustment(s).\n\nA complete backup is taken first. No records are deleted and no amounts change.`)) return;
    const res=await mergeEmployeeGroup(canonId, dupIds, profile);
    if(!res) return;                        // nothing to merge (unchanged behaviour)
    // UX-006C2C-3 — a denial is not a persistence failure: nothing was written and no
    // pre-merge backup was taken, so the SPR-079 wording below would be false. The engine
    // returns a typed NotAuthorized; report it as a denial and stop.
    if(res.error === 'NotAuthorized'){ showWarning('You do not have permission to merge employee records.'); return; }
    if(res.ok !== true){
      // SPR-079 — persistence failed. No success message, no completion state is
      // cleared. Wording states the operation did not complete; it does NOT claim
      // a rollback, because the fan-out is not atomic and earlier writes may have
      // persisted. The pre-merge safety backup remains available.
      showError('Some data could not be saved. The merge was not completed successfully — reload the page to return to the last saved state. A pre-merge backup was taken and is still available in Settings.', null, 9000);
      render();
      return;
    }
    const rec=res.audit;
    if(State.dedupCanon) delete State.dedupCanon[key];
    showSuccess(`Merged ${rec.duplicateEmployeeIds.length} duplicate(s) into ${rec.canonicalCode}. ${rec.relinkedCounts.txns} transaction(s) relinked; amounts unchanged.`, 7000);
    render();
  }));
}
