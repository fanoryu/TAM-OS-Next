'use strict';
/* ============================================================
   U1 — SESSION SHELL CHROME ORACLE (test-only) — tools/session-shell-chrome.js
   ------------------------------------------------------------
   The exact markup the AUTHENTICATED SESSION shell (js/ui/session-workspace-view.js,
   sessionShellHTML) must render around the workspace card, written out here from the
   U1 specification — not computed by the production code — so a harness can:

     parseSessionShell(html)  -> { role, active, disabled, content } when html is exactly
                                 one SESSION shell (a CEO or Employee navigation, one
                                 active route, all items enabled or all disabled) wrapping
                                 `content`; otherwise null.

   The runtime harnesses strip the chrome with it and keep every content assertion they
   had (no LOCAL navigation, no "Acting as", no other domain, no local data tool) on the
   card alone. Any other sidebar, item, label, attribute or order fails the parse.

   Used only by tools/verify-*-runtime.js. Never in module-order.js or the package.
   ============================================================ */

const fs = require('fs');
const path = require('path');

const constants = fs.readFileSync(path.join(__dirname, '..', 'js', 'core', 'constants.js'), 'utf8');
const pick = (name) => { const m = new RegExp('const ' + name + " = '([^']*)';").exec(constants); if(!m) throw new Error('constants.js: ' + name + ' not found'); return m[1]; };
const APP_NAME = pick('APP_NAME');
const APP_VERSION = pick('APP_VERSION');
const BRAND_MONOGRAM = pick('BRAND_MONOGRAM');

const APP_TAGLINE = pick('APP_TAGLINE');

// The navigation, per role, in order: [group label, [[route, button id, icon, label, more], ...]]. The
// Employee's Finance group is labelled "My work" (U1 correction 2). UI-INT-1 (Owner D-UI-1, 2026-11-13): the
// v2.11.0 wording and order — CEO Finance: Overview, Payroll, Transactions, More > Overtime; System: Activity
// Log. Was (Phase 1): Overtime, Payroll, Finance; Audit.
const NAV = Object.freeze({
  ceo: [['People', [['main', 'swSectionMain', '☺', 'Employees', false]]],
    ['Finance', [['finance', 'swSectionFinance', '▣', 'Overview', false], ['payroll', 'swSectionPayroll', '৳', 'Payroll', false],
      ['transactions', 'swSectionTransactions', '≡', 'Transactions', false], ['overtime', 'swSectionOvertime', '⏱', 'Overtime', true]]],
    ['System', [['audit', 'swSectionAudit', '☰', 'Activity Log', false]]]],
  employee: [['People', [['main', 'swSectionMain', '☺', 'My profile', false]]],
    ['My work', [['overtime', 'swSectionOvertime', '⏱', 'My overtime', false], ['payroll', 'swSectionPayroll', '৳', 'My payroll', false]]]]
});
const ROUTES = Object.freeze({ ceo: ['main', 'finance', 'payroll', 'transactions', 'overtime', 'audit'], employee: ['main', 'overtime', 'payroll'] });
const GROUP_IDS = Object.freeze({ 'People': 'people', 'Finance': 'finance', 'My work': 'finance', 'System': 'system' });

// The chrome in its first-paint state: rail expanded, every group expanded, "More" open; then the breadcrumb (Group / Page) opening <main>.
function chromeOf(role, active, disabled){
  const item = ([route, id, ic, text]) => '<button class="nav-item' + (route === active ? ' active' : '') + '" type="button" id="' + id + '"'
    + (route === active ? ' aria-current="page"' : '') + (disabled ? ' disabled' : '') + ' title="' + text + '"><span class="ic" aria-hidden="true">' + ic + '</span><span class="nav-label">' + text + '</span></button>';
  let crumb = '';
  const nav = NAV[role].map(([label, items]) => {
    const own = items.find((i) => i[0] === active);
    if(own) crumb = '<nav class="breadcrumb" aria-label="Breadcrumb"><ol class="crumb-list"><li class="crumb"><span class="crumb-text">' + label + '</span></li>'
      + '<span class="crumb-sep" aria-hidden="true">/</span><li class="crumb"><span class="crumb-text" aria-current="page">' + own[3] + '</span></li></ol></nav>';
    const more = items.filter((i) => i[4]);
    const open = more.length > 0;   // "More" starts open in SESSION (UI-INT-1)
    const moreHTML = more.length ? '<button class="nav-item nav-more-head" type="button" id="swNavMore" aria-expanded="' + open + '" title="More"' + (disabled ? ' disabled' : '') + '>'
      + '<span class="ic" aria-hidden="true">⋯</span><span class="nav-label">More</span><span class="chev" aria-hidden="true">' + (open ? '▾' : '▸') + '</span></button>'
      + (open ? '<div class="nav-more-items">' + more.map(item).join('') + '</div>' : '') : '';
    return '<div class="nav-group"><button class="nav-group-head" type="button" id="swNavGroup-' + GROUP_IDS[label] + '" data-sw-group="' + GROUP_IDS[label] + '" aria-expanded="true">'
      + '<span>' + label + '</span><span class="chev" aria-hidden="true">▾</span></button><div class="nav-group-items">'
      + items.filter((i) => !i[4]).map(item).join('') + moreHTML + '</div></div>';
  }).join('');
  return '<a class="skip-link" href="#main" id="skipLink">Skip to main content</a>'
    + '<button class="nav-hamburger" id="navHamburger" type="button" aria-label="Open navigation" aria-controls="sidebar" aria-expanded="false"><span aria-hidden="true">☰</span></button>'
    + '<div class="sidebar-backdrop" id="sidebarBackdrop" hidden></div>'
    + '<div class="sidebar" id="sidebar"><div class="brand"><div class="brand-lockup">'
    + '<img class="brand-monogram" src="' + BRAND_MONOGRAM + '" alt="" aria-hidden="true" width="34" height="34" draggable="false">'
    + '<div class="mark">TAM&nbsp;<span class="os">OS</span></div></div>'
    + '<button class="sidebar-collapse-btn" id="sidebarCollapseBtn" type="button" aria-label="Collapse sidebar" aria-expanded="true" title="Collapse sidebar"><span aria-hidden="true">«</span></button></div>'
    + '<nav class="nav" aria-label="Primary navigation">' + nav + '</nav>'
    + '<div class="sidebar-foot">' + APP_NAME + ' v' + APP_VERSION + '<br>' + APP_TAGLINE + '<br>Data stored on the TAM OS server.</div></div>'
    + '<main class="main" id="main" tabindex="-1">' + crumb;
}

function parseSessionShell(html){
  html = String(html);
  if(html.slice(-7) !== '</main>') return null;
  for(const role of Object.keys(ROUTES)){
    for(const active of ROUTES[role]){
      for(const disabled of [false, true]){
        const chrome = chromeOf(role, active, disabled);
        if(html.indexOf(chrome) === 0) return { role: role, active: active, disabled: disabled, content: html.slice(chrome.length, -7) };
      }
    }
  }
  return null;
}

// The html with the SESSION shell chrome removed (unchanged when there is no exact shell).
function stripSessionShell(html){
  const s = parseSessionShell(html);
  return s ? s.content : String(html);
}

module.exports = { parseSessionShell, stripSessionShell, chromeOf, NAV, ROUTES };
