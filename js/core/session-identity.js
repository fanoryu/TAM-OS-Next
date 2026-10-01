/* ============================================================
   SESSION IDENTITY FOUNDATION (AFI-1) — js/core/session-identity.js
   ------------------------------------------------------------
   The authoritative identity source for the future authenticated mode: a
   SessionIdentityProvider that satisfies the existing canonical seam
   (getCurrentUser() -> User | null, js/core/identity.js) from the backend's
   GET /api/auth/me, plus the in-memory CsrfHolder for that session.

   HEADLESS AND INERT (AFI-1): nothing installs this provider and nothing calls
   refresh(). LocalIdentityProvider stays the active provider, "Acting as" is
   unchanged, and normal boot makes no request. Installing it is AFI-2 work,
   behind one explicit source constant (owner decision D1) — never inferred from
   backend availability, a response, the hostname or a cookie. There is NO
   fallback in either direction: this module never references the local
   adapter or its fixtures, and no failure here produces a principal.

   AUTHORITY: the server is the authority (SDR-0002 §23). The principal is built
   ONLY from the /me projection — never from State, storage, the DOM or any
   other client value — and is UX projection, not a security control. The
   backend re-derives role, company and employee binding on every request.

   /me PROJECTION (server/src/Controller/AuthController.php::me):
     { userId, membershipId, role, employeeId: string|null, csrfToken }
   Exactly these keys; anything else is refused (fail closed). Mapping:
     userId     -> id
     role       -> principalType ('ceo' | 'employee'; unknown -> refused)
     employeeId -> employeeId (Employee: required; CEO: optional binding, kept
                   only when present — User != Employee)
     displayName   a fixed role label ('CEO' / 'Employee'): UX only, never a
                   personal name
     membershipId  validated, not retained (no consumer needs it)
     csrfToken     validated, then held by CsrfHolder — NEVER part of the principal

   CSRF: memory only. Never in State, localStorage, sessionStorage,
   StorageAdapter, a JS cookie, a URL or the DOM; gone on reload (the next
   /me returns it again).

   Classic shared global scope; top-level `const` bindings, NOT on window.
   ============================================================ */

/* ---------- CsrfHolder — the session's synchronizer token, in memory only ---------- */
const CsrfHolder = (function(){
  let token = null;                 // begins empty; never persisted
  return Object.freeze({
    get(){ return token; },
    // Accepts only a well-formed token (server SessionToken shape); refuses anything else.
    replace(next){
      if(typeof next !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(next)) return false;
      token = next;
      return true;
    },
    clear(){ token = null; }
  });
})();

/* ---------- /me projection -> principal (internal) ----------
   Returns { principal, csrfToken } or null. Pure: reads only its argument. */
const SESSION_PROJECTION_KEYS = Object.freeze(['csrfToken', 'employeeId', 'membershipId', 'role', 'userId']);
const SESSION_ROLE_LABELS = Object.freeze({ ceo: 'CEO', employee: 'Employee' });

const isSessionIdentifier = function(v){
  return typeof v === 'string' && v.length > 0 && v.length <= 64 && /^[\x21-\x7e]+$/.test(v);
};

const mapSessionProjection = function(data){
  if(!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const keys = Object.keys(data).sort();
  if(keys.length !== SESSION_PROJECTION_KEYS.length) return null;
  for(let i = 0; i < keys.length; i++){ if(keys[i] !== SESSION_PROJECTION_KEYS[i]) return null; }
  if(!isSessionIdentifier(data.userId) || !isSessionIdentifier(data.membershipId)) return null;
  if(typeof data.csrfToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.csrfToken)) return null;
  const role = data.role;
  if(role !== PRINCIPAL_TYPES.CEO && role !== PRINCIPAL_TYPES.EMPLOYEE) return null;
  const binding = data.employeeId;
  if(binding !== null && !isSessionIdentifier(binding)) return null;
  if(role === PRINCIPAL_TYPES.EMPLOYEE && binding === null) return null;
  const principal = { id: data.userId, displayName: SESSION_ROLE_LABELS[role], principalType: role };
  if(binding !== null) principal.employeeId = binding;
  if(!isValidUser(principal)) return null;
  return { principal: Object.freeze(principal), csrfToken: data.csrfToken };
};

/* ---------- SessionIdentityProvider ----------
   getCurrentUser() is synchronous (the canonical seam); refresh() is the only
   way identity changes. Outcomes of refresh():
     /me 200 + valid projection -> principal set, CSRF token replaced
     401, or a 200 with an invalid projection -> principal AND token cleared
     any other failure (unavailable, rate limited, ...) -> nothing changes;
       the result reports the kind and the caller decides (AFI-2 state machine)
   Concurrent refresh() calls share one in-flight request. */
const SessionIdentityProvider = (function(){
  let current = null;
  let inFlight = null;

  function clearIdentity(){ current = null; CsrfHolder.clear(); }

  async function load(){
    const res = await ApiClient.request('/api/auth/me', { method: 'GET' });
    if(!res.ok){
      if(res.kind === API_RESULT_KINDS.UNAUTHENTICATED) clearIdentity();
      return Object.freeze({ ok: false, kind: res.kind, requestId: res.requestId });
    }
    const mapped = mapSessionProjection(res.data);
    if(!mapped){
      clearIdentity();
      return Object.freeze({ ok: false, kind: API_RESULT_KINDS.UNAVAILABLE, requestId: res.requestId });
    }
    current = mapped.principal;
    CsrfHolder.replace(mapped.csrfToken);
    return Object.freeze({ ok: true, requestId: res.requestId });
  }

  return Object.freeze({
    // CANONICAL method: a copy of the authoritative principal, or null.
    getCurrentUser(){ return current ? Object.assign({}, current) : null; },
    refresh(){
      if(!inFlight){
        inFlight = load().finally(function(){ inFlight = null; });
      }
      return inFlight;
    },
    // Forget the identity and its CSRF token locally (logout, session loss).
    clear(){ clearIdentity(); }
  });
})();
