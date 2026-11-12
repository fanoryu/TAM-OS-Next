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

// The U1 navigation, per role, in order: [group label, [[route, button id, icon, label], ...]]. The
// Employee's Finance group is labelled "My work" (U1 correction 2). Phase 1 authorized revision: the CEO's
// Finance group ends with Finance (the Ledger: dashboard and general transactions). Was: Overtime, Payroll.
const NAV = Object.freeze({
  ceo: [['People', [['main', 'swSectionMain', '☺', 'Employees']]],
    ['Finance', [['overtime', 'swSectionOvertime', '⏱', 'Overtime'], ['payroll', 'swSectionPayroll', '৳', 'Payroll'], ['finance', 'swSectionFinance', '▣', 'Finance']]],
    ['System', [['audit', 'swSectionAudit', '☰', 'Audit']]]],
  employee: [['People', [['main', 'swSectionMain', '☺', 'My profile']]],
    ['My work', [['overtime', 'swSectionOvertime', '⏱', 'My overtime'], ['payroll', 'swSectionPayroll', '৳', 'My payroll']]]]
});
const ROUTES = Object.freeze({ ceo: ['main', 'overtime', 'payroll', 'finance', 'audit'], employee: ['main', 'overtime', 'payroll'] });

function chromeOf(role, active, disabled){
  const nav = NAV[role].map(([label, items]) => '<div class="nav-group"><div class="nav-group-head"><span>' + label + '</span></div><div class="nav-group-items">'
    + items.map(([route, id, ic, text]) => '<button class="nav-item' + (route === active ? ' active' : '') + '" type="button" id="' + id + '"'
      + (route === active ? ' aria-current="page"' : '') + (disabled ? ' disabled' : '') + '><span class="ic" aria-hidden="true">' + ic + '</span><span class="nav-label">' + text + '</span></button>').join('')
    + '</div></div>').join('');
  return '<a class="skip-link" href="#main" id="skipLink">Skip to main content</a>'
    + '<button class="nav-hamburger" id="navHamburger" type="button" aria-label="Open navigation" aria-controls="sidebar" aria-expanded="false"><span aria-hidden="true">☰</span></button>'
    + '<div class="sidebar-backdrop" id="sidebarBackdrop" hidden></div>'
    + '<div class="sidebar" id="sidebar"><div class="brand"><div class="brand-lockup">'
    + '<img class="brand-monogram" src="' + BRAND_MONOGRAM + '" alt="" aria-hidden="true" width="34" height="34" draggable="false">'
    + '<div class="mark">TAM&nbsp;<span class="os">OS</span></div></div></div>'
    + '<nav class="nav" aria-label="Primary navigation">' + nav + '</nav>'
    + '<div class="sidebar-foot">' + APP_NAME + ' v' + APP_VERSION + '<br>Data stored on the TAM OS server.</div></div>'
    + '<main class="main" id="main" tabindex="-1">';
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
