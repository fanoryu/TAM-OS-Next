/* ============================================================
   DEVELOPMENT LOCAL IDENTITY FIXTURE (AFI-5a, AFI-5b) — tools/dev/local-identity-fixture.js
   ------------------------------------------------------------
   TEST-ONLY. The ONLY home of the development persona for LOCAL mode. It lives OUTSIDE
   the application: it is never listed in tools/module-order.js, never referenced by
   index.html, and never part of the deployment package (tools/verify-build.js, AFI-5a
   checks). It is loaded only by tools/serve-local-dev.js (injected in memory after
   js/core/identity.js) and by the runtime harnesses that run LOCAL mode.

   NOT AUTHENTICATION. A persona chosen here proves nothing about who the operator is;
   it is a spoofable client-side fixture identity. Real identity is the SESSION mode's
   GET /api/auth/me, and the server re-derives every principal from the database.

   AFI-5b (design Rev 1.2 D-02, Rev 1.2.1 R-1):
   - The application ships no fixtures and no selection API, so this file owns them.
     Exactly five top-level names: TAM_DEV_LOCAL, DEV_PERSONA, DEV_FIXTURE_PRINCIPALS,
     DevLocalIdentity and LocalIdentityProvider (a development-only compatibility alias
     with the shipped v2.11.0 adapter's semantics, for the LOCAL runtime harnesses).
   - LocalIdentityProvider owns the selection: null at load; selectPrincipal(valid id)
     selects and returns a copy; an unknown id returns null and leaves the selection
     unchanged; getCurrentUser() returns null or a validated copy. It takes effect only
     once installed through the internal test seam setIdentityProviderForTesting
     (js/core/identity.js). Selecting never installs it, and clearing the seam never
     clears its selection.
   - DEV_PERSONA is null on disk: loaded as is, the file makes NO seam call and selects
     nobody (fail closed, never a default CEO). Only tools/serve-local-dev.js rewrites
     that one line, in memory, from its required --as argument.
   - It reads or writes no State, storage, network or StorageAdapter, and puts nothing
     on window.

   Classic shared global scope; top-level `const` bindings, NOT on window.
   ============================================================ */

/* Marker: present only when this development file is loaded. */
const TAM_DEV_LOCAL = true;

/* The persona to install at load. null on disk = install nothing. */
const DEV_PERSONA = null;

/* The fabricated development principals, in the v2.11.0 order (no real PII). */
const DEV_FIXTURE_PRINCIPALS = Object.freeze([
  Object.freeze({ id: 'user_ceo_fixture',      displayName: 'Executive (CEO)',  principalType: 'ceo' }),
  Object.freeze({ id: 'user_employee_fixture', displayName: 'Employee (Sample)', principalType: 'employee',
                  employeeId: 'emp_fixture_self' })
]);

/* Development-only compatibility alias (D-02). Never shipped. */
const LocalIdentityProvider = (function(){
  let selectedId = null;             // alias-private; null = no principal selected

  function find(id){
    for(let i = 0; i < DEV_FIXTURE_PRINCIPALS.length; i++){
      if(DEV_FIXTURE_PRINCIPALS[i].id === id) return DEV_FIXTURE_PRINCIPALS[i];
    }
    return null;
  }
  function copy(u){ return u ? Object.assign({}, u) : null; }

  return Object.freeze({
    // Canonical method: a validated copy of the selection, or null (fail closed).
    getCurrentUser(){
      if(selectedId === null) return null;
      const u = find(selectedId);
      return isValidUser(u) ? copy(u) : null;
    },
    // The selectable principals as fresh copies, in fixture order.
    getAvailablePrincipals(){ return DEV_FIXTURE_PRINCIPALS.map(copy); },
    // Select by id. An unknown id is a no-op miss returning null: it never selects a
    // CEO, never fabricates a principal and keeps the previous selection.
    selectPrincipal(id){
      const u = find(id);
      if(!u) return null;
      selectedId = u.id;
      return copy(u);
    }
  });
})();

const DevLocalIdentity = (function(){
  // A fixed, unmistakable notice on the page (dev server only). Inline style attribute:
  // the production CSP allows attributes (style-src-attr), so no stylesheet changes.
  function banner(u){
    if(typeof document === 'undefined' || !document) return;
    const mount = function(){
      if(!document.body || typeof document.createElement !== 'function') return;
      const el = document.createElement('div');
      el.setAttribute('role', 'status');
      el.setAttribute('data-dev-local', 'true');
      el.setAttribute('style', 'position:fixed;left:8px;bottom:8px;z-index:2147483647;pointer-events:none;'
        + 'padding:4px 8px;border-radius:4px;background:#8B1E1E;color:#FFF;font:600 11px/1.4 sans-serif;');
      el.textContent = 'DEVELOPMENT — LOCAL DATA — NOT AUTHENTICATED · ' + u.displayName;
      document.body.appendChild(el);
    };
    if(document.readyState === 'loading' && typeof document.addEventListener === 'function'){
      document.addEventListener('DOMContentLoaded', mount);
    } else {
      mount();
    }
  }

  const api = Object.freeze({
    // The persona list as defensive copies.
    principals(){ return LocalIdentityProvider.getAvailablePrincipals(); },
    // Select a persona through the alias and install THAT alias through the test seam.
    // An unknown id changes neither the selection nor the installed provider and
    // returns null — it never falls back to a CEO and never fabricates a principal.
    install(id){
      const u = LocalIdentityProvider.selectPrincipal(id);
      if(!u) return null;
      setIdentityProviderForTesting(LocalIdentityProvider);
      return u;
    },
    // The selected persona (a copy), or null.
    current(){ return LocalIdentityProvider.getCurrentUser(); }
  });

  // Load-time install: only when the dev server set DEV_PERSONA; the banner only after a
  // successful install. On disk (null) nothing happens.
  if(DEV_PERSONA !== null){
    const u = api.install(DEV_PERSONA);
    if(u) banner(u);
  }
  return api;
})();
