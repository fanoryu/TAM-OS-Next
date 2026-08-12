/* ---------- Smart Import wizard UI (Parts 2, 7, 8) ---------- */
const SMART_STEPS = ['Upload File','Parse Workbook','Detect Months & Categories','Detect Employees & Contracts','Match Existing Master Data','Review Conflicts','Select Import Actions','Commit','Import Results'];
function smartMatchPill(status){
  const map={'Exact':'pill-status-completed','High Confidence':'pill-status-scheduled','Needs Review':'pill-status-partial','No Match':'pill-status-cancelled','Existing':'pill-status-completed','New':'pill-status-scheduled','Updated':'pill-status-partial','Conflict':'pill-status-cancelled','Missing Information':'pill-status-partial'};
  return `<span class="pill ${map[status]||'pill-other'}">${escapeHtml(status)}</span>`;
}
function smartItemBucket(item){
  if(item.actions.skip) return 'skipped';
  if(item.ctMatch.status==='Conflict' || item.ctMatch.missingInfo) return 'conflicts';
  if(item.empMatch.status==='No Match') return 'newEmp';
  if(item.ctMatch.status==='New') return 'newCt';
  return 'existing';
}
// v2.5.1 — Column Mapping & Raw Parsed Row Preview (shown before import).
const SMART_OVERRIDE_MEANINGS = ['employeeName','contractNumber','contractProgress','salary','month','category','planned','date','workingHoursPerDay','workingDaysPerWeek','overtimeHours','uraian'];
function renderColumnMappingCard(model){
  const map = model.mapping;
  const showMap = !!State.smartShowMapping, showRaw = !!State.smartShowRaw;
  const srcLabel = model.source==='letterdoc' ? 'TAM Letter-Document (Rencana Penggunaan Dana)' : model.source==='generic' ? 'Structured column table' : 'Unknown layout';
  let body = '';
  if(showMap){
    if(map && map.recognized && map.recognized.length){
      body += `<div class="table-wrap" style="margin-bottom:10px;"><table><thead><tr><th>Source Header</th><th>Detected Meaning</th><th>Sample Value</th><th>Confidence</th></tr></thead><tbody>`
        + map.recognized.map(r=>`<tr><td>${escapeHtml(r.header||'—')}</td><td><b>${escapeHtml(r.meaningLabel||r.meaning||'—')}</b></td><td class="dim">${escapeHtml(r.sample!=null?String(r.sample):'')}</td><td>${escapeHtml(r.confidence||'—')}</td></tr>`).join('')
        + `</tbody></table></div>`;
    } else {
      body += `<p class="hint">No column mapping report available for this layout.</p>`;
    }
    // Manual override (generic column tables only — letterdoc fields are row-blocks, not columns)
    if(map && map.source==='generic' && Array.isArray(map.rows)){
      const headerRow = map.rows[map.headerIdx]||[];
      const opts = (selected)=>`<option value="">(auto / none)</option>`+headerRow.map((h,ci)=>`<option value="${ci}" ${selected===ci?'selected':''}>${escapeHtml(String(h==null?('Col '+(ci+1)):h))}</option>`).join('');
      body += `<div class="hint" style="margin:8px 0 6px;"><b>Manual override</b> — remap any field if a column was mis-detected. Changing a value re-parses instantly.</div>
        <div class="grid grid-3" style="gap:8px;">${SMART_OVERRIDE_MEANINGS.map(mn=>`<div class="field"><label>${escapeHtml(GENERIC_MEANING_LABEL[mn]||mn)}</label><select class="input" data-simap="${mn}">${opts(map.colMap[mn])}</select></div>`).join('')}</div>`;
    }
    if(map && map.unrecognized && map.unrecognized.length){
      body += `<div class="hint" style="margin-top:8px;"><b>Unrecognized headers:</b> ${map.unrecognized.map(u=>escapeHtml(u.header)).join(', ')}</div>`;
    }
  }
  if(showRaw){
    const rows = model.rows||[];
    body += `<div class="table-wrap" style="margin-top:10px;max-height:340px;overflow:auto;"><table><thead><tr><th>#</th><th>Employee (extracted)</th><th>Contract #</th><th>Progress</th><th class="num">Salary</th><th>Month</th><th>Sub-lines / evidence</th></tr></thead><tbody>`
      + rows.slice(0,200).map((r,idx)=>`<tr><td class="dim">${idx+1}</td><td>${escapeHtml(r.employeeName||'—')}</td><td>${escapeHtml(r.contractNumber||'—')}</td><td>${r.progressCurrent!=null?escapeHtml((''+r.progressCurrent).replace('.',',')+'/'+r.progressTotal):'—'}</td><td class="num">${fmtIDR(r.salary||0)}</td><td class="dim">${escapeHtml(r.month||'')} ${r.year||''}</td><td class="faint" style="font-size:10.5px;">${escapeHtml(((r.subLines||[]).join(' · '))||'')}</td></tr>`).join('')
      + `</tbody></table></div><p class="hint">Exactly what Smart Import extracted from each payroll row — verify before committing.</p>`;
  }
  return `<div class="card stack-section">
    <div class="small-btn-row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
      <div><b>Column Mapping</b> <span class="faint" style="font-size:11px;">· ${escapeHtml(srcLabel)}</span></div>
      <div class="small-btn-row" style="gap:8px;">
        <button class="btn btn-sm ${showMap?'btn-accent':''}" id="siMapToggle">${showMap?'Hide':'Show'} Mapping</button>
        <button class="btn btn-sm ${showRaw?'btn-accent':''}" id="siRawToggle">${showRaw?'Hide':'Show'} Raw Parsed Rows</button>
      </div>
    </div>
    ${body?`<div style="margin-top:10px;">${body}</div>`:'<p class="hint" style="margin:8px 0 0;">Review how each source column/field maps to Employee, Contract, Progress, and Salary before importing.</p>'}
  </div>`;
}
/* ---------- v2.6.5 — Smart Import selection helpers (scroll/focus preservation) ---------- */
// Rows that will actually be committed (selected and not skipped).
function smartSelectedCount(model){ return model ? model.items.filter(i=>i.selected && !i.actions.skip).length : 0; }
// Incrementally refresh only the "N selected" indicator — no re-render, no scroll change.
function updateSmartSelectionCount(model){
  const el = document.getElementById('siSelCount');
  if(el) el.textContent = smartSelectedCount(model)+' selected';
}
// Sync the currently-visible row checkboxes to the model in place (used by Select All / Unselect All).
function syncSmartCheckboxes(main, model){
  main.querySelectorAll('[data-sisel]').forEach(cb=>{
    const it = model.items[+cb.dataset.sisel]; if(!it) return;
    cb.checked = !!(it.selected && !it.actions.skip);
    cb.disabled = !!it.actions.skip;
  });
}
// Run a mutation that re-renders the wizard while preserving the review list's scroll position
// (both the inner .table-wrap and the window) and the focused control — restored AFTER layout via
// requestAnimationFrame, using focus({preventScroll:true}) so nothing is scrolled into view.
function preserveSmartImportView(main, mutate){
  const wrapBefore = main.querySelector('.table-wrap');
  const st = wrapBefore ? wrapBefore.scrollTop : 0;
  const sl = wrapBefore ? wrapBefore.scrollLeft : 0;
  const winY = (typeof window!=='undefined') ? (window.scrollY || window.pageYOffset || 0) : 0;
  const act = document.activeElement;
  let focusKey = null;
  if(act && act.dataset){
    if(act.dataset.sisel!=null) focusKey = {attr:'data-sisel', val:act.dataset.sisel};
    else if(act.dataset.simap!=null) focusKey = {attr:'data-simap', val:act.dataset.simap};
    else if(act.dataset.sitab!=null) focusKey = {attr:'data-sitab', val:act.dataset.sitab};
  }
  mutate();
  // Restore after the new DOM is laid out. Primary path is requestAnimationFrame (matches the
  // sidebar-scroll pattern); a guarded setTimeout backstop also runs it once even when the tab
  // is hidden (rAF is paused while hidden). Reading scrollHeight forces layout first so the
  // scrollTop assignment sticks instead of clamping against a stale height.
  let done = false;
  const restore = ()=>{
    if(done) return; done = true;
    const wrapAfter = main.querySelector('.table-wrap');
    if(wrapAfter){ void wrapAfter.scrollHeight; wrapAfter.scrollTop = st; wrapAfter.scrollLeft = sl; }
    if(typeof window!=='undefined' && typeof window.scrollTo==='function') window.scrollTo(0, winY);
    if(focusKey){
      const el = main.querySelector(`[${focusKey.attr}="${focusKey.val}"]`);
      if(el){ try{ el.focus({preventScroll:true}); }catch(_e){ try{ el.focus(); }catch(_e2){} } }
    }
  };
  if(typeof requestAnimationFrame==='function') requestAnimationFrame(restore);
  setTimeout(restore, 0);
}
function renderSmartImport(main){
  const model = State.smartImport;
  if(!model){ State.view='add'; render(); return; }
  const c = smartCounts(model);
  const step = State.smartStep||7;
  const tabs = [['all','All',model.items.length],['ready','Ready',c.ready],['newEmp','New Employees',c.newEmp],['newCt','New Contracts',c.newCt],['existing','Existing Matches',c.matchedCt],['conflicts','Conflicts',c.conflicts],['skipped','Skipped',model.items.filter(i=>i.actions.skip).length]];
  const activeTab = State.smartTab||'all';
  const visible = model.items.filter(i=> activeTab==='all' ? true : smartItemBucket(i)===activeTab);

  main.innerHTML = pageHeader('Smart Import', `${escapeHtml(model.fileName)} · ${c.rows} payroll row(s) across ${c.months} month(s)`,
      `<button class="btn" id="siCancel">Cancel</button>`)
    + `<div class="card stack-section"><div class="chart-range-chips">${SMART_STEPS.map((s,i)=>`<span class="btn btn-sm ${i+1<=step?'btn-accent':''}" style="cursor:default;">${i+1}. ${escapeHtml(s)}</span>`).join('')}</div></div>
    <div class="grid grid-4 stack-section">
      <div class="card stat-card"><div class="stat-label">Payroll Rows</div><div class="stat-value">${c.rows}</div><div class="stat-sub dim">across ${c.months} month(s)</div></div>
      <div class="card stat-card"><div class="stat-label">Unique Employees</div><div class="stat-value">${c.uniqueEmployees}</div><div class="stat-sub dim">${c.existingMatched} matched · ${c.newEmployees} new${c.possibleDuplicates?' · '+c.possibleDuplicates+' possible dup':''}</div></div>
      <div class="card stat-card"><div class="stat-label">Contracts</div><div class="stat-value">${c.contracts}</div><div class="stat-sub dim">${c.matchedCt} matched · ${c.newCt} new</div></div>
      <div class="card stat-card"><div class="stat-label">Will Create</div><div class="stat-value">${c.payroll}</div><div class="stat-sub dim">payroll plans · ${c.txns} transactions</div></div>
    </div>
    <p class="hint" style="margin:-6px 0 12px;">Employees are master data — <b>${c.uniqueEmployees}</b> unique person(s) detected across all months (not ${c.rows} rows). Each person is created once and reused for every monthly payroll plan and transaction.${(c.conflicts+c.reviewRequired)?` <b style="color:var(--brick);">${c.conflicts+c.reviewRequired} row(s) need review.</b>`:''}${c.possibleDuplicates?` <b style="color:var(--brick);">${c.possibleDuplicates} candidate(s) match more than one existing employee — see Employee Duplicate Review.</b>`:''}</p>
    ${renderColumnMappingCard(model)}
    <div class="card">
      <div class="chart-range-chips" style="margin-bottom:12px;">${tabs.map(([k,l,n])=>`<button class="btn btn-sm ${activeTab===k?'btn-accent':''}" data-sitab="${k}">${l} (${n})</button>`).join('')}</div>
      <div class="small-btn-row" style="flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center;">
        <button class="btn btn-sm" id="siSelectSafe">Select All Safe</button>
        <button class="btn btn-sm" id="siUnselect">Unselect All</button>
        <button class="btn btn-sm" id="siSkipConflicts">Skip Conflicts</button>
        <button class="btn btn-sm" id="siReviewOnly">Review Only</button>
        <span class="dim" id="siSelCount" style="font-size:12px;margin-left:auto;">${smartSelectedCount(model)} selected</span>
        <button class="btn btn-accent" id="siCommit">Commit Selected</button>
      </div>
      <div class="table-wrap" style="max-height:520px;overflow-y:auto;">
        <table>
          <thead><tr><th style="width:34px;"></th><th>Employee</th><th>Contract</th><th>Progress</th><th class="num">Salary</th><th>Month</th><th>Employee Match</th><th>Contract</th></tr></thead>
          <tbody>${visible.map(i=>{
            const idx = model.items.indexOf(i);
            const conf = i.ctMatch.conflicts||[];
            const cand = i.candidateKey && model.candidates ? model.candidates.get(i.candidateKey) : null;
            const canonLabel = cand ? (cand.matchedEmployee ? ('↳ '+escapeHtml(cand.matchedEmployee.employeeId||cand.matchedEmployee.fullName)+(cand.possibleDuplicate?' (possible dup)':'')) : ('↳ new person · '+cand.workbookMonths.size+' month(s)')) : '';
            return `<tr>
              <td><input type="checkbox" data-sisel="${idx}" ${i.selected&&!i.actions.skip?'checked':''} ${i.actions.skip?'disabled':''}></td>
              <td><b>${escapeHtml(i.row.employeeName||'—')}</b>${i.actions.createEmployee?' <span class="pill pill-status-scheduled">create</span>':''}${i.reviewRequired?' <span class="pill pill-status-partial">review</span>':''}${canonLabel?`<div class="faint" style="font-size:10px;">${canonLabel}</div>`:''}</td>
              <td>${escapeHtml(i.row.contractNumber || (i.proposed.contractNumber||'—'))}${i.actions.createContract?' <span class="pill pill-status-scheduled">new</span>':''}${i.ctMatch.missingInfo?' <span class="pill pill-status-partial" title="No contract number or progress in the workbook — using a default duration and the payroll month as start.">defaults</span>':''}</td>
              <td>${i.row.progressCurrent!=null?escapeHtml((''+i.row.progressCurrent).replace('.',',')+'/'+i.row.progressTotal):'<span class="faint">—</span>'}${i.ctMatch.inferredStart?`<div class="faint" style="font-size:10px;">start≈${escapeHtml(i.ctMatch.inferredStart.slice(0,7))}</div>`:''}</td>
              <td class="num">${fmtIDR(i.row.salary)}</td>
              <td class="dim">${escapeHtml(i.row.month)} ${i.row.year}</td>
              <td>${smartMatchPill(i.empMatch.status)}${i.empMatch.employee&&i.empMatch.status!=='Exact'?`<div class="faint" style="font-size:10px;">${escapeHtml(i.empMatch.employee.fullName)} ${(i.empMatch.confidence*100).toFixed(0)}%</div>`:''}</td>
              <td>${smartMatchPill(i.ctMatch.status)}${conf.length?`<div class="faint" style="font-size:10px;">${conf.map(x=>escapeHtml(x.field+': '+x.existing+' → '+x.imported)).join('<br>')}</div>`:''}</td>
            </tr>`;}).join('') || `<tr><td colspan="8" class="empty">No rows in this tab.</td></tr>`}</tbody>
        </table>
      </div>
      <p class="hint" style="margin-top:10px;">Conflicts show existing → imported side-by-side and are never auto-applied. New employees/contracts are created only for checked rows. Salaries, durations, dates, and overlapping contracts are never overwritten automatically.</p>
    </div>`;

  document.getElementById('siCancel').addEventListener('click', ()=>{ State.smartImport=null; State.view='add'; render(); });
  // v2.5.1 — Column Mapping page controls
  const mapToggle = document.getElementById('siMapToggle');
  if(mapToggle) mapToggle.addEventListener('click', ()=>{ State.smartShowMapping = !State.smartShowMapping; renderSmartImport(main); });
  const rawToggle = document.getElementById('siRawToggle');
  if(rawToggle) rawToggle.addEventListener('click', ()=>{ State.smartShowRaw = !State.smartShowRaw; renderSmartImport(main); });
  // Column-mapping override rebuilds the whole model → a full re-render is unavoidable, so
  // preserve the list scroll position and the focused mapping <select> across it (v2.6.5).
  main.querySelectorAll('[data-simap]').forEach(sel=>sel.addEventListener('change', ()=>{
    preserveSmartImportView(main, ()=>{
      const overm = {};
      main.querySelectorAll('[data-simap]').forEach(s=>{ const v=s.value; if(v!==''){ overm[s.dataset.simap] = +v; } });
      const fresh = rebuildSmartImportFromOverride(model, overm);
      State.smartImport = fresh; renderSmartImport(main);
    });
  }));
  // Switching review tabs is an intentional navigation — starting the new tab at the top is fine.
  main.querySelectorAll('[data-sitab]').forEach(b=>b.addEventListener('click', ()=>{ State.smartTab=b.dataset.sitab; renderSmartImport(main); }));
  // v2.6.5 — ROW SELECTION IS FULLY INCREMENTAL. Toggling a row changes only model.items[].selected
  // (no smartCounts value depends on `selected`), so we update the model + the selection counter
  // and DO NOT re-render. The scroll container is never rebuilt, so scroll position and keyboard
  // focus stay exactly where they were. This is the fix for the report.
  main.querySelectorAll('[data-sisel]').forEach(cb=>cb.addEventListener('change', e=>{
    const it = model.items[+e.target.dataset.sisel]; if(!it) return;
    it.selected = e.target.checked && !it.actions.skip;
    updateSmartSelectionCount(model);
  }));
  // Select All Safe / Unselect All only flip `selected` (no bucket/count/visible-set change), so
  // they too are incremental: sync the visible checkboxes in place, update the counter, no re-render.
  document.getElementById('siSelectSafe').addEventListener('click', ()=>{
    model.items.forEach(i=>{ i.selected = !i.reviewRequired && !i.actions.skip; });
    syncSmartCheckboxes(main, model); updateSmartSelectionCount(model);
  });
  document.getElementById('siUnselect').addEventListener('click', ()=>{
    model.items.forEach(i=>i.selected=false);
    syncSmartCheckboxes(main, model); updateSmartSelectionCount(model);
  });
  // Skip Conflicts changes actions.skip → it moves rows between buckets, disables their checkboxes
  // and changes the summary counts, so a re-render IS needed. Preserve the scroll position across it.
  document.getElementById('siSkipConflicts').addEventListener('click', ()=>{
    preserveSmartImportView(main, ()=>{
      model.items.forEach(i=>{ if(i.ctMatch.status==='Conflict'||i.ctMatch.missingInfo){ i.actions.skip=true; i.selected=false; } });
      renderSmartImport(main);
    });
  });
  document.getElementById('siReviewOnly').addEventListener('click', ()=>{ State.smartTab='conflicts'; renderSmartImport(main); });
  document.getElementById('siCommit').addEventListener('click', async ()=>{
    const sel = model.items.filter(i=>i.selected && !i.actions.skip);
    if(!sel.length){ showWarning('No rows selected to commit.'); return; }
    if(State.importMode==='review'){ showWarning('Review Only mode: nothing is committed. Switch mode to Smart Payroll & Master Sync to import.'); return; }
    if(!confirmAction(`Commit ${sel.length} selected row(s)? A safety backup is taken first. Employees/contracts/payroll/transactions will be created with structured links; duplicates (employee+contract+month) are skipped.`)) return;
    State.smartStep=8;
    const res = await commitSmartImport(model);
    if(res.ok !== true){
      // UX-006C2C-2 — an authorization denial is not a storage failure: no write was
      // attempted, so it is reported separately and the wizard stays on the review step.
      if(res.error === 'NotAuthorized'){
        State.smartStep=7;
        showError('You do not have permission to commit an import.', null, 7000);
        render();
        return;
      }
      // SPR-079 — persistence failed. The import is NOT closed as completed: the
      // parsed model is kept so the user can retry, the wizard does not advance to
      // the results screen, and no success message is shown. Wording states the
      // operation did not complete; it does NOT claim a rollback, because the
      // fan-out is not atomic and earlier writes may have persisted. The
      // pre-import safety backup remains available.
      State.smartStep=7;
      showError('Some data could not be saved. The import was not completed successfully — reload the page to return to the last saved state, then try again. A pre-import backup was taken and is still available in Settings.', null, 9000);
      render();
      return;
    }
    const audit = res.audit;
    State.smartImport=null; State.smartStep=9;
    showSuccess(`Smart Import complete: ${audit.counts.employees} employees, ${audit.counts.contracts} contracts, ${audit.counts.payrollPlans} payroll plans, ${audit.counts.txns} transactions created.`, 7000);
    State.view='importResults'; State.lastImportAudit=audit; render();
  });
}
function renderImportResults(main){
  const a = State.lastImportAudit;
  if(!a){ State.view='add'; render(); return; }
  main.innerHTML = pageHeader('Import Results', `${escapeHtml(a.fileName)} · committed ${escapeHtml(new Date(a.ts).toLocaleString('id-ID'))}`,
      `<button class="btn btn-accent" id="irPayroll">Continue to Payroll Planning</button><button class="btn" id="irBack">Back to Add / Upload</button><button class="btn btn-danger" id="irUndo"${authzDisabled(ACTIONS.IMPORT_UNDO)}>Undo Last Smart Import</button>`)
    + `<div class="grid grid-4 stack-section">
      <div class="card stat-card"><div class="stat-label">Employees Created</div><div class="stat-value">${a.counts.employees}</div></div>
      <div class="card stat-card"><div class="stat-label">Contracts Created</div><div class="stat-value">${a.counts.contracts}</div></div>
      <div class="card stat-card"><div class="stat-label">Payroll Plans</div><div class="stat-value">${a.counts.payrollPlans}</div></div>
      <div class="card stat-card"><div class="stat-label">Transactions</div><div class="stat-value">${a.counts.txns}</div></div>
    </div>
    <div class="card"><div class="insight-list">
      <div class="insight-item good">Committed with a pre-import safety backup and an audit record. All created records carry importBatchId ${escapeHtml(a.batchId)} and structured employee/contract/payroll links.</div>
      ${a.counts.duplicatesSkipped?`<div class="insight-item warn">${a.counts.duplicatesSkipped} duplicate payroll row(s) were skipped (employee + contract + month already existed).</div>`:''}
      ${a.counts.skipped?`<div class="insight-item">${a.counts.skipped} row(s) were skipped or unselected.</div>`:''}
      <div class="insight-item">Undo removes created records but never executed, modified, or committed-executed transactions.</div>
    </div></div>`;
  document.getElementById('irPayroll').addEventListener('click', ()=>{ State.view='payroll'; render(); });
  document.getElementById('irBack').addEventListener('click', ()=>{ State.view='add'; render(); });
  document.getElementById('irUndo').addEventListener('click', undoLastSmartImport);
}
