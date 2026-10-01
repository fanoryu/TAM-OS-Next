/* ============================================================
   AUTH VIEWS (AFI-2) — js/ui/auth-view.js
   ------------------------------------------------------------
   The SESSION-mode screens, rendered into #app by the existing render() facade
   (js/ui/shell-render.js) whenever AuthBoot grants no workspace — which, in AFI-2,
   is always. Replacing #app unmounts any shell, so the business shell, the
   navigation, Global Search and "Acting as" never appear in SESSION mode.

     CHECKING_SESSION  "Checking your session…"
     SIGNED_OUT        sign-in form (email + password), with a fixed message
     AUTHENTICATED     AFI-4a1: the read-only SESSION Employee workspace —
                       renderSessionWorkspace() (js/ui/session-workspace-view.js),
                       called only from here — with the role label and Sign out
     UNAVAILABLE       explanation + Retry

   Every message is a fixed string chosen by key; no server text is shown. Every
   dynamic value is escaped. The password is read once on submit, the field is
   cleared at once, and it is handed to AuthBoot.signIn() — never stored, never
   logged, never put in a URL (the form posts nowhere: method="post", and submit
   is always intercepted). Listeners are bound to the freshly rendered nodes.

   AFI-3: while AuthFlow (js/core/auth-flow.js) owns the screen, its credential
   views replace these: forgot-password form and its one generic confirmation,
   reset and activation forms (new password + confirmation, autocomplete
   "new-password"), their done screens with an explicit "Continue to sign in", and
   the invalid-link screen. The link token never reaches this file. Both password
   fields are read once on submit and cleared at once; the confirmation is compared
   by AuthFlow and never sent.

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
  signout_unconfirmed: 'Signed out on this device. TAM OS could not confirm the sign-out with the server; that session ends on its own after a period of inactivity.',
  session_ended: 'Your session has ended. Sign in again to continue.'
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
      + '<div class="auth-actions"><button class="btn" id="authForgotBtn" type="button"' + dis + '>Forgot password?</button>'
      + '<button class="btn btn-accent" id="authSignInBtn" type="submit"' + dis + '>' + (s.busy ? 'Signing in…' : 'Sign in') + '</button></div>'
      + '</form>';
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
  const forgot = app.querySelector('#authForgotBtn');
  if(forgot) forgot.addEventListener('click', function(){ AuthFlow.openForgot(); });
}

/* ---------- AFI-3 credential-flow views ---------- */
const AUTH_FLOW_MESSAGES = Object.freeze({
  missing_email: 'Enter your email address.',
  missing_password: 'Enter the new password in both fields.',
  mismatch: 'The two passwords do not match. Enter them again.',
  policy: 'That password cannot be used. Choose a different one that follows the guidance above.',
  rate_limited: 'Too many attempts from this network.',
  rejected: 'The request was refused by TAM OS. Reload the page and try again.',
  rejected_link: 'The request was refused by TAM OS. Open the link from your message again.',
  unavailable: 'TAM OS could not be reached. Try again in a moment.',
  failed: 'The request did not complete. Try again.'
});

const AUTH_FLOW_POLICY_HINT = 'Use at least 12 characters. Very long passwords may be refused (the limit is 72 bytes, fewer characters for non-Latin text). Do not use your email address or a common password.';

// The email typed into the forgot-password form, so a failed request keeps it. Memory
// only; never shown in the confirmation.
let authFlowLastEmail = '';

function authFlowMessageHTML(f){
  if(!f.message || !AUTH_FLOW_MESSAGES[f.message]) return '<p class="auth-message" id="authMessage" role="alert"></p>';
  let text = AUTH_FLOW_MESSAGES[f.message];
  if(f.message === 'rate_limited') text += authWaitText(f.retryAfter);
  const ref = f.requestId ? ' Reference: ' + f.requestId + '.' : '';
  return '<p class="auth-message auth-message-warn" id="authMessage" role="alert">' + escapeHtml(text + ref) + '</p>';
}

