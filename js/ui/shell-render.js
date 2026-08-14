/* ============================================================
   RENDER — app shell
   ============================================================ */
/* v2.6.3b — shared FLOATING Actions menu (finance + HR menus).
   The dropdown is portaled out of the scrolling table container into #menu-root
   and positioned with position:fixed via getBoundingClientRect(), so it is never
   clipped by a table's overflow. It auto-flips up/down, closes on outside click
   and Escape, and repositions on window resize/scroll. One menu is open at a time.
   Both bindHRActions and bindActionMenus use openFloatingMenu/closeFloatingMenu. */
let __floatMenu = null; // { menu, placeholder, toggle, onDoc, onKey, onReposition, onItem }
function isFloatingMenuOpenFor(toggle){ return !!(__floatMenu && __floatMenu.toggle===toggle); }
function positionFloatingMenu(toggle, menu){
  const b = toggle.getBoundingClientRect();
  const mh = menu.offsetHeight || 0, mw = menu.offsetWidth || 0;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const spaceBelow = vh - b.bottom;
  const flipUp = spaceBelow < mh + 8 && b.top > spaceBelow; // not enough room below and more room above
  let top = flipUp ? (b.top - mh - 4) : (b.bottom + 4);
  top = Math.max(8, Math.min(top, vh - mh - 8));
  let left = b.right - mw;                 // right-aligned to the toggle
  left = Math.max(8, Math.min(left, vw - mw - 8));
  menu.style.top = top + 'px'; menu.style.left = left + 'px'; menu.style.right = 'auto'; menu.style.bottom = 'auto';
  menu.classList.toggle('up', flipUp);
}
function closeFloatingMenu(){
  const s = __floatMenu; if(!s) return; __floatMenu = null;
  document.removeEventListener('click', s.onDoc, true);
  document.removeEventListener('keydown', s.onKey, true);
  window.removeEventListener('resize', s.onReposition, true);
  window.removeEventListener('scroll', s.onReposition, true);
  s.menu.removeEventListener('click', s.onItem, true);
  s.menu.style.display = 'none';
  s.menu.classList.remove('floating','up');
  s.menu.style.position=''; s.menu.style.top=''; s.menu.style.left=''; s.menu.style.right=''; s.menu.style.bottom='';
  // Restore the menu to its original spot if that spot still exists; otherwise drop it
  // (the table was re-rendered by the action, so a fresh menu already exists).
  if(s.placeholder && s.placeholder.parentNode){ s.placeholder.parentNode.replaceChild(s.menu, s.placeholder); }
  else if(s.menu.parentNode){ s.menu.parentNode.removeChild(s.menu); }
}
function openFloatingMenu(toggle, menu){
  closeFloatingMenu();
  const root = document.getElementById('menu-root') || document.body;
  const placeholder = document.createComment('actions-menu');
  if(menu.parentNode) menu.parentNode.replaceChild(placeholder, menu);
  root.appendChild(menu);
  menu.classList.add('floating');
  menu.style.position = 'fixed';
  menu.style.display = 'block';
  positionFloatingMenu(toggle, menu); // measure + place after it is visible
  const onDoc = (e)=>{ if(!menu.contains(e.target) && toggle!==e.target && !toggle.contains(e.target)) closeFloatingMenu(); };
  const onKey = (e)=>{ if(e.key==='Escape'){ e.stopPropagation(); closeFloatingMenu(); } };
  const onReposition = ()=>{ if(__floatMenu) positionFloatingMenu(toggle, menu); };
  // An item click performs its own action (often re-rendering the table); close after it.
  // Capture phase so it still fires even though item handlers call e.stopPropagation().
  const onItem = (e)=>{ if(e.target.closest('.actions-item,[data-hr-action],[data-action]')) setTimeout(closeFloatingMenu, 0); };
  menu.addEventListener('click', onItem, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onReposition, true);
  window.addEventListener('scroll', onReposition, true);
  // Defer the outside-click closer so the opening click doesn't immediately close it.
  setTimeout(()=>{ if(__floatMenu && __floatMenu.onDoc===onDoc) document.addEventListener('click', onDoc, true); }, 0);
  __floatMenu = { menu, placeholder, toggle, onDoc, onKey, onReposition, onItem };
}
/* ============================================================
   FEATURE LIFECYCLE REGISTRY (v2.7.0)
   One centralized source for feature status + sidebar badges. Replaces the
   previously hardcoded "Preview" badge string. Stable features render no badge.
   ============================================================ */
