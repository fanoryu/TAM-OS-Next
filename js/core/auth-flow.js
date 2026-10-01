/* ============================================================
   CREDENTIAL FLOWS (AFI-3) — js/core/auth-flow.js
   ------------------------------------------------------------
   The SESSION-mode credential flows: account activation, the password-recovery
   request and the password reset. A state machine SUBORDINATE to AuthBoot
   (js/core/auth-boot.js): AuthBoot stays the only authority for session and
   identity truth. These flows need no session and establish none — the backend
   answers activate and reset without creating a session or setting a cookie, so
   the user always signs in afterwards.

   STATES
     IDLE            no flow; AuthBoot's own view is shown.
     FORGOT_FORM     email form (entered only from AuthBoot's SIGNED_OUT).
     FORGOT_SENT     the ONE generic confirmation, whatever the address.
     RESET_FORM      new password + confirmation, from a #recovery= link.
     RESET_DONE      password changed; "Continue to sign in".
     ACTIVATE_FORM   new password + confirmation, from an #activation= link.
     ACTIVATE_DONE   account activated; "Continue to sign in".
     LINK_INVALID    the link was malformed, or the server refused its token
                     (invalid, expired, used, revoked alike — never told apart).

   LINKS (owner decision D-A): `<origin>/#recovery=<token>` (built by the backend,
   server/src/Mail/RecoveryMail.php) and `<origin>/#activation=<token>` (composed by
   the operator from the CLI token). The token is in the FRAGMENT, so no server,
   proxy or Referer sees it. A credential fragment is read once — at SESSION start
   or on hashchange — and stripped at once with history.replaceState (no new
   history entry). The token then lives only in this closure: never in the view
   model, the DOM, State, storage, a cookie, a URL or a log. LOCAL mode never
   reaches this module.

   CONTRACT (server/src/Controller/AuthController.php): all three routes are
   RouteAuth::None — no session is resolved and no CSRF token is sent.
     POST /api/auth/activate         { token, password }  -> { activated: true }
     POST /api/auth/forgot-password  { email }            -> { requested: true }
     POST /api/auth/reset-password   { token, password }  -> { reset: true }
   The password confirmation (owner decision D-B) is compared here and never sent.
   One request in flight; no timer, no polling, no automatic retry.

   Classic shared global scope; top-level `const` bindings, not on window.
   ============================================================ */

const AUTH_FLOW_STATES = Object.freeze({
  IDLE: 'IDLE',
  FORGOT_FORM: 'FORGOT_FORM',
  FORGOT_SENT: 'FORGOT_SENT',
  RESET_FORM: 'RESET_FORM',
  RESET_DONE: 'RESET_DONE',
  ACTIVATE_FORM: 'ACTIVATE_FORM',
  ACTIVATE_DONE: 'ACTIVATE_DONE',
  LINK_INVALID: 'LINK_INVALID'
});

// Exactly one credential link: the purpose, '=', one 43-character token, nothing else.
const AUTH_LINK_PATTERN = /^#(recovery|activation)=([A-Za-z0-9_-]{43})$/;
// Any fragment that claims to be a credential link — stripped even when it is malformed.
const AUTH_LINK_PREFIX = /^#(recovery|activation)(?![A-Za-z0-9_-])/;

// '#recovery=<token>' -> { purpose, token }; anything else -> null.
const parseAuthLink = function(hash){
  if(typeof hash !== 'string') return null;
  const m = AUTH_LINK_PATTERN.exec(hash);
  return m ? { purpose: m[1], token: m[2] } : null;
};

