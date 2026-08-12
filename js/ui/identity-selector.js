/* ============================================================
   REACHABLE PRINCIPAL SELECTION (UX-006D1) — js/ui/identity-selector.js
   ------------------------------------------------------------
   A compact "Acting as" native <select> in the persistent sidebar .brand area.
   Its ONLY job is to make the already-existing UX-006A principals reachable in
   the running application, so a live active principal exists as the runtime
   prerequisite for future authorization enforcement (UX-006C2). It wires NO
   mutation boundary, NO Global Search scope, NO navigation change.

   TRUST BOUNDARY (read before extending): this is an identity-SELECTION
   affordance over the existing spoofable client-side principal abstraction
   (js/core/identity.js). It is NOT a security boundary. It proves nothing about
   who the operator really is; it only chooses WHICH principal the app acts as.

   FROZEN INVARIANTS (UX-006D1 plan):
   - Initial state is getCurrentUser() === null. No auto-selection, no default
     CEO, no implicit CEO, no boot-time principal. The unselected state is valid
     and fail-closed.
   - Selection is EPHEMERAL: it lives only in the LocalIdentityProvider closure
     and resets on reload. No persistence, no storage key, no State.identity, no
     schema change (SCHEMA_VERSION stays 6).
   - This module is the SINGLE UI adapter permitted to call the local-only
     LocalIdentityProvider enumeration/selection helpers
     (getAvailablePrincipals / selectPrincipal). Every other application module
     continues to consume identity only through getCurrentUser().
   - Selection changes flow through the EXISTING shell lifecycle (render()), not
     a new bootstrap lifecycle, store, or reload.

   Classic shared global scope; mirrors shell-render.js / identity.js conventions.
   ============================================================ */

/* Deterministic option order: CEO first, then Employee, then any future
   principal type by displayName. principalType is used ONLY for ordering here —
   never rendered as a security role. */
const IDENTITY_PRINCIPAL_ORDER = Object.freeze({ ceo: 0, employee: 1 });
const IDENTITY_SELECT_ID = 'identityPrincipalSelect';
const IDENTITY_HELP_ID = 'identityPrincipalHelp';
const IDENTITY_CONTEXT_ID = 'identityPrincipalContext';
const IDENTITY_RAIL_ID = 'identityPrincipalRail';
const IDENTITY_SELECT_PLACEHOLDER = '— Select principal —';
/* Readiness-3 (first-boot guidance, PRESENTATION ONLY). The fail-closed null principal
   is unchanged — nothing here selects, defaults to, or persists a principal. Only the
   WORDING changed: "some actions are unavailable" described the capability consequence
   but not the data one, so a first-boot operator saw empty pages with no way to tell
   that the emptiness was a not-yet-chosen identity rather than an empty database. The
   line now names the cause and the single action that resolves it. */
const IDENTITY_NULL_HELP = 'No principal selected — choose who you are acting as above to see your data and actions.';

/* UX-006D2 — presentation of the active workspace context (PRESENTATION ONLY).
   getCurrentWorkspace() is the frozen UX-006B derived selector; this reads it to
   LABEL what is already true and renders nothing else. It performs no scope query,
   grants nothing, and changes no policy — an operator simply could not previously
   tell which workspace context the chosen principal was acting in. `null` is a
   real, valid context (no principal, or an employee with missing linkage) and is
   presented as such rather than hidden. */
const IDENTITY_WORKSPACE_LABELS = Object.freeze({
  executive: { name: 'Executive workspace', detail: 'Company-wide records' },
  personal:  { name: 'Personal workspace',  detail: 'Your own records' }
});
/* A null workspace has TWO distinct causes and they must not be presented as one:
   nobody is acting yet, or somebody is acting but their records are not linked (the
   frozen UX-006B fail-closed path — an employee principal whose Employee record is
   missing resolves to no workspace, never to a company-wide one). Telling an active
   principal to "select a principal" would be simply untrue. */
