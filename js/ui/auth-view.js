/* ============================================================
   AUTH VIEWS (AFI-2) — js/ui/auth-view.js
   ------------------------------------------------------------
   The SESSION-mode screens, rendered into #app by the existing render() facade
   (js/ui/shell-render.js) whenever AuthBoot grants no workspace — which, in AFI-2,
   is always. Replacing #app unmounts any shell, so the business shell, the
   navigation, Global Search and "Acting as" never appear in SESSION mode.

     CHECKING_SESSION  "Checking your session…"
     SIGNED_OUT        sign-in form (email + password), with a fixed message
     AUTHENTICATED     holding view: role label + Sign out (owner decision D-A)
     UNAVAILABLE       explanation + Retry

   Every message is a fixed string chosen by key; no server text is shown. Every
   dynamic value is escaped. The password is read once on submit, the field is
   cleared at once, and it is handed to AuthBoot.signIn() — never stored, never
   logged, never put in a URL (the form posts nowhere: method="post", and submit
   is always intercepted). Listeners are bound to the freshly rendered nodes.

   Classic shared global scope; mirrors identity-selector.js conventions.
   ============================================================ */

const AUTH_VIEW_MESSAGES = Object.freeze({
  missing: 'Enter your email address and password.',
  credentials: 'Email or password is incorrect, or this account cannot sign in.',
  rate_limited: 'Too many sign-in attempts.',
  validation: 'Sign-in could not be processed. Check your entries and try again.',
  rejected: 'Sign-in was refused by TAM OS. Reload the page and try again.',
  unavailable: 'TAM OS could not be reached. Try again in a moment.',
  failed: 'Sign-in did not complete. Try again.',
  signed_out: 'You have signed out.',
  signout_unconfirmed: 'Signed out on this device. TAM OS could not confirm the sign-out with the server; that session ends on its own after a period of inactivity.'
});

// The email of the last attempt, so a failed sign-in keeps it. Memory only; never the password.
let authViewLastEmail = '';

function authWaitText(seconds){
  if(typeof seconds !== 'number' || !(seconds > 0)) return '';
  if(seconds < 60) return ' Try again in ' + seconds + ' second' + (seconds === 1 ? '' : 's') + '.';
  const minutes = Math.ceil(seconds / 60);
  return ' Try again in about ' + minutes + ' minute' + (minutes === 1 ? '' : 's') + '.';
}

function authMessageHTML(s, alert){
  if(!s.message || !AUTH_VIEW_MESSAGES[s.message]) return '<p class="auth-message" id="authMessage" role="' + (alert ? 'alert' : 'status') + '"></p>';
  let text = AUTH_VIEW_MESSAGES[s.message];
  if(s.message === 'rate_limited') text += authWaitText(s.retryAfter);
  const ref = (s.requestId && s.message !== 'signed_out') ? ' Reference: ' + s.requestId + '.' : '';
  const tone = (s.message === 'signed_out') ? '' : ' auth-message-warn';
  return '<p class="auth-message' + tone + '" id="authMessage" role="' + (alert ? 'alert' : 'status') + '">' + escapeHtml(text + ref) + '</p>';
}

function authViewHTML(s){
  const head = function(title){ return '<h1 class="auth-title" id="authTitle" tabindex="-1">' + escapeHtml(title) + '</h1>'; };
  let body;
  if(s.state === AUTH_STATES.SIGNED_OUT){
    const dis = s.busy ? ' disabled' : '';
    body = head('Sign in to TAM OS')
      + '<form class="auth-form" id="authSignInForm" method="post" novalidate' + (s.busy ? ' aria-busy="true"' : '') + '>'
      + '<div class="field"><label for="authEmail">Email</label>'
      + '<input class="input" id="authEmail" name="email" type="email" autocomplete="username" maxlength="254" required value="' + escapeHtml(authViewLastEmail) + '"' + dis + '></div>'
      + '<div class="field"><label for="authPassword">Password</label>'
      + '<input class="input" id="authPassword" name="password" type="password" autocomplete="current-password" required' + dis + '></div>'
      + authMessageHTML(s, true)
      + '<div class="auth-actions"><button class="btn btn-accent" id="authSignInBtn" type="submit"' + dis + '>' + (s.busy ? 'Signing in…' : 'Sign in') + '</button></div>'
      + '</form>';
  } else if(s.state === AUTH_STATES.AUTHENTICATED){
    const who = (s.principal && s.principal.displayName) ? s.principal.displayName : '';
    body = head('Signed in')
      + '<p class="auth-lead">Signed in as <strong>' + escapeHtml(who) + '</strong>.</p>'
      + '<p class="auth-notice">Your TAM OS workspace is not available in this sign-in mode yet.</p>'
      + '<div class="auth-actions"><button class="btn" id="authSignOutBtn" type="button"' + (s.busy ? ' disabled aria-busy="true"' : '') + '>' + (s.busy ? 'Signing out…' : 'Sign out') + '</button></div>';
  } else if(s.state === AUTH_STATES.UNAVAILABLE){
    body = head('TAM OS is unavailable')
      + '<p class="auth-lead">Your session could not be confirmed. Check your connection, then try again.</p>'
      + authMessageHTML(s, true)
      + '<div class="auth-actions"><button class="btn btn-accent" id="authRetryBtn" type="button"' + (s.busy ? ' disabled' : '') + '>Retry</button></div>';
  } else {
    body = head('TAM OS') + '<p class="auth-lead" role="status">Checking your session…</p>';
  }
  return '<main class="auth-screen" id="main"><section class="card auth-card" aria-labelledby="authTitle">' + body + '</section></main>';
}

function bindAuthView(app){
  const form = app.querySelector('#authSignInForm');
  if(form){
    form.addEventListener('submit', function(e){
      e.preventDefault();
      const emailEl = form.querySelector('#authEmail');
      const passEl = form.querySelector('#authPassword');
      const email = emailEl ? emailEl.value : '';
      const password = passEl ? passEl.value : '';
      if(passEl) passEl.value = '';
      authViewLastEmail = email;
      AuthBoot.signIn(email, password);
    });
  }
  const out = app.querySelector('#authSignOutBtn');
  if(out) out.addEventListener('click', function(){ AuthBoot.signOut(); });
  const retry = app.querySelector('#authRetryBtn');
  if(retry) retry.addEventListener('click', function(){ AuthBoot.retry(); });
}

// Renders the view for the current AuthBoot state into #app (called by render()).
function renderAuthView(){
  if(typeof document === 'undefined') return;
  const app = document.getElementById('app');
  if(!app) return;
  const modal = document.getElementById('modal-root');
  if(modal) modal.innerHTML = '';
  const s = AuthBoot.snapshot();
  app.innerHTML = authViewHTML(s);
  bindAuthView(app);
  // Focus: the first empty sign-in field when the form is usable, else the heading.
  let target = null;
  if(s.state === AUTH_STATES.SIGNED_OUT && !s.busy){
    const email = app.querySelector('#authEmail');
    target = (email && !email.value) ? email : app.querySelector('#authPassword');
  }
  if(!target) target = app.querySelector('#authTitle');
  if(target && typeof target.focus === 'function') target.focus();
}
