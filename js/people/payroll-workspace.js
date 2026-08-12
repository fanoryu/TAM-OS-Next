/* ============================================================
   PAYROLL INTELLIGENCE WORKSPACE UI (v2.6.3)
   Operational, workflow-oriented payroll: one active period,
   KPI cards, deterministic health, summary, a read-only worksheet,
   bulk lifecycle actions with confirmations, and a period lock.
   Payroll = Base Salary + Approved Overtime (single source of truth):
   salary is edited on the Contract, overtime in Overtime, and both
   flow into the read-only Total here. Lifecycle stages, health, lock
   and summary helpers live in payroll-ops-engine.js.
   ============================================================ */
function payrollSelSet(monthKey){ if(!State.payrollSel[monthKey]) State.payrollSel[monthKey]=new Set(); return State.payrollSel[monthKey]; }
/* PR-5J "The Accountant" — the ONE official UI seam for a pre-posting PayrollPlan
   lifecycle transition. Single-record and bulk callers both route through the
   Domain command (payroll.lifecycle.transition); no UI ever calls the handler
   (transitionPayrollLifecycle) directly. On a typed business failure it surfaces
   the same user-facing messaging the former setPayrollStatus showed. Returns true
   only on success. */
async function requestPayrollLifecycle(id, targetStatus){
  const outcome = await uiExecute('command', 'payroll.lifecycle.transition', [id, targetStatus]);
  if(outcome && outcome.success) return true;
  const err = outcome && outcome.error;
  if(err==='PayrollPeriodLocked') showWarning('This payroll period is locked — unlock it to change status.');
  else if(err==='PayrollCommittedImmutable') showWarning('Committed payroll cannot change status here — use the adjustment workflow.');
  else if(err && err!=='PayrollPlanNotFound') showWarning('Could not change payroll status: '+err+'.');
  return false;
}
// Compact "2 Locked; 1 Illegal…" summary of per-record lifecycle command failures for bulk reporting.
function payrollBulkFailureSummary(failures){
  const byErr={};
  (failures||[]).forEach(f=>{ const e=f.error||'Unknown'; byErr[e]=(byErr[e]||0)+1; });
  return Object.entries(byErr).map(([e,n])=>`${n} ${e}`).join('; ');
}
// Cycle-status pill (used by the dashboard payroll strip).
function cycleStatusPill(cs){
  const map={'Not Generated':'pill-status-archived','Draft':'pill-status-planned','In Review':'pill-status-scheduled','Ready to Commit':'pill-status-partial','Committed':'pill-status-completed','Partially Executed':'pill-status-partial','Fully Executed':'pill-status-completed'};
  return `<span class="pill ${map[cs]||'pill-other'}">${escapeHtml(cs)}</span>`;
}

