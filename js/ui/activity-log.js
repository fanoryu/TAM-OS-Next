/* ============================================================
   ACTIVITY LOG + AUDIT TRAIL (v2.6.4)
   A read-only, cross-module view over the existing append-only
   audit store (tam_audit_log_v1 — the SAME key the Start-Fresh
   reset record already uses; no new storage key, no SCHEMA_VERSION
   change). logActivity() is called at the mutation chokepoints
   (payroll, overtime, finance execution, imports, deletes); this
   page reads, filters (search / module / type / period), renders
   incrementally so search focus is preserved, and exports to CSV.

   The audit store deliberately lives in localStorage (like the
   pre-existing reset record) so it survives a data reset. Entries
   are normalized to a single shape at read time so both the legacy
   reset record ({event,ts,note}) and the richer v2.6.4 records
   ({ts,type,module,entity,entityId,desc,refs}) display cleanly.
   ============================================================ */
const AUDIT_LOG_KEY = 'tam_audit_log_v1';
const AUDIT_LOG_CAP = 500; // keep the newest N records; audit is diagnostic, not unbounded

function readAuditRaw(){
  try{ const v = JSON.parse(window.localStorage.getItem(AUDIT_LOG_KEY) || '[]'); return Array.isArray(v) ? v : []; }
  catch(e){ return []; }
}
// Append one activity record. MUST never throw — auditing can never break a user action.
function logActivity(entry){
  try{
    if(!entry || typeof entry!=='object') return;
    const rec = Object.assign({ ts: new Date().toISOString() }, entry);
    const log = readAuditRaw();
    log.unshift(rec);
    window.localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify(log.slice(0, AUDIT_LOG_CAP)));
  }catch(e){ /* audit logging is best-effort only */ }
}
// Normalize any stored record (legacy reset OR rich v2.6.4) to one shape.
function normalizeAuditEntry(e){
  if(!e || typeof e!=='object') return null;
  if(e.type){
    return { ts:e.ts||null, type:e.type, module:e.module||'System', entity:e.entity||'', entityId:e.entityId||'', desc:e.desc||e.note||'', refs:(e.refs&&typeof e.refs==='object')?e.refs:{} };
  }
  if(e.event){ // legacy shape: {event, ts, note}
    return { ts:e.ts||null, type:e.event, module:e.module||'System', entity:e.entity||'', entityId:e.entityId||'', desc:e.note||e.desc||'', refs:{} };
  }
  return null;
}
// All events, normalized, newest first.
function getAuditEvents(){
  return readAuditRaw().map(normalizeAuditEntry).filter(Boolean)
    .sort((a,b)=> new Date(b.ts||0) - new Date(a.ts||0));
}
// Events touching a specific payroll period month key (for the payroll timelines).
function auditEventsForMonth(monthKey){
  return getAuditEvents().filter(e=> e.refs && e.refs.monthKey===monthKey);
}

const AUDIT_TYPE_LABELS = {
  'reset':'Data Reset',
  'payroll.generate':'Payroll Generated', 'payroll.review':'Payroll Reviewed', 'payroll.approve':'Payroll Approved',
  'payroll.return':'Payroll Returned to Draft', 'payroll.cancel':'Payroll Row Cancelled', 'payroll.post':'Payroll Posted to Finance',
  'payroll.lock':'Payroll Period Locked', 'payroll.unlock':'Payroll Period Unlocked', 'payroll.override':'Salary Overridden',
  'overtime.approved':'Overtime Approved', 'overtime.reviewed':'Overtime Reviewed', 'overtime.rejected':'Overtime Rejected',
  'overtime.submitted':'Overtime Submitted', 'overtime.draft':'Overtime Set to Draft', 'overtime.committed-to-payroll':'Overtime Committed to Payroll',
  'finance.execute':'Transaction Executed', 'import.commit':'Smart Import Committed', 'import.undo':'Smart Import Undone',
  'employee.delete':'Employee Deleted', 'contract.delete':'Contract Deleted',
  'bankaccount.create':'Bank Account Created', 'bankaccount.edit':'Bank Account Updated', 'bankaccount.status':'Bank Account Status Changed',
  'supplemental.create':'Supplemental Created', 'supplemental.refresh':'Supplemental Refreshed', 'supplemental.review':'Supplemental Submitted for Review',
  'supplemental.return_draft':'Supplemental Returned to Draft', 'supplemental.approve':'Supplemental Approved', 'supplemental.return_review':'Supplemental Returned to Review',
  'supplemental.post':'Supplemental Posted to Finance', 'supplemental.execute':'Supplemental Executed', 'supplemental.cancel':'Supplemental Cancelled',
};
function auditTypeLabel(t){
  if(AUDIT_TYPE_LABELS[t]) return AUDIT_TYPE_LABELS[t];
  return String(t||'').replace(/[._-]+/g,' ').replace(/\b\w/g, c=>c.toUpperCase());
}
function auditModulePill(m){
  const map={Payroll:'pill-status-scheduled', Overtime:'pill-status-partial', Finance:'pill-status-completed', Import:'pill-status-planned', Employees:'pill-other', Contracts:'pill-other', System:'pill-status-archived'};
  return `<span class="pill ${map[m]||'pill-other'}">${escapeHtml(m||'System')}</span>`;
}
function auditRelatedChips(refs){
  const r = refs||{}; const out=[];
  const shortId = (v)=>{ v=String(v); return v.length>10 ? '…'+v.slice(-6) : v; };
  if(r.monthKey)       out.push(`<span class="pill pill-other" title="Payroll period">${escapeHtml(r.monthKey)}</span>`);
  if(r.employeeId)     out.push(`<span class="pill pill-other" title="Employee ${escapeHtml(String(r.employeeId))}">emp ${escapeHtml(shortId(r.employeeId))}</span>`);
  if(r.payrollPlanId)  out.push(`<span class="pill pill-other" title="Payroll plan ${escapeHtml(String(r.payrollPlanId))}">pay ${escapeHtml(shortId(r.payrollPlanId))}</span>`);
  if(r.contractId)     out.push(`<span class="pill pill-other" title="Contract ${escapeHtml(String(r.contractId))}">ct ${escapeHtml(shortId(r.contractId))}</span>`);
  if(r.transactionId)  out.push(`<span class="pill pill-other" title="Transaction ${escapeHtml(String(r.transactionId))}">txn ${escapeHtml(shortId(r.transactionId))}</span>`);
  if(r.importBatchId)  out.push(`<span class="pill pill-other" title="Import batch ${escapeHtml(String(r.importBatchId))}">imp ${escapeHtml(shortId(r.importBatchId))}</span>`);
  return out.join(' ') || '<span class="faint">—</span>';
}