const FEATURE_STATUS = { STABLE:'stable', BETA:'beta', PREVIEW:'preview', COMING_SOON:'comingSoon' };
const FEATURE_BADGE_TEXT = { stable:'', beta:'BETA', preview:'PREVIEW', comingSoon:'Soon' }; // UX-004F: quieter "Soon" (was heavy "SOON")
const FEATURE_REGISTRY = {
  recurring: { status:'stable',     label:'Recurring Expenses', tooltip:'' },
  projects:  { status:'comingSoon', label:'Projects',           tooltip:'Projects is planned and not yet available.' },
  vendors:   { status:'comingSoon', label:'Vendors',            tooltip:'Vendor management is planned and not yet available.' },
  calendar:  { status:'comingSoon', label:'Financial Calendar', tooltip:'The financial calendar is planned and not yet available.' },
};
function featureStatusOf(id){ const f=FEATURE_REGISTRY[id]; return f?f.status:'stable'; }
function featureIsComingSoon(id){ return featureStatusOf(id)==='comingSoon'; }
// Shared badge renderer — stable features render nothing; others get an accessible badge.
function featureBadgeHTML(id){
  const f = FEATURE_REGISTRY[id]; if(!f) return '';
  const txt = FEATURE_BADGE_TEXT[f.status]; if(!txt) return '';
  return `<span class="nav-preview-tag" title="${escapeHtml(f.tooltip||txt)}">${txt}</span>`;
}
// UX-004C — DOMAIN REGROUPING. Exactly five top-level groups in the approved
// order: Dashboard, People, Finance, Analytics, System — business domains, not
// implementation history. Every item is an EXISTING view; ids, labels, icons and
// placeholder flags are unchanged — only group membership and order changed. The
// UX-004B manifest keeps working automatically: NAV_VIEW_OWNER maps context routes
// to their owning item, and navItemGroup() derives each group from THIS structure,
// so hierarchical active-state follows the regrouping with no per-view logic.
const NAV_GROUPS = [
  {id:'dashboard', label:'Dashboard', items:[
    {id:'execDashboard', label:'Executive Dashboard', ic:'◆'},
    {id:'execinsights', label:'Executive Insights', ic:'✦'},
  ]},
  {id:'people', label:'People', items:[
    {id:'employees', label:'Employees', ic:'☺'},
    {id:'contracts', label:'Contracts', ic:'▦'},
  ]},
  // UX-004F — NAVIGATION SIMPLIFICATION. Finance shows four PRIMARY items; every
  // other Finance destination is disclosed under "More" (more:true). This is
  // presentation only — ids, routes, views and behaviour are unchanged; only labels
  // and the primary/secondary split changed. Labels are simplified (Finance Overview
  // -> Overview, Monthly Plan Generator -> Planning, Supplemental Payments ->
  // Supplements, Add / Upload -> Import, Execution Center -> Execution, Recurring
  // Expenses -> Recurring, Payroll Workspace -> Payroll).
  {id:'finance', label:'Finance', items:[
    {id:'financeOverview', label:'Overview', ic:'▣'},
    {id:'payroll', label:'Payroll', ic:'৳'},
    {id:'transactions', label:'Transactions', ic:'≡'},
    {id:'monthlyplan', label:'Planning', ic:'⊞'},
    {id:'overtime', label:'Overtime', ic:'⏱', more:true},
    {id:'supplementals', label:'Supplements', ic:'⊕', more:true},
    {id:'add', label:'Import', ic:'+', more:true},
    {id:'recurring', label:'Recurring', ic:'↻', more:true},
    {id:'cashflow', label:'Cash Flow', ic:'∼', more:true},
    {id:'budgetcenter', label:'Budget Center', ic:'▥', more:true},
    {id:'executioncenter', label:'Execution', ic:'⚡︎', more:true}, // v2.6.3c — VS-15 forces monochrome text (was a colored emoji that stood out)
    {id:'bankaccounts', label:'Bank Accounts', ic:'▦', more:true},
    {id:'projects', label:'Projects', ic:'▢', placeholder:true, more:true},
    {id:'vendors', label:'Vendors', ic:'▢', placeholder:true, more:true},
    {id:'calendar', label:'Financial Calendar', ic:'▢', placeholder:true, more:true},
  ]},
  {id:'analytics', label:'Analytics', items:[
    {id:'planvsactual', label:'Planned vs Actual', ic:'⇄'},
    {id:'compare', label:'Compare Months', ic:'⧉'},
    {id:'trends', label:'Monthly Trends', ic:'∿'},
    {id:'reports', label:'Reports', ic:'▤'},
  ]},
  {id:'system', label:'System', items:[
    {id:'settings', label:'Settings', ic:'⚙'},
    {id:'activity', label:'Activity Log', ic:'☰'},
    {id:'about', label:'About', ic:'ℹ'},
    {id:'releasenotes', label:'Release Notes', ic:'✎'},
  ]},
];
const PAGE_TITLES = Object.fromEntries(NAV_GROUPS.flatMap(g=>g.items).map(i=>[i.id,i.label]));

/* ============================================================
   UX-004B — CANONICAL NAVIGATION MANIFEST
   The single source of truth mapping every renderView() route that is NOT
   itself a sidebar item (context-only detail, wizard and drill-down views)
   to the sidebar nav ITEM that owns it. Direct sidebar views own themselves
   and need no entry. The owning GROUP is never hardcoded here — it is derived
   from NAV_GROUPS, so ownership follows automatically when UX-004C regroups.

   This replaces scattered exact-match (State.view===id) active-state logic:
   active state now resolves hierarchically through this one manifest, so a
   detail page keeps its parent sidebar item highlighted and its group open.
   ============================================================ */
