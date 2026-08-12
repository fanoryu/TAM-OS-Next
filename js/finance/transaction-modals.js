/* ---------- execute modal ---------- */
function openExecuteModal(id){ State.execModalTxnId = id; renderExecuteModal(); }
function closeModal(){
  State.execModalTxnId=null;
  document.getElementById('modal-root').innerHTML='';
  // Return focus to whatever opened the modal (accessibility, v2.2.1).
  if(State._modalOpener && typeof State._modalOpener.focus==='function'){ try{ State._modalOpener.focus(); }catch(e){} }
  State._modalOpener=null;
}
function renderExecuteModal(){
  const t = findTxn(State.execModalTxnId); if(!t) return;
  const root = document.getElementById('modal-root');
  if(!State._modalOpener) State._modalOpener = document.activeElement;
  const defAmt = (t.actual!==null&&t.actual!==undefined)?t.actual:(t.planned||0);
  const today = new Date().toISOString().slice(0,10);
  root.innerHTML = `
    <div class="modal-overlay" id="execOverlay">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="execModalTitle" style="max-width:540px;">
        <h3 id="execModalTitle">Execute Transaction</h3>
        <p class="dim" style="font-size:12.5px;margin:0 0 var(--space-4);">${escapeHtml(t.uraian)} · ${escapeHtml(t.category)} · planned ${fmtIDR(t.planned)}</p>
        <form id="execForm">
          <div class="form-grid" style="grid-template-columns:1fr 1fr;">
            <div class="field"><label>Execution Date</label><input class="input" type="date" name="executionDate" value="${escapeHtml(t.txnDate||today)}"></div>
            <div class="field"><label>Actual Amount (Rp)</label><input class="input" type="number" step="any" name="actualAmount" value="${defAmt}"></div>
            <div class="field"><label>Payment Method</label><select class="input" name="method">${PAYMENT_METHODS.map(m=>`<option ${m===State.settings.defaultPaymentMethod?'selected':''}>${m}</option>`).join('')}</select></div>
            <div class="field"><label>Bank Account</label><select class="input" name="bank">${companyAccountOptionsHTML(State.settings.defaultBank)}</select></div>
            <div class="field"><label>Reference Number</label><input class="input" name="reference" placeholder="e.g. TRX-000123"></div>
            <div class="field"><label>Attachment</label><input class="input" type="text" name="attachment" placeholder="(coming soon)" disabled></div>
            <div class="field" style="grid-column:span 2;"><label>Notes</label><textarea class="input" name="notes" placeholder="Optional notes"></textarea></div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn" id="execCancel">Cancel</button>
            <button type="submit" class="btn btn-accent">Execute Transaction</button>
          </div>
        </form>
      </div>
    </div>`;
  document.getElementById('execCancel').addEventListener('click', closeModal);
  document.getElementById('execOverlay').addEventListener('click', e=>{ if(e.target.id==='execOverlay') closeModal(); });
  focusFirstIn(root);
  document.getElementById('execForm').addEventListener('submit', async e=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    const amt = Number(fd.get('actualAmount'));
    if(isNaN(amt)){ toast('Enter a valid actual amount.'); return; }
    const res = await executeTransaction(t.id, {
      executionDate: fd.get('executionDate'),
      actualAmount: amt,
      method: fd.get('method'),
      bank: fd.get('bank'),
      reference: (fd.get('reference')||'').trim(),
      notes: (fd.get('notes')||'').trim(),
    });
    if(res && res.ok===false){ toast(res.reason || 'Transaction was not executed.', 7000); return; }
    closeModal();
    if(res && res.suppWarning) toast(res.suppWarning, 8000); else toast('Transaction executed.');
    render();
  });
}

