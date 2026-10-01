/* ============================================================
   SESSION EMPLOYEE WORKSPACE VIEW (AFI-4a1) — js/ui/session-workspace-view.js
   ------------------------------------------------------------
   The read-only SESSION workspace, rendered into #app by renderAuthView()
   (js/ui/auth-view.js) — its only caller — while AuthBoot is AUTHENTICATED. It is
   NOT the business shell: AuthBoot.allowsWorkspace() stays false, so render()
   never mounts the shell, its navigation, Global Search or "Acting as", and no
   other domain (Overtime, Payroll, Finance) has an entry here.

     CEO       Employees: Active / Archived tabs, the company list, a record's
               detail; the derived account state is status text only.
     Employee  My profile: their own record, read-only, exactly the self fields.

   Data comes only from SessionWorkspace / SessionEmployeeStore
   (js/core/session-employee.js); nothing is written here but the DOM. There is no
   create, edit, archive or account control. Every message is a fixed string;
   every server value is escaped, and money is shown exactly as the server sent it.
   The opaque record id never appears in the page: a row is opened by its position
   in the list that was rendered.

   Classic shared global scope; existing CSS classes only.
   ============================================================ */

const SESSION_WORKSPACE_ACCOUNT_LABELS = Object.freeze({
  none: 'No login', pending: 'Activation pending', active: 'Login active', disabled: 'Login disabled'
});
const SESSION_WORKSPACE_ERRORS = Object.freeze({
  DENIED: 'You do not have access to this information.',
  NOT_FOUND: 'This record was not found.',
  CONFLICT: 'TAM OS reported a conflict. Try again.',
  RATE_LIMITED: 'Too many requests.',
  VALIDATION: 'TAM OS could not process this request.',
  CLIENT_FAULT: 'TAM OS could not process this request.',
  SERVER_ERROR: 'Employee information could not be loaded. Try again in a moment.',
  UNAVAILABLE: 'Employee information could not be loaded. Check your connection, then try again.',
  INVALID_RESPONSE: 'TAM OS sent an unexpected response. Try again in a moment.'
});
const SESSION_WORKSPACE_SELF_MISSING = 'Your profile is not available right now. Try again in a moment.';

function sessionWorkspaceValue(v){
  return (v === null || v === undefined || v === '') ? '—' : escapeHtml(String(v));
}

function sessionWorkspaceRows(rows){
  return '<div class="table-wrap"><table><tbody>'
    + rows.map(function(r){ return '<tr><th scope="row">' + escapeHtml(r[0]) + '</th><td>' + sessionWorkspaceValue(r[1]) + '</td></tr>'; }).join('')
    + '</tbody></table></div>';
}

// The failure message, with the wait for a 429 and the server reference when known.
function sessionWorkspaceErrorHTML(error, text){
  let msg = text || SESSION_WORKSPACE_ERRORS[error.kind] || SESSION_WORKSPACE_ERRORS.UNAVAILABLE;
  if(error.kind === 'RATE_LIMITED' && typeof authWaitText === 'function') msg += authWaitText(error.retryAfter);
  if(error.requestId) msg += ' Reference: ' + error.requestId + '.';
  return '<p class="auth-message auth-message-warn" role="alert">' + escapeHtml(msg) + '</p>';
}

function sessionWorkspaceListHTML(w){
  const tabs = '<div class="tabs" role="tablist" aria-label="Employee records">'
    + '<button class="tab' + (w.listArchived ? '' : ' active') + '" type="button" id="swActiveTab" role="tab" aria-selected="' + (!w.listArchived) + '">Active</button>'
    + '<button class="tab' + (w.listArchived ? ' active' : '') + '" type="button" id="swArchivedTab" role="tab" aria-selected="' + w.listArchived + '">Including archived</button>'
    + '</div>';
  if(w.listStatus === SESSION_EMPLOYEE_STATUS.ERROR && w.error && w.error.scope === 'list'){
    const retry = w.error.kind === 'DENIED' ? '' : '<div class="auth-actions"><button class="btn btn-accent" type="button" id="swRetryBtn">Retry</button></div>';
    return tabs + sessionWorkspaceErrorHTML(w.error) + retry;
  }
  if(w.listStatus !== SESSION_EMPLOYEE_STATUS.READY || !w.list) return tabs + '<p class="auth-lead" role="status">Loading employees…</p>';
  if(!w.list.length) return tabs + '<div class="empty">No employee records' + (w.listArchived ? '' : ' (archived records are under "Including archived")') + '.</div>';
  const rows = w.list.map(function(e, i){
    return '<tr><td>' + sessionWorkspaceValue(e.employeeCode) + '</td><td>' + sessionWorkspaceValue(e.fullName) + '</td>'
      + '<td>' + sessionWorkspaceValue(e.jobTitle) + '</td><td>' + sessionWorkspaceValue(e.department) + '</td>'
      + '<td>' + sessionWorkspaceValue(e.employmentStatus) + (e.archived ? ' <span class="pill pill-status-archived">Archived</span>' : '') + '</td>'
      + '<td>' + escapeHtml(SESSION_WORKSPACE_ACCOUNT_LABELS[e.accountState]) + '</td>'
      + '<td><button class="btn" type="button" data-sw-open="' + i + '">View</button></td></tr>';
  }).join('');
  return tabs + '<div class="table-wrap"><table><thead><tr><th scope="col">Code</th><th scope="col">Name</th><th scope="col">Job title</th>'
    + '<th scope="col">Department</th><th scope="col">Employment</th><th scope="col">Login</th><th scope="col" aria-label="Open record"></th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table></div>';
}