/* ---------- period filter ---------- */
function activityPeriodCutoff(period){
  const now = Date.now(), DAY = 86400000;
  if(period==='7d')  return now - 7*DAY;
  if(period==='30d') return now - 30*DAY;
  if(period==='90d') return now - 90*DAY;
  if(period==='month'){ const d=new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }
  return 0; // all time
}

/* ---------- incremental render (search focus preserved, mirrors v2.6.1 pattern) ---------- */
let __activityCache = [];
function activityFiltered(){
  const f = State.activityFilter;
  let rows = __activityCache.slice();
  if(f.module!=='all') rows = rows.filter(e=>e.module===f.module);
  if(f.type!=='all')   rows = rows.filter(e=>e.type===f.type);
  const cut = activityPeriodCutoff(f.period);
  if(cut) rows = rows.filter(e=> e.ts && new Date(e.ts).getTime() >= cut);
  if(f.search.trim()){
    const s = normStr(f.search);
    rows = rows.filter(e=> [e.entity, e.desc, auditTypeLabel(e.type), e.module, e.entityId, e.refs?Object.values(e.refs).join(' '):'']
      .some(x=> normStr(String(x||'')).includes(s)));
  }
  rows.sort((a,b)=> new Date(b.ts||0) - new Date(a.ts||0)); // newest first
  return rows;
}
function activityRowHTML(e){
  return `<tr>
    <td class="dim" style="white-space:nowrap;">${e.ts?escapeHtml(new Date(e.ts).toLocaleString('id-ID')):'—'}</td>
    <td>${auditModulePill(e.module)}</td>
    <td><b>${escapeHtml(auditTypeLabel(e.type))}</b></td>
    <td>${e.entity?escapeHtml(e.entity):'<span class="faint">—</span>'}</td>
    <td class="dim">${e.desc?escapeHtml(e.desc):'—'}</td>
    <td style="font-size:10px;">${auditRelatedChips(e.refs)}</td>
  </tr>`;
}
function activityBodyHTML(){
  const rows = activityFiltered();
  if(!rows.length) return '<tr><td colspan="6" class="empty">No activity matches the current filters.</td></tr>';
  return rows.map(activityRowHTML).join('');
}
function applyActivityFilter(main){
  const tb = document.getElementById('actRows'); if(!tb) return;
  tb.innerHTML = activityBodyHTML();
  const cnt = document.getElementById('actCount'); if(cnt) cnt.textContent = String(activityFiltered().length);
}
function renderActivityLog(main){
  if(!State.activityFilter) State.activityFilter = {search:'', module:'all', type:'all', period:'all'};
  __activityCache = getAuditEvents();
  const f = State.activityFilter;

  // Fully empty store (nothing has been recorded yet) — dedicated empty state.
  if(!__activityCache.length){
    main.innerHTML = pageHeader('Activity Log','A read-only audit trail of key actions across TAM OS. Newest first.')
      + `<div class="card"><div class="empty">
        <div class="big">▤</div>
        <div style="color:var(--text);font-weight:600;margin-bottom:6px;">No activity recorded yet</div>
        <div>Actions such as generating, approving, posting or locking payroll, executing transactions, committing a Smart Import, or changing overtime status will appear here as they happen. Nothing on this page is sample data.</div>
      </div></div>`;
    return;
  }

  const modules = [...new Set(__activityCache.map(e=>e.module))].sort();
  const types = [...new Set(__activityCache.map(e=>e.type))].sort((a,b)=>auditTypeLabel(a).localeCompare(auditTypeLabel(b)));

  main.innerHTML = pageHeader('Activity Log', 'A read-only audit trail of key actions across TAM OS. Newest first — search, filter and export.')
    + `<div class="card">
      <div class="form-grid" style="grid-template-columns:1.6fr 1fr 1.2fr 1fr;margin-bottom:12px;">
        <div class="field"><label>Search</label><input class="input" id="actSearch" placeholder="entity, description, id" value="${escapeHtml(f.search)}"></div>
        <div class="field"><label>Module</label><select class="input" id="actModule"><option value="all">All modules</option>${modules.map(m=>`<option value="${escapeHtml(m)}" ${f.module===m?'selected':''}>${escapeHtml(m)}</option>`).join('')}</select></div>
        <div class="field"><label>Event Type</label><select class="input" id="actType"><option value="all">All events</option>${types.map(t=>`<option value="${escapeHtml(t)}" ${f.type===t?'selected':''}>${escapeHtml(auditTypeLabel(t))}</option>`).join('')}</select></div>
        <div class="field"><label>Period</label><select class="input" id="actPeriod">
          <option value="all" ${f.period==='all'?'selected':''}>All time</option>
          <option value="7d" ${f.period==='7d'?'selected':''}>Last 7 days</option>
          <option value="30d" ${f.period==='30d'?'selected':''}>Last 30 days</option>
          <option value="90d" ${f.period==='90d'?'selected':''}>Last 90 days</option>
          <option value="month" ${f.period==='month'?'selected':''}>This month</option>
        </select></div>
      </div>
      <div class="small-btn-row" style="flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center;">
        <span class="dim" style="font-size:12px;"><b id="actCount">${activityFiltered().length}</b> event(s) · ${__activityCache.length} total recorded</span>
        <button class="btn btn-sm" id="actReset">Clear Filters</button>
        <button class="btn btn-sm" id="actCsv" style="margin-left:auto;">Export CSV</button>
      </div>
      <div class="table-wrap" style="max-height:640px;overflow:auto;">
        <table>
          <thead><tr><th style="width:150px;">Time</th><th>Module</th><th>Event</th><th>Entity</th><th>Description</th><th>Related</th></tr></thead>
          <tbody id="actRows">${activityBodyHTML()}</tbody>
        </table>
      </div>
      <p class="hint" style="margin-top:10px;">Read-only. Records are stored privately on this device and are kept even after a data reset. The newest ${AUDIT_LOG_CAP} events are retained.</p>
    </div>`;

  document.getElementById('actSearch').addEventListener('input', e=>{ State.activityFilter.search=e.target.value; applyActivityFilter(main); });
  document.getElementById('actModule').addEventListener('change', e=>{ State.activityFilter.module=e.target.value; applyActivityFilter(main); });
  document.getElementById('actType').addEventListener('change', e=>{ State.activityFilter.type=e.target.value; applyActivityFilter(main); });
  document.getElementById('actPeriod').addEventListener('change', e=>{ State.activityFilter.period=e.target.value; applyActivityFilter(main); });
  document.getElementById('actReset').addEventListener('click', ()=>{ State.activityFilter={search:'', module:'all', type:'all', period:'all'}; renderActivityLog(main); });
  document.getElementById('actCsv').addEventListener('click', exportActivityCsv);
}
function exportActivityCsv(){
  const rows = activityFiltered();
  const headers = ['Timestamp','Module','Event Type','Event','Entity','Description','Month','Employee ID','Payroll ID','Contract ID','Transaction ID','Import ID'];
  const lines = [`# ${APP_NAME} v${APP_VERSION} — Activity Log`, headers.join(',')];
  rows.forEach(e=>{ const r=e.refs||{}; lines.push([
    e.ts||'', e.module||'', e.type||'', auditTypeLabel(e.type), e.entity||'', e.desc||'',
    r.monthKey||'', r.employeeId||'', r.payrollPlanId||'', r.contractId||'', r.transactionId||'', r.importBatchId||''
  ].map(csvSafe).join(','));});
  downloadBlob(lines.join('\n'), `${FILE_BASE}-activity-log-${new Date().toISOString().slice(0,10)}.csv`, 'text/csv');
  showSuccess('Activity log exported.');
}