function authFlowViewHTML(f){
  const head = function(title){ return '<h1 class="auth-title" id="authTitle" tabindex="-1">' + escapeHtml(title) + '</h1>'; };
  const dis = f.busy ? ' disabled' : '';
  const back = function(label){ return '<button class="btn" id="authBackBtn" type="button"' + dis + '>' + escapeHtml(label) + '</button>'; };
  let body;
  if(f.state === AUTH_FLOW_STATES.FORGOT_FORM){
    body = head('Reset your password')
      + '<p class="auth-lead">Enter the email address of your TAM OS account.</p>'
      + '<form class="auth-form" id="authForgotForm" method="post" novalidate' + (f.busy ? ' aria-busy="true"' : '') + '>'
      + '<div class="field"><label for="authForgotEmail">Email</label>'
      + '<input class="input" id="authForgotEmail" name="email" type="email" autocomplete="username" maxlength="254" required value="' + escapeHtml(authFlowLastEmail) + '"' + dis + '></div>'
      + authFlowMessageHTML(f)
      + '<div class="auth-actions">' + back('Back to sign in')
      + '<button class="btn btn-accent" id="authForgotSubmitBtn" type="submit"' + dis + '>' + (f.busy ? 'Sending…' : 'Send link') + '</button></div>'
      + '</form>';
  } else if(f.state === AUTH_FLOW_STATES.FORGOT_SENT){
    body = head('Check your email')
      + '<p class="auth-lead" role="status">If an account can be recovered, a link was sent. Use the most recent message. If none arrives, contact your administrator.</p>'
      + '<div class="auth-actions">' + back('Back to sign in') + '</div>';
  } else if(f.state === AUTH_FLOW_STATES.RESET_FORM || f.state === AUTH_FLOW_STATES.ACTIVATE_FORM){
    const activation = f.state === AUTH_FLOW_STATES.ACTIVATE_FORM;
    const submit = activation ? (f.busy ? 'Activating…' : 'Activate account') : (f.busy ? 'Saving…' : 'Set password');
    body = head(activation ? 'Activate your account' : 'Choose a new password')
      + '<p class="auth-lead">' + escapeHtml(activation ? 'Set the password for your TAM OS account.' : 'Set a new password for your TAM OS account.') + '</p>'
      + '<form class="auth-form" id="authNewPasswordForm" method="post" novalidate' + (f.busy ? ' aria-busy="true"' : '') + '>'
      + '<div class="field"><label for="authNewPassword">New password</label>'
      + '<input class="input" id="authNewPassword" name="new-password" type="password" autocomplete="new-password" aria-describedby="authPolicyHint" required' + dis + '>'
      + '<p class="hint" id="authPolicyHint">' + escapeHtml(AUTH_FLOW_POLICY_HINT) + '</p></div>'
      + '<div class="field"><label for="authConfirmPassword">Confirm new password</label>'
      + '<input class="input" id="authConfirmPassword" name="confirm-new-password" type="password" autocomplete="new-password" required' + dis + '></div>'
      + authFlowMessageHTML(f)
      + '<div class="auth-actions">' + back('Back to sign in')
      + '<button class="btn btn-accent" id="authNewPasswordSubmitBtn" type="submit"' + dis + '>' + submit + '</button></div>'
      + '</form>';
  } else if(f.state === AUTH_FLOW_STATES.RESET_DONE){
    body = head('Password changed')
      + '<p class="auth-lead" role="status">Your password was changed and every session of your account has ended. Sign in with the new password.</p>'
      + '<div class="auth-actions"><button class="btn btn-accent" id="authContinueBtn" type="button">Continue to sign in</button></div>';
  } else if(f.state === AUTH_FLOW_STATES.ACTIVATE_DONE){
    body = head('Account activated')
      + '<p class="auth-lead" role="status">Your password is set. Sign in to continue.</p>'
      + '<div class="auth-actions"><button class="btn btn-accent" id="authContinueBtn" type="button">Continue to sign in</button></div>';
  } else {
    const next = f.purpose === 'activation'
      ? 'If you already activated your account, sign in. Otherwise ask your administrator for a new activation link.'
      : 'If you just set a new password, sign in with it. Otherwise use "Forgot password?" on the sign-in page to get a new link.';
    body = head('This link cannot be used')
      + '<p class="auth-lead" role="alert">This link is invalid, has expired or was already used.</p>'
      + '<p class="auth-notice">' + escapeHtml(next) + '</p>'
      + '<div class="auth-actions">' + back('Back to sign in') + '</div>';
  }
  return '<main class="auth-screen" id="main"><section class="card auth-card" aria-labelledby="authTitle">' + body + '</section></main>';
}

function bindAuthFlowView(app){
  const forgotForm = app.querySelector('#authForgotForm');
  if(forgotForm){
    forgotForm.addEventListener('submit', function(e){
      e.preventDefault();
      const emailEl = forgotForm.querySelector('#authForgotEmail');
      const email = emailEl ? emailEl.value : '';
      authFlowLastEmail = email;
      AuthFlow.requestRecovery(email);
    });
  }
  const pwForm = app.querySelector('#authNewPasswordForm');
  if(pwForm){
    pwForm.addEventListener('submit', function(e){
      e.preventDefault();
      const newEl = pwForm.querySelector('#authNewPassword');
      const confirmEl = pwForm.querySelector('#authConfirmPassword');
      const first = newEl ? newEl.value : '';
      const second = confirmEl ? confirmEl.value : '';
      if(newEl) newEl.value = '';
      if(confirmEl) confirmEl.value = '';
      AuthFlow.submitPassword(first, second);
    });
  }
  const back = app.querySelector('#authBackBtn');
  if(back) back.addEventListener('click', function(){ AuthFlow.leave(); });
  const cont = app.querySelector('#authContinueBtn');
  if(cont) cont.addEventListener('click', function(){ AuthFlow.leave(); });
}

// The credential-flow view, while AuthFlow owns the screen.
function renderAuthFlowView(app){
  const f = AuthFlow.snapshot();
  if(f.state === AUTH_FLOW_STATES.FORGOT_SENT) authFlowLastEmail = '';
  app.innerHTML = authFlowViewHTML(f);
  bindAuthFlowView(app);
  let target = null;
  if(!f.busy && f.state === AUTH_FLOW_STATES.FORGOT_FORM){
    const email = app.querySelector('#authForgotEmail');
    if(email && !email.value) target = email;
  } else if(!f.busy && (f.state === AUTH_FLOW_STATES.RESET_FORM || f.state === AUTH_FLOW_STATES.ACTIVATE_FORM)){
    target = app.querySelector('#authNewPassword');
  }
  if(!target) target = app.querySelector('#authTitle');
  if(target && typeof target.focus === 'function') target.focus();
}

// Renders the view for the current AuthBoot state into #app (called by render()).
function renderAuthView(){
  if(typeof document === 'undefined') return;
  const app = document.getElementById('app');
  if(!app) return;
  const modal = document.getElementById('modal-root');
  if(modal) modal.innerHTML = '';
  if(typeof AuthFlow !== 'undefined' && AuthFlow.active()) return renderAuthFlowView(app);
  const s = AuthBoot.snapshot();
  if(s.state === AUTH_STATES.AUTHENTICATED) return renderSessionWorkspace(app, s);   // AFI-4a1
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
