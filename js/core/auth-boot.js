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
                       rendered by auth-view inside the SESSION shell (U1, D-GS-1:
                       allowsWorkspace()) — never the LOCAL business shell.
     UNAVAILABLE       /me could not be determined (403, 429, 5xx, network,
                       timeout, malformed answer) or the mode is invalid. Retry only.

   FIREWALL: no state ever loads local business state, runs a migration, opens the
   first-run choice, mounts the shell or "Acting as", or falls back to the local
   identity. allowsWorkspace() is false outside AUTHENTICATED. AFI-4a1: leaving
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

   WP-1 (Account security): while AUTHENTICATED, the signed-in user's own Change password
   (POST /api/auth/change-password) and Sign out all devices (POST /api/auth/logout-all),
   each sent ONCE with the in-memory CSRF token and never replayed — not even after a 403.
   The panel state is memory only and is reset by every state change (go()). The passwords
   are parameters of changePassword() only: never stored, logged or put in the view model.
     change-password 200   the server rotated the session: the answer must be the exact
                           projection of the same principal with a new CSRF token; the
                           token is installed and GET /api/auth/me must confirm the same
                           principal AND that token. Anything else fails closed.
     uncertain outcome     (503, network, timeout, 500, a malformed 200) never resent: /me
                           once — 401 ends the session ('password_unconfirmed'); a live
                           session stays, Change password is not offered again in it.
     logout-all            confirmed ONLY by a 200 that is exactly { loggedOut: true } ->
                           SIGNED_OUT 'signed_out_all'. 401 -> SIGNED_OUT unconfirmed; an
                           uncertain outcome re-checks /me once; nothing else says "done".

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
    account = freshAccount();                // WP-1: no Account security panel outlives a state change
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
      SessionLedgerStore.clear();           // Phase 1: nor the SESSION Finance data
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

  /* ---------- WP-1: Account security (memory only) ----------
     panel     null | 'menu' | 'password' | 'logout_all'
     busy      a change-password or logout-all request (or its /me check) is in flight
     message   a fixed failure key for the open panel; notice: a fixed outcome key
     locked    an uncertain password change happened in this session: never offered again
     focus     a one-shot focus request for the view (takeAccountFocus) */
  let account = freshAccount();
  function freshAccount(){
    return { panel: null, busy: false, message: null, retryAfter: undefined, requestId: undefined, notice: null, locked: false, focus: null };
  }
  function accountPaint(focus){ account.focus = focus || null; paint(); }
  // A refusal the server answered before acting (or a local refusal): stays signed in, panel open.
  function accountFailed(msg, res){
    account.busy = false;
    account.message = msg;
    account.retryAfter = res && res.retryAfter;
    account.requestId = res && res.requestId;
    accountPaint('message');
  }
  const PASSWORD_FAILURES = Object.freeze({
    RATE_LIMITED: 'pw_rate_limited', CONFLICT: 'pw_conflict', DENIED: 'pw_rejected',
    CLIENT_FAULT: 'pw_failed', NOT_FOUND: 'pw_failed'
  });
  const onlyField = function(res, name){ return !!res.fields && res.fields.length === 1 && res.fields[0] === name; };
  // An answer whose effect is unknown (503, network, timeout, 500, a malformed 200): the change
  // is NEVER resent. /me once decides what this device can still say.
  async function passwordUncertain(principal, res){
    account.locked = true;
    const me = await SessionIdentityProvider.refresh();
    if(state !== AUTH_STATES.AUTHENTICATED) return;
    account.busy = false;
    if(!me.ok && me.kind === API_RESULT_KINDS.UNAUTHENTICATED) return go(AUTH_STATES.SIGNED_OUT, 'password_unconfirmed', { requestId: res.requestId });
    if(!me.ok || !samePrincipal(principal, SessionIdentityProvider.getCurrentUser())) return go(AUTH_STATES.UNAVAILABLE, 'unavailable', { requestId: me.requestId });
    account.panel = null; account.message = null;
    account.notice = 'pw_unconfirmed'; account.requestId = res.requestId;
    accountPaint('notice');
  }
  // 200: the server revoked every session and issued this device a new one (new cookie, new
  // CSRF token in the answer). Accepted only when the answer is the exact projection of the
  // same principal and /me, under the new cookie, confirms that principal and that token.
  async function passwordChanged(principal, res){
    const rotated = mapSessionProjection(res.data);
    if(!rotated || !samePrincipal(principal, rotated.principal)) return passwordUncertain(principal, res);
    CsrfHolder.replace(rotated.csrfToken);
    const me = await SessionIdentityProvider.refresh();
    if(state !== AUTH_STATES.AUTHENTICATED) return;
    account.busy = false;
    if(!me.ok && me.kind === API_RESULT_KINDS.UNAUTHENTICATED) return go(AUTH_STATES.SIGNED_OUT, 'session_ended');
    if(!me.ok || !samePrincipal(principal, SessionIdentityProvider.getCurrentUser()) || CsrfHolder.get() !== rotated.csrfToken){
      return go(AUTH_STATES.UNAVAILABLE, 'unavailable', { requestId: me.requestId });
    }
    account.panel = null; account.message = null; account.notice = 'pw_changed';
    accountPaint('notice');
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
      if(state !== AUTH_STATES.AUTHENTICATED || busy || account.busy) return;
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

    // WP-1: the Account security panel. 'menu' | 'password' | 'logout_all'; never while a
    // request is in flight; Change password is not offered after an uncertain change.
    openAccount(panel){
      if(state !== AUTH_STATES.AUTHENTICATED || busy || account.busy) return;
      if(panel !== 'menu' && panel !== 'password' && panel !== 'logout_all') return;
      if(panel === 'password' && account.locked) return;
      account.panel = panel; account.message = null; account.retryAfter = undefined; account.requestId = undefined; account.notice = null;
      accountPaint(panel === 'password' ? 'current' : 'panel');
    },
    closeAccount(){
      if(state !== AUTH_STATES.AUTHENTICATED || account.busy || !account.panel) return;
      account.panel = null; account.message = null; account.retryAfter = undefined; account.requestId = undefined;
      accountPaint('opener');
    },

    // WP-1: POST /api/auth/change-password, exactly { currentPassword, newPassword }, CSRF,
    // sent once. The confirmation is compared here and never sent. No replay of any kind.
    async changePassword(currentPassword, newPassword, confirmPassword){
      if(state !== AUTH_STATES.AUTHENTICATED || busy || account.busy || account.panel !== 'password' || account.locked) return;
      if(typeof currentPassword !== 'string' || typeof newPassword !== 'string' || typeof confirmPassword !== 'string'
        || !currentPassword || !newPassword || !confirmPassword) return accountFailed('pw_missing');
      if(newPassword !== confirmPassword) return accountFailed('pw_mismatch');
      const principal = SessionIdentityProvider.getCurrentUser();
      account.busy = true; account.message = null; account.retryAfter = undefined; account.requestId = undefined; accountPaint();
      const res = await ApiClient.request('/api/auth/change-password', { method: 'POST', body: { currentPassword: currentPassword, newPassword: newPassword }, csrf: true });
      if(state !== AUTH_STATES.AUTHENTICATED) return;
      if(res.ok) return passwordChanged(principal, res);
      if(res.kind === API_RESULT_KINDS.UNAVAILABLE || res.kind === API_RESULT_KINDS.SERVER_ERROR) return passwordUncertain(principal, res);
      if(res.kind === API_RESULT_KINDS.UNAUTHENTICATED) return go(AUTH_STATES.SIGNED_OUT, 'session_ended');
      if(res.kind === API_RESULT_KINDS.VALIDATION){
        return accountFailed(onlyField(res, 'currentPassword') ? 'pw_current' : (onlyField(res, 'newPassword') ? 'pw_policy' : 'pw_failed'), res);
      }
      accountFailed(PASSWORD_FAILURES[res.kind] || 'pw_failed', res);
    },

    // WP-1: POST /api/auth/logout-all {} with CSRF, sent once. Only the exact { loggedOut: true }
    // confirms it; this device then always ends SIGNED_OUT.
    async signOutAll(){
      if(state !== AUTH_STATES.AUTHENTICATED || busy || account.busy || account.panel !== 'logout_all') return;
      const principal = SessionIdentityProvider.getCurrentUser();
      account.busy = true; account.message = null; account.retryAfter = undefined; account.requestId = undefined; accountPaint();
      const res = await ApiClient.request('/api/auth/logout-all', { method: 'POST', body: {}, csrf: true });
      if(state !== AUTH_STATES.AUTHENTICATED) return;
      const data = res.ok ? res.data : null;
      if(res.ok && !!data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 1 && data.loggedOut === true){
        return go(AUTH_STATES.SIGNED_OUT, 'signed_out_all');
      }
      if(!res.ok && res.kind === API_RESULT_KINDS.UNAUTHENTICATED) return go(AUTH_STATES.SIGNED_OUT, 'signout_all_unconfirmed', { requestId: res.requestId });
      if(res.ok || res.kind === API_RESULT_KINDS.UNAVAILABLE || res.kind === API_RESULT_KINDS.SERVER_ERROR){
        const me = await SessionIdentityProvider.refresh();
        if(state !== AUTH_STATES.AUTHENTICATED) return;
        if(!me.ok && me.kind === API_RESULT_KINDS.UNAUTHENTICATED) return go(AUTH_STATES.SIGNED_OUT, 'signout_all_unconfirmed', { requestId: res.requestId });
        if(!me.ok || !samePrincipal(principal, SessionIdentityProvider.getCurrentUser())) return go(AUTH_STATES.UNAVAILABLE, 'unavailable', { requestId: me.requestId });
        return accountFailed('all_unconfirmed', res);
      }
      accountFailed(res.kind === API_RESULT_KINDS.RATE_LIMITED ? 'all_rate_limited' : (res.kind === API_RESULT_KINDS.DENIED ? 'all_rejected' : 'all_failed'), res);
    },

    // WP-1: the view's one-shot focus request after a paint ('current' | 'panel' | 'message' |
    // 'notice' | 'opener' | null).
    takeAccountFocus(){ const f = account.focus; account.focus = null; return f; },

    // U1 (D-GS-1, GR-4): the SESSION shell only — AUTHENTICATED with a principal that has a
    // navigation model (sessionNavModel, js/ui/session-workspace-view.js). Never the LOCAL shell: render() sends every
    // SESSION paint to renderAuthView(). Every other state, and an unknown role, is false.
    allowsWorkspace(){
      return state === AUTH_STATES.AUTHENTICATED && typeof sessionNavModel === 'function'
        && sessionNavModel(SessionIdentityProvider.getCurrentUser()) !== null;
    },

    // A read-only view model for js/ui/auth-view.js.
    snapshot(){
      return Object.freeze({
        state: state, busy: busy, message: message, retryAfter: retryAfter, requestId: requestId,
        principal: state === AUTH_STATES.AUTHENTICATED ? SessionIdentityProvider.getCurrentUser() : null,
        // WP-1: the Account security panel (fixed keys only; never a password).
        account: Object.freeze({ panel: account.panel, busy: account.busy, message: account.message, retryAfter: account.retryAfter,
          requestId: account.requestId, notice: account.notice, locked: account.locked })
      });
    }
  });
})();