/* ---------- edit modal ---------- */
function openEditModal(id){
  const t = findTxn(id); if(!t) return;
  const root = document.getElementById('modal-root');
  State._modalOpener = document.activeElement;
  root.innerHTML = `
    <div class="modal-overlay" id="editOverlay">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="editModalTitle" style="max-width:520px;">
        <h3 id="editModalTitle">Edit Transaction</h3>
        <form id="editForm">
          <div class="form-grid" style="grid-template-columns:1fr 1fr;">
            <div class="field" style="grid-column:span 2;"><label>Description</label><input class="input" name="uraian" value="${escapeHtml(t.uraian)}"></div>
            <div class="field"><label>Planned Amount (Rp)</label><input class="input" type="number" step="any" name="planned" value="${t.planned||0}"></div>
            <div class="field"><label>Category</label><input class="input" name="category" value="${escapeHtml(t.category)}"></div>
            <div class="field"><label>Volume</label><input class="input" type="number" step="any" name="vol" value="${t.vol??''}"></div>
            <div class="field"><label>Unit</label><input class="input" name="satuan" value="${escapeHtml(t.satuan||'')}"></div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn" id="editCancel">Cancel</button>
            <button type="submit" class="btn btn-accent">Save Changes</button>
          </div>
        </form>
      </div>
    </div>`;
  document.getElementById('editCancel').addEventListener('click', closeModal);
  document.getElementById('editOverlay').addEventListener('click', e=>{ if(e.target.id==='editOverlay') closeModal(); });
  focusFirstIn(root);
  document.getElementById('editForm').addEventListener('submit', async e=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    const res = await saveEditedTransaction(t.id, {
      uraian:(fd.get('uraian')||'').trim(),
      planned:Number(fd.get('planned'))||0,
      category:(fd.get('category')||'').trim()||t.category,
      vol: fd.get('vol')!==''?Number(fd.get('vol')):null,
      satuan:(fd.get('satuan')||'').trim()||null,
    });
    if(res && res.ok===false){ toast(res.reason || 'Transaction was not updated.', 7000); return; }
    closeModal(); toast('Transaction updated.'); render();
  });
}