const NAV_VIEW_OWNER = {
  // People drill-downs -> their parent sidebar item
  employeeDetail:     'employees',
  employeeDedup:      'employees',
  contractDetail:     'contracts',
  payrollDetail:      'payroll',
  payrollAdjustments: 'payroll',
  overtimeSheet:      'overtime',
  supplementalDetail: 'supplementals',
  legacyMap:          'payroll',
  // Finance ingestion flow -> Add / Upload
  smartImport:        'add',
  importResults:      'add',
};
// The nav item that should carry active state for the current view: a context-only
// view resolves to its parent item; a direct sidebar view owns itself.
function navOwnerItem(view){ return NAV_VIEW_OWNER[view] || view; }
// The group that contains a given nav item, derived from NAV_GROUPS (single source
// of truth). Returns null if the id is not a sidebar item.
function navItemGroup(itemId){
  for(const g of NAV_GROUPS){ if(g.items.some(i=>i.id===itemId)) return g.id; }
  return null;
}
// The one nav item + owning group that receive active state for the current view.
// Every consumer (mount markup and in-place sync) resolves through this, so exactly
// one path decides "you are here" regardless of which navigation API was used.
function navActive(){ const item = navOwnerItem(State.view); return { item: item, group: navItemGroup(item) }; }

function captureSidebarScroll(){
  const nav = document.querySelector('.nav');
  if(nav) State.sidebarScrollTop = nav.scrollTop;
}
function restoreSidebarScroll(){
  const raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : (fn)=>setTimeout(fn, 0);
  raf(()=>{
    const nav = document.querySelector('.nav');
    if(nav) nav.scrollTop = State.sidebarScrollTop || 0;
  });
}
/* ============================================================
   SHELL / VIEW SEPARATION (UX-002A)
   The shell — sidebar, brand, nav tree and the #main container — is mounted
   ONCE by renderShell() and then persists for the life of the session.
   Ordinary navigation replaces only the #main content (renderView) and syncs
   the nav's derived state in place (syncShellState): active item, group
   collapse, chevron, aria-expanded and the brand subtitle. The sidebar, the
   nav tree and their listeners are no longer torn down and rebuilt.

   render() is retained as the compatibility facade so every existing caller
   keeps working unchanged; its observable result is identical to before.
   #menu-root, #modal-root and #toast-root are siblings of #app and were never
   inside the rebuilt subtree — they are unaffected, before and after.
   ============================================================ */
