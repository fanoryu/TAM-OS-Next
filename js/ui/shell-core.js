/* ============================================================
   SHELL CORE — js/ui/shell-core.js
   ------------------------------------------------------------
   The part of the app shell the SESSION workspace shares with the LOCAL development shell, split
   out of js/ui/shell-render.js (SESSION-only production package): the floating Actions menu,
   NAV_GROUPS (group labels and icons the SESSION shell reuses), the two drawer helpers and the
   render() facade. It reads no State and no storage; outside LOCAL mode render() only calls
   renderAuthView(). Everything else of the LOCAL shell stays in js/ui/shell-render.js, which
   ships only in LOCAL development (tools/serve-local-dev.js).
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
// Drawer mode = tablet/mobile widths, where the sidebar is an off-canvas overlay.
function sidebarIsDrawerMode(){
  return typeof matchMedia === 'function' ? matchMedia('(max-width:768px)').matches : false;
}
// Focus trap for the open mobile drawer: Tab cycles within the sidebar; nothing
// outside it receives focus while the overlay is up.
function sidebarFocusables(sidebar){
  return Array.from(sidebar.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
    .filter(el=>!el.disabled && el.offsetParent !== null);
}
/* Compatibility facade — the entry point every existing caller already uses. SESSION renders
   only the auth views; LOCAL (development only) hands over to renderLocalShell(), which lives in
   js/ui/shell-render.js — a LOCAL-only module that is not in the production package. */
function render(){
  closeFloatingMenu();    // v2.6.3b — never leave a portaled Actions menu orphaned across a re-render
  // AFI-2 — outside LOCAL mode only the auth views render (js/ui/auth-view.js). U1: an
  // AUTHENTICATED principal gets the SESSION shell from there (js/ui/session-workspace-view.js); this
  // LOCAL shell and its views are never mounted in SESSION mode, whatever allowsWorkspace()
  // says. LOCAL (development only) is unchanged.
  if(AUTH_MODE !== AUTH_MODES.LOCAL){
    if(typeof renderAuthView === 'function') renderAuthView();
    return;
  }
  renderLocalShell();      // LOCAL development only (js/ui/shell-render.js)
}