/* ---------- transaction detail / timeline ---------- */
function openDetailModal(id){
  const t = findTxn(id); if(!t) return;
  const root = document.getElementById('modal-root');
  State._modalOpener = document.activeElement;
  const st = statusOf(t);
  const stages = ['Planning','Scheduling','Execution','Completion'];
  const stageReached = st==='completed'||st==='archived' ? 4 : st==='partial' ? 3 : st==='scheduled' ? 2 : st==='cancelled' ? 1 : 1;
  const ex = t.execution;
  root.innerHTML = `
    <div class="modal-overlay" id="detailOverlay">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="detailModalTitle" style="max-width:560px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
          <h3 id="detailModalTitle" style="margin:0;">${escapeHtml(t.uraian)}</h3>
          ${statusBadge(st)}
        </div>
        <p class="dim" style="font-size:12.5px;margin:6px 0 16px;">${escapeHtml(t.category)} · ${escapeHtml(t.month)} ${t.year} · planned ${fmtIDR(t.planned)}${t.actual!=null?' · actual '+fmtIDR(t.actual):''}</p>
        ${payrollLinkCardHTML(t)}

        <div class="exec-timeline">
          ${stages.map((s,i)=>`<div class="exec-stage ${i<stageReached?'reached':''} ${st==='cancelled'&&i>=1?'cancelled':''}">
            <div class="exec-dot"></div><div class="exec-stage-label">${s}</div>
          </div>`).join('<div class="exec-connector"></div>')}
        </div>

        ${ex ? `<div class="card" style="margin-top:16px;padding:14px 16px;">
          <h4 style="margin:0 0 8px;font-size:12.5px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-faint);">Execution Detail</h4>
          <div style="font-size:12.5px;line-height:1.9;">
            <div>Executed amount: <b class="mono">${fmtIDR(ex.actualAmount)}</b></div>
            ${ex.executionDate?`<div>Date: <b>${escapeHtml(ex.executionDate)}</b></div>`:''}
            ${ex.method?`<div>Method: <b>${escapeHtml(ex.method)}</b></div>`:''}
            ${ex.bank?`<div>Bank: <b>${escapeHtml(ex.bank)}</b></div>`:''}
            ${ex.reference?`<div>Reference: <b>${escapeHtml(ex.reference)}</b></div>`:''}
            ${ex.notes?`<div>Notes: ${escapeHtml(ex.notes)}</div>`:''}
            <div class="faint" style="font-size:10.5px;margin-top:4px;">Execution ID: ${escapeHtml(ex.executionId||'—')}${ex.ts?' · '+new Date(ex.ts).toLocaleString('id-ID'):''}</div>
          </div>
        </div>`:''}

        <div class="card" style="margin-top:var(--space-4);padding:14px 16px;">
          <h4 style="margin:0 0 8px;font-size:12.5px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-faint);">History</h4>
          <div class="hist-list">
            ${(t.history||[]).map(h=>`<div class="hist-row">
              <span class="hist-event">${escapeHtml((h.event||'').charAt(0).toUpperCase()+(h.event||'').slice(1))}</span>
              <span class="hist-note">${escapeHtml(h.note||'')}</span>
              <span class="hist-ts faint">${h.ts?new Date(h.ts).toLocaleString('id-ID'):'—'}</span>
            </div>`).join('') || '<div class="empty">No history recorded.</div>'}
          </div>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn" id="detailClose">Close</button>
        </div>
      </div>
    </div>`;
  document.getElementById('detailClose').addEventListener('click', closeModal);
  document.getElementById('detailOverlay').addEventListener('click', e=>{ if(e.target.id==='detailOverlay') closeModal(); });
  const goEmp = document.getElementById('detailGoEmp'); if(goEmp) goEmp.addEventListener('click', ()=>{ closeModal(); hrNavTo('employeeDetail', {detailEmpId:goEmp.dataset.id}); });
  const goCt = document.getElementById('detailGoCt'); if(goCt) goCt.addEventListener('click', ()=>{ closeModal(); hrNavTo('contractDetail', {detailContractId:goCt.dataset.id}); });
  const goPay = document.getElementById('detailGoPay'); if(goPay) goPay.addEventListener('click', ()=>{ closeModal(); const pp=payrollPlanById(goPay.dataset.id); if(pp){ State.payrollMonth=pp.monthKey; } hrNavTo('payroll'); });
}
// Payroll linkage block shown in transaction detail when a transaction is
// linked to employee/contract/payroll master data.
function payrollLinkCardHTML(t){
  if(!t.employeeId && !t.contractId && !t.payrollPlanId) return '';
  const emp = t.employeeId?empById(t.employeeId):null;
  const ct = t.contractId?contractById(t.contractId):null;
  const meta = t.payrollMeta||{};
  const progress = meta.contractProgress || (ct?contractCalc(ct, t.monthKey).progress:null);
  const otIds = Array.isArray(t.overtimeIds)?t.overtimeIds:[];
  const otRecs = otIds.map(id=>overtimeById(id)).filter(Boolean);
  const otSum = otRecs.reduce((s,o)=>s+num(o.approvedAmount!=null?o.approvedAmount:o.calculatedAmount),0);
  const otBlock = (otIds.length||t.overtimeAmount) ? `
    <div class="divider" style="margin:10px 0;"></div>
    <div style="font-size:12.5px;">Overtime component: <b class="mono" style="color:var(--accent);">${fmtIDR(t.overtimeAmount!=null?t.overtimeAmount:otSum)}</b> <span class="faint">(inside the planned payroll total, ${otRecs.length} record(s))</span></div>
    ${otRecs.length?`<div class="table-wrap" style="margin-top:6px;"><table><thead><tr><th>Date</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>${otRecs.map(o=>`<tr><td class="dim">${escapeHtml(o.overtimeDate||'—')}</td><td class="num">${num(o.overtimeHours)}</td><td class="num">${fmtIDRfull(o.hourlyRate)}</td><td class="num">${fmtIDR(o.approvedAmount!=null?o.approvedAmount:o.calculatedAmount)}</td><td>${hrStatusBadge(o.status,OVERTIME_STATUS_META)}</td></tr>`).join('')}</tbody></table></div>`:''}` : '';
  return `<div class="card" style="margin:0 0 var(--space-4);padding:14px 16px;border-left:3px solid var(--accent);">
    <h4 style="margin:0 0 8px;font-size:12.5px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-faint);">Payroll Link · Source: ${escapeHtml(t.source==='payroll'?'Payroll Planning':t.source||'—')}</h4>
    <div style="font-size:12.5px;line-height:1.9;">
      <div>Employee: <b>${escapeHtml(emp?emp.fullName:(meta.employeeName||'—'))}</b></div>
      <div>Contract Number: <b>${escapeHtml(ct?ct.contractNumber:(meta.contractNumber||'—'))}</b></div>
      <div>Contract Progress: <b>${escapeHtml(progress||'—')}</b></div>
      <div>Payroll Plan: <b>${t.payrollPlanId?escapeHtml(t.payrollPlanId):'—'}</b></div>
    </div>
    ${otBlock}
    <div class="small-btn-row" style="margin-top:10px;">
      ${emp?`<button class="btn btn-sm" id="detailGoEmp" data-id="${emp.id}">Employee detail</button>`:''}
      ${ct?`<button class="btn btn-sm" id="detailGoCt" data-id="${ct.id}">Contract detail</button>`:''}
      ${t.payrollPlanId?`<button class="btn btn-sm" id="detailGoPay" data-id="${t.payrollPlanId}">Payroll plan</button>`:''}
    </div>
  </div>`;
}

