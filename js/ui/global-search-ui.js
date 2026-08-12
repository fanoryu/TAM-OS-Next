/* ============================================================
   GLOBAL SEARCH — APPLICATION ADAPTER + PALETTE (UX-005D)
   ------------------------------------------------------------
   The application-facing layer around the pure engine (js/core/global-search.js).
   RESPONSIBILITIES: (1) map already-authorized sources into plain search documents,
   (2) derive navigation documents from the canonical nav manifest (no second route
   map), (3) run the pure engine, (4) render the Ctrl/Cmd+K palette, (5) activate a
   result via hrNavTo() — NAVIGATION ONLY.

   SCOPE-SAFETY (frozen for UX-006): scoping happens HERE, at the openGlobalSearch()
   call site, which chooses WHICH sources to pass to collectGlobalSearchDocuments().
   Today it passes company-wide State; a future Personal Workspace passes a self-
   scoped subset with NO change to the engine or the collector contract. The engine
   can never recover a record that was not supplied.

   This module performs NO business mutation: activation is strictly hrNavTo().
   ============================================================ */

const GLOBAL_SEARCH_TYPE_LABEL = { view:'Navigation', employee:'Employees', contract:'Contracts', payroll:'Payroll', transaction:'Transactions' };

// Build navigation documents from the SUPPLIED nav groups (derived from the
// canonical manifest by the caller) — placeholders excluded. No second route map.
function globalSearchViewDocs(navGroups, titles){
  const docs = [];
  (navGroups || []).forEach(g => (g.items || []).forEach(it => {
    if(it.placeholder) return;                       // exclude coming-soon placeholders
    const label = (titles && titles[it.id]) || it.label || it.id;
    docs.push({
      key: 'view:' + it.id, type: 'view', label: label,
      meta: 'Go to ' + (g.label || ''), searchText: normStr(label + ' ' + (g.label || '')),
      to: it.id, context: {}
    });
  }));
  return docs;
}

// Map already-authorized sources -> plain search documents. Reads ONLY the sources
// object it is given (never State directly) — this is the scope seam.
function collectGlobalSearchDocuments(sources){
  sources = sources || {};
  const docs = [];
  // Navigation
  globalSearchViewDocs(sources.navGroups, sources.pageTitles).forEach(d => docs.push(d));
  // Employees
  (sources.employees || []).forEach(e => {
    if(!e || !e.id) return;
    docs.push({
      key: 'employee:' + e.id, type: 'employee',
      label: e.fullName || e.employeeId || '(unnamed)',
      meta: [e.department, e.jobTitle, e.employeeId].filter(Boolean).join(' · '),
      searchText: normStr([e.fullName, e.employeeId, e.jobTitle, e.department, e.email, e.phone].filter(Boolean).join(' ')),
      to: 'employeeDetail', context: { detailEmpId: e.id }
    });
  });
  // Contracts
  (sources.contracts || []).forEach(c => {
    if(!c || !c.id) return;
    docs.push({
      key: 'contract:' + c.id, type: 'contract',
      label: c.contractNumber || '(contract)',
      meta: [c.employeeName, c.status].filter(Boolean).join(' · '),
      searchText: normStr([c.contractNumber, c.employeeName, c.status].filter(Boolean).join(' ')),
      to: 'contractDetail', context: { detailContractId: c.id }
    });
  });
  // Payroll plans
  (sources.payrollPlans || []).forEach(p => {
    if(!p || !p.id) return;
    const mo = (typeof keyToMonthObj === 'function' && p.monthKey) ? keyToMonthObj(p.monthKey) : null;
    const period = mo ? (mo.month + ' ' + mo.year) : (p.monthKey || '');
    docs.push({
      key: 'payroll:' + p.id, type: 'payroll',
      label: p.employeeName || '(payroll)',
      meta: [period, p.status].filter(Boolean).join(' · '),
      searchText: normStr([p.employeeName, period, p.status].filter(Boolean).join(' ')),
      to: 'payrollDetail', context: { detailPayrollId: p.id }
    });
  });
  // NOTE (UX-005D v1): Transaction entity results are DEFERRED — the Transactions
  // view has no non-mutating focus/deep-link route (see plan §17). Execution Center
  // still appears as a Navigation result.
  return docs;
}

