/* ============================================================
   DEVELOPMENT LOCAL IDENTITY FIXTURE (AFI-5a) — tools/dev/local-identity-fixture.js
   ------------------------------------------------------------
   TEST-ONLY. A development persona for LOCAL mode that lives OUTSIDE the application:
   it is never listed in tools/module-order.js, never referenced by index.html, and
   never part of the deployment package (tools/verify-build.js, AFI-5a checks). It is
   loaded only by tools/serve-local-dev.js (injected in memory after js/core/identity.js)
   and by the runtime harness tools/verify-dev-local-runtime.js.

   NOT AUTHENTICATION. A persona chosen here proves nothing about who the operator is;
   it is the same spoofable client-side fixture identity as the shipped "Acting as"
   adapter, moved out of the product. Real identity is the SESSION mode's GET
   /api/auth/me, and the server re-derives every principal from the database.

   AFI-5a (owner decision D-AFI5-2, design Addendum A1 §2.1):
   - DEV_FIXTURE_PRINCIPALS is a deep copy of the two shipped fixture principals
     (js/core/identity.js FIXTURE_PRINCIPALS) — same ids, names and employee binding —
     so a persona here resolves exactly as "Acting as" does today. The parity is
     proven by tools/verify-dev-local-runtime.js, not assumed.
   - Every top-level name is NEW (TAM_DEV_LOCAL, DEV_PERSONA, DEV_FIXTURE_PRINCIPALS,
     DevLocalIdentity): none collides with an application declaration, so this file
     loads beside the unchanged application in one classic global scope.
   - It installs a persona ONLY through the existing internal test seam
     setIdentityProviderForTesting (js/core/identity.js). It never calls the shipped
     selection API, and reads or writes no State, storage, network or StorageAdapter.
   - DEV_PERSONA is null on disk: loaded as is, the file installs NOTHING (fail closed,
     never a default CEO). Only tools/serve-local-dev.js rewrites that one line, in
     memory, from its required --as argument.

   Classic shared global scope; top-level `const` bindings, NOT on window.
   ============================================================ */

/* Marker: present only when this development file is loaded. */
const TAM_DEV_LOCAL = true;

/* The persona to install at load. null on disk = install nothing. */
const DEV_PERSONA = null;

/* Deep copy of the shipped fixture principals (fabricated; no real PII). */
const DEV_FIXTURE_PRINCIPALS = Object.freeze([
  Object.freeze({ id: 'user_ceo_fixture',      displayName: 'Executive (CEO)',  principalType: 'ceo' }),
  Object.freeze({ id: 'user_employee_fixture', displayName: 'Employee (Sample)', principalType: 'employee',
                  employeeId: 'emp_fixture_self' })
]);

const DevLocalIdentity = (function(){
  let installed = null;              // the persona this file installed; null = none

  function find(id){
    for(let i = 0; i < DEV_FIXTURE_PRINCIPALS.length; i++){
      if(DEV_FIXTURE_PRINCIPALS[i].id === id) return DEV_FIXTURE_PRINCIPALS[i];
    }
    return null;
  }
  function copy(u){ return u ? Object.assign({}, u) : null; }

  // The provider handed to the test seam: the canonical getCurrentUser() only.
  const provider = Object.freeze({ getCurrentUser(){ return copy(installed); } });

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
    principals(){ return DEV_FIXTURE_PRINCIPALS.map(copy); },
    // Install a persona by id through the test seam. An unknown id installs nothing and
    // returns null — it never falls back to a CEO and never fabricates a principal.
    install(id){
      const u = find(id);
      if(!u) return null;
      installed = u;
      setIdentityProviderForTesting(provider);
      return copy(u);
    },
    // The installed persona (a copy), or null.
    current(){ return copy(installed); }
  });

  // Load-time install: only when the dev server set DEV_PERSONA; the banner only after a
  // successful install. On disk (null) nothing happens.
  if(DEV_PERSONA !== null){
    const u = api.install(DEV_PERSONA);
    if(u) banner(u);
  }
  return api;
})();
