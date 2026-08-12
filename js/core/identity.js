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

   CANONICAL vs LOCAL (frozen, UX-006A plan §5):
   - IdentityProvider — the CANONICAL seam application consumers depend on.
     Its ONLY method is getCurrentUser() -> User | null. A future backend
     provider satisfies exactly this and need not enumerate or select.
   - LocalIdentityProvider — a development/test ADAPTER that additionally
     supports deterministic persona selection (getAvailablePrincipals /
     selectPrincipal). These are local-adapter capabilities ONLY; normal
     application modules must NEVER depend on them.

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
    // CEO must not carry an employee linkage.
    if('employeeId' in u && u.employeeId !== undefined) return false;
  }
  return true;
}

/* ---------- deterministic representative principals (fabricated) ----------
   Two canonical access models must both be representable in v3.0.0 (frozen
   Q2): CEO (Executive / ALL_COMPANY) and Employee (Personal / SELF). These
   are obviously-fabricated development fixtures — no real PII. The Employee's
   employeeId is a deterministic, non-empty OPAQUE forward reference: it does
   not (yet) resolve to any State.employees record, and UX-006A must not imply
   it does. */
const FIXTURE_PRINCIPALS = Object.freeze([
  Object.freeze({ id: 'user_ceo_fixture',      displayName: 'Executive (CEO)',  principalType: PRINCIPAL_TYPES.CEO }),
  Object.freeze({ id: 'user_employee_fixture', displayName: 'Employee (Sample)', principalType: PRINCIPAL_TYPES.EMPLOYEE,
                  employeeId: 'emp_fixture_self' })
]);

// Return a fresh shallow copy so callers cannot mutate a frozen fixture's
// (already frozen) identity, and never hand out the internal array reference.
function cloneUser(u){ return u ? Object.assign({}, u) : u; }

/* ---------- LocalIdentityProvider (development/test adapter) ----------
   Owns the PRIVATE selection state. Implements the canonical getCurrentUser()
   AND the local-only enumeration/selection helpers. No persistence: selection
   lives only in this closure and resets on reload. */
const LocalIdentityProvider = (function(){
  let selectedId = null;           // provider-private; null = no principal selected

  function findFixture(id){
    for(let i=0;i<FIXTURE_PRINCIPALS.length;i++){ if(FIXTURE_PRINCIPALS[i].id === id) return FIXTURE_PRINCIPALS[i]; }
    return null;
  }

  return Object.freeze({
    // CANONICAL method. Returns a validated User copy, or null (fail-closed).
    getCurrentUser(){
      if(selectedId === null) return null;
      const u = findFixture(selectedId);
      if(!isValidUser(u)) return null;   // never leak a malformed/partial principal
      return cloneUser(u);
    },
    // LOCAL-ONLY: enumerate the selectable principals as defensive copies.
    // Callers cannot corrupt the canonical fixture definitions.
    getAvailablePrincipals(){
      return FIXTURE_PRINCIPALS.map(cloneUser);
    },
    // LOCAL-ONLY: select by id. Unknown id is a safe no-op miss returning
    // null — it never selects CEO and never fabricates a principal.
    selectPrincipal(id){
      const u = findFixture(id);
      if(!u){ return null; }
      selectedId = u.id;
      return cloneUser(u);
    }
  });
})();

/* ---------- active provider indirection ----------
   The canonical seam delegates to whatever provider is currently active. The
   default (and only production) provider is LocalIdentityProvider. This
   indirection exists so the canonical seam is genuinely testable: a harness can
   install an alternative provider and observe that getCurrentUser() re-validates
   and fails closed. It is NOT a product provider-selection API — there is no
   public setter and no runtime switch UI. */
let activeIdentityProvider = LocalIdentityProvider;

/* ---------- IdentityProvider (CANONICAL seam) ----------
   The ONLY identity contract application consumers may depend on. In the
   client build it is backed by the active provider (the local adapter), but it
   exposes ONLY the universal getCurrentUser() — never enumeration or selection.
   A future backend/authenticated provider implements exactly this one method. */
const IdentityProvider = Object.freeze({
  getCurrentUser(){ return activeIdentityProvider.getCurrentUser(); }
});

/* INTERNAL TEST SEAM — installs an alternative provider behind the canonical
   seam. Declared as a top-level `const` (function EXPRESSION) on purpose: in a
   classic script a `const` creates a lexical binding but is NOT attached to the
   global `window` object (unlike a function declaration or `var`). So this seam
   is invisible on the production global, yet the runtime harness can still reach
   it — the harness's appended export runs in this same lexical script scope.
   Application modules must never call this — it is a test seam, not a
   provider-selection API. */
const setIdentityProviderForTesting = function(provider){
  activeIdentityProvider = provider || LocalIdentityProvider;
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
  window.LocalIdentityProvider = LocalIdentityProvider;
  window.getCurrentUser = getCurrentUser;
}