function shellIsMounted(){
  const app = document.getElementById('app');
  return !!(app && app.querySelector('.sidebar') && app.querySelector('#main'));
}
// One nav item button. Extracted so primary and "More" items share identical markup.
function navItemHTML(n, activeItem){
  const on = n.id===activeItem;
  return `<button class="nav-item ${on?'active':''}" data-nav="${n.id}"${on?' aria-current="page"':''} title="${escapeHtml(n.label)}">
                <span class="ic" aria-hidden="true">${n.ic}</span><span class="nav-label">${escapeHtml(n.label)}</span>${featureBadgeHTML(n.id)}
              </button>`;
}
// UX-004F — the "More" disclosure is open when the user opened it OR the active view
// lives inside it (so the highlighted item is never hidden). Derived, not stored.
function navMoreOpen(g, activeItem){
  const moreItems = g.items.filter(i=>i.more);
  if(!moreItems.length) return false;
  if(moreItems.some(i=>i.id===activeItem)) return true;   // active item forces it open
  return !!State.navMore[g.id];
}
// One nav group's markup. Finance splits into PRIMARY items plus a "More" disclosure
// holding every more:true item; other groups render every item as before.
function navGroupHTML(g){
  const active = navActive();
  // The active group is always shown expanded while one of its descendant views
  // is active, so the highlighted item is never hidden inside a collapsed group.
  const collapsed = !!State.navCollapsed[g.id] && g.id !== active.group;
  const primary = g.items.filter(i=>!i.more);
  const moreItems = g.items.filter(i=>i.more);
  const moreOpen = navMoreOpen(g, active.item);
  const moreHTML = moreItems.length ? `
              <button class="nav-item nav-more-head" data-more="${g.id}" aria-expanded="${moreOpen}" title="More">
                <span class="ic" aria-hidden="true">⋯</span><span class="nav-label">More</span><span class="chev" aria-hidden="true">${moreOpen?'▾':'▸'}</span>
              </button>
              <div class="nav-more-items" style="${moreOpen?'':'display:none;'}">
                ${moreItems.map(n=>navItemHTML(n, active.item)).join('')}
              </div>` : '';
  return `<div class="nav-group">
            <button class="nav-group-head" data-group="${g.id}" aria-expanded="${!collapsed}">
              <span>${escapeHtml(g.label)}</span><span class="chev" aria-hidden="true">${collapsed?'▸':'▾'}</span>
            </button>
            <div class="nav-group-items" style="${collapsed?'display:none;':''}">
              ${primary.map(n=>navItemHTML(n, active.item)).join('')}${moreHTML}
            </div>
          </div>`;
}
// Mounts the persistent shell. Called once (first render), and again only if
// the shell is somehow absent — it is never part of ordinary navigation.
function renderShell(){
  const app = document.getElementById('app');
  app.innerHTML = `
    <a class="skip-link" href="#main" id="skipLink">Skip to main content</a>
    <button class="nav-hamburger" id="navHamburger" type="button" aria-label="Open navigation" aria-controls="sidebar" aria-expanded="false"><span class="hbars" aria-hidden="true">☰</span></button>
    <div class="sidebar-backdrop" id="sidebarBackdrop" hidden></div>
    <div class="sidebar" id="sidebar">
      <div class="brand">
        <div class="brand-lockup">
          <img class="brand-monogram" src="${BRAND_MONOGRAM}" alt="" aria-hidden="true" width="34" height="34" draggable="false">
          <div class="mark">TAM&nbsp;<span class="os">OS</span></div>
        </div>
        <button class="sidebar-collapse-btn" id="sidebarCollapseBtn" type="button" aria-label="Collapse sidebar" aria-expanded="true" title="Collapse sidebar"><span class="cbar" aria-hidden="true">«</span></button>
        ${typeof renderIdentitySelectorHTML==='function'?renderIdentitySelectorHTML():''}
      </div>
      <nav class="nav" aria-label="Primary navigation">
        ${NAV_GROUPS.map(navGroupHTML).join('')}
      </nav>
      <div class="sidebar-foot">${escapeHtml(APP_NAME)} v${APP_VERSION}<br>${escapeHtml(APP_TAGLINE)}<br>Data stored privately in your browser.</div>
    </div>
    <main class="main" id="main" tabindex="-1"></main>
  `;
  bindShell(app);
  // UX-006D1 — bind the reachable principal selector once against the persistent
  // shell (mirrors the bind-once discipline of the nav listeners above).
  if(typeof bindIdentitySelector==='function') bindIdentitySelector(app);
  sidebarApplyState(); // apply session collapse/drawer state to the freshly mounted shell
}
// Shell listeners are bound once, against nodes that now outlive navigation.
function bindShell(app){
  // UX-005F (A1) — skip-to-content. The link is the first focusable shell node; on
  // activation it moves keyboard focus into the <main> landmark (tabindex="-1"), so
  // keyboard users bypass the persistent nav. The shell is never remounted.
  const skip = app.querySelector('#skipLink');
  if(skip){
    skip.addEventListener('click', (e)=>{
      e.preventDefault();
      const main = document.getElementById('main');
      if(main && typeof main.focus === 'function'){ try{ main.focus(); }catch(err){} }
    });
  }
  app.querySelectorAll('[data-nav]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.preventDefault();
      captureSidebarScroll();
      State.view = btn.dataset.nav; State.pendingImport=null;
      if(State.sidebarDrawerOpen) closeSidebarDrawer(); // a tap in the mobile drawer navigates then dismisses it
      render();
      btn.blur(); // unchanged: navigation leaves focus off the nav item, as before
    });
  });
  app.querySelectorAll('[data-group]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.preventDefault();
      const g=btn.dataset.group;
      // HOTFIX (UX-004 interaction regression): the active group is always kept
      // expanded (verifier-enforced invariant, syncShellState `!== active.group`).
      // Flipping its collapsed flag here changed nothing on screen yet silently armed
      // a surprising collapse the next time the user navigated away — the header felt
      // dead. When this header owns the active view, the toggle is a clean no-op so no
      // phantom state is stored. Non-active groups toggle exactly as before.
      if(g === navActive().group){ btn.blur(); return; }
      captureSidebarScroll();
      State.navCollapsed[g]=!State.navCollapsed[g];
      render();
      btn.blur();
    });
  });
  // UX-004F — the "More" disclosure toggle (session-only, progressive disclosure).
  app.querySelectorAll('[data-more]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.preventDefault();
      const g=btn.dataset.more, grp=NAV_GROUPS.find(x=>x.id===g);
      // HOTFIX (UX-004 interaction regression): when the active view lives inside More,
      // the disclosure is force-open (intended). Flipping navMore here was a hidden
      // no-op that surprised on the next navigation, so it is a clean no-op instead.
      if(grp && grp.items.some(i=>i.more && i.id===navActive().item)){ btn.blur(); return; }
      captureSidebarScroll();
      State.navMore[g]=!State.navMore[g];
      render();
      btn.blur();
    });
  });
  const navEl = app.querySelector('.nav');
  if(navEl) navEl.addEventListener('scroll', ()=>{ State.sidebarScrollTop = navEl.scrollTop; });
  // UX-004E — sidebar interaction listeners, bound ONCE against the persistent shell.
  const collapseBtn = app.querySelector('#sidebarCollapseBtn');
  if(collapseBtn) collapseBtn.addEventListener('click', (e)=>{ e.preventDefault(); toggleSidebarCollapsed(); });
  const hamburger = app.querySelector('#navHamburger');
  if(hamburger) hamburger.addEventListener('click', (e)=>{ e.preventDefault(); if(State.sidebarDrawerOpen) closeSidebarDrawer(); else openSidebarDrawer(); });
  const backdrop = app.querySelector('#sidebarBackdrop');
  if(backdrop) backdrop.addEventListener('click', ()=>closeSidebarDrawer());
  const sidebar = app.querySelector('.sidebar');
  // ESC closes the drawer; Tab is trapped inside the sidebar while the drawer is open.
  if(sidebar) sidebar.addEventListener('keydown', (e)=>{
    if(!State.sidebarDrawerOpen) return;
    if(e.key==='Escape'){ e.preventDefault(); closeSidebarDrawer(); return; }
    if(e.key==='Tab'){
      const f = sidebarFocusables(sidebar); if(!f.length) return;
      const first=f[0], last=f[f.length-1];
      if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
    }
  });
  // A viewport change (e.g. mobile -> desktop) re-asserts state and dismisses a dangling drawer.
  if(typeof matchMedia === 'function'){
    const mq = matchMedia('(max-width:768px)');
    const onMq = ()=>{ if(!sidebarIsDrawerMode() && State.sidebarDrawerOpen){ closeSidebarDrawer(); } else { sidebarApplyState(); } };
    if(mq.addEventListener) mq.addEventListener('change', onMq); else if(mq.addListener) mq.addListener(onMq);
  }
}
// Reapplies to the persistent shell exactly the derived state that the old full
// rebuild used to re-emit from scratch. Same inputs, same resulting DOM.
function syncShellState(){
  const app = document.getElementById('app');
  if(!app) return;
  const sub = app.querySelector('.brand .sub');
  const company = State.settings.companyName||COMPANY_NAME_DEFAULT;
  if(sub && sub.textContent !== company) sub.textContent = company;
  // UX-004B — hierarchical active state resolved through the one navigation manifest,
  // not exact State.view equality: exactly one item is active (the current view or its
  // parent), and it alone carries aria-current="page".
  const active = navActive();
  app.querySelectorAll('[data-nav]').forEach(btn=>{
    const on = btn.dataset.nav === active.item;
    btn.classList.toggle('active', on);
    if(on){ if(btn.getAttribute('aria-current') !== 'page') btn.setAttribute('aria-current','page'); }
    else if(btn.hasAttribute('aria-current')) btn.removeAttribute('aria-current');
  });
  app.querySelectorAll('[data-group]').forEach(head=>{
    // The active group is always shown expanded while one of its descendants is active.
    const collapsed = !!State.navCollapsed[head.dataset.group] && head.dataset.group !== active.group;
    const expanded = String(!collapsed);
    // Write only on change: an unconditional assignment would replace the chevron's
    // text node on every navigation, churning the nav subtree we just stopped rebuilding.
    if(head.getAttribute('aria-expanded') !== expanded) head.setAttribute('aria-expanded', expanded);
    const chev = head.querySelector('.chev');
    const glyph = collapsed?'▸':'▾';
    if(chev && chev.textContent !== glyph) chev.textContent = glyph;
    const items = head.parentNode.querySelector('.nav-group-items');
    const disp = collapsed?'none':'';
    if(items && items.style.display !== disp) items.style.display = disp;
  });
  // UX-004F — sync each "More" disclosure in place (open when toggled OR the active
  // view is inside it), mirroring the group-collapse sync above so no shell remount.
  app.querySelectorAll('[data-more]').forEach(head=>{
    const g = NAV_GROUPS.find(x=>x.id===head.dataset.more);
    const open = g ? navMoreOpen(g, active.item) : false;
    const expanded = String(open);
    if(head.getAttribute('aria-expanded') !== expanded) head.setAttribute('aria-expanded', expanded);
    const chev = head.querySelector('.chev');
    const glyph = open?'▾':'▸';
    if(chev && chev.textContent !== glyph) chev.textContent = glyph;
    const box = head.parentNode.querySelector('.nav-more-items');
    const disp = open?'':'none';
    if(box && box.style.display !== disp) box.style.display = disp;
  });
  // UX-004E — re-assert sidebar collapse/drawer state after each in-place sync, so
  // the session interaction state survives navigation without a shell remount.
  sidebarApplyState();
  // UX-006D1 — keep the "Acting as" selector consistent with getCurrentUser()
  // after each in-place sync, without rebuilding the shell.
  if(typeof syncIdentitySelector==='function') syncIdentitySelector();
}
/* ============================================================
   UX-004E — SIDEBAR INTERACTION (collapse, pin, hover-expand, responsive drawer)
   INTERACTION ONLY. Every behaviour toggles classes / aria attributes on the
   ALREADY-MOUNTED persistent shell nodes — it never remounts the shell, never
   changes node identity, and never touches active-state, breadcrumb or Quick Action
   logic. All state is SESSION-ONLY on State (sidebarCollapsed / sidebarPinned /
   sidebarDrawerOpen): no storage key, no persistence, no schema. Hover-expand is
   pure CSS (desktop only). The drawer is width-driven CSS; JS only toggles the
   open class, manages the focus trap, ESC/backdrop close, and focus restoration.
   ============================================================ */