function sessionWorkspaceDetailHTML(w){
  const back = '<div class="auth-actions"><button class="btn" type="button" id="swBackBtn">Back to list</button>';
  if(w.detailStatus === SESSION_EMPLOYEE_STATUS.ERROR && w.error && w.error.scope === 'detail'){
    const retry = (w.error.kind === 'DENIED' || w.error.kind === 'NOT_FOUND') ? '' : '<button class="btn btn-accent" type="button" id="swRetryBtn">Retry</button>';
    return sessionWorkspaceErrorHTML(w.error) + back + retry + '</div>';
  }
  if(w.detailStatus !== SESSION_EMPLOYEE_STATUS.READY || !w.detail) return '<p class="auth-lead" role="status">Loading the record…</p>' + back + '</div>';
  const d = w.detail;
  return '<h2 class="section-title">' + escapeHtml(d.fullName) + (d.archived ? ' <span class="pill pill-status-archived">Archived</span>' : '') + '</h2>'
    + sessionWorkspaceRows([
      ['Employee code', d.employeeCode], ['Full name', d.fullName], ['Job title', d.jobTitle], ['Department', d.department],
      ['Employment status', d.employmentStatus], ['Join date', d.joinDate], ['Contact email', d.contactEmail], ['Phone', d.phone],
      ['Notes', d.notes], ['Monthly base salary (Rp)', d.monthlyBaseSalary], ['Archived', d.archived ? 'Yes' : 'No'],
      ['Login', SESSION_WORKSPACE_ACCOUNT_LABELS[d.accountState]]
    ]) + back + '</div>';
}

function sessionWorkspaceSelfHTML(w){
  if(w.selfStatus === SESSION_EMPLOYEE_STATUS.ERROR && w.error && w.error.scope === 'self'){
    if(w.error.kind === 'DENIED') return sessionWorkspaceErrorHTML(w.error);
    const text = w.error.kind === 'NOT_FOUND' ? SESSION_WORKSPACE_SELF_MISSING : null;
    return sessionWorkspaceErrorHTML(w.error, text) + '<div class="auth-actions"><button class="btn btn-accent" type="button" id="swRetryBtn">Retry</button></div>';
  }
  if(w.selfStatus !== SESSION_EMPLOYEE_STATUS.READY || !w.self) return '<p class="auth-lead" role="status">Loading your profile…</p>';
  const p = w.self;
  return sessionWorkspaceRows([
    ['Employee code', p.employeeCode], ['Full name', p.fullName], ['Job title', p.jobTitle], ['Department', p.department],
    ['Employment status', p.employmentStatus], ['Join date', p.joinDate], ['Contact email', p.contactEmail], ['Phone', p.phone],
    ['Monthly base salary (Rp)', p.monthlyBaseSalary]
  ]);
}

function sessionWorkspaceHTML(auth, w){
  const principal = auth.principal;
  const who = (principal && principal.displayName) ? principal.displayName : '';
  const ceo = !!principal && principal.principalType === PRINCIPAL_TYPES.CEO;
  const employee = !!principal && principal.principalType === PRINCIPAL_TYPES.EMPLOYEE;
  const title = ceo ? (w.detailId ? 'Employee record' : 'Employees') : (employee ? 'My profile' : 'TAM OS');
  let body;
  if(ceo) body = w.detailId ? sessionWorkspaceDetailHTML(w) : sessionWorkspaceListHTML(w);
  else if(employee) body = sessionWorkspaceSelfHTML(w);
  else body = '<p class="auth-message auth-message-warn" role="alert">' + escapeHtml(SESSION_WORKSPACE_ERRORS.UNAVAILABLE) + '</p>';
  return '<main class="auth-screen" id="main"><section class="card" aria-labelledby="authTitle">'
    + '<div class="page-head"><div><h1 class="auth-title" id="authTitle" tabindex="-1">' + escapeHtml(title) + '</h1>'
    + '<p class="auth-lead">Signed in as <strong>' + escapeHtml(who) + '</strong>.</p></div>'
    + '<div class="auth-actions"><button class="btn" id="authSignOutBtn" type="button"' + (auth.busy ? ' disabled aria-busy="true"' : '') + '>' + (auth.busy ? 'Signing out…' : 'Sign out') + '</button></div></div>'
    + body + '</section></main>';
}

function bindSessionWorkspace(app){
  const on = function(id, fn){ const el = app.querySelector('#' + id); if(el) el.addEventListener('click', fn); };
  on('authSignOutBtn', function(){ AuthBoot.signOut(); });
  on('swActiveTab', function(){ SessionWorkspace.showArchived(false); });
  on('swArchivedTab', function(){ SessionWorkspace.showArchived(true); });
  on('swBackBtn', function(){ SessionWorkspace.back(); });
  on('swRetryBtn', function(){ SessionWorkspace.retry(); });
  const openers = app.querySelectorAll('[data-sw-open]');
  for(let i = 0; i < openers.length; i++){
    openers[i].addEventListener('click', function(){
      const list = SessionEmployeeStore.snapshot().list || [];
      const row = list[Number(this.getAttribute('data-sw-open'))];
      if(row) SessionWorkspace.openDetail(row.id);
    });
  }
}

// Renders the authenticated SESSION workspace. Called only by renderAuthView().
function renderSessionWorkspace(app, auth){
  SessionWorkspace.ensureLoaded(auth.principal);
  app.innerHTML = sessionWorkspaceHTML(auth, SessionEmployeeStore.snapshot());
  bindSessionWorkspace(app);
  const heading = app.querySelector('#authTitle');
  if(heading && typeof heading.focus === 'function') heading.focus();
}