/* ---------------- palette state (ephemeral, session-only) ---------------- */
let __gsearch = null; // { overlay, input, list, results:[docs...], active, onKey, returnFocus }

function globalSearchIsOpen(){ return !!__gsearch; }

// Flatten the grouped engine output into rendered rows + a parallel doc list for
// keyboard activation (active index maps into this flat list).
function renderGlobalSearchResults(result){
  if(!__gsearch) return;
  const flat = [];
  let html = '';
  (result.groups || []).forEach(g => {
    html += '<div class="gsearch-group" role="presentation">' + escapeHtml(GLOBAL_SEARCH_TYPE_LABEL[g.type] || g.type) + '</div>';
    g.items.forEach(doc => {
      const idx = flat.length; flat.push(doc);
      html += '<div class="gsearch-item" role="option" id="gsearch-opt-' + idx + '" data-gs-index="' + idx + '"'
        + (idx === 0 ? ' aria-selected="true"' : '') + '>'
        + '<span class="gsearch-item-label">' + escapeHtml(doc.label) + '</span>'
        + (doc.meta ? '<span class="gsearch-item-meta">' + escapeHtml(doc.meta) + '</span>' : '')
        + '<span class="gsearch-item-type" aria-hidden="true">' + escapeHtml(GLOBAL_SEARCH_TYPE_LABEL[doc.type] || doc.type) + '</span>'
        + '</div>';
    });
  });
  __gsearch.results = flat;
  __gsearch.active = flat.length ? 0 : -1;
  const empty = !result.query
    ? '<div class="gsearch-empty">Type to search employees, contracts, payroll, and pages…</div>'
    : '<div class="gsearch-empty">No matches for “' + escapeHtml(result.query) + '”.</div>';
  __gsearch.list.innerHTML = flat.length ? html : empty;
  __gsearch.input.setAttribute('aria-activedescendant', flat.length ? ('gsearch-opt-0') : '');
  const live = __gsearch.overlay.querySelector('.gsearch-count');
  if(live) live.textContent = flat.length ? (flat.length + ' result' + (flat.length===1?'':'s')) : (result.query ? 'No results' : '');
  highlightGlobalSearchActive();
}

function highlightGlobalSearchActive(){
  if(!__gsearch) return;
  const items = __gsearch.list.querySelectorAll('.gsearch-item');
  items.forEach((el, i) => {
    const on = i === __gsearch.active;
    el.classList.toggle('active', on);
    if(on){ el.setAttribute('aria-selected','true'); __gsearch.input.setAttribute('aria-activedescendant', el.id); el.scrollIntoView({block:'nearest'}); }
    else el.removeAttribute('aria-selected');
  });
}

function moveGlobalSearchActive(delta){
  if(!__gsearch || !__gsearch.results.length) return;
  const n = __gsearch.results.length;
  __gsearch.active = (__gsearch.active + delta + n) % n;
  highlightGlobalSearchActive();
}

// Activation — NAVIGATION ONLY. hrNavTo is the sole effect.
function activateGlobalSearchResult(idx){
  if(!__gsearch) return;
  const doc = __gsearch.results[idx];
  if(!doc || !doc.to) return;
  closeGlobalSearch();
  hrNavTo(doc.to, doc.context || undefined);
}

function runGlobalSearchQuery(){
  if(!__gsearch) return;
  // Documents are collected ONCE per open (see openGlobalSearch); re-query re-ranks
  // the cached document set.
  const res = searchGlobal(__gsearch.input.value, __gsearch.docs, {});
  renderGlobalSearchResults(res);
}

