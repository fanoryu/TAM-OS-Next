/* ============================================================
   AUTHENTICATED BOOT (AFI-2) — js/core/auth-boot.js
   ------------------------------------------------------------
   The SESSION-mode boot and sign-in state machine. It runs only when the explicit
   source constant AUTH_MODE (js/core/constants.js) is SESSION; in LOCAL mode —
   the shipped default — app-bootstrap.js never starts it and nothing here runs.

   STATES
     CHECKING_SESSION  GET /api/auth/me is in flight. Neutral checking view.
     SIGNED_OUT        /me said 401 (or the user signed out). Sign-in form.
     AUTHENTICATED     /me returned a valid projection. AFI-4a1: the read-only
                       SESSION Employee workspace (js/ui/session-workspace-view.js),
                       rendered by auth-view — never the business shell (D-A holds:
                       allowsWorkspace() stays false).
     UNAVAILABLE       /me could not be determined (403, 429, 5xx, network,
                       timeout, malformed answer) or the mode is invalid. Retry only.

   FIREWALL: no state ever loads local business state, runs a migration, opens the
   first-run choice, mounts the shell or "Acting as", or falls back to the local
   identity. allowsWorkspace() is false in every state. AFI-4a1: leaving
   AUTHENTICATED also destroys the in-memory SESSION Employee data
   (SessionEmployeeStore) — AFI-4b1: and the SESSION Overtime data
   (SessionOvertimeStore) — and sessionLost() is how a business read's 401 ends the
   session. AFI-4a2: sessionUncertain() is how a business write whose bounded CSRF
   recovery could not confirm the session ('unavailable') fails closed to UNAVAILABLE.

   AUTHORITY: identity comes only from SessionIdentityProvider.refresh() (GET
   /api/auth/me). The login response is never trusted as identity; a successful
   login is followed by /me. The server remains the authority; this is UX
   orchestration. Nothing is persisted and nothing is logged; the password is a
   parameter of signIn() only. No timer, no automatic retry.

   AFI-3: the credential flows (activation, recovery request, reset) are a
   subordinate machine, AuthFlow (js/core/auth-flow.js). It never touches identity;
   start() only gives it the first look at a credential link.

   Classic shared global scope; top-level `const` bindings, not on window.
   ============================================================ */

const AUTH_STATES = Object.freeze({
  CHECKING_SESSION: 'CHECKING_SESSION',
  SIGNED_OUT: 'SIGNED_OUT',
  AUTHENTICATED: 'AUTHENTICATED',
  UNAVAILABLE: 'UNAVAILABLE'
});

/* ---------- bounded 403 / stale-CSRF recovery (internal) ----------
   For a session-bound mutation. A 403 is answered before any handler side effect
   (origin, CSRF and record-free policy checks run in the kernel), so ONE replay is
   safe — but only when the 403 was a stale CSRF token of the SAME principal:
     1. send the mutation with the in-memory CSRF token          (request 1)
     2. not a 403 -> done
     3. GET /api/auth/me once                                     (request 2)
          401                -> recovery 'signed_out'   (no replay)
          any other failure  -> identity cleared, 'unavailable' (no replay)
          principal changed  -> 'principal_changed'     (no replay)
          token unchanged    -> 'token_unchanged': a genuine denial (no replay)
     4. otherwise replay exactly once with the new token          (request 3)
        and return that answer as final — a second 403 is never retried.
   At most three requests; a genuine authorization denial stays a denial. */
const samePrincipal = function(a, b){
  return !!a && !!b && a.id === b.id && a.principalType === b.principalType
    && (a.employeeId || null) === (b.employeeId || null);
};

const authSessionMutation = async function(path, body){
  const principal = SessionIdentityProvider.getCurrentUser();
  const token = CsrfHolder.get();
  const first = await ApiClient.request(path, { method: 'POST', body: body, csrf: true });
  if(first.ok || first.kind !== API_RESULT_KINDS.DENIED) return { result: first, recovery: 'none' };
  const me = await SessionIdentityProvider.refresh();
  if(!me.ok){
    if(me.kind === API_RESULT_KINDS.UNAUTHENTICATED) return { result: first, recovery: 'signed_out' };
    SessionIdentityProvider.clear();                       // fail closed: unknown session state
    return { result: first, recovery: 'unavailable' };
  }
  if(!samePrincipal(principal, SessionIdentityProvider.getCurrentUser())) return { result: first, recovery: 'principal_changed' };
  if(CsrfHolder.get() === token) return { result: first, recovery: 'token_unchanged' };
  const replay = await ApiClient.request(path, { method: 'POST', body: body, csrf: true });
  return { result: replay, recovery: 'replayed' };
};

