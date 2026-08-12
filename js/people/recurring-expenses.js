/* ============================================================
   RECURRING EXPENSES
   ============================================================ */
function recurringDueInMonth(monthKey){
  return State.recurringExpenses.filter(r=>{
    if(r.active===false) return false;
    if(!r.startMonth) return false;
    if(monthKey < r.startMonth) return false;
    if(r.endMonth && monthKey > r.endMonth) return false;
    const interval = RECUR_FREQUENCIES[r.frequency]||1;
    const diff = keyAbs(monthKey) - keyAbs(r.startMonth);
    return diff>=0 && diff % interval === 0;
  });
}
function renderRecurringExpenses(main){
  const list = State.recurringExpenses.slice().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  const activeN = list.filter(r=>r.active!==false).length;
  main.innerHTML = `
    <div class="page-head">
      <div><h1>Recurring Expenses</h1><p class="desc">${list.length} template${list.length===1?'':'s'} · ${activeN} active. The Monthly Plan Generator adds the ones due in each month automatically.</p></div>
      <div class="head-controls"><button class="btn btn-accent" id="addRe">+ Add Recurring Expense</button></div>
    </div>
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Category</th><th class="num">Default Amount</th><th>Frequency</th><th>Window</th><th>Pay Day</th><th>Vendor</th><th>Status</th><th></th></tr></thead>
        <tbody>${list.map(r=>`<tr>
          <td><b>${escapeHtml(r.name||'—')}</b></td>
          <td>${categoryPill(r.category||'Operasional Rutin')}</td>
          <td class="num">${fmtIDR(r.defaultAmount)}</td>
          <td>${escapeHtml(r.frequency||'Monthly')}</td>
          <td class="dim">${escapeHtml(r.startMonth||'—')}${r.endMonth?' → '+escapeHtml(r.endMonth):' → ongoing'}</td>
          <td class="dim">${r.paymentDay||'—'}</td>
          <td class="dim">${escapeHtml(r.vendor||'—')}</td>
          <td>${r.active===false?'<span class="pill pill-status-archived">Inactive</span>':'<span class="pill pill-status-completed">Active</span>'}</td>
          <td>${hrActionsMenu('re', r.id, [['re-edit','Edit'],[r.active===false?'re-toggle':'re-toggle', r.active===false?'Activate':'Deactivate'],['re-delete','Delete']])}</td>
        </tr>`).join('') || '<tr><td colspan="9" class="empty">No recurring expenses yet. Add templates like Internet, Electricity, Office Rent, or Software subscriptions.</td></tr>'}</tbody>
      </table></div>
    </div>`;
  document.getElementById('addRe').addEventListener('click', ()=>openRecurringModal(null));
  bindHRActions(main);
}
function openRecurringModal(id){
  const r = id ? State.recurringExpenses.find(x=>x.id===id) : null;
  const isNew=!r;
  const v = r || {frequency:'Monthly', category:'Operasional Rutin', startMonth:todayKey(), active:true, paymentDay:Number(State.settings.defaultPayrollGenerationDay)||1};
  const cats = [...new Set([...KNOWN_CATEGORIES, ...State.txns.map(t=>t.category)])].filter(c=>c!=='Pendapatan');
  openModalHTML(`
    <h3>${isNew?'Add':'Edit'} Recurring Expense</h3>
    <form id="reForm">
      <div class="form-grid" style="grid-template-columns:1fr 1fr;">
        <div class="field" style="grid-column:span 2;"><label>Name</label><input class="input" name="name" value="${escapeHtml(v.name||'')}" required placeholder="e.g. Office Internet"></div>
        <div class="field"><label>Category</label><select class="input" name="category">${cats.map(c=>`<option ${v.category===c?'selected':''}>${escapeHtml(c)}</option>`).join('')}</select></div>
        <div class="field"><label>Default Amount (Rp)</label><input class="input" type="number" step="any" name="defaultAmount" value="${v.defaultAmount??''}" required></div>
        <div class="field"><label>Frequency</label><select class="input" name="frequency">${Object.keys(RECUR_FREQUENCIES).map(fq=>`<option ${v.frequency===fq?'selected':''}>${fq}</option>`).join('')}</select></div>
        <div class="field"><label>Payment Day</label><input class="input" type="number" min="1" max="31" name="paymentDay" value="${v.paymentDay??''}"></div>
        <div class="field"><label>Start Month (YYYY-MM)</label><input class="input" name="startMonth" value="${escapeHtml(v.startMonth||'')}" placeholder="2026-01" required></div>
        <div class="field"><label>End Month (optional)</label><input class="input" name="endMonth" value="${escapeHtml(v.endMonth||'')}" placeholder="blank = ongoing"></div>
        <div class="field"><label>Vendor</label><input class="input" name="vendor" value="${escapeHtml(v.vendor||'')}"></div>
        <div class="field"><label>Payment Method</label><select class="input" name="paymentMethod"><option value="">—</option>${PAYMENT_METHODS.map(m=>`<option ${v.paymentMethod===m?'selected':''}>${m}</option>`).join('')}</select></div>
        <div class="field"><label>Bank Account</label><select class="input" name="bankAccount">${companyAccountOptionsHTML(v.bankAccount, {blankOption:true})}</select></div>
        <div class="field" style="grid-column:span 2;"><label>Notes</label><textarea class="input" name="notes">${escapeHtml(v.notes||'')}</textarea></div>
      </div>
      <div class="modal-actions"><button type="button" class="btn" id="reCancel">Cancel</button><button type="submit" class="btn btn-accent">${isNew?'Create':'Save'}</button></div>
    </form>`, {width:600, onMount:(root)=>{
      root.querySelector('#reCancel').addEventListener('click', closeModal);
      root.querySelector('#reForm').addEventListener('submit', async ev=>{
        ev.preventDefault();
        // UX-006C2C-4 (row 17) — a recurring rule is Finance-administrative configuration that
        // GENERATES transactions; the frozen finance.manage description covers it. Executing the
        // resulting transactions still requires finance.execute.
        if(!can(ACTIONS.FINANCE_MANAGE)){ toast('You do not have permission to manage recurring expenses.', 7000); return; }
        const fd=new FormData(ev.target);
        const rec = r || {id:uid('re'), active:true, createdAt:new Date().toISOString()};
        rec.name=(fd.get('name')||'').trim(); rec.category=fd.get('category');
        rec.defaultAmount = fd.get('defaultAmount')===''?0:Number(fd.get('defaultAmount'));
        rec.frequency=fd.get('frequency'); rec.paymentDay=fd.get('paymentDay')?Number(fd.get('paymentDay')):null;
        rec.startMonth=(fd.get('startMonth')||'').trim(); rec.endMonth=(fd.get('endMonth')||'').trim()||null;
        rec.vendor=(fd.get('vendor')||'').trim(); rec.paymentMethod=fd.get('paymentMethod')||null; rec.bankAccount=fd.get('bankAccount')||null;
        rec.notes=(fd.get('notes')||'').trim(); rec.updatedAt=new Date().toISOString();
        if(isNew) State.recurringExpenses.push(rec);
        await persistRecurring(); closeModal(); toast(isNew?'Recurring expense added.':'Recurring expense updated.'); render();
      });
    }});
}
async function toggleRecurring(id){
  // UX-006C2C-4 (row 18) — rule administration; finance.manage.
  if(!can(ACTIONS.FINANCE_MANAGE)){ toast('You do not have permission to manage recurring expenses.', 7000); return; }
  const r = State.recurringExpenses.find(x=>x.id===id); if(!r) return;
  r.active = r.active===false; r.updatedAt=new Date().toISOString();
  await persistRecurring(); toast(r.active?'Activated.':'Deactivated.'); render();
}
async function deleteRecurring(id){
  // UX-006C2C-4 (row 19) — rule administration; finance.manage. Gated before the confirm.
  if(!can(ACTIONS.FINANCE_MANAGE)){ toast('You do not have permission to manage recurring expenses.', 7000); return; }
  const r = State.recurringExpenses.find(x=>x.id===id); if(!r) return;
  if(!confirm(`Delete recurring template "${r.name}"? Transactions already generated from it are not affected.`)) return;
  State.recurringExpenses = State.recurringExpenses.filter(x=>x.id!==id);
  await persistRecurring(); toast('Recurring expense deleted.'); render();
}
