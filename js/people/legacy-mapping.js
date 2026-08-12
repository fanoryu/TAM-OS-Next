/* ============================================================
   LEGACY PAYROLL MAPPING
   Conservatively links historical Gaji transactions (imported from
   Excel, where the description is the employee name) to employee &
   contract master data. Never guesses aggressively, never creates
   contracts, always requires confirmation, preserves descriptions.
   ============================================================ */
function unlinkedGajiTxns(){
  return State.txns.filter(t=>t.type!=='income' && (t.category==='Gaji') && !t.employeeId && t.source!=='payroll');
}
function suggestEmployeeForName(name){
  const n = normStr(name);
  let exact = State.employees.find(e=>normStr(e.fullName)===n);
  if(exact) return {emp:exact, confidence:'high'};
  let best=null, bestScore=0;
  State.employees.forEach(e=>{ const s=similarText(e.fullName, name); if(s>bestScore){ bestScore=s; best=e; } });
  if(best && bestScore>=0.82) return {emp:best, confidence:'medium', score:bestScore};
  return {emp:null, confidence:'none'};
}
function renderLegacyPayrollMapping(main){
  const unlinked = unlinkedGajiTxns();
  // group by description (employee name as written on the historical row)
  const groups = {};
  unlinked.forEach(t=>{ const k=t.uraian||'(blank)'; (groups[k]=groups[k]||{name:t.uraian, txns:[]}).txns.push(t); });
  const rows = Object.values(groups).map(g=>({...g, suggestion:suggestEmployeeForName(g.name)}))
    .sort((a,b)=>b.txns.length-a.txns.length);

  main.innerHTML = `
    <div class="page-head">
      <div><h1>Legacy Payroll Mapping</h1><p class="desc">Link historical Gaji transactions to employee and contract master data. Matching is conservative — review every suggestion before applying. Descriptions are preserved.</p></div>
      <div class="head-controls"><button class="btn" id="backPay">← Payroll Planning</button></div>
    </div>
    ${!((typeof getScopedRecords === 'function') ? getScopedRecords('employee') : State.employees).length?`<div class="insight-item warn stack-section">No employees exist yet. Add employees first (People &amp; Contracts → Employees), then return here to map historical payroll to them.</div>`:''}
    <div class="card">
      <h3>Unmapped Historical Payroll <span class="tag">${unlinked.length} transaction(s) · ${rows.length} distinct name(s)</span></h3>
      ${rows.length?`
      <div class="table-wrap" style="max-height:560px;overflow-y:auto;">
        <table>
          <thead><tr><th>Historical Description</th><th class="num">Txns</th><th>Match Confidence</th><th>Map to Employee</th><th>Auto-link Contract</th></tr></thead>
          <tbody>${rows.map((g,i)=>`<tr>
            <td><b>${escapeHtml(g.name||'—')}</b></td>
            <td class="num">${g.txns.length}</td>
            <td>${g.suggestion.confidence==='high'?'<span class="pill pill-status-completed">high</span>':g.suggestion.confidence==='medium'?`<span class="pill pill-status-partial">medium ${(g.suggestion.score*100).toFixed(0)}%</span>`:'<span class="pill pill-status-archived">no match</span>'}</td>
            <td><select class="input" data-map="${i}"><option value="">— do not map —</option>${((typeof getScopedRecords === 'function') ? getScopedRecords('employee') : State.employees).map(e=>`<option value="${e.id}" ${g.suggestion.emp&&g.suggestion.emp.id===e.id&&g.suggestion.confidence==='high'?'selected':''}>${escapeHtml(e.fullName)} (${escapeHtml(e.employeeId||'')})</option>`).join('')}</select></td>
            <td><label class="checkbox-row"><input type="checkbox" data-autoct="${i}" checked> match by month</label></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="modal-actions" style="justify-content:flex-start;margin-top:var(--space-4);">
        <button class="btn btn-accent" id="applyMap">Apply Mappings</button>
        <span class="hint" style="align-self:center;">Only rows with an employee selected are linked. Contracts are linked only where one already covers that transaction's month — none are created.</span>
      </div>`:'<div class="empty">All Gaji transactions are already linked to employees, or there is no historical payroll to map.</div>'}
    </div>`;
  document.getElementById('backPay').addEventListener('click', ()=>hrNavTo('payroll'));
  const applyBtn = document.getElementById('applyMap');
  if(applyBtn) applyBtn.addEventListener('click', async ()=>{
    // UX-006C2C-4 (row 24) — bulk administrative edit of existing transactions
    // (employeeId / contractId / payrollMeta / history): finance.manage, before any edit.
    if(!can(ACTIONS.FINANCE_MANAGE)){ toast('You do not have permission to edit transactions.', 7000); return; }
    let linked=0, ctLinked=0;
    rows.forEach((g,i)=>{
      const sel = main.querySelector(`[data-map="${i}"]`); const empId = sel && sel.value;
      if(!empId) return;
      const emp = empById(empId); if(!emp) return;
      const autoCt = main.querySelector(`[data-autoct="${i}"]`).checked;
      g.txns.forEach(t=>{
        t.employeeId = empId;
        if(!t.payrollMeta) t.payrollMeta = {employeeName:emp.fullName, contractNumber:null, contractProgress:null};
        pushHistory(t, 'linked', `Mapped to employee ${emp.fullName} via Legacy Payroll Mapping`);
        if(autoCt){ const ct = coveringContract(empId, t.monthKey); if(ct){ t.contractId=ct.id; const cc=contractCalc(ct,t.monthKey); t.payrollMeta.contractNumber=ct.contractNumber; t.payrollMeta.contractProgress=cc.progress; ctLinked++; } }
        linked++;
      });
    });
    if(!linked){ toast('No rows had an employee selected.'); return; }
    await persist();
    toast(`Linked ${linked} transaction(s) to employees${ctLinked?`, ${ctLinked} to contracts`:''}. Descriptions preserved.`, 6000);
    render();
  });
}