/* ---------- actions menu ---------- */
// context: 'exec' (Execution Center — full lifecycle actions) or
// 'ledger' (Transactions page — record review only: detail / edit / delete).
// Operational payment actions live exclusively in the Execution Center.
function actionsMenuHTML(t, context){
  const st = statusOf(t);
  const items = [];
  if(context!=='ledger'){
    const canExecute = st!=='cancelled' && t.type!=='income';
    if(canExecute) items.push(['execute','Execute']);
    if(st!=='scheduled' && st!=='completed' && st!=='archived' && st!=='cancelled') items.push(['schedule','Schedule']);
  }
  items.push(['detail','View Detail / History']);
  items.push(['edit','Edit']);
  if(context!=='ledger'){
    items.push(['duplicate','Duplicate']);
    if(st!=='cancelled') items.push(['cancel','Cancel']);
    if(st==='completed') items.push(['archive','Archive']);
  }
  items.push(['delete','Delete']);
  return `<div class="actions-menu">
    <button class="btn btn-sm actions-toggle" data-actions="${t.id}">Actions ▾</button>
    <div class="actions-dropdown" data-menu="${t.id}" style="display:none;">
      ${items.map(([a,l])=>`<button class="actions-item ${a==='delete'?'danger':''}" data-action="${a}" data-id="${t.id}">${l}</button>`).join('')}
    </div>
  </div>`;
}
// UX-006C2C-2 — the Finance engine boundaries return a typed {ok:false, reason}
// when authorization (or the lookup) fails. A failed result is reported as-is and
// never as a success; nothing changed, so no re-render is needed.
function reportTxnResult(res, okMessage){
  if(res && res.ok===false){ toast(res.reason || 'Transaction was not updated.', 7000); return false; }
  toast(okMessage); render(); return true;
}
// Binds the action menus of ONE freshly rendered view. Must be called exactly
// once per render — the render functions do this themselves. Never call it
// again after a render call (that double-binds every listener: toggles cancel
// themselves out and actions fire twice — the v2.1.1 Execution Center bug).
function bindActionMenus(main){
  main.querySelectorAll('[data-actions]').forEach(btn=>btn.addEventListener('click', e=>{
    e.stopPropagation();
    // v2.6.3b — shared floating menu (portaled out of the table container, never clipped).
    if(isFloatingMenuOpenFor(btn)){ closeFloatingMenu(); return; }
    const menu = main.querySelector(`[data-menu="${btn.dataset.actions}"]`);
    if(menu) openFloatingMenu(btn, menu);
  }));
  main.querySelectorAll('[data-action]').forEach(btn=>btn.addEventListener('click', async e=>{
    e.stopPropagation();
    main.querySelectorAll('.actions-dropdown').forEach(m=>m.style.display='none');
    const id = btn.dataset.id, action = btn.dataset.action;
    const t = findTxn(id); if(!t) return;
    if(action==='execute'){ openExecuteModal(id); }
    else if(action==='schedule'){ const d = prompt('Payment date (YYYY-MM-DD):', t.txnDate||new Date().toISOString().slice(0,10)); if(d){ reportTxnResult(await scheduleTransaction(id, d.trim()), 'Transaction scheduled.'); } }
    else if(action==='detail'){ openDetailModal(id); }
    else if(action==='edit'){ openEditModal(id); }
    else if(action==='duplicate'){ reportTxnResult(await duplicateTransaction(id), 'Transaction duplicated.'); }
    else if(action==='cancel'){ if(confirm('Cancel this planned transaction? It will be excluded from budget analytics.')){ reportTxnResult(await cancelTransaction(id), 'Transaction cancelled.'); } }
    else if(action==='archive'){ reportTxnResult(await archiveTransaction(id), 'Transaction archived.'); }
    // Inline permanent delete is the mutation boundary itself (no engine function):
    // UX-006C2C-2 authorizes finance.manage here, before the confirm and the filter.
    else if(action==='delete'){ if(!can(ACTIONS.FINANCE_MANAGE)){ toast('You do not have permission to perform this action.', 7000); return; } if(confirm('Delete this transaction permanently? This cannot be undone.')){ State.txns = State.txns.filter(x=>x.id!==id); await persist(); toast('Transaction deleted.'); render(); } }
  }));
  main.querySelectorAll('[data-open-detail]').forEach(b=>b.addEventListener('click', e=>{ e.stopPropagation(); openDetailModal(b.dataset.openDetail); }));
}