function renderPayrollWorkspace(main){
  // Empty-state onboarding
  /* NOT scoped, deliberately. This gate asks whether the COMPANY has master data at
     all — a setup condition, not a per-principal read. Scoping it sent a null principal
     into the no-data state, which removed #genPay and #lockBtn: two of the seven
     controls UX-006C3 froze as VISIBLE + DISABLED for null. The frozen C3 contract
     wins; the worksheet ROWS are scoped by payrollPlansForMonth(). */
  if(!State.employees.length || !State.contracts.length){
    main.innerHTML = pageHeader('Payroll Workspace','Operational payroll — run the full monthly cycle inside TAM OS.')
      + `<div class="card"><div class="empty">
        <div class="big">৳</div>
        <div style="color:var(--text);font-weight:600;margin-bottom:6px;">No employees and contracts are available yet</div>
        <div class="stack-section">Add employees and active contracts, then generate payroll — payroll is Base Salary + Approved Overtime.</div>
        <div class="small-btn-row" style="justify-content:center;flex-wrap:wrap;">
          <button class="btn btn-accent" data-empty-nav="employees">Add Employee</button>
          <button class="btn" data-empty-nav="contracts">Create Contract</button>
          <button class="btn" data-empty-nav="add">Import Initial Company Data</button>
        </div></div></div>`;
    bindActionEmptyState(main); return;
  }
  const months = getMonths();
  // Readiness-1 — the month switcher offers only months the principal can actually read.
  const keys = [...new Set([...months.map(m=>m.key), ...((typeof getScopedRecords === 'function') ? getScopedRecords('payrollPlan') : State.payrollPlans).map(p=>p.monthKey), todayKey()])].sort();
  if(!State.payrollMonth || !keys.includes(State.payrollMonth)) State.payrollMonth = keys[keys.length-1];
  const monthKey = State.payrollMonth, mo = keyToMonthObj(monthKey);
  const locked = isPayrollLocked(monthKey);
  const plans = payrollPlansForMonth(monthKey);
  const counts = payrollStageCounts(monthKey);
  const summary = payrollSummary(monthKey);
  const otHours = plans.reduce((s,p)=>{ const h=payrollHistoricalSnapshot(p).overtimeHours; return s+(h==null?0:num(h)); },0);
  const eligible = ((typeof getScopedRecords === 'function') ? getScopedRecords('employee') : State.employees).filter(e=>!payrollExclusionReason(e, monthKey));
  const excludedNow = ((typeof getScopedRecords === 'function') ? getScopedRecords('employee') : State.employees).map(e=>({e, reason:payrollExclusionReason(e, monthKey)}))
    .filter(x=>x.reason && x.e.active!==false && x.e.employmentStatus==='Active');
  const health = payrollHealth(monthKey);
  const periodEvents = buildPayrollPeriodTimeline(monthKey); // v2.6.4 read-only period activity
  const hasRows = plans.length>0;
  // v2.6.8 — each bulk action owns its eligibility; buttons disable only when the period
  // has no row eligible for THAT action (selection itself stays generic).
  const canReviewAny  = plans.some(PAYROLL_BULK_ACTIONS.review.eligible);
  const canApproveAny = plans.some(PAYROLL_BULK_ACTIONS.approve.eligible);
  const canPostAny    = plans.some(PAYROLL_BULK_ACTIONS.post.eligible);

  const kpi = (label, value, sub) => `<div class="card stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div>${sub?`<div class="stat-sub dim">${sub}</div>`:''}</div>`;

  main.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Payroll Workspace</h1>
        <p class="desc">One active period — Employee → Contract → Approved Overtime → Generate → Review → Approve → Post to Finance → Execution.</p>
      </div>
      <div class="head-controls">
        <select class="input" id="payMonth" title="Current payroll period">${keys.map(k=>{const o=keyToMonthObj(k);return `<option value="${k}" ${k===monthKey?'selected':''}>${o.month} ${o.year}${isPayrollLocked(k)?' 🔒':''}</option>`;}).join('')}</select>
        <button class="btn ${locked?'':'btn-danger'}" id="lockBtn"${authzDisabled(ACTIONS.PAYROLL_MANAGE, { employeeId:null })}>${locked?'🔓 Unlock Period':'🔒 Lock Period'}</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:var(--space-4);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border-left:3px solid ${locked?'var(--brick)':'var(--accent)'};">
      <div>
        <div class="stat-label">Current Payroll Period</div>
        <div style="font-family:var(--serif);font-size:22px;font-weight:600;">${escapeHtml(mo.month)} ${mo.year} ${locked?'<span class="pill pill-status-cancelled">LOCKED</span>':''}</div>
      </div>
      <div class="small-btn-row" style="flex-wrap:wrap;gap:8px;">
        <button class="btn btn-accent" id="genPay" ${locked?'disabled':''}${authzDisabled(ACTIONS.PAYROLL_MANAGE, { employeeId:null })}>Generate Payroll</button>
        <button class="btn" id="actReview" ${locked||!canReviewAny?'disabled':''} title="Review applies only to Draft payroll. Any other selected rows are skipped and reported.">Review Selected</button>
        <button class="btn" id="actApprove" ${locked||!canApproveAny?'disabled':''} title="Approve applies only to Draft and Review payroll. Any other selected rows are skipped and reported.">Approve Selected</button>
        <button class="btn btn-accent" id="actPost" ${locked||!canPostAny?'disabled':''} title="Post applies only to Approved payroll. Any other selected rows are skipped and reported.">Post to Finance</button>
      </div>
    </div>

    <div class="grid grid-4" style="margin-bottom:12px;">
      ${kpi('Employees', plans.length, `${eligible.length} eligible · ${excludedNow.length} excluded`)}
      ${kpi('Draft', counts.Draft, 'awaiting review')}
      ${kpi('Review', counts.Review, 'in review')}
      ${kpi('Approved', counts.Approved, 'ready to post')}
    </div>
    <div class="grid grid-4 stack-section">
      ${kpi('Posted', counts.Posted, 'planned in finance')}
      ${kpi('Executed', counts.Executed, 'paid via Execution Center')}
      ${kpi('Total Payroll', fmtIDRShort(summary.total), 'base + approved overtime')}
      ${kpi('Total Overtime', fmtIDRShort(summary.overtime), `${otHours} hrs`)}
    </div>

    ${health.length?`<div class="card stack-section">
      <h3>Payroll Health <span class="tag">${health.length}</span></h3>
      <div class="insight-list">${health.slice(0,24).map(h=>`<div class="insight-item ${h.sev==='warn'?'warn':''}"><b>${escapeHtml(h.title)}</b> — ${escapeHtml(h.detail)}</div>`).join('')}</div>
    </div>`:''}

    ${payrollDriftBannerHTML(plans)}

    ${hasRows?`<div class="grid grid-4 stack-section">
      <div class="chart-mini-stat"><div class="lbl">Employees</div><div class="val">${summary.count}</div></div>
      <div class="chart-mini-stat"><div class="lbl">Average Payroll</div><div class="val">${fmtIDRShort(summary.average)}</div></div>
      <div class="chart-mini-stat"><div class="lbl">Highest</div><div class="val">${fmtIDRShort(summary.highest)}</div></div>
      <div class="chart-mini-stat"><div class="lbl">Lowest</div><div class="val">${fmtIDRShort(summary.lowest)}</div></div>
    </div>`:''}

    <div id="payArea"></div>

    ${periodEvents.length?`<div class="card" style="margin-top:var(--space-4);"><h3>Period Activity <span class="tag">${periodEvents.length}</span></h3>
      <p class="hint" style="margin-top:-2px;margin-bottom:10px;">Recorded generate / post / lock / unlock events for ${escapeHtml(mo.month)} ${mo.year} — newest first. See the full cross-module trail in Management → Activity Log.</p>
      ${payrollTimelineHTML(periodEvents)}</div>`:''}

    ${excludedNow.length?`<div class="card" style="margin-top:var(--space-4);"><h3>Excluded Employees <span class="tag">${excludedNow.length}</span></h3><div class="insight-list">${excludedNow.map(x=>`<div class="insight-item warn"><b>${escapeHtml(x.e.fullName)}</b> — ${escapeHtml(x.reason)}</div>`).join('')}</div></div>`:''}`;

  document.getElementById('payMonth').addEventListener('change', e=>{ State.payrollMonth=e.target.value; renderPayrollWorkspace(main); });
  document.getElementById('lockBtn').addEventListener('click', async ()=>{
    // Outcome-reporting audit — setPayrollLock returns a typed result and denies
    // fail-closed (it reports the denial itself). A denied lock/unlock must not also
    // report success: check the result before any success message or re-render.
    let lockRes;
    if(locked){ if(!confirmAction(`Unlock payroll for ${mo.month} ${mo.year}? This re-enables generation, edits, overtime changes, and finance posting for this period.`)) return; lockRes = await setPayrollLock(monthKey,false); if(lockRes && lockRes.ok===false) return; showSuccess('Period unlocked.'); }
    else { if(!confirmAction(`Lock payroll for ${mo.month} ${mo.year}? While locked: payroll cannot be regenerated or edited, its overtime cannot be modified, and finance posting cannot run again.`)) return; lockRes = await setPayrollLock(monthKey,true); if(lockRes && lockRes.ok===false) return; showSuccess('Period locked.'); }
    renderPayrollWorkspace(main);
  });
  const genBtn=document.getElementById('genPay');
  if(genBtn) genBtn.addEventListener('click', async ()=>{
    if(isPayrollLocked(monthKey)){ showWarning('This period is locked.'); return; }
    // Outcome-reporting audit — generatePayrollForMonth returns {denied:true, generated:0}
    // when payroll.manage denies. A denial must not persist and must not be reported as a
    // completed generation ("Generated 0, refreshed 0, 0 excluded."), so it is checked
    // BEFORE the persist and before any success message.
    const res = generatePayrollForMonth(monthKey);
    if(res && res.denied){ showWarning('You do not have permission to generate payroll.'); return; }
    await persistPayrollPlans();
    let msg=`Generated ${res.generated}, refreshed ${res.refreshed}, ${res.excluded.length} excluded.`;
    if(res.skippedCommitted) msg+=` ${res.skippedCommitted} posted row(s) left unchanged.`;
    if(res.changed) msg+=` ${res.changed} row(s) flagged (overtime updated).`;
    showSuccess(msg, 6000); renderPayrollWorkspace(main);
  });

  const sel = payrollSelSet(monthKey);
  // v2.6.8 (Issue 1) — GENERIC selection: the set simply represents the rows the user
  // picked. Only prune rows that have left the worksheet (removed or Cancelled). Every
  // visible stage stays selectable; each action filters to its own eligible subset.
  [...sel].forEach(id=>{ const p=payrollPlanById(id); if(!p || payrollStage(p)==='Cancelled') sel.delete(id); });
  // Shared runner: partition the current selection for `action`, act on the eligible
  // rows, and report eligible / skipped / reason.
  const runBulkStatus=async (action, targetStatus, verbPast)=>{
    const all=[...sel];
    if(!all.length){ showWarning('Select one or more rows first.'); return; }
    const {eligible, skipped}=partitionPayrollSelection(all, action);
    const spec=PAYROLL_BULK_ACTIONS[action];
    if(!eligible.length){ showWarning(`No selected rows are eligible for ${spec.label}.\n${spec.label} applies only to ${spec.eligibleLabel} payroll.${skipped.length?`\nSkipped: ${payrollSkipSummary(skipped)}.`:''}`); return; }
    if(!confirmAction(`${spec.label} ${eligible.length} eligible row(s)?${skipped.length?` (${skipped.length} selected row(s) will be skipped.)`:''}`)) return;
    // PR-5J — route EACH eligible row through the one official lifecycle Domain command.
    // Each PayrollPlan transition is independently atomic; there is no cross-record rollback.
    let n=0; const cmdFailures=[];
    for(const pid of eligible){
      const outcome=await uiExecute('command', 'payroll.lifecycle.transition', [pid, targetStatus]);
      if(outcome && outcome.success) n++;
      else cmdFailures.push({id:pid, error:(outcome && outcome.error)||'Unknown'});
    }
    let msg=`${verbPast} ${n} payroll(s).`;
    if(skipped.length) msg+=`\n${skipped.length} skipped — ${payrollSkipSummary(skipped)}.`;
    if(cmdFailures.length) msg+=`\n${cmdFailures.length} could not be updated — ${payrollBulkFailureSummary(cmdFailures)}.`;
    // Outcome-reporting audit — a batch in which nothing succeeded (every row denied or
    // rejected) is not a success: report it on the warning channel. The counts themselves
    // are unchanged, and a batch with at least one success still reads as a success.
    if(n===0 && cmdFailures.length) showWarning(msg); else showSuccess(msg);
    renderPayrollWorkspace(main);
  };
  const ar=document.getElementById('actReview'); if(ar) ar.addEventListener('click', ()=>runBulkStatus('review','Reviewed','Reviewed'));
  const aa=document.getElementById('actApprove'); if(aa) aa.addEventListener('click', ()=>runBulkStatus('approve','Ready','Approved'));
  const ap=document.getElementById('actPost'); if(ap) ap.addEventListener('click', ()=>openCommitPayrollModal(monthKey, main));

  const area=document.getElementById('payArea');
  if(!hasRows){
    area.innerHTML = `<div class="card"><div class="empty">
      <div class="big">৳</div>
      <div style="color:var(--text);font-weight:600;margin-bottom:6px;">Payroll has not been generated for ${escapeHtml(mo.month)} ${mo.year}.</div>
      <div style="margin-bottom:12px;">Generate the worksheet from active contracts and approved overtime. Payroll = Base Salary + Approved Overtime; nothing else is added.</div>
      ${locked?'<span class="pill pill-status-cancelled">Period locked</span>':'<button class="btn btn-accent" id="genPay2">Generate Payroll</button>'}
    </div></div>`;
    const g2=document.getElementById('genPay2'); if(g2) g2.addEventListener('click', ()=>document.getElementById('genPay').click());
    return;
  }
  renderPayrollWorksheet(area, monthKey, main);
}

/* ---------- read-only worksheet (incremental search preserved from v2.6.1) ---------- */
function payrollRowsFiltered(monthKey){
  const f=State.payrollFilter;
  let rows = payrollPlansForMonth(monthKey, true).filter(p=>p.status!=='Cancelled');
  if(f.search.trim()){ const s=normStr(f.search); rows=rows.filter(p=>[p.employeeName,p.contractNumber,p.department].some(x=>normStr(x||'').includes(s))); }
  if(f.department!=='all') rows=rows.filter(p=>(p.department||'')===f.department);
  if(f.status!=='all') rows=rows.filter(p=>payrollStage(p)===f.status);
  rows.sort((a,b)=>String(a.employeeName||'').localeCompare(String(b.employeeName||'')));
  return rows;
}
function payrollWorksheetBodyHTML(monthKey, sel){
  return payrollRowsFiltered(monthKey).map(p=>payrollWorksheetRowHTML(p, sel)).join('') || '<tr><td colspan="9" class="empty">No payroll rows match.</td></tr>';
}
// v2.6.8 (Issue 1) — the header "select all shown" checkbox syncs with ALL visible rows
// (the selection model is generic): checked when all are selected, indeterminate when
// some are, unchecked/disabled when there are none.
function syncPayrollHeaderCheckbox(monthKey, sel){
  const cb=document.getElementById('pfAll'); if(!cb) return;
  const rows=payrollRowsFiltered(monthKey);
  const selN=rows.filter(p=>sel.has(p.id)).length;
  cb.checked = rows.length>0 && selN===rows.length;
  cb.indeterminate = selN>0 && selN<rows.length;
  cb.disabled = rows.length===0;
}
function bindPayrollRows(area, monthKey, main, sel){
  // Selected count = the actual number of selected rows (generic selection model).
  const updCount=()=>{
    const el=document.getElementById('pbSelCount'); if(el) el.textContent = sel.size?`${sel.size} selected`:'';
    syncPayrollHeaderCheckbox(monthKey, sel);
  };
  area.querySelectorAll('[data-psel]').forEach(cb=>cb.addEventListener('change', e=>{ const id=e.target.dataset.psel; if(e.target.checked) sel.add(id); else sel.delete(id); updCount(); }));
  area.querySelectorAll('[data-pact]').forEach(b=>b.addEventListener('click', async ()=>{
    const id=b.dataset.pid, act=b.dataset.pact;
    if(act==='detail') hrNavTo('payrollDetail',{detailPayrollId:id});
    else if(act==='review'){ await requestPayrollLifecycle(id,'Reviewed'); render(); }
    else if(act==='ready'){ await requestPayrollLifecycle(id,'Ready'); render(); }
    else if(act==='draft'){ await requestPayrollLifecycle(id,'Draft'); render(); }
    else if(act==='cancel'){ if(confirmAction('Cancel this payroll row? It will not be posted to finance.')){ await requestPayrollLifecycle(id,'Cancelled'); render(); } }
    else if(act==='exec'){ const pp=payrollPlanById(id); const t=payrollTxnOf(pp); if(t){ focusTransactionInExecutionCenter(t.id); } else showWarning('Not posted to a transaction yet.'); }
  }));
  bindHRActions(area);
  updCount();
}
function applyPayrollFilter(area, monthKey, main){
  const tb=document.getElementById('pwRows'); if(!tb) return;
  const sel=payrollSelSet(monthKey);
  tb.innerHTML=payrollWorksheetBodyHTML(monthKey, sel);
  bindPayrollRows(area, monthKey, main, sel);
}
function renderPayrollWorksheet(area, monthKey, main){
  const f=State.payrollFilter;
  const depts=[...new Set(((typeof getScopedRecords === 'function') ? getScopedRecords('employee') : State.employees).map(e=>e.department).filter(Boolean))].sort();
  const sel=payrollSelSet(monthKey);
  const locked=isPayrollLocked(monthKey);

  area.innerHTML = `<div class="card">
    <div class="form-grid" style="grid-template-columns:1.6fr 1fr 1fr;margin-bottom:12px;">
      <div class="field"><label>Search</label><input class="input" id="pfSearch" placeholder="employee, contract" value="${escapeHtml(f.search)}"></div>
      <div class="field"><label>Department</label><select class="input" id="pfDept"><option value="all">All</option>${depts.map(d=>`<option ${f.department===d?'selected':''}>${escapeHtml(d)}</option>`).join('')}</select></div>
      <div class="field"><label>Stage</label><select class="input" id="pfStatus"><option value="all">All stages</option>${PAYROLL_STAGES.map(s=>`<option ${f.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
    </div>
    <div class="small-btn-row" style="flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center;">
      <button class="btn btn-sm" id="pbSelAll" title="Selects all visible rows. Each bulk action applies to its own eligible stages (Review → Draft, Approve → Draft/Review, Post → Approved) and reports skipped rows.">Select All</button>
      <span class="dim" id="pbSelCount" style="font-size:12px;"></span>
      <span class="faint" id="pbSelHelp" style="font-size:11px;" title="Select any rows. Review applies to Draft; Approve to Draft and Review; Post to Approved. Ineligible selected rows are skipped and reported per action.">ⓘ Each action applies to its own eligible stages</span>
      <button class="btn btn-sm" id="pbCsv" style="margin-left:auto;">Export CSV</button>
    </div>
    <div class="table-wrap" style="max-height:600px;overflow:auto;">
      <table>
        <thead><tr>
          <th style="width:32px;"><input type="checkbox" id="pfAll" title="Select all shown"></th>
          <th>Employee</th><th>Contract</th><th>Progress</th>
          <th class="num">Base Salary</th><th class="num">Approved OT</th><th class="num">Total Payroll</th><th>Stage</th><th></th>
        </tr></thead>
        <tbody id="pwRows">${payrollWorksheetBodyHTML(monthKey, sel)}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:10px;">Read-only. Base salary comes from the active contract; overtime comes from Approved overtime records. Edit salary in Employee/Contract, overtime in Overtime. Only Approved rows can be posted; posting creates Planned transactions — execute them in the Execution Center.${locked?' <b>This period is locked.</b>':''}</p>
  </div>`;

  document.getElementById('pfSearch').addEventListener('input', e=>{ f.search=e.target.value; applyPayrollFilter(area, monthKey, main); });
  document.getElementById('pfDept').addEventListener('change', e=>{ f.department=e.target.value; applyPayrollFilter(area, monthKey, main); });
  document.getElementById('pfStatus').addEventListener('change', e=>{ f.status=e.target.value; applyPayrollFilter(area, monthKey, main); });
  // Select All / header checkbox select ALL visible rows (generic selection). Each bulk
  // action filters the selection to its own eligible stages and reports the rest.
  document.getElementById('pbSelAll').addEventListener('click', ()=>{ payrollRowsFiltered(monthKey).forEach(p=>sel.add(p.id)); applyPayrollFilter(area, monthKey, main); });
  const allCb=document.getElementById('pfAll'); if(allCb) allCb.addEventListener('change', e=>{ const rows=payrollRowsFiltered(monthKey); if(e.target.checked) rows.forEach(p=>sel.add(p.id)); else rows.forEach(p=>sel.delete(p.id)); applyPayrollFilter(area, monthKey, main); });
  document.getElementById('pbCsv').addEventListener('click', ()=>exportPayrollCsv(monthKey));
  bindPayrollRows(area, monthKey, main, sel);
}
function payrollWorksheetRowHTML(p, sel){
  const stage=payrollStage(p);
  const posted=(stage==='Posted'||stage==='Executed');
  const canReview=stage==='Draft', canApprove=(stage==='Draft'||stage==='Review'), canDraft=(stage==='Review'||stage==='Approved');
  // v2.6.8 (Issue 2) — live overtime-drift pill, shown immediately (no Generate click needed).
  const drift=payrollOvertimeDrift(p);
  const driftPill = drift ? (drift.committed
    ? '<span class="pill pill-status-cancelled" title="Approved overtime added after this payroll was posted — a supplemental payment is required">OT after posting</span> '
    : '<span class="pill pill-status-partial" title="Approved overtime changed since this payroll — regenerate to include it">OT drift</span> ') : '';
  const snap=payrollHistoricalSnapshot(p);                  // v2.7.1 stage-aware figures
  const mismatchPill=payrollSnapshotHasIssue(p)?'<span class="pill pill-status-cancelled" title="This posted payroll disagrees with its committed transaction — see Payroll Detail">snapshot mismatch</span> ':'';
  const flags=(p.missingSalary?'<span class="pill pill-status-cancelled">no salary</span> ':'')+(p.missingSchedule?'<span class="pill pill-status-partial">no schedule</span> ':'')+driftPill+mismatchPill+(p.otChanged?'<span class="pill pill-status-partial" title="Approved overtime changed since generation">OT changed</span> ':'');
  const otHrs = snap.overtimeHours==null?' <span class="faint">(—h)</span>':(num(snap.overtimeHours)?` <span class="faint">(${num(snap.overtimeHours)}h)</span>`:'');
  const otCell = `${fmtIDR(snap.overtimeAmount)}${otHrs}`;
  return `<tr>
    <td><input type="checkbox" data-psel="${p.id}" ${sel.has(p.id)?'checked':''}></td>
    <td><button class="linklike" data-pact="detail" data-pid="${p.id}"><b>${escapeHtml(p.employeeName||'—')}</b></button>${flags?`<div class="faint" style="font-size:10px;">${flags}</div>`:''}</td>
    <td class="dim">${escapeHtml(p.contractNumber||'—')}</td>
    <td>${escapeHtml(p.contractProgress||'—')}</td>
    <td class="num">${fmtIDR(snap.baseSalary)}</td>
    <td class="num">${otCell}</td>
    <td class="num"><b${snap.totalPayroll<0?' style="color:var(--brick);"':''}>${fmtIDR(snap.totalPayroll)}</b></td>
    <td>${payrollStagePill(p)}</td>
    <td>${hrActionsMenu('prow', p.id, [
      ['prow-detail','View Detail'],
      canReview?['prow-review','Mark Reviewed']:null,
      canApprove?['prow-ready','Approve']:null,
      canDraft?['prow-draft','Return to Draft']:null,
      posted?['prow-exec','Open in Execution Center']:null,
      !posted?['prow-cancel','Cancel Row']:null,
    ])}</td>
  </tr>`;
}
function openPayrollOvertimeBreakdown(id){
  const pp=payrollPlanById(id); if(!pp) return;
  const snap=payrollHistoricalSnapshot(pp);
  const frozen=snap&&Array.isArray(snap.overtimeSnapshot)&&snap.overtimeSnapshot.length?snap.overtimeSnapshot:null;
  const note=frozen?'<p class="hint" style="margin-bottom:8px;">Frozen at posting — this breakdown reflects the overtime as committed and does not change if the source records are later edited or deleted.</p>':'';
  const bodyRows = frozen
    ? frozen.map(o=>`<tr><td class="dim">${escapeHtml(o.overtimeDate||'—')}</td><td class="num">${num(o.overtimeHours)}</td><td>${escapeHtml(o.workDescription||'')}</td><td class="num">—</td><td class="num">—</td><td class="num">${fmtIDR(o.calculatedAmount)}</td><td class="num">${o.approvedAmount!=null?fmtIDR(o.approvedAmount):'—'}</td><td>${escapeHtml(o.statusAtCommit||'—')}</td></tr>`).join('')
    : (pp.overtimeIds||[]).map(overtimeById).filter(Boolean).map(o=>`<tr><td class="dim">${escapeHtml(o.overtimeDate||'—')}</td><td class="num">${num(o.overtimeHours)}</td><td>${escapeHtml(o.workDescription||'')}</td><td class="num">${o.monthlyStandardHours}</td><td class="num">${fmtIDRfull(o.hourlyRate)}</td><td class="num">${fmtIDR(o.calculatedAmount)}</td><td class="num">${o.approvedAmount!=null?fmtIDR(o.approvedAmount):'—'}</td><td>${hrStatusBadge(o.status,OVERTIME_STATUS_META)}</td></tr>`).join('');
  openModalHTML(`<h3>Overtime Breakdown — ${escapeHtml(pp.employeeName)}</h3>${note}
    <div class="table-wrap"><table><thead><tr><th>Date</th><th class="num">Hours</th><th>Description</th><th class="num">Std Hrs</th><th class="num">Rate</th><th class="num">Calc</th><th class="num">Approved</th><th>Status</th></tr></thead>
    <tbody>${bodyRows||'<tr><td colspan="8" class="empty">No overtime recorded for this payroll.</td></tr>'}</tbody></table></div>
    <div class="modal-actions"><button type="button" class="btn" id="obc">Close</button></div>`, {width:720, onMount:(r)=>r.querySelector('#obc').addEventListener('click', closeModal)});
}
function openCommitPayrollModal(monthKey, main){
  if(isPayrollLocked(monthKey)){ showWarning('This period is locked — finance posting cannot run again.'); return; }
  const sel=payrollSelSet(monthKey);
  // v2.6.8 — Post owns its eligibility (Approved). With an explicit selection, partition it
  // and carry the ineligible rows through as reported skips; with no selection, fall back to
  // every Approved row in the period (nothing to report as a selection skip).
  let readyIds, selectionSkips=[];
  if(sel.size){
    const part=partitionPayrollSelection([...sel], 'post');
    readyIds=part.eligible;
    selectionSkips=part.skipped.map(x=>({name:x.name, reasons:[x.reason]}));
    if(!readyIds.length){ showWarning(`No selected rows are eligible for Post.\nPost applies only to Approved payroll.${part.skipped.length?`\nSkipped: ${payrollSkipSummary(part.skipped)}.`:''}`); return; }
  } else {
    readyIds=payrollPlansForMonth(monthKey).filter(p=>p.status==='Ready').map(p=>p.id);
    if(!readyIds.length){ showWarning('No Approved payroll to post. Only Approved rows can be posted — approve rows first.'); return; }
  }
  const s=commitPayrollPreview(monthKey, readyIds);
  openModalHTML(`<h3>Post Approved Payroll to Finance</h3>
    <div style="font-size:12.5px;line-height:1.95;">
      <div>Employees: <b>${s.employees}</b></div>
      <div>Base salary total: <b class="mono">${fmtIDR(s.base)}</b></div>
      <div>Approved overtime total: <b class="mono">${fmtIDR(s.overtime)}</b></div>
      <div>Total payroll: <b class="mono" style="color:var(--accent);">${fmtIDR(s.planned)}</b></div>
      <div class="divider" style="margin:8px 0;"></div>
      <div>New transactions: <b>${s.newTxn}</b> · Existing: <b>${s.existingTxn}</b> · Changed: <b>${s.changedTxn}</b> · Skipped: <b>${s.skipped}</b></div>
    </div>
    <p class="hint" style="margin-top:8px;">Creates one Planned Gaji transaction per employee (status Planned, actual empty). Nothing is executed automatically — pay them in the Execution Center. Duplicates are never created.</p>
    <div class="modal-actions"><button type="button" class="btn" id="cpCancel">Cancel</button><button type="button" class="btn btn-accent" id="cpGo">Post ${readyIds.length} Row(s)</button></div>`,
    {width:560, onMount:(root)=>{
      root.querySelector('#cpCancel').addEventListener('click', closeModal);
      root.querySelector('#cpGo').addEventListener('click', async ()=>{
        const res=await commitReadyPayroll(monthKey, readyIds);
        // SPR-081 — the result is inspected BEFORE any completion behaviour.
        // Clearing the selection is completion behaviour: it discards which rows
        // the user was posting. It must never run on a failed posting.
        if(res.locked){ sel.clear(); closeModal(); return; }   // unchanged locked UX (engine already warned)
        // Outcome-reporting audit — an authorization denial must never reach the completion
        // path below: it would clear the selection, close the modal and report "Posted to
        // finance: 0 transaction(s) created" for a posting that never happened. The engine
        // already warned; the selection is deliberately retained so the user keeps their rows.
        if(res.error === 'NotAuthorized'){ closeModal(); return; }
        // A persistence failure must never be presented as a completed posting:
        // no selection clear, no success toast, no posted-vs-skipped summary
        // (which reads as success), and no claim that anything was rolled back.
        // Some datasets may already have been written, so the user is directed to
        // Integrity Check and manual review before any further posting attempt.
        // The modal is closed explicitly because render() below rebuilds the
        // workspace beneath it; the SELECTION is deliberately retained, so the
        // same rows stay checked and the user can see exactly what was involved.
        if(res.ok !== true && res.error === 'PayrollPersistenceFailed'){
          closeModal();
          showError('Payroll posting did not complete successfully. Some data may already have been saved. Run Integrity Check (Settings → Run Integrity Check) and review Payroll and Finance records before attempting another posting.', null, 12000);
          render();
          return;
        }
        // Success only from here: the selection has served its purpose.
        sel.clear(); closeModal();
        // v2.6.4/2.6.8 — report posted vs skipped. Skips are the pre-post selection skips
        // (rows not at the Approved stage) plus any commit blockers, each with its reason.
        res.skippedDetails=[...selectionSkips, ...(res.skippedDetails||[])];
        if(res.skippedDetails.length){ openPostResultModal(res); }
        else showSuccess(`Posted to finance: ${res.created} transaction(s) created, ${res.updated} updated.`, 6000);
        render();
      });
    }});
}
// v2.6.4 — Post to Finance result summary: posted vs skipped, with the exact blocker reason
// per skipped row. Read-only, single modal (no chain). Blocker rules are unchanged.
function openPostResultModal(res){
  const posted=res.posted||[], skipped=res.skippedDetails||[];
  const postedHTML = posted.length
    ? `<div class="hist-list">${posted.map(p=>`<div class="hist-row"><span class="hist-event">Posted</span><span class="hist-note">${escapeHtml(p.name)}${p.created?'':' <span class="faint">(updated existing)</span>'}</span></div>`).join('')}</div>`
    : '<div class="empty">No rows were posted.</div>';
  const skippedHTML = skipped.length
    ? `<div class="insight-list">${skipped.map(s=>`<div class="insight-item warn"><b>${escapeHtml(s.name)}</b> — ${escapeHtml((s.reasons||[]).join('; '))}</div>`).join('')}</div>`
    : '';
  openModalHTML(`<h3>Post to Finance — Result</h3>
    <div style="font-size:12.5px;line-height:1.9;">
      <div><b style="color:var(--green,#4FAE7C);">${res.created} created</b> · <b>${res.updated} updated</b> · <b style="color:var(--brick);">${skipped.length} skipped</b></div>
    </div>
    <div style="margin-top:10px;"><h4 style="margin:0 0 6px;">Posted (${posted.length})</h4>${postedHTML}</div>
    ${skipped.length?`<div style="margin-top:12px;"><h4 style="margin:0 0 6px;">Skipped — not posted (${skipped.length})</h4>${skippedHTML}
      <p class="hint" style="margin-top:8px;">No transaction was created for these rows and their stage is unchanged. Post applies only to Approved payroll; blocked Approved rows stay Approved — fix the reason (salary on the Contract, a valid/unique contract, or a non-negative total), then Post to Finance again.</p></div>`:''}
    <div class="modal-actions"><button type="button" class="btn btn-accent" id="prOk">Done</button></div>`,
    {width:600, onMount:(root)=>root.querySelector('#prOk').addEventListener('click', closeModal)});
}
// Shared read-only timeline markup (reuses the existing .hist-* classes; no CSS change).
function payrollTimelineHTML(events){
  if(!events || !events.length) return '<div class="empty">No recorded events yet.</div>';
  return `<div class="hist-list">${events.map(e=>`<div class="hist-row"><span class="hist-event">${escapeHtml(e.label)}</span><span class="hist-note">${escapeHtml(e.detail||'')}</span><span class="hist-ts faint">${e.ts?new Date(e.ts).toLocaleString('id-ID'):'—'}</span></div>`).join('')}</div>`;
}
function exportPayrollCsv(monthKey){
  const plans=payrollPlansForMonth(monthKey, true);
  const headers=['Employee','Contract','Progress','Department','Base Salary','Approved Overtime','Total Payroll','Stage','Source'];
  const lines=[`# ${APP_NAME} v${APP_VERSION} — Payroll ${keyToMonthObj(monthKey).month} ${keyToMonthObj(monthKey).year}`, headers.join(',')];
  plans.forEach(p=>{ const snap=payrollHistoricalSnapshot(p); lines.push([p.employeeName,p.contractNumber,p.contractProgress,p.department,snap.baseSalary,snap.overtimeAmount,snap.totalPayroll,payrollStage(p),snap.sourceLabel].map(csvSafe).join(',')); });
  downloadBlob(lines.join('\n'), `${FILE_BASE}-payroll-${monthKey}.csv`, 'text/csv'); showSuccess('Payroll exported.');
}

/* ---------- payroll preview (read-only) & history ---------- */
function renderPayrollDetail(main){
  // Readiness-1 — re-scope the captured id at render time (see renderEmployeeDetail).
  // This page carries salary, so a stale id must never resolve a colleague's row.
  const p = (typeof getScopedRecordById === 'function') ? getScopedRecordById('payrollPlan', State.detailPayrollId) : payrollPlanById(State.detailPayrollId);
  if(!p){ main.innerHTML=emptyState('Payroll row not found','It may have been cancelled or removed.'); return; }
  const emp=empById(p.employeeId), ct=contractById(p.contractId), txn=payrollTxnOf(p);
  const snap=payrollHistoricalSnapshot(p);                 // v2.7.1 stage-aware source of truth
  const committedStage=(payrollStage(p)==='Posted'||payrollStage(p)==='Executed');
  main.innerHTML = pageHeader(p.employeeName||'Payroll', `${escapeHtml(p.month)} ${p.year} · ${escapeHtml(p.contractNumber||'—')} · ${escapeHtml(p.contractProgress||'')}`,
      `<button class="btn" id="pdBack">← Payroll Workspace</button>${emp?`<button class="btn" id="pdEmp">Employee</button>`:''}${ct?`<button class="btn" id="pdCt">Contract</button>`:''}${txn?`<button class="btn" id="pdTxn">Transaction</button>`:''}`)
    + payrollDriftBannerHTML([p])
    + payrollIntegrityNoticeHTML(p)                          // v2.7.1 mismatch notice (between/above the panels)
    + `<div class="grid grid-2" style="margin-bottom:var(--space-4);align-items:start;">
      <div class="card"><h3>Base Payroll Snapshot <span class="tag">${committedStage?'committed':'read-only'}</span> ${payrollIntegrityBadge(p)}</h3><div style="font-size:13px;line-height:1.75;">
        <div>Employee: <b>${escapeHtml(p.employeeName||'—')}</b></div>
        <div>Contract: <b>${escapeHtml(p.contractNumber||'—')}</b></div>
        <div>Current Contract Progress: <b>${escapeHtml(p.contractProgress||'—')}</b></div>
        <div class="divider" style="margin:8px 0;"></div>
        <div>Base Salary: <b class="mono">${fmtIDR(snap.baseSalary)}</b> <span class="faint">${committedStage?'committed at posting':'from contract'}</span></div>
        <div>Approved Overtime: <b class="mono">${fmtIDR(snap.overtimeAmount)}</b> <span class="faint">(${payrollHoursDisplay(snap)}${snap.overtimeRecordCount!=null?` · ${snap.overtimeRecordCount} record(s)`:''})</span>${(p.overtimeIds&&p.overtimeIds.length)||(snap.overtimeSnapshot&&snap.overtimeSnapshot.length)?` · <button class="linklike" id="pdOt">breakdown</button>`:''}</div>
        <div class="divider" style="margin:8px 0;"></div>
        <div style="font-size:15px;">Total Payroll: <b class="mono" style="color:var(--accent);">${fmtIDR(snap.totalPayroll)}</b> ${snap.totalPayroll<0?'<span class="pill pill-status-cancelled">negative</span>':''}</div>
        <div>Stage: ${payrollStagePill(p)} <span class="faint" style="font-size:11px;">source: ${escapeHtml(snap.sourceLabel)}</span></div>
        <p class="hint" style="margin-top:8px;">Payroll = Base Salary + Approved Overtime. ${committedStage?'This is the committed historical record — it is not reconstructed from current contract or overtime data. Supplemental payments (if any) are shown separately below.':'Edit salary via the Contract; edit overtime via Overtime. Generated finance transaction is shown at right.'}</p>
      </div></div>
      <div class="card"><h3>Generated Finance Transaction</h3>${txn?`<div style="font-size:13px;line-height:1.75;">
        <div>Transaction Status: ${statusBadge(statusOf(txn))}</div>
        <div>Planned: <b class="mono">${fmtIDR(txn.planned)}</b> · Actual paid: <b class="mono">${txn.actual!=null?fmtIDR(txn.actual):'—'}</b></div>
        <div>Remaining: <b class="mono">${fmtIDR(num(txn.planned)-num(txn.actual))}</b></div>
        <div>Execution Date: <b>${escapeHtml((txn.execution&&txn.execution.executionDate)||txn.txnDate||'—')}</b></div>
        <div>Method: <b>${escapeHtml((txn.execution&&txn.execution.method)||'—')}</b> · Bank: <b>${escapeHtml((txn.execution&&txn.execution.bank)||'—')}</b></div>
        <div style="margin-top:8px;"><button class="btn btn-sm" id="pdExec">Open in Execution Center</button></div>
      </div>`:'<div class="empty">Not posted to finance yet. Approve then Post to Finance to create a Planned transaction.</div>'}</div>
    </div>
    ${(typeof supplementalPlanSectionHTML==='function')?supplementalPlanSectionHTML(p):''}
    <div class="card stack-section"><h3>Payroll Timeline</h3>
      <p class="hint" style="margin-top:-2px;margin-bottom:10px;">Generated → Reviewed → Approved → Posted → Executed, plus period lock/unlock. Only events that actually occurred are shown (real timestamps — nothing is fabricated).</p>
      ${payrollTimelineHTML(buildPayrollTimeline(p))}</div>
    <div class="card"><h3>Payroll History</h3><div class="hist-list">${(p.history||[]).map(h=>`<div class="hist-row"><span class="hist-event">${escapeHtml((h.event||'').charAt(0).toUpperCase()+(h.event||'').slice(1))}</span><span class="hist-note">${escapeHtml(h.note||'')}</span><span class="hist-ts faint">${h.ts?new Date(h.ts).toLocaleString('id-ID'):'—'}</span></div>`).join('')||'<div class="empty">No history.</div>'}</div></div>`;
  document.getElementById('pdBack').addEventListener('click', ()=>hrNavTo('payroll'));
  const ge=document.getElementById('pdEmp'); if(ge) ge.addEventListener('click', ()=>hrNavTo('employeeDetail',{detailEmpId:emp.id}));
  const gc=document.getElementById('pdCt'); if(gc) gc.addEventListener('click', ()=>hrNavTo('contractDetail',{detailContractId:ct.id}));
  const gt=document.getElementById('pdTxn'); if(gt) gt.addEventListener('click', ()=>openDetailModal(txn.id));
  const go=document.getElementById('pdOt'); if(go) go.addEventListener('click', ()=>openPayrollOvertimeBreakdown(p.id));
  const ge2=document.getElementById('pdExec'); if(ge2) ge2.addEventListener('click', ()=>{ if(txn) focusTransactionInExecutionCenter(txn.id); else { State.view='executioncenter'; render(); } });
}

/* ---------- recurring payroll adjustments UI (retained; not featured in the simplified workspace) ---------- */
function renderPayrollAdjustments(main){
  // Readiness-1 — recurring adjustments are per-employee compensation; scoped read.
  const list=((typeof getScopedRecords === 'function') ? getScopedRecords('payrollAdjustment') : State.payrollAdjustments.slice()).sort((a,b)=>String(a.employeeName||'').localeCompare(String(b.employeeName||'')));
  main.innerHTML = pageHeader('Recurring Payroll Adjustments','Retained for backward compatibility. TAM payroll is Base Salary + Approved Overtime; adjustments are not part of the standard workflow.',
      `<button class="btn" id="paBack">← Payroll Workspace</button><button class="btn btn-accent" id="paAdd">+ Add Adjustment</button>`)
    + `<div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Employee</th><th>Name</th><th>Type</th><th class="num">Amount</th><th>Window</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.map(a=>`<tr>
        <td><b>${escapeHtml(a.employeeName||'—')}</b></td><td>${escapeHtml(a.name||'—')}</td>
        <td>${a.type==='Deduction'?'<span class="pill pill-status-cancelled">Deduction</span>':'<span class="pill pill-status-completed">Addition</span>'}</td>
        <td class="num">${fmtIDR(a.amount)}</td><td class="dim">${escapeHtml(a.startMonth||'—')}${a.endMonth?' → '+escapeHtml(a.endMonth):' → ongoing'}</td>
        <td>${a.active===false?'<span class="pill pill-status-archived">Inactive</span>':'<span class="pill pill-status-completed">Active</span>'}</td>
        <td>${hrActionsMenu('padj', a.id, [['padj-edit','Edit'],['padj-toggle',a.active===false?'Activate':'Deactivate'],['padj-delete','Delete']])}</td>
      </tr>`).join('')||'<tr><td colspan="7" class="empty">No recurring adjustments.</td></tr>'}</tbody></table></div></div>`;
  document.getElementById('paBack').addEventListener('click', ()=>hrNavTo('payroll'));
  document.getElementById('paAdd').addEventListener('click', ()=>openAdjustmentModal(null));
  bindHRActions(main);
}
function openAdjustmentModal(id){
  const a=id?State.payrollAdjustments.find(x=>x.id===id):null; const isNew=!a;
  // Readiness-1 — an employee PICKER is a read of the employee list; scope it, or the
  // dropdown re-exposes every colleague the scoped views deliberately hide.
  const emps=((typeof getScopedRecords === 'function') ? getScopedRecords('employee') : State.employees.slice()).sort((x,y)=>String(x.fullName||'').localeCompare(String(y.fullName||'')));
  const v=a||{type:'Addition', startMonth:todayKey(), active:true};
  openModalHTML(`<h3>${isNew?'Add':'Edit'} Recurring Adjustment</h3>
    <form id="paForm"><div class="form-grid" style="grid-template-columns:1fr 1fr;">
      <div class="field" style="grid-column:span 2;"><label>Employee</label><select class="input" name="employeeId" required><option value="">— select —</option>${emps.map(e=>`<option value="${e.id}" ${v.employeeId===e.id?'selected':''}>${escapeHtml(e.fullName)}</option>`).join('')}</select></div>
      <div class="field"><label>Name</label><input class="input" name="name" value="${escapeHtml(v.name||'')}" required placeholder="e.g. Transport allowance"></div>
      <div class="field"><label>Type</label><select class="input" name="type"><option ${v.type==='Addition'?'selected':''}>Addition</option><option ${v.type==='Deduction'?'selected':''}>Deduction</option></select></div>
      <div class="field"><label>Amount (Rp)</label><input class="input" type="number" step="any" name="amount" value="${v.amount??''}" required></div>
      <div class="field"><label>Start Month (YYYY-MM)</label><input class="input" name="startMonth" value="${escapeHtml(v.startMonth||'')}" required></div>
      <div class="field"><label>End Month (optional)</label><input class="input" name="endMonth" value="${escapeHtml(v.endMonth||'')}" placeholder="blank = ongoing"></div>
      <div class="field" style="grid-column:span 2;"><label>Notes</label><input class="input" name="notes" value="${escapeHtml(v.notes||'')}"></div>
    </div><div class="modal-actions"><button type="button" class="btn" id="paCancel">Cancel</button><button type="submit" class="btn btn-accent">${isNew?'Create':'Save'}</button></div></form>`,
    {width:600, onMount:(root)=>{
      root.querySelector('#paCancel').addEventListener('click', closeModal);
      root.querySelector('#paForm').addEventListener('submit', async ev=>{
        ev.preventDefault();
        // UX-006C2C-4 (row 21) — adjustments feed payroll computation; payroll.manage.
        // Company-scope probe, matching every other payroll boundary.
        if(!can(ACTIONS.PAYROLL_MANAGE, { employeeId:null })){ showWarning('You do not have permission to manage payroll adjustments.'); return; }
        const fd=new FormData(ev.target); const emp=empById(fd.get('employeeId'));
        if(!emp){ showWarning('Select an employee.'); return; }
        const rec=a||{id:uid('padj'), active:true, createdAt:new Date().toISOString()};
        rec.employeeId=emp.id; rec.employeeName=emp.fullName; rec.name=(fd.get('name')||'').trim(); rec.type=fd.get('type');
        rec.amount=Number(fd.get('amount'))||0; rec.startMonth=(fd.get('startMonth')||'').trim(); rec.endMonth=(fd.get('endMonth')||'').trim()||null; rec.notes=(fd.get('notes')||'').trim(); rec.updatedAt=new Date().toISOString();
        if(isNew) State.payrollAdjustments.push(rec);
        await persistPayrollAdjustments(); closeModal(); showSuccess('Adjustment saved.'); render();
      });
    }});
}
async function toggleAdjustment(id){
  // UX-006C2C-4 (row 22) — payroll.manage before the mutation.
  if(!can(ACTIONS.PAYROLL_MANAGE, { employeeId:null })){ showWarning('You do not have permission to manage payroll adjustments.'); return; }
  const a=State.payrollAdjustments.find(x=>x.id===id); if(!a) return; a.active=a.active===false; a.updatedAt=new Date().toISOString(); await persistPayrollAdjustments(); render();
}
async function deleteAdjustment(id){
  // UX-006C2C-4 (row 23) — payroll.manage before the confirm and the removal.
  if(!can(ACTIONS.PAYROLL_MANAGE, { employeeId:null })){ showWarning('You do not have permission to manage payroll adjustments.'); return; }
  const a=State.payrollAdjustments.find(x=>x.id===id); if(!a) return; if(!confirmAction('Delete this recurring adjustment? Historical payroll snapshots are not changed.')) return; State.payrollAdjustments=State.payrollAdjustments.filter(x=>x.id!==id); await persistPayrollAdjustments(); render();
}