// Drawer mode = tablet/mobile widths, where the sidebar is an off-canvas overlay.
function sidebarIsDrawerMode(){
  return typeof matchMedia === 'function' ? matchMedia('(max-width:768px)').matches : false;
}
// Re-assert the current session state onto the persistent nodes. Idempotent and
// cheap; safe to call after mount and on every navigation sync.
function sidebarApplyState(){
  const app = document.getElementById('app'); if(!app) return;
  const sidebar = app.querySelector('.sidebar');
  const drawer  = sidebarIsDrawerMode();
  const collapsed = !drawer && !!State.sidebarCollapsed; // collapse is a desktop-only rail
  if(sidebar){
    sidebar.classList.toggle('collapsed', collapsed);
    // In drawer mode the sidebar is hidden off-canvas unless the drawer is open.
    const hidden = drawer && !State.sidebarDrawerOpen;
    if(hidden){ sidebar.setAttribute('aria-hidden','true'); }
    else if(sidebar.hasAttribute('aria-hidden')){ sidebar.removeAttribute('aria-hidden'); }
  }
  app.classList.toggle('drawer-open', drawer && !!State.sidebarDrawerOpen);
  const back = app.querySelector('#sidebarBackdrop');
  if(back){ const show = drawer && !!State.sidebarDrawerOpen; if(show){ back.hidden = false; } else { back.hidden = true; } }
  const cbtn = app.querySelector('#sidebarCollapseBtn');
  if(cbtn){
    cbtn.setAttribute('aria-expanded', String(!collapsed));
    cbtn.setAttribute('aria-label', collapsed?'Expand sidebar':'Collapse sidebar');
    cbtn.setAttribute('title', collapsed?'Expand sidebar':'Collapse sidebar');
    const bar = cbtn.querySelector('.cbar'); if(bar){ const g = collapsed?'»':'«'; if(bar.textContent!==g) bar.textContent=g; }
  }
  const ham = app.querySelector('#navHamburger');
  if(ham) ham.setAttribute('aria-expanded', String(drawer && !!State.sidebarDrawerOpen));
}
// Collapse / expand the desktop rail. This IS the session pin — the chosen state is
// remembered for the session (in memory) and never persisted.
function setSidebarCollapsed(collapsed){
  State.sidebarCollapsed = !!collapsed;
  State.sidebarPinned = collapsed ? 'collapsed' : 'expanded'; // session-only pin, never stored
  sidebarApplyState();
}
function toggleSidebarCollapsed(){ setSidebarCollapsed(!State.sidebarCollapsed); }
// Focus trap for the open mobile drawer: Tab cycles within the sidebar; nothing
// outside it receives focus while the overlay is up.
function sidebarFocusables(sidebar){
  return Array.from(sidebar.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
    .filter(el=>!el.disabled && el.offsetParent !== null);
}
function openSidebarDrawer(){
  if(!sidebarIsDrawerMode()) return;
  State._sidebarFocusReturn = document.activeElement; // restore here on close
  State.sidebarDrawerOpen = true;
  sidebarApplyState();
  const app = document.getElementById('app'); const sidebar = app && app.querySelector('.sidebar');
  const f = sidebar ? sidebarFocusables(sidebar) : [];
  if(f.length) f[0].focus();
}
function closeSidebarDrawer(){
  const wasOpen = !!State.sidebarDrawerOpen;
  State.sidebarDrawerOpen = false;
  sidebarApplyState();
  if(wasOpen){
    const ret = State._sidebarFocusReturn;
    const app = document.getElementById('app');
    const ham = app && app.querySelector('#navHamburger');
    // Restore to where focus was before opening; if that was nowhere meaningful
    // (body/detached), fall back to the control that opened the drawer.
    const retOk = ret && ret !== document.body && typeof ret.focus==='function' && document.contains(ret);
    const target = retOk ? ret : ham;
    if(target && typeof target.focus==='function') target.focus();
    State._sidebarFocusReturn = null;
  }
}
/* Compatibility facade — the entry point every existing caller already uses.
   Mounts the shell on first use, then only syncs it and replaces the view. */
function render(){
  closeFloatingMenu();    // v2.6.3b — never leave a portaled Actions menu orphaned across a re-render
  captureSidebarScroll(); // preserved: keeps State.sidebarScrollTop the authority for nav scroll
  if(!shellIsMounted()) renderShell();
  syncShellState();
  restoreSidebarScroll();
  renderView(document.getElementById('main'));
}

const PLACEHOLDER_IDS = new Set(NAV_GROUPS.flatMap(g=>g.items).filter(i=>i.placeholder).map(i=>i.id));

function renderView(main){
  renderViewContent(main);
  // UX-004D — centralized, single-landmark breadcrumb + context Quick Actions,
  // mounted AFTER the view content so they attach to the freshly rendered page-head.
  mountBreadcrumb(main);
  mountQuickActions(main);
}
function renderViewContent(main){
  if(PLACEHOLDER_IDS.has(State.view)) return renderPlaceholderPage(main, State.view);
  if(State.view==='execDashboard') return renderExecutiveDashboard(main);
  if(State.view==='financeOverview') return renderDashboard(main);
  if(State.view==='executioncenter') return renderExecutionCenter(main);
  if(State.view==='transactions') return renderTransactions(main);
  if(State.view==='add') return renderAdd(main);
  if(State.view==='smartImport') return renderSmartImport(main);
  if(State.view==='importResults') return renderImportResults(main);
  if(State.view==='cashflow') return renderCashFlow(main);
  if(State.view==='budgetcenter') return renderBudgetCenter(main);
  if(State.view==='planvsactual') return renderPlanVsActual(main);
  if(State.view==='compare') return renderCompare(main);
  if(State.view==='trends') return renderTrends(main);
  if(State.view==='execinsights') return renderExecutiveInsights(main);
  if(State.view==='employees') return renderEmployees(main);
  if(State.view==='employeeDedup') return renderEmployeeDedup(main);
  if(State.view==='employeeDetail') return renderEmployeeDetail(main);
  if(State.view==='contracts') return renderContracts(main);
  if(State.view==='contractDetail') return renderContractDetail(main);
  if(State.view==='payroll') return renderPayrollWorkspace(main);
  if(State.view==='payrollDetail') return renderPayrollDetail(main);
  if(State.view==='payrollAdjustments') return renderPayrollAdjustments(main);
  if(State.view==='overtime') return renderOvertime(main);
  if(State.view==='overtimeSheet') return renderOvertimeWorksheet(main);
  if(State.view==='supplementals') return renderSupplementalPayments(main);
  if(State.view==='supplementalDetail') return renderSupplementalDetail(main);
  if(State.view==='monthlyplan') return renderMonthlyPlanGenerator(main);
  if(State.view==='recurring') return renderRecurringExpenses(main);
  if(State.view==='legacyMap') return renderLegacyPayrollMapping(main);
  if(State.view==='reports') return renderReports(main);
  if(State.view==='activity') return renderActivityLog(main);
  if(State.view==='settings') return renderSettings(main);
  if(State.view==='bankaccounts') return renderBankAccounts(main);
  if(State.view==='about') return renderAbout(main);
  if(State.view==='releasenotes') return renderReleaseNotes(main);
  return renderExecutiveDashboard(main);
}
/* ============================================================
   UX-004D — BREADCRUMBS (derived from the canonical navigation architecture)
   Breadcrumbs are NOT a second route hierarchy. Every trail is computed from the
   SAME sources that drive the sidebar: navOwnerItem() (NAV_VIEW_OWNER) resolves the
   owning sidebar item, navItemGroup() (NAV_GROUPS) resolves its domain, and
   PAGE_TITLES supplies canonical item labels. Conceptual shape: Domain / Item /
   Context. Domain crumbs are non-interactive (no dedicated domain landing page
   exists); the owning-item crumb links to its canonical view only when the current
   view is a deeper context; the terminal crumb is the current page (aria-current).
   ============================================================ */
const NAV_GROUP_LABELS = Object.fromEntries(NAV_GROUPS.map(g=>[g.id,g.label]));
// Terminal (context) label for a drill-down view. Entity-aware where reliable
// runtime context already exists — read SYNCHRONOUSLY from the already-selected id,
// never a new fetch and never async — otherwise a stable generic label. Internal
// ids are never exposed: a human label (name / contract number) or a generic falls
// back in their place.
function breadcrumbTerminalLabel(view){
  switch(view){
    /* Readiness-1 — the breadcrumb is a READ of the record it names. Resolving it with
       the unscoped empById/contractById/payrollPlanById printed a foreign employee's NAME
       above a correctly-blocked detail page, which leaked exactly what the page refused
       to render. Out of scope now falls back to the generic label. */
    case 'employeeDetail':     { const e = (typeof getScopedRecordById==='function') ? getScopedRecordById('employee', State.detailEmpId) : null; return (e && e.fullName) || 'Employee Detail'; }
    case 'contractDetail':     { const c = (typeof getScopedRecordById==='function') ? getScopedRecordById('contract', State.detailContractId) : null; return (c && c.contractNumber) || 'Contract Detail'; }
    case 'payrollDetail':      { const p = (typeof getScopedRecordById==='function') ? getScopedRecordById('payrollPlan', State.detailPayrollId) : null; return (p && p.employeeName) || 'Payroll Detail'; }
    case 'supplementalDetail': return 'Supplemental Detail';
    case 'payrollAdjustments': return 'Payroll Adjustments';
    case 'overtimeSheet':      return 'Overtime Sheet';
    case 'employeeDedup':      return 'Duplicate Review';
    case 'legacyMap':          return 'Legacy Mapping';
    case 'smartImport':        return 'Smart Import';
    case 'importResults':      return 'Import Results';
    default:                   return PAGE_TITLES[view] || view;
  }
}
// The trail, derived entirely from the canonical nav data. Returns
// [{label, view|null, current}]. view!==null means the crumb navigates to that
// existing sidebar view; current marks the terminal (present) page.
function breadcrumbTrail(view){
  const ownerId = navOwnerItem(view);      // sidebar item that owns this view (NAV_VIEW_OWNER)
  const groupId = navItemGroup(ownerId);   // its domain (NAV_GROUPS) — single source of truth
  const isContext = view !== ownerId;      // a context-only drill-down (owner differs)
  const trail = [];
  // Domain: no dedicated per-domain landing page exists, so it is non-interactive text.
  if(groupId) trail.push({ label: NAV_GROUP_LABELS[groupId] || groupId, view: null, current: false });
  // Owning nav item: links to its canonical view when we are deeper; else it is current.
  trail.push({ label: PAGE_TITLES[ownerId] || ownerId, view: isContext ? ownerId : null, current: !isContext });
  // Terminal context/detail crumb (present page).
  if(isContext) trail.push({ label: breadcrumbTerminalLabel(view), view: null, current: true });
  return trail;
}
function breadcrumbHTML(view){
  const trail = breadcrumbTrail(view);
  if(!trail.length) return '';
  const items = trail.map((c,i)=>{
    const sep = i>0 ? '<span class="crumb-sep" aria-hidden="true">/</span>' : '';
    const inner = c.view
      ? `<button type="button" class="crumb-link" data-crumb-nav="${c.view}">${escapeHtml(c.label)}</button>`
      : `<span class="crumb-text"${c.current?' aria-current="page"':''}>${escapeHtml(c.label)}</span>`;
    return `${sep}<li class="crumb">${inner}</li>`;
  }).join('');
  // Exactly ONE Breadcrumb landmark per render; the sidebar keeps its own separate
  // Primary-navigation landmark and its own active item's aria-current="page".
  return `<nav class="breadcrumb" aria-label="Breadcrumb"><ol class="crumb-list">${items}</ol></nav>`;
}
function mountBreadcrumb(main){
  const html = breadcrumbHTML(State.view);
  if(!html) return;
  main.insertAdjacentHTML('afterbegin', html);
  main.querySelectorAll('[data-crumb-nav]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{ e.preventDefault(); hrNavTo(btn.dataset.crumbNav); });
  });
}
/* ============================================================
   UX-004D — CONTEXT-AWARE QUICK ACTIONS (one centralized manifest)
   NAVIGATION METADATA ONLY. Each action names a destination VIEW, an optional
   resolver returning the State context patch needed to open it, and an optional
   visibility predicate over existing derived state. No execution, approval, posting
   or persistence is expressible here — the only side effect any action can produce
   is hrNavTo(): set navigation/context state and change the view. Every destination
   is an EXISTING view where the existing controls, confirmations, permissions and
   audit behaviour remain authoritative. Execution-Center actions are worded as
   navigation ("Go to Execution Center"), never as "Execute".
   ============================================================ */