function openGlobalSearch(){
  if(__gsearch){ __gsearch.input.focus(); __gsearch.input.select(); return; }
  const returnFocus = document.activeElement;
  /* SCOPE SEAM (Readiness-1 — now wired). The search ENGINE stays source-agnostic and
     is not a policy engine: it only ever ranks the documents it is handed. Scope is
     applied here, at the document-collection input, exactly as the seam was designed:

         raw State -> scoped source records -> search documents -> engine

     CEO is handed the company-wide sets (unchanged). An Employee is handed only their
     own records, so foreign employees, contracts and payroll can never be indexed —
     and therefore can never be returned or navigated to from a result. With no
     principal selected the scoped sets are empty and only navigation documents remain,
     which is the correct fail-closed reading of "not a CEO". */
  const scoped = (typeof getScopedRecords === 'function')
    ? { employees: getScopedRecords('employee'), contracts: getScopedRecords('contract'), payrollPlans: getScopedRecords('payrollPlan') }
    : { employees: State.employees || [], contracts: State.contracts || [], payrollPlans: State.payrollPlans || [] };
  const docs = collectGlobalSearchDocuments({
    navGroups: (typeof NAV_GROUPS !== 'undefined') ? NAV_GROUPS : [],
    pageTitles: (typeof PAGE_TITLES !== 'undefined') ? PAGE_TITLES : {},
    employees: scoped.employees,
    contracts: scoped.contracts,
    payrollPlans: scoped.payrollPlans
  });
  const overlay = document.createElement('div');
  overlay.className = 'gsearch-overlay';
  overlay.innerHTML =
    '<div class="gsearch-box" role="dialog" aria-modal="true" aria-label="Global search">'
    + '<input class="gsearch-input input" type="text" role="combobox" aria-expanded="true" aria-controls="gsearch-list" aria-autocomplete="list" aria-label="Search employees, contracts, payroll, and pages" placeholder="Search employees, contracts, payroll, pages…" autocomplete="off">'
    + '<div class="gsearch-count" aria-live="polite"></div>'
    + '<div class="gsearch-results" id="gsearch-list" role="listbox" aria-label="Search results"></div>'
    + '</div>';
  document.body.appendChild(overlay);
  const input = overlay.querySelector('.gsearch-input');
  const list = overlay.querySelector('.gsearch-results');
  __gsearch = { overlay, input, list, docs, results: [], active: -1, returnFocus };

  const deb = (typeof debounce === 'function') ? debounce(runGlobalSearchQuery, 150) : runGlobalSearchQuery;
  input.addEventListener('input', deb);
  // Overlay-scoped key handling (does not disturb global listeners).
  overlay.addEventListener('keydown', (e) => {
    if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); closeGlobalSearch(); }
    else if(e.key === 'ArrowDown'){ e.preventDefault(); moveGlobalSearchActive(1); }
    else if(e.key === 'ArrowUp'){ e.preventDefault(); moveGlobalSearchActive(-1); }
    else if(e.key === 'Enter'){ e.preventDefault(); if(__gsearch.active >= 0) activateGlobalSearchResult(__gsearch.active); }
  });
  overlay.addEventListener('click', (e) => {
    if(e.target === overlay){ closeGlobalSearch(); return; }         // backdrop click closes
    const item = e.target.closest('.gsearch-item');
    if(item){ activateGlobalSearchResult(parseInt(item.dataset.gsIndex, 10)); }
  });
  runGlobalSearchQuery();   // initial (empty-query) state
  input.focus();
}

function closeGlobalSearch(){
  const s = __gsearch; if(!s) return; __gsearch = null;
  if(s.overlay && s.overlay.parentNode) s.overlay.parentNode.removeChild(s.overlay);
  const ret = s.returnFocus;
  if(ret && ret !== document.body && typeof ret.focus === 'function' && document.contains(ret)) ret.focus();
}

// Global Ctrl/Cmd+K binding (capture phase). Bound ONCE. Does not fire while the
// mobile drawer focus-trap is active, so it never conflicts with that trap.
function bindGlobalSearchShortcut(){
  if(bindGlobalSearchShortcut._bound) return; bindGlobalSearchShortcut._bound = true;
  document.addEventListener('keydown', (e) => {
    if((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')){
      if(typeof State !== 'undefined' && State.sidebarDrawerOpen) return; // don't fight the drawer trap
      e.preventDefault();
      if(globalSearchIsOpen()) __gsearch.input.focus(); else openGlobalSearch();
    }
  }, true);
}
bindGlobalSearchShortcut();