/* ---------- AuthBoot — the state machine ---------- */
const AuthBoot = (function(){
  let state = AUTH_STATES.CHECKING_SESSION;
  let busy = false;          // a sign-in, sign-out or check is in flight
  let message = null;        // a fixed message key for the view (never server text)
  let retryAfter;            // seconds, from a 429 Retry-After
  let requestId;             // the server requestId of the last failure, for reference

  function paint(){ if(typeof render === 'function') render(); }

  function go(next, msg, extra){
    state = next;
    message = msg || null;
    retryAfter = extra && extra.retryAfter;
    requestId = extra && extra.requestId;
    if(next !== AUTH_STATES.AUTHENTICATED){
      SessionIdentityProvider.clear();
      SessionEmployeeStore.clear();          // AFI-4a1: no server business data outlives the identity
      SessionOvertimeStore.clear();          // AFI-4b1: nor the SESSION Overtime data
      SessionPayrollStore.clear();           // AFI-4c1: nor the SESSION Payroll data
      SessionAuditStore.clear();             // AFI-4g: nor the SESSION Audit data
    }
    paint();
  }

  // /me answer -> state. Only a successful, validated projection authenticates.
  function settle(res){
    if(res.ok && SessionIdentityProvider.getCurrentUser()) return go(AUTH_STATES.AUTHENTICATED);
    if(!res.ok && res.kind === API_RESULT_KINDS.UNAUTHENTICATED) return go(AUTH_STATES.SIGNED_OUT);
    return go(AUTH_STATES.UNAVAILABLE, 'unavailable', { requestId: res.requestId });
  }

  async function check(){
    busy = true;
    go(AUTH_STATES.CHECKING_SESSION);
    if(AUTH_MODE !== AUTH_MODES.SESSION){            // invalid mode: fail closed, never reach the API
      busy = false;
      return go(AUTH_STATES.UNAVAILABLE, 'unavailable');
    }
    const res = await SessionIdentityProvider.refresh();
    busy = false;
    settle(res);
  }

  const LOGIN_FAILURES = Object.freeze({
    UNAUTHENTICATED: 'credentials', RATE_LIMITED: 'rate_limited', VALIDATION: 'validation',
    DENIED: 'rejected', UNAVAILABLE: 'unavailable', SERVER_ERROR: 'unavailable'
  });

  return Object.freeze({
    // Boot entry (SESSION mode only; called by app-bootstrap.js). AFI-3: a credential
    // link (#recovery= / #activation=) opens its flow first, without checking the
    // session; the flow calls start() again when it ends, and /me decides from there.
    start(){
      if(AUTH_MODE === AUTH_MODES.SESSION && typeof AuthFlow !== 'undefined' && AuthFlow.beginFromLink()) return Promise.resolve();
      return check();
    },

    // UNAVAILABLE -> CHECKING_SESSION. Manual only; never scheduled.
    retry(){
      if(state !== AUTH_STATES.UNAVAILABLE || busy) return Promise.resolve();
      return check();
    },

    async signIn(email, password){
      if(state !== AUTH_STATES.SIGNED_OUT || busy) return;
      if(typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password){
        message = 'missing'; paint(); return;
      }
      busy = true; message = null; paint();
      const res = await ApiClient.request('/api/auth/login', { method: 'POST', body: { email: email, password: password } });
      if(!res.ok){
        busy = false;
        return go(AUTH_STATES.SIGNED_OUT, LOGIN_FAILURES[res.kind] || 'failed', { retryAfter: res.retryAfter, requestId: res.requestId });
      }
      // The login answer is transport success only: identity comes from /me.
      const me = await SessionIdentityProvider.refresh();
      busy = false;
      if(me.ok && SessionIdentityProvider.getCurrentUser()) return go(AUTH_STATES.AUTHENTICATED);
      if(!me.ok && me.kind === API_RESULT_KINDS.UNAUTHENTICATED) return go(AUTH_STATES.SIGNED_OUT, 'failed');
      return go(AUTH_STATES.UNAVAILABLE, 'unavailable', { requestId: me.requestId });
    },

    // Always ends SIGNED_OUT on this device. Only a confirmed server logout says so;
    // any other outcome warns that the server session may outlive this page.
    async signOut(){
      if(state !== AUTH_STATES.AUTHENTICATED || busy) return;
      busy = true; paint();
      const out = await authSessionMutation('/api/auth/logout', {});
      busy = false;
      const confirmed = out.result.ok || out.recovery === 'signed_out';
      go(AUTH_STATES.SIGNED_OUT, confirmed ? 'signed_out' : 'signout_unconfirmed', { requestId: out.result.requestId });
    },

    // AFI-4a1: a business read answered 401 — the session is gone. AUTHENTICATED ->
    // SIGNED_OUT ('session_ended'): identity, CSRF token and Employee data cleared.
    // No request is made. Any other failure is the workspace's, not the session's.
    sessionLost(){
      if(state !== AUTH_STATES.AUTHENTICATED) return;
      go(AUTH_STATES.SIGNED_OUT, 'session_ended');
    },

    // AFI-4a2: a business write's authSessionMutation ended with recovery 'unavailable' —
    // its /me check failed, so whether this session still exists is unknown. Fail closed:
    // AUTHENTICATED -> UNAVAILABLE (Retry re-checks /me); identity, CSRF token and Employee
    // data cleared. No request is made. Only that recovery outcome calls this.
    sessionUncertain(){
      if(state !== AUTH_STATES.AUTHENTICATED) return;
      go(AUTH_STATES.UNAVAILABLE, 'unavailable');
    },

    // AFI-2 grants no business workspace in any state (D-A).
    allowsWorkspace(){ return false; },

    // A read-only view model for js/ui/auth-view.js.
    snapshot(){
      return Object.freeze({
        state: state, busy: busy, message: message, retryAfter: retryAfter, requestId: requestId,
        principal: state === AUTH_STATES.AUTHENTICATED ? SessionIdentityProvider.getCurrentUser() : null
      });
    }
  });
})();