const AuthFlow = (function(){
  let state = AUTH_FLOW_STATES.IDLE;
  let purpose = null;        // 'recovery' | 'activation' while a link flow is open
  let token = null;          // the link token: this closure only
  let busy = false;          // one request in flight
  let message = null;        // a fixed message key for the view (never server text)
  let retryAfter;            // seconds, from a 429 Retry-After
  let requestId;             // the server requestId of the last failure, for reference
  let listening = false;

  function paint(){ if(typeof render === 'function') render(); }

  function set(next, msg, extra){
    state = next;
    message = msg || null;
    retryAfter = extra && extra.retryAfter;
    requestId = extra && extra.requestId;
    paint();
  }

  function sessionMode(){ return AUTH_MODE === AUTH_MODES.SESSION; }

  // Reads a credential fragment once and strips it from the current history entry.
  // null when the fragment is not a credential link (it is then left untouched).
  function takeLink(){
    const hash = (typeof location !== 'undefined' && location && typeof location.hash === 'string') ? location.hash : '';
    if(!AUTH_LINK_PREFIX.test(hash)) return null;
    if(typeof history !== 'undefined' && history && typeof history.replaceState === 'function'){
      history.replaceState(null, '', location.pathname + location.search);
    }
    return parseAuthLink(hash) || { purpose: hash.indexOf('#activation') === 0 ? 'activation' : 'recovery', token: null };
  }

  function enter(link){
    busy = false;
    purpose = link.purpose;
    token = link.token;
    if(!token) return set(AUTH_FLOW_STATES.LINK_INVALID);
    set(purpose === 'activation' ? AUTH_FLOW_STATES.ACTIVATE_FORM : AUTH_FLOW_STATES.RESET_FORM);
  }

  // A link opened into an already-loaded tab. Stripped in every case; never ingested
  // while a request (a flow's or AuthBoot's) is in flight.
  function onHashChange(){
    if(!sessionMode()) return;
    const link = takeLink();
    if(!link || busy || AuthBoot.snapshot().busy) return;
    enter(link);
  }

  // Failure kind -> fixed message key. Nothing here depends on an account.
  const FAILURES = Object.freeze({
    RATE_LIMITED: 'rate_limited', DENIED: 'rejected', CLIENT_FAULT: 'failed', VALIDATION: 'failed',
    UNAUTHENTICATED: 'unavailable', NOT_FOUND: 'unavailable', CONFLICT: 'unavailable',
    SERVER_ERROR: 'unavailable', UNAVAILABLE: 'unavailable'
  });

  // A success answer must be exactly the documented data object; anything else is not success.
  function exactly(data, key){
    return !!data && typeof data === 'object' && !Array.isArray(data)
      && Object.keys(data).length === 1 && data[key] === true;
  }

  function onlyField(res, name){
    return Array.isArray(res.fields) && res.fields.length === 1 && res.fields[0] === name;
  }

  return Object.freeze({
    // SESSION start (called by AuthBoot.start() only): true when a credential link
    // was found, so AuthBoot shows the flow instead of checking the session first.
    beginFromLink(){
      if(!sessionMode()) return false;
      if(!listening && typeof window !== 'undefined' && typeof window.addEventListener === 'function'){
        window.addEventListener('hashchange', onHashChange);
        listening = true;
      }
      if(state !== AUTH_FLOW_STATES.IDLE) return false;
      const link = takeLink();
      if(!link) return false;
      enter(link);
      return true;
    },

    // "Forgot password?" — only from AuthBoot's SIGNED_OUT, with nothing in flight.
    openForgot(){
      if(!sessionMode() || state !== AUTH_FLOW_STATES.IDLE || busy) return;
      const s = AuthBoot.snapshot();
      if(s.state !== AUTH_STATES.SIGNED_OUT || s.busy) return;
      purpose = 'recovery';
      set(AUTH_FLOW_STATES.FORGOT_FORM);
    },

    async requestRecovery(email){
      if(state !== AUTH_FLOW_STATES.FORGOT_FORM || busy) return;
      if(typeof email !== 'string' || !email.trim()){ message = 'missing_email'; paint(); return; }
      busy = true; message = null; paint();
      const res = await ApiClient.request('/api/auth/forgot-password', { method: 'POST', body: { email: email } });
      busy = false;
      if(state !== AUTH_FLOW_STATES.FORGOT_FORM) return;
      if(res.ok && exactly(res.data, 'requested')) return set(AUTH_FLOW_STATES.FORGOT_SENT);
      const fail = res.ok ? 'unavailable' : (FAILURES[res.kind] || 'unavailable');
      set(AUTH_FLOW_STATES.FORGOT_FORM, fail, { retryAfter: res.retryAfter, requestId: res.requestId });
    },

    // Activation or reset, by the open link flow. The confirmation never leaves here.
    async submitPassword(password, confirmation){
      const form = state;
      if((form !== AUTH_FLOW_STATES.RESET_FORM && form !== AUTH_FLOW_STATES.ACTIVATE_FORM) || busy || !token) return;
      if(typeof password !== 'string' || !password || typeof confirmation !== 'string' || !confirmation){
        message = 'missing_password'; paint(); return;
      }
      if(password !== confirmation){ message = 'mismatch'; paint(); return; }
      const activation = form === AUTH_FLOW_STATES.ACTIVATE_FORM;
      busy = true; message = null; paint();
      const res = await ApiClient.request(activation ? '/api/auth/activate' : '/api/auth/reset-password', { method: 'POST', body: { token: token, password: password } });
      busy = false;
      if(state !== form) return;
      if(res.ok && exactly(res.data, activation ? 'activated' : 'reset')){
        token = null;
        return set(activation ? AUTH_FLOW_STATES.ACTIVATE_DONE : AUTH_FLOW_STATES.RESET_DONE);
      }
      if(!res.ok && res.kind === API_RESULT_KINDS.VALIDATION && onlyField(res, 'token')){
        token = null;                                       // dead for good: never retried
        return set(AUTH_FLOW_STATES.LINK_INVALID);
      }
      if(!res.ok && res.kind === API_RESULT_KINDS.VALIDATION && onlyField(res, 'password')){
        return set(form, 'policy', { requestId: res.requestId });   // the token was not consumed
      }
      const fail = res.ok ? 'unavailable' : (FAILURES[res.kind] || 'unavailable');
      set(form, fail === 'rejected' ? 'rejected_link' : fail, { retryAfter: res.retryAfter, requestId: res.requestId });
    },

    // "Back to sign in" / "Continue to sign in": the flow ends, the token is dropped and
    // AuthBoot checks the session again — /me is authoritative.
    leave(){
      if(state === AUTH_FLOW_STATES.IDLE || busy) return Promise.resolve();
      state = AUTH_FLOW_STATES.IDLE;
      purpose = null; token = null; message = null; retryAfter = undefined; requestId = undefined;
      return AuthBoot.start();
    },

    // True while a flow owns the auth screen.
    active(){ return state !== AUTH_FLOW_STATES.IDLE; },

    // A read-only view model for js/ui/auth-view.js. Never the token.
    snapshot(){
      return Object.freeze({ state: state, purpose: purpose, busy: busy, message: message, retryAfter: retryAfter, requestId: requestId });
    }
  });
})();