const IDENTITY_NO_PRINCIPAL = Object.freeze({ name: 'No workspace', detail: 'Select a principal to begin' });
const IDENTITY_UNRESOLVED_WORKSPACE = Object.freeze({ name: 'No workspace', detail: 'No linked employee record' });

function identityWorkspaceLabel(current){
  const ws = (typeof getCurrentWorkspace === 'function') ? getCurrentWorkspace() : null;
  if(ws) return IDENTITY_WORKSPACE_LABELS[ws.type] || IDENTITY_UNRESOLVED_WORKSPACE;
  return current ? IDENTITY_UNRESOLVED_WORKSPACE : IDENTITY_NO_PRINCIPAL;
}

// Compact initials for the rail/avatar chip. Presentation only — never an identifier.
function identityInitials(current){
  if(!current) return '—';
  // Punctuation is stripped first: display names like "Executive (CEO)" would
  // otherwise yield "E(" rather than "EC".
  const parts = String(current.displayName || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if(!parts.length) return '—';
  return (parts.length === 1 ? parts[0].slice(0, 2) : (parts[0][0] + parts[parts.length - 1][0])).toUpperCase();
}

// The SINGLE enumeration point. Returns local-adapter defensive copies in a
// deterministic order. Empty array when the adapter is unavailable (fail-safe).
function identityAvailablePrincipals(){
  const list = (typeof LocalIdentityProvider !== 'undefined'
    && LocalIdentityProvider && typeof LocalIdentityProvider.getAvailablePrincipals === 'function')
    ? LocalIdentityProvider.getAvailablePrincipals() : [];
  return list.slice().sort(function(a, b){
    const ra = IDENTITY_PRINCIPAL_ORDER[a && a.principalType];
    const rb = IDENTITY_PRINCIPAL_ORDER[b && b.principalType];
    const na = (ra === undefined) ? 99 : ra;
    const nb = (rb === undefined) ? 99 : rb;
    if(na !== nb) return na - nb;
    return String(a && a.displayName).localeCompare(String(b && b.displayName));
  });
}

// The acting-as / unselected helper line for the current principal (or null).
function identityHelpText(current){
  return current ? ('Acting as ' + current.displayName + '.') : IDENTITY_NULL_HELP;
}

// Markup for the selector. A non-value placeholder is selected while no principal
// is chosen (never silently selects a principal). Every dynamic value is escaped.
function renderIdentitySelectorHTML(){
  const principals = identityAvailablePrincipals();
  const current = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  const currentId = current ? current.id : '';
  const opts = ['<option value="">' + escapeHtml(IDENTITY_SELECT_PLACEHOLDER) + '</option>']
    .concat(principals.map(function(p){
      const on = (p.id === currentId) ? ' selected' : '';
      return '<option value="' + escapeHtml(p.id) + '"' + on + '>' + escapeHtml(p.displayName) + '</option>';
    })).join('');
  const ws = identityWorkspaceLabel(current);
  const state = current ? 'active' : 'none';
  // UX-006D2 — the collapsed rail previously hid the whole selector, so a collapsed
  // sidebar showed NO indication of which principal was active. This compact chip is
  // rail-only (CSS-revealed) and carries the same truth in two characters.
  const rail = '<div class="identity-rail" id="' + IDENTITY_RAIL_ID + '" data-principal-state="' + state + '"'
    + ' title="' + escapeHtml(identityHelpText(current)) + '" aria-hidden="true">'
    + escapeHtml(identityInitials(current)) + '</div>';
  return '<div class="identity-selector" data-principal-state="' + state + '">'
    + rail
    + '<label class="identity-selector-label" for="' + IDENTITY_SELECT_ID + '">Acting as</label>'
    + '<select class="input identity-select" id="' + IDENTITY_SELECT_ID + '" aria-describedby="' + IDENTITY_HELP_ID + '">'
    + opts
    + '</select>'
    + '<p class="identity-selector-help" id="' + IDENTITY_HELP_ID + '">' + escapeHtml(identityHelpText(current)) + '</p>'
    + '<div class="identity-context" id="' + IDENTITY_CONTEXT_ID + '" data-principal-state="' + state + '">'
    + '<span class="identity-context-name">' + escapeHtml(ws.name) + '</span>'
    + '<span class="identity-context-detail">' + escapeHtml(ws.detail) + '</span>'
    + '</div>'
    + '</div>';
}

// The SINGLE selection point. Applies the chosen principal via the local adapter
// (an empty / unknown id is a safe no-op miss that never fabricates a principal),
// then re-syncs through the EXISTING render facade — no reload, no new lifecycle.
function onIdentityPrincipalChange(id){
  if(typeof LocalIdentityProvider !== 'undefined'
     && LocalIdentityProvider && typeof LocalIdentityProvider.selectPrincipal === 'function'){
    LocalIdentityProvider.selectPrincipal(id);
  }
  if(typeof render === 'function') render();
}

// Bind the change listener once against the already-mounted shell (mirrors the
// bind-once discipline of bindShell). The <select> node outlives navigation, so
// the listener is never rebound.
function bindIdentitySelector(app){
  const scope = app || (typeof document !== 'undefined' ? document : null);
  if(!scope || typeof scope.querySelector !== 'function') return;
  const sel = scope.querySelector('#' + IDENTITY_SELECT_ID);
  if(!sel) return;
  sel.addEventListener('change', function(){ onIdentityPrincipalChange(sel.value); });
}

// Keep the mounted selector truthful after any render/sync WITHOUT rebuilding the
// shell — mirrors syncShellState's write-on-change discipline. Reflects the value
// and the acting-as / unselected helper from getCurrentUser().
function syncIdentitySelector(){
  if(typeof document === 'undefined') return;
  const app = document.getElementById('app'); if(!app) return;
  const sel = app.querySelector('#' + IDENTITY_SELECT_ID); if(!sel) return;
  const current = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  const currentId = current ? current.id : '';
  if(sel.value !== currentId) sel.value = currentId;
  const txt = identityHelpText(current);
  const help = app.querySelector('#' + IDENTITY_HELP_ID);
  if(help){
    if(help.textContent !== txt) help.textContent = txt;
  }
  /* UX-006D2 — keep the presentation surfaces truthful on the SAME write-on-change
     discipline. These are derived from the current principal on every sync, so no
     provenance from a previous principal can survive a switch. Nothing is stored. */
  const state = current ? 'active' : 'none';
  const root = app.querySelector('.identity-selector');
  if(root && root.getAttribute('data-principal-state') !== state) root.setAttribute('data-principal-state', state);
  const rail = app.querySelector('#' + IDENTITY_RAIL_ID);
  if(rail){
    const ini = identityInitials(current);
    if(rail.textContent !== ini) rail.textContent = ini;
    if(rail.getAttribute('data-principal-state') !== state) rail.setAttribute('data-principal-state', state);
    if(rail.getAttribute('title') !== txt) rail.setAttribute('title', txt);
  }
  const ctx = app.querySelector('#' + IDENTITY_CONTEXT_ID);
  if(ctx){
    const ws = identityWorkspaceLabel(current);
    const nameEl = ctx.querySelector('.identity-context-name');
    const detailEl = ctx.querySelector('.identity-context-detail');
    if(nameEl && nameEl.textContent !== ws.name) nameEl.textContent = ws.name;
    if(detailEl && detailEl.textContent !== ws.detail) detailEl.textContent = ws.detail;
    if(ctx.getAttribute('data-principal-state') !== state) ctx.setAttribute('data-principal-state', state);
  }
}

// Classic shared global scope; expose only what the shell mounts/binds/syncs.
if (typeof window !== 'undefined') {
  window.renderIdentitySelectorHTML = renderIdentitySelectorHTML;
  window.bindIdentitySelector = bindIdentitySelector;
  window.syncIdentitySelector = syncIdentitySelector;
}
