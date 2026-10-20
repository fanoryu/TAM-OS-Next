/* ============================================================
   IDENTITY FOUNDATION (UX-006A) — js/core/identity.js
   ------------------------------------------------------------
   The smallest production identity primitive for TAM OS. It introduces an
   IDENTITY abstraction only — WHO the application is acting as — and nothing
   about authentication (HOW identity is proven) or authorization (WHAT the
   principal may do). Those are later UX-006 phases and are NOT started here.

   TRUST BOUNDARY (read before extending): this is a development/client
   identity abstraction. Provider-based LOCAL principal selection is NOT
   authentication — it is spoofable client-side (any browser owner controls
   their own localStorage/State), and real security enforcement remains a
   future backend responsibility. No credential material is stored, verified,
   transmitted, or implied. Do NOT describe any check here as "secure login".

   CANONICAL seam (frozen, UX-006A plan §5):
   - IdentityProvider — the CANONICAL seam application consumers depend on.
     Its ONLY method is getCurrentUser() -> User | null. The SESSION provider
     (js/core/session-identity.js) satisfies exactly this.
   - AFI-5b: the application ships NO principal fixtures and NO enumeration or
     selection API. LOCAL mode exists for development and testing only; its
     identity is a development provider installed from outside the application
     (never part of the package) through the internal test seam below.

   Identity state is provider-owned and PRIVATE (module closure). There is NO
   State.identity slice, NO bootstrap lifecycle, NO persistence, NO storage
   key, and NO schema change in UX-006A. currentUser === null is a valid,
   fail-closed "no principal selected" state; nothing here ever defaults to a
   privileged (CEO) principal.

   Classic shared global scope — no ES modules, no bundler. Mirrors the
   EmployeeRepository convention: frozen objects exposed on the global.
   ============================================================ */

/* ---------- principal classification (identity only, NOT RBAC) ---------- */
const PRINCIPAL_TYPES = Object.freeze({ CEO: 'ceo', EMPLOYEE: 'employee' });

/* ---------- User contract validation (lightweight, no schema library) ----------
   Returns true only for a well-formed identity object. This proves
   IDENTITY-CONTRACT validity — the shape of the User — and deliberately does
   NOT prove EMPLOYEE-RECORD referential validity: it never calls empById and
   never requires a matching State.employees record. That referential check is
   UX-006B, when SELF scope is introduced. */
function isValidUser(u){
  if(!u || typeof u !== 'object') return false;
  if(typeof u.id !== 'string' || u.id.length === 0) return false;
  if(typeof u.displayName !== 'string' || u.displayName.length === 0) return false;
  if(u.principalType !== PRINCIPAL_TYPES.CEO && u.principalType !== PRINCIPAL_TYPES.EMPLOYEE) return false;
  if(u.principalType === PRINCIPAL_TYPES.EMPLOYEE){
    // Employee requires a non-empty opaque employeeId (a forward reference).
    if(typeof u.employeeId !== 'string' || u.employeeId.length === 0) return false;
  } else {
    // AFI-1 — a CEO MAY carry an employee binding (User != Employee; the server's
    // Principal permits it, SDR-0002 §6). Absent / undefined / null mean no binding;
    // any other value must be a non-empty opaque id. The binding never changes the
    // CEO workspace (Executive / ALL_COMPANY, js/core/workspace.js).
    if('employeeId' in u && u.employeeId !== undefined && u.employeeId !== null
       && (typeof u.employeeId !== 'string' || u.employeeId.length === 0)) return false;
  }
  return true;
}

/* ---------- active provider: chosen by the explicit AUTH_MODE (AFI-2, AFI-5b) ----------
   The canonical seam delegates to the provider of the CURRENT mode, resolved at
   call time from the single source constant AUTH_MODE (js/core/constants.js):
     SESSION -> SessionIdentityProvider (js/core/session-identity.js) — the shipped
                mode. The test seam below is IGNORED here: nothing installed through
                it, or cleared through it, can change a SESSION principal.
     LOCAL   -> the development provider explicitly installed through the test seam,
                or NO_IDENTITY_PROVIDER when none is installed. LOCAL has no built-in
                provider and never falls back to one.
     anything else, or SESSION before its provider exists -> NO_IDENTITY_PROVIDER
   It is NOT a product provider-selection API: there is no public setter and no
   runtime switch UI. */
const NO_IDENTITY_PROVIDER = Object.freeze({ getCurrentUser(){ return null; } });
let testIdentityProvider = null;    // set only through setIdentityProviderForTesting
const modeIdentityProvider = function(){
  if(AUTH_MODE === AUTH_MODES.SESSION && typeof SessionIdentityProvider !== 'undefined') return SessionIdentityProvider;
  if(AUTH_MODE === AUTH_MODES.LOCAL) return testIdentityProvider || NO_IDENTITY_PROVIDER;
  return NO_IDENTITY_PROVIDER;
};

/* ---------- IdentityProvider (CANONICAL seam) ----------
   The ONLY identity contract application consumers may depend on. It exposes
   ONLY the universal getCurrentUser() — never enumeration or selection. */
const IdentityProvider = Object.freeze({
  getCurrentUser(){ return modeIdentityProvider().getCurrentUser(); }
});

/* INTERNAL TEST SEAM — installs a development provider behind the canonical
   seam. Declared as a top-level `const` (function EXPRESSION) on purpose: in a
   classic script a `const` creates a lexical binding but is NOT attached to the
   global `window` object (unlike a function declaration or `var`). So this seam
   is invisible on the production global, yet the runtime harness can still reach
   it — the harness's appended export runs in this same lexical script scope.
   Application modules must never call this — it is a test seam, not a
   provider-selection API. It takes effect in LOCAL mode only.
   AFI-5b (R-1): null clears the test provider. LOCAL without an explicitly
   installed provider resolves to NO_IDENTITY_PROVIDER (null identity; not ready);
   it never restores or installs the development alias. Reinstall the alias
   explicitly to resume LOCAL identity. SESSION ignores the seam, including null
   resets. */
const setIdentityProviderForTesting = function(provider){
  testIdentityProvider = provider || null;
};

/* ---------- LOCAL development readiness (AFI-5b, D-01) ----------
   True only in explicit LOCAL mode with an installed development provider whose
   current principal is a valid User. The mode is tested first, so outside LOCAL
   the seam is never read. A provider that throws is not ready. This is a boot
   safety belt for development, not authentication: the shipped mode is SESSION.
   Evaluated once by the LOCAL branch of js/core/app-bootstrap.js; nothing else
   may reference it (tools/verify-build.js, AFI-5b R-3). Not exported on window. */
const localDevReady = function(){
  if(AUTH_MODE !== AUTH_MODES.LOCAL) return false;
  if(testIdentityProvider === null) return false;
  try { return isValidUser(testIdentityProvider.getCurrentUser()); }
  catch(_e){ return false; }
};

/* ---------- getCurrentUser() — the single canonical consumer entry point ----------
   Delegates through the canonical seam, re-validates the result, and fails
   closed to null. Never fabricates a CEO, never returns a partial identity. */
function getCurrentUser(){
  let u;
  try { u = IdentityProvider.getCurrentUser(); }
  catch(_e){ return null; }            // local resolution failure never crashes the app
  return isValidUser(u) ? u : null;
}

// Classic shared global scope; expose on the global object (mirrors
// EmployeeRepository). No eval, no module system.
if (typeof window !== 'undefined') {
  window.PRINCIPAL_TYPES = PRINCIPAL_TYPES;
  window.IdentityProvider = IdentityProvider;
  window.getCurrentUser = getCurrentUser;
}