const QUICK_ACTIONS_BY_VIEW = {
  employeeDetail: [
    { label:'View Contract', to:'contractDetail',
      show:()=>!!activeContractToday(State.detailEmpId),
      resolve:()=>({ detailContractId: (activeContractToday(State.detailEmpId)||{}).id }) },
    { label:'Go to Payroll', to:'payroll' },
  ],
  contractDetail: [
    { label:'View Employee', to:'employeeDetail',
      show:()=>{ const c=contractById(State.detailContractId); return !!(c && empById(c.employeeId)); },
      resolve:()=>({ detailEmpId: (contractById(State.detailContractId)||{}).employeeId }) },
    { label:'Go to Payroll', to:'payroll' },
  ],
  payroll: [
    { label:'Go to Execution Center', to:'executioncenter',
      show:()=>State.payrollPlans.some(p=>{ const s=payrollStage(p); return s==='Posted' || s==='Executed'; }) },
  ],
  payrollDetail: [
    { label:'View Posted Transactions', to:'transactions',
      show:()=>!!payrollTxnOf(payrollPlanById(State.detailPayrollId)) },
    { label:'Go to Execution Center', to:'executioncenter',
      show:()=>{ const p=payrollPlanById(State.detailPayrollId); if(!p) return false; const s=payrollStage(p); return s==='Posted' || s==='Executed'; } },
  ],
  overtime: [
    { label:'Go to Payroll', to:'payroll' },
    { label:'Go to Execution Center', to:'executioncenter',
      show:()=>State.payrollPlans.some(p=>{ const s=payrollStage(p); return s==='Posted' || s==='Executed'; }) },
  ],
  executioncenter: [
    { label:'View Posted Transactions', to:'transactions' },
    { label:'Go to Payroll', to:'payroll' },
    { label:'Go to Overtime', to:'overtime' },
  ],
};
// Visible actions for a view — visibility derives from existing state at render time
// and is never persisted. A throwing predicate hides its action (fail-safe).
function quickActionsFor(view){
  const defs = QUICK_ACTIONS_BY_VIEW[view];
  if(!defs) return [];
  return defs.filter(a=>{ try{ return a.show ? !!a.show() : true; }catch(e){ return false; } });
}
// Quick Actions live in the existing page-header .head-controls slot — native to the
// workspace header, no floating button, palette or second toolbar. hrNavTo() is the
// ONLY effect: navigation and context state, nothing else.
function mountQuickActions(main){
  const acts = quickActionsFor(State.view);
  if(!acts.length) return;
  const head = main.querySelector('.page-head');
  if(!head) return;
  let controls = head.querySelector('.head-controls');
  if(!controls){ controls = document.createElement('div'); controls.className='head-controls'; head.appendChild(controls); }
  acts.forEach(a=>{
    const btn = document.createElement('button');
    btn.type='button';
    btn.className='btn quick-action';
    btn.textContent = a.label;
    btn.setAttribute('data-quick-action', a.to);
    btn.addEventListener('click', ()=>{
      const extra = a.resolve ? a.resolve() : null;
      hrNavTo(a.to, extra || undefined); // navigation only — sets view + required context
    });
    controls.appendChild(btn);
  });
}
function goToMonthOverview(monthKey){ State.selectedMonth = monthKey; State.view = 'financeOverview'; render(); }
function renderPlaceholderPage(main, id){
  const item = NAV_GROUPS.flatMap(g=>g.items).find(i=>i.id===id);
  main.innerHTML = `
    <div class="page-head"><div><h1>${escapeHtml(item?item.label:id)}</h1><p class="desc">Planned module — not yet implemented.</p></div></div>
    <div class="card" style="max-width:640px;">
      <div class="empty">
        <div class="big">▢</div>
        <div style="color:var(--text);font-weight:600;margin-bottom:6px;">Coming in a future release</div>
        <div>This module is planned for a future version of ${escapeHtml(APP_NAME)} and has not been built yet. No data is shown here because none has been collected — nothing on this page is placeholder or sample data.</div>
      </div>
    </div>
  `;
}

function monthSelectHTML(id, selected, includeAll){
  const months = getMonths();
  let opts = includeAll ? `<option value="all" ${selected==='all'?'selected':''}>All months</option>` : '';
  opts += months.map(m=>`<option value="${m.key}" ${m.key===selected?'selected':''}>${monthLabel(m)}</option>`).join('');
  return `<select id="${id}" class="input">${opts || '<option>No data</option>'}</select>`;
}
