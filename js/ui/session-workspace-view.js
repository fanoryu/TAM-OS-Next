/* ============================================================
   SESSION EMPLOYEE WORKSPACE VIEW (AFI-4a1, AFI-4a2) — js/ui/session-workspace-view.js
   ------------------------------------------------------------
   The SESSION workspace, rendered into #app by renderAuthView()
   (js/ui/auth-view.js) — its only caller — while AuthBoot is AUTHENTICATED. It is
   NOT the LOCAL business shell: render() never mounts renderShell() in SESSION,
   its data-nav navigation, Global Search or "Acting as", and no LOCAL
   domain page has an entry here. U1: the card sits inside the SESSION shell (end of
   this file) while AuthBoot.allowsWorkspace() — AUTHENTICATED with a navigation model.

   AFI-4b1: two SESSION sections, switched by buttons under the heading — CEO
   "Employees | Overtime", Employee "My profile | My overtime". The existing section
   stays the default; the Overtime section is renderSessionOvertimeHTML()
   (js/ui/session-overtime-view.js, SessionOvertime's memory-only data) — never the
   LOCAL Overtime page. Sections do not switch while a write of either is in flight.
   AFI-4c1: the CEO gets a third section, "Payroll" (renderSessionPayrollHTML(),
   js/ui/session-payroll-view.js, SessionPayroll's memory-only data) — never the LOCAL
   Payroll Workspace. AFI-4c2: an Employee's third section is "My payroll" — their own
   Committed payroll only, through the same SessionPayroll data; never the CEO's controls.
   AFI-4g: the CEO gets a fourth section, "Audit" (renderSessionAuditHTML(),
   js/ui/session-audit-view.js, SessionAudit's memory-only data) — read only; an Employee has
   no Audit section (D-AFI4g-3 = A).

     CEO       Employees: Active / Archived tabs, the company list, a record's
               detail; the derived account state is status text only.
               AFI-4a2: "Add employee" (an inline form card above the list), "Edit"
               (the record's form in place of its detail) and "Archive" (an inline
               confirmation; soft archive, no unarchive) — Employee records only.
               AFI-4a3: a "Login access" row under them offers exactly the account
               operations sessionAccountOperations() allows for the server projection
               (accountManageable + accountState) — Create login, Resend activation email,
               Disable login, Enable login — each through an inline panel. With
               accountManageable false the Login status text stays and nothing is offered.
     Employee  My profile: their own record, read-only, exactly the self fields —
               no form, no Add, no Edit, no Archive.

   Data comes only from SessionWorkspace / SessionEmployeeStore
   (js/core/session-employee.js); nothing is written here but the DOM. A draft is
   handed to SessionWorkspace.setDraft() as it is typed (memory only, no render),
   so a re-render keeps it. The account state is never a permission on its own; the
   login email typed for Create login starts empty (never the contact email) and is
   memory only. No activation token or link exists in the browser. Every message is a fixed string; every server value and every draft
   value is escaped, and money is shown exactly as the server sent it. The opaque
   record id never appears in the page: a row is opened by its position in the list
   that was rendered, and the record version stays in memory.

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

/* ---------- AFI-4a2: the Employee form and the write messages ---------- */
// The writable profile (EMPLOYEE_WRITABLE_FIELDS), in form order. Fixed names only.
const SESSION_WORKSPACE_FIELDS = Object.freeze([
  { name: 'employeeCode', label: 'Employee code', type: 'text', required: true, error: 'Enter an employee code of at most 32 characters, on one line.' },
  { name: 'fullName', label: 'Full name', type: 'text', required: true, error: 'Enter a full name of at most 160 characters, on one line.' },
  { name: 'employmentStatus', label: 'Employment status', type: 'select', required: true, error: 'Choose an employment status.' },
  { name: 'jobTitle', label: 'Job title', type: 'text', error: 'Use at most 120 characters, on one line.' },
  { name: 'department', label: 'Department', type: 'text', error: 'Use at most 120 characters, on one line.' },
  { name: 'joinDate', label: 'Join date', type: 'date', error: 'Enter a valid date, from 1900 onwards.' },
  { name: 'contactEmail', label: 'Contact email', type: 'email', error: 'Enter a valid email address.' },
  { name: 'phone', label: 'Phone', type: 'tel', error: 'Use digits, spaces and + ( ) - . only, at most 40 characters.' },
  { name: 'monthlyBaseSalary', label: 'Monthly base salary (Rp)', type: 'text', inputmode: 'decimal', hint: 'Digits only, up to 2 decimals — for example 7500000 or 7500000.50.', error: 'Enter an amount with digits only and at most 2 decimals, without separators.' },
  { name: 'notes', label: 'Notes', type: 'textarea', error: 'Use at most 2000 characters.' }
].map(Object.freeze));
const SESSION_WORKSPACE_MUTATION_ERRORS = Object.freeze({
  VALIDATION: 'Some entries need attention. Check the marked fields.',
  VALIDATION_UNNAMED: 'TAM OS could not accept these entries. Check the form, then try again.',
  DENIED: 'You do not have permission to make this change.',
  NOT_FOUND: 'This employee record is no longer available. The list was reloaded.',
  RATE_LIMITED: 'Too many requests.',
  SERVER_ERROR: 'The change was not saved. Try again in a moment.',
  CLIENT_FAULT: 'TAM OS could not process this request.'
});
// The backend reports one generic conflict: the wording never claims which cause it was.
const SESSION_WORKSPACE_CONFLICTS = Object.freeze({
  create: 'The employee record could not be created because of a conflict. The employee code may already be in use.',
  update: 'The employee record changed or could not be saved because of a conflict. Reload the record, then review your changes before saving again.',
  archive: 'The employee record changed or could not be archived because of a conflict. Reload the record before trying again.',
  provision: 'This login changed or the action is no longer available. Reload the record to see what can be done now.',
  reissue: 'This login changed or the action is no longer available. Reload the record to see what can be done now.',
  disable: 'This login changed or the action is no longer available. Reload the record to see what can be done now.',
  enable: 'This login changed or the action is no longer available. Reload the record to see what can be done now.'
});
const SESSION_WORKSPACE_AMBIGUOUS = Object.freeze({
  create: 'TAM OS could not confirm the change. The list below was read again from TAM OS — check whether the record was created before saving again.',
  update: 'TAM OS could not confirm the change. The record was read again from TAM OS — check it before saving again.',
  archive: 'TAM OS could not confirm the change. The record was read again from TAM OS — check whether it is archived before trying again.',
  provision: 'TAM OS could not confirm the change. The record was read again from TAM OS — its login status shows whether a login now exists.',
  reissue: 'TAM OS could not confirm whether a new activation email was queued. The record was read again; you may request another resend deliberately.',
  disable: 'TAM OS could not confirm the change. The record was read again from TAM OS — its login status shows whether sign-in is now blocked.',
  enable: 'TAM OS could not confirm the change. The record was read again from TAM OS — its login status shows whether sign-in is allowed again.'
});
const SESSION_WORKSPACE_NOTICES = Object.freeze({
  created: 'Employee record created.',
  saved: 'Employee record saved.',
  archived: 'Employee record archived. Archived records are listed under "Including archived".',
  unchanged: 'No changes to save.',
  reloaded: 'The record was read again from TAM OS. Your edits are kept; Save applies them to the latest version.',
  provisioned: 'Login created. An activation email has been queued for the address entered.',
  reissued: 'A new activation email has been queued. Earlier activation links no longer work.',
  disabled: 'Login disabled. Sign-in is blocked and existing sessions end.',
  enabled: 'Login enabled. Sign-in is allowed again.',
  enabled_pending: 'Login enabled. This person has not activated the login yet — the activation email may need to be resent.'
});

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

// The one message about the CEO's write (or a notice), shown where that write is.
function sessionWorkspaceMutationHTML(w){
  const m = w.mutation;
  let text = null, warn = true;
  if(m.status === SESSION_MUTATION_STATUS.AMBIGUOUS) text = SESSION_WORKSPACE_AMBIGUOUS[m.kind];
  else if(m.status === SESSION_MUTATION_STATUS.ERROR && m.error){
    const k = m.error.kind;
    if(k === 'CONFLICT') text = SESSION_WORKSPACE_CONFLICTS[m.kind];
    else if(k === 'VALIDATION') text = (m.fields || []).some((f) => EMPLOYEE_WRITABLE_FIELDS.indexOf(f) !== -1) ? SESSION_WORKSPACE_MUTATION_ERRORS.VALIDATION : SESSION_WORKSPACE_MUTATION_ERRORS.VALIDATION_UNNAMED;
    else text = SESSION_WORKSPACE_MUTATION_ERRORS[k] || SESSION_WORKSPACE_MUTATION_ERRORS.CLIENT_FAULT;
    if(k === 'RATE_LIMITED' && typeof authWaitText === 'function') text += authWaitText(m.error.retryAfter);
  } else if(m.status === SESSION_MUTATION_STATUS.IDLE && w.notice && SESSION_WORKSPACE_NOTICES[w.notice]){
    text = SESSION_WORKSPACE_NOTICES[w.notice]; warn = false;
  }
  if(!text) return '';
  if(warn && m.error && m.error.requestId) text += ' Reference: ' + m.error.requestId + '.';
  return '<p class="auth-message' + (warn ? ' auth-message-warn' : '') + '" id="swMutationMessage" role="' + (warn ? 'alert' : 'status') + '" tabindex="-1">' + escapeHtml(text) + '</p>';
}

function sessionWorkspaceFieldHTML(def, value, invalid, disabled){
  const id = 'swf-' + def.name;
  const hintId = def.hint ? id + '-hint' : '';
  const errorId = invalid ? id + '-error' : '';
  const described = [hintId, errorId].filter(Boolean).join(' ');
  const attrs = ' id="' + id + '" name="' + def.name + '"' + (def.required ? ' required aria-required="true"' : '')
    + (invalid ? ' aria-invalid="true"' : '') + (described ? ' aria-describedby="' + described + '"' : '') + (disabled ? ' disabled' : '');
  let control;
  if(def.type === 'select'){
    control = '<select class="input"' + attrs + '>' + EMPLOYEE_API_STATUSES.map(function(st){
      return '<option value="' + escapeHtml(st) + '"' + (st === value ? ' selected' : '') + '>' + escapeHtml(st) + '</option>';
    }).join('') + '</select>';
  } else if(def.type === 'textarea'){
    control = '<textarea class="input" rows="4"' + attrs + '>' + escapeHtml(value) + '</textarea>';
  } else {
    control = '<input class="input" type="' + def.type + '"' + (def.inputmode ? ' inputmode="' + def.inputmode + '"' : '') + ' autocomplete="off"' + attrs + ' value="' + escapeHtml(value) + '">';
  }
  return '<div class="field"><label for="' + id + '">' + escapeHtml(def.label) + (def.required ? ' <span aria-hidden="true">*</span>' : '') + '</label>' + control
    + (def.hint ? '<p class="hint" id="' + hintId + '">' + escapeHtml(def.hint) + '</p>' : '')
    + (invalid ? '<p class="hint auth-message-warn" id="' + errorId + '">' + escapeHtml(def.error) + '</p>' : '') + '</div>';
}

// The inline create / edit form card. Edit holds back Save until the record it saves
// against is loaded, live and not archived.
function sessionWorkspaceFormHTML(w){
  const f = w.form;
  const busy = w.mutation.status === SESSION_MUTATION_STATUS.PENDING;
  const dis = busy ? ' disabled' : '';
  const invalid = (w.mutation.status === SESSION_MUTATION_STATUS.ERROR && w.mutation.fields) ? w.mutation.fields : [];
  const edit = f.mode === 'edit';
  let state = '', canSave = !busy, reload = false;
  if(edit){
    if(w.detailStatus === SESSION_EMPLOYEE_STATUS.ERROR && w.error && w.error.scope === 'detail'){ state = sessionWorkspaceErrorHTML(w.error); canSave = false; reload = w.error.kind !== 'NOT_FOUND' && w.error.kind !== 'DENIED'; }
    else if(w.detailStatus !== SESSION_EMPLOYEE_STATUS.READY || !w.detail){ state = '<p class="auth-lead" role="status">Reading the record again…</p>'; canSave = false; }
    else if(w.detail.archived){ state = '<p class="auth-message auth-message-warn" role="alert">This record is archived and can no longer be edited.</p>'; canSave = false; }
    if(w.mutation.status === SESSION_MUTATION_STATUS.ERROR && w.mutation.error && w.mutation.error.kind === 'CONFLICT') reload = true;
  }
  const title = edit ? 'Edit employee' : 'Add employee';
  return '<section class="card" aria-labelledby="swFormTitle"><h2 class="section-title" id="swFormTitle" tabindex="-1">' + title + '</h2>'
    + '<form id="swForm" method="post" novalidate' + (busy ? ' aria-busy="true"' : '') + '>'
    + '<p class="hint">Fields marked * are required.</p>'
    + '<div class="form-grid">' + SESSION_WORKSPACE_FIELDS.map(function(def){
      return sessionWorkspaceFieldHTML(def, f.values[def.name], invalid.indexOf(def.name) !== -1, busy);
    }).join('') + '</div>'
    + state + sessionWorkspaceMutationHTML(w)
    + '<div class="auth-actions"><button class="btn" type="button" id="swFormCancel"' + dis + '>Cancel</button>'
    + (reload ? '<button class="btn" type="button" id="swReloadBtn"' + dis + '>Reload record</button>' : '')
    + '<button class="btn btn-accent" type="submit" id="swFormSave"' + (canSave ? '' : ' disabled') + (busy ? ' aria-busy="true"' : '') + '>' + (busy ? 'Saving…' : 'Save') + '</button></div>'
    + '</form></section>';
}

// Archive asks first, inline: the record named, Cancel, and "Archive record".
function sessionWorkspaceConfirmHTML(w){
  const d = w.detail;
  const busy = w.mutation.status === SESSION_MUTATION_STATUS.PENDING;
  const dis = busy ? ' disabled' : '';
  const conflict = w.mutation.status === SESSION_MUTATION_STATUS.ERROR && w.mutation.error && w.mutation.error.kind === 'CONFLICT';
  return '<section class="card" aria-labelledby="swConfirmTitle"' + (busy ? ' aria-busy="true"' : '') + '>'
    + '<h2 class="section-title" id="swConfirmTitle" tabindex="-1">Archive this employee record?</h2>'
    + '<p class="auth-lead">' + escapeHtml(d.fullName) + ' (' + escapeHtml(d.employeeCode) + ') will be archived: removed from the active list and kept under "Including archived". Archiving is not deletion, and it cannot be undone here.</p>'
    + sessionWorkspaceMutationHTML(w)
    + '<div class="auth-actions"><button class="btn" type="button" id="swArchiveCancel"' + dis + '>Cancel</button>'
    + (conflict ? '<button class="btn" type="button" id="swReloadBtn"' + dis + '>Reload record</button>' : '')
    + '<button class="btn btn-danger" type="button" id="swArchiveConfirm"' + dis + (busy ? ' aria-busy="true"' : '') + '>' + (busy ? 'Archiving…' : 'Archive record') + '</button></div>'
    + '</section>';
}

/* ---------- AFI-4a3: Login access ---------- */
const SESSION_ACCOUNT_BUTTONS = Object.freeze({
  provision: { id: 'swAcctProvision', label: 'Create login' },
  reissue: { id: 'swAcctReissue', label: 'Resend activation email' },
  disable: { id: 'swAcctDisable', label: 'Disable login' },
  enable: { id: 'swAcctEnable', label: 'Enable login' }
});
const SESSION_ACCOUNT_PANELS = Object.freeze({
  provision: { title: 'Create a login', text: 'Enter the email address this person will sign in with. TAM OS queues an activation email to it; the login works once they set a password.', submit: 'Create login' },
  reissue: { title: 'Send a new activation email?', text: 'A new activation email is queued. Activation links sent earlier stop working.', submit: 'Resend activation email' },
  disable: { title: 'Disable this login?', text: 'Sign-in is blocked and every existing session of this person ends. Their employee record is not changed.', submit: 'Disable login' },
  enable: { title: 'Enable this login?', text: 'Sign-in is allowed again. No activation email is sent.', submit: 'Enable login' }
});

// The operations the server projection offers, as one row of buttons; none when it offers none.
function sessionWorkspaceAccountRowHTML(w, dis){
  const ops = sessionAccountOperations(w.detail);
  if(!ops.length || w.form || w.confirm || w.accountAction) return '';
  return '<div class="auth-actions" role="group" aria-label="Login access">' + ops.map(function(k){
    return '<button class="btn" type="button" id="' + SESSION_ACCOUNT_BUTTONS[k].id + '"' + dis + '>' + escapeHtml(SESSION_ACCOUNT_BUTTONS[k].label) + '</button>';
  }).join('') + '</div>';
}

// The inline panel of the open account operation. Create login carries the one email field (empty
// at first); its form submission is the confirmation.
function sessionWorkspaceAccountHTML(w){
  const a = w.accountAction;
  const d = w.detail;
  const panel = SESSION_ACCOUNT_PANELS[a.kind];
  const busy = w.mutation.status === SESSION_MUTATION_STATUS.PENDING;
  const dis = busy ? ' disabled' : '';
  const conflict = w.mutation.status === SESSION_MUTATION_STATUS.ERROR && w.mutation.error && w.mutation.error.kind === 'CONFLICT';
  const invalid = w.mutation.status === SESSION_MUTATION_STATUS.ERROR && (w.mutation.fields || []).indexOf('email') !== -1;
  const actions = '<div class="auth-actions"><button class="btn" type="button" id="swAcctCancel"' + dis + '>Cancel</button>'
    + (conflict ? '<button class="btn" type="button" id="swReloadBtn"' + dis + '>Reload record</button>' : '')
    + '<button class="btn ' + (a.kind === 'disable' ? 'btn-danger' : 'btn-accent') + '" type="' + (a.kind === 'provision' ? 'submit' : 'button') + '" id="swAcctSubmit"' + dis + (busy ? ' aria-busy="true"' : '') + '>'
    + (busy ? 'Working…' : escapeHtml(panel.submit)) + '</button></div>';
  let body = '<p class="auth-lead">' + escapeHtml(d.fullName) + ' (' + escapeHtml(d.employeeCode) + '). ' + escapeHtml(panel.text) + '</p>';
  if(a.kind === 'provision'){
    body = '<form id="swAcctForm" method="post" novalidate' + (busy ? ' aria-busy="true"' : '') + '>' + body
      + '<div class="field"><label for="swa-email">Login email <span aria-hidden="true">*</span></label>'
      + '<input class="input" type="email" id="swa-email" name="email" autocomplete="off" required aria-required="true"'
      + (invalid ? ' aria-invalid="true" aria-describedby="swa-email-error"' : '') + dis + ' value="' + escapeHtml(a.email) + '">'
      + (invalid ? '<p class="hint auth-message-warn" id="swa-email-error">Enter a valid email address for the login.</p>' : '') + '</div>'
      + sessionWorkspaceMutationHTML(w) + actions + '</form>';
  } else {
    body += sessionWorkspaceMutationHTML(w) + actions;
  }
  return '<section class="card" aria-labelledby="swAccountTitle"' + (busy ? ' aria-busy="true"' : '') + '>'
    + '<h2 class="section-title" id="swAccountTitle" tabindex="-1">' + escapeHtml(panel.title) + '</h2>' + body + '</section>';
}

function sessionWorkspaceListHTML(w){
  const busy = w.mutation.status === SESSION_MUTATION_STATUS.PENDING;
  const dis = busy ? ' disabled' : '';
  const head = (w.form ? sessionWorkspaceFormHTML(w)
      : '<div class="auth-actions"><button class="btn btn-accent" type="button" id="swAddBtn"' + dis + '>Add employee</button></div>' + sessionWorkspaceMutationHTML(w));
  const tabs = head + '<div class="tabs" role="tablist" aria-label="Employee records">'
    + '<button class="tab' + (w.listArchived ? '' : ' active') + '" type="button" id="swActiveTab" role="tab" aria-selected="' + (!w.listArchived) + '"' + dis + '>Active</button>'
    + '<button class="tab' + (w.listArchived ? ' active' : '') + '" type="button" id="swArchivedTab" role="tab" aria-selected="' + w.listArchived + '"' + dis + '>Including archived</button>'
    + '</div>';
  if(w.listStatus === SESSION_EMPLOYEE_STATUS.ERROR && w.error && w.error.scope === 'list'){
    const retry = w.error.kind === 'DENIED' ? '' : '<div class="auth-actions"><button class="btn btn-accent" type="button" id="swRetryBtn"' + dis + '>Retry</button></div>';
    return tabs + sessionWorkspaceErrorHTML(w.error) + retry;
  }
  if(w.listStatus !== SESSION_EMPLOYEE_STATUS.READY || !w.list) return tabs + '<p class="auth-lead" role="status">Loading employees…</p>';
  if(!w.list.length) return tabs + '<div class="empty">No employee records' + (w.listArchived ? '' : ' (archived records are under "Including archived")') + '.</div>';
  const rows = w.list.map(function(e, i){
    return '<tr><td>' + sessionWorkspaceValue(e.employeeCode) + '</td><td>' + sessionWorkspaceValue(e.fullName) + '</td>'
      + '<td>' + sessionWorkspaceValue(e.jobTitle) + '</td><td>' + sessionWorkspaceValue(e.department) + '</td>'
      + '<td>' + sessionWorkspaceValue(e.employmentStatus) + (e.archived ? ' <span class="pill pill-status-archived">Archived</span>' : '') + '</td>'
      + '<td>' + escapeHtml(SESSION_WORKSPACE_ACCOUNT_LABELS[e.accountState]) + '</td>'
      + '<td><button class="btn" type="button" data-sw-open="' + i + '"' + dis + '>View</button></td></tr>';
  }).join('');
  return tabs + '<div class="table-wrap"><table><thead><tr><th scope="col">Code</th><th scope="col">Name</th><th scope="col">Job title</th>'
    + '<th scope="col">Department</th><th scope="col">Employment</th><th scope="col">Login</th><th scope="col" aria-label="Open record"></th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table></div>';
}

function sessionWorkspaceDetailHTML(w){
  if(w.form) return sessionWorkspaceFormHTML(w);
  const busy = w.mutation.status === SESSION_MUTATION_STATUS.PENDING;
  const dis = busy ? ' disabled' : '';
  const back = '<div class="auth-actions"><button class="btn" type="button" id="swBackBtn"' + dis + '>Back to list</button>';
  if(w.detailStatus === SESSION_EMPLOYEE_STATUS.ERROR && w.error && w.error.scope === 'detail'){
    const retry = (w.error.kind === 'DENIED' || w.error.kind === 'NOT_FOUND') ? '' : '<button class="btn btn-accent" type="button" id="swRetryBtn">Retry</button>';
    return sessionWorkspaceMutationHTML(w) + sessionWorkspaceErrorHTML(w.error) + back + retry + '</div>';
  }
  if(w.detailStatus !== SESSION_EMPLOYEE_STATUS.READY || !w.detail) return sessionWorkspaceMutationHTML(w) + '<p class="auth-lead" role="status">Loading the record…</p>' + back + '</div>';
  const d = w.detail;
  // Edit and Archive: CEO Employee CRUD only, for a live record; the confirmation replaces them.
  const actions = (d.archived || w.confirm || w.accountAction) ? '' : '<button class="btn" type="button" id="swEditBtn"' + dis + '>Edit</button>'
    + '<button class="btn btn-danger" type="button" id="swArchiveBtn"' + dis + '>Archive</button>';
  return '<h2 class="section-title">' + escapeHtml(d.fullName) + (d.archived ? ' <span class="pill pill-status-archived">Archived</span>' : '') + '</h2>'
    + (w.confirm || w.accountAction ? '' : sessionWorkspaceMutationHTML(w))
    + sessionWorkspaceRows([
      ['Employee code', d.employeeCode], ['Full name', d.fullName], ['Job title', d.jobTitle], ['Department', d.department],
      ['Employment status', d.employmentStatus], ['Join date', d.joinDate], ['Contact email', d.contactEmail], ['Phone', d.phone],
      ['Notes', d.notes], ['Monthly base salary (Rp)', d.monthlyBaseSalary], ['Archived', d.archived ? 'Yes' : 'No'],
      ['Login', SESSION_WORKSPACE_ACCOUNT_LABELS[d.accountState]]
    ]) + back + actions + '</div>'
    + sessionWorkspaceAccountRowHTML(w, dis)
    + (w.confirm && !d.archived ? sessionWorkspaceConfirmHTML(w) : '')
    + (w.accountAction && w.accountAction.id === d.id ? sessionWorkspaceAccountHTML(w) : '');
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

// U1: the section buttons are the SESSION shell's sidebar items (js/ui/session-shell.js,
// sessionNavModel); none is enabled while a write of any section is in flight. Without a
// navigation model (no principal, unknown role) the card renders alone — no shell.
function sessionWorkspaceHTML(auth, w){
  const principal = auth.principal;
  const who = (principal && principal.displayName) ? principal.displayName : '';
  const ceo = !!principal && principal.principalType === PRINCIPAL_TYPES.CEO;
  const employee = !!principal && principal.principalType === PRINCIPAL_TYPES.EMPLOYEE;
  const ot = SessionOvertimeStore.snapshot();
  const pr = SessionPayrollStore.snapshot();
  const payroll = (ceo || employee) && pr.open;                        // AFI-4c1 CEO Payroll; AFI-4c2 Employee My payroll
  const overtime = (ceo || employee) && ot.open && !payroll;
  const audit = ceo && SessionAuditStore.snapshot().open && !payroll && !overtime;   // AFI-4g: the CEO's Audit
  const busy = w.mutation.status === SESSION_MUTATION_STATUS.PENDING || ot.mutation.status === SESSION_OVERTIME_MUTATION_STATUS.PENDING
    || pr.mutation.status === SESSION_PAYROLL_MUTATION_STATUS.PENDING;
  let title = ceo ? (w.detailId ? (w.form ? 'Edit employee record' : 'Employee record') : 'Employees') : (employee ? 'My profile' : 'TAM OS');
  let body;
  if(payroll){ title = renderSessionPayrollTitle(pr, principal); body = renderSessionPayrollHTML(principal, pr); }
  else if(overtime){ title = renderSessionOvertimeTitle(principal, ot); body = renderSessionOvertimeHTML(principal, ot); }
  else if(audit){ const au = SessionAuditStore.snapshot(); title = renderSessionAuditTitle(au); body = renderSessionAuditHTML(au); }
  else if(ceo) body = w.detailId ? sessionWorkspaceDetailHTML(w) : sessionWorkspaceListHTML(w);
  else if(employee) body = sessionWorkspaceSelfHTML(w);
  else body = '<p class="auth-message auth-message-warn" role="alert">' + escapeHtml(SESSION_WORKSPACE_ERRORS.UNAVAILABLE) + '</p>';
  const card = '<section class="card" aria-labelledby="authTitle">'
    + '<div class="page-head"><div><h1 class="auth-title" id="authTitle" tabindex="-1">' + escapeHtml(title) + '</h1>'
    + '<p class="auth-lead">Signed in as <strong>' + escapeHtml(who) + '</strong>.</p></div>'
    + '<div class="auth-actions"><button class="btn" id="authSignOutBtn" type="button"' + (auth.busy ? ' disabled aria-busy="true"' : '') + '>' + (auth.busy ? 'Signing out…' : 'Sign out') + '</button></div></div>'
    + body + '</section>';
  const model = AuthBoot.allowsWorkspace() ? sessionNavModel(principal) : null;
  if(!model) return '<main class="auth-screen" id="main">' + card + '</main>';
  return sessionShellHTML(model, payroll ? 'payroll' : (overtime ? 'overtime' : (audit ? 'audit' : SESSION_HOME_ROUTE)), busy, card);
}

function bindSessionWorkspace(app){
  const on = function(id, fn){ const el = app.querySelector('#' + id); if(el) el.addEventListener('click', fn); };
  on('authSignOutBtn', function(){ AuthBoot.signOut(); });
  // AFI-4b1: the section switch — never while an Employee write is in flight. AFI-4c1: nor while
  // an Overtime or Payroll write is; SessionPayroll.show decides who may open it (the CEO's Payroll,
  // AFI-4c2 an Employee's My payroll). AFI-4g: every other section closes Audit; SessionAudit.show
  // opens it for the CEO only.
  const idle = function(){
    return SessionEmployeeStore.snapshot().mutation.status !== SESSION_MUTATION_STATUS.PENDING
      && SessionOvertimeStore.snapshot().mutation.status !== SESSION_OVERTIME_MUTATION_STATUS.PENDING
      && SessionPayrollStore.snapshot().mutation.status !== SESSION_PAYROLL_MUTATION_STATUS.PENDING;
  };
  const sectionTo = function(overtime){
    return function(){ if(!idle()) return; SessionPayroll.show(false); SessionAudit.show(false); SessionOvertime.show(overtime); };
  };
  on('swSectionMain', sectionTo(false));
  on('swSectionOvertime', sectionTo(true));
  on('swSectionPayroll', function(){ if(!idle()) return; SessionOvertime.show(false); SessionAudit.show(false); SessionPayroll.show(true); });
  on('swSectionAudit', function(){ if(!idle()) return; SessionOvertime.show(false); SessionPayroll.show(false); SessionAudit.show(true); });
  if(SessionPayrollStore.snapshot().open){ bindSessionPayroll(app); return; }
  if(SessionOvertimeStore.snapshot().open){ bindSessionOvertime(app); return; }
  if(SessionAuditStore.snapshot().open){ bindSessionAudit(app); return; }
  on('swActiveTab', function(){ SessionWorkspace.showArchived(false); });
  on('swArchivedTab', function(){ SessionWorkspace.showArchived(true); });
  on('swBackBtn', function(){ SessionWorkspace.back(); });
  on('swRetryBtn', function(){ SessionWorkspace.retry(); });
  on('swAddBtn', function(){ SessionWorkspace.openCreate(); });
  on('swEditBtn', function(){ SessionWorkspace.openEdit(); });
  on('swFormCancel', function(){ SessionWorkspace.cancelForm(); });
  on('swReloadBtn', function(){ SessionWorkspace.reloadRecord(); });
  on('swArchiveBtn', function(){ SessionWorkspace.openArchive(); });
  on('swArchiveCancel', function(){ SessionWorkspace.cancelArchive(); });
  on('swArchiveConfirm', function(){ SessionWorkspace.confirmArchive(); });
  // AFI-4a3: Login access.
  Object.keys(SESSION_ACCOUNT_BUTTONS).forEach(function(k){ on(SESSION_ACCOUNT_BUTTONS[k].id, function(){ SessionWorkspace.openAccountAction(k); }); });
  on('swAcctCancel', function(){ SessionWorkspace.cancelAccountAction(); });
  const acctForm = app.querySelector('#swAcctForm');
  if(acctForm){
    const email = acctForm.querySelector('#swa-email');
    if(email) email.addEventListener('input', function(){ SessionWorkspace.setAccountEmail(this.value); });
    acctForm.addEventListener('submit', function(e){
      e.preventDefault();
      if(email) SessionWorkspace.setAccountEmail(email.value);
      SessionWorkspace.submitAccountAction();
    });
  } else {
    on('swAcctSubmit', function(){ SessionWorkspace.submitAccountAction(); });
  }
  const openers = app.querySelectorAll('[data-sw-open]');
  for(let i = 0; i < openers.length; i++){
    openers[i].addEventListener('click', function(){
      const list = SessionEmployeeStore.snapshot().list || [];
      const row = list[Number(this.getAttribute('data-sw-open'))];
      if(row) SessionWorkspace.openDetail(row.id);
    });
  }
  // The draft follows the fields as they change; Save hands the last values over first.
  const form = app.querySelector('#swForm');
  if(form){
    const keep = function(){ SessionWorkspace.setDraft(this.name, this.value); };
    SESSION_WORKSPACE_FIELDS.forEach(function(def){
      const el = form.querySelector('#swf-' + def.name);
      if(el){ el.addEventListener('input', keep); el.addEventListener('change', keep); }
    });
    form.addEventListener('submit', function(e){
      e.preventDefault();
      SESSION_WORKSPACE_FIELDS.forEach(function(def){
        const el = form.querySelector('#swf-' + def.name);
        if(el) SessionWorkspace.setDraft(def.name, el.value);
      });
      SessionWorkspace.submitForm();
    });
  }
}

// After a render: the element the workspace asked for (an invalid field, the write
// message, the confirmation, the form); else the element that had focus, when it is still
// there (a background re-read must not move focus); else the heading.
function sessionWorkspaceFocus(app, hint, kept){
  let el = null;
  if(hint && hint.indexOf('field:') === 0 && EMPLOYEE_WRITABLE_FIELDS.indexOf(hint.slice(6)) !== -1) el = app.querySelector('#swf-' + hint.slice(6));
  else if(hint === 'message') el = app.querySelector('#swMutationMessage');
  else if(hint === 'confirm') el = app.querySelector('#swConfirmTitle');
  else if(hint === 'form') el = app.querySelector('#swFormTitle');
  else if(hint === 'account') el = app.querySelector('#swAccountTitle');
  else if(hint === 'account-email') el = app.querySelector('#swa-email');
  if(!el && !hint && kept){
    el = app.querySelector('#' + kept.id);
    if(el && typeof el.focus === 'function'){
      el.focus();
      try { if(typeof kept.start === 'number' && typeof el.setSelectionRange === 'function') el.setSelectionRange(kept.start, kept.end); } catch(_e){ /* not a text field */ }
      return;
    }
  }
  if(!el) el = app.querySelector('#authTitle');
  if(el && typeof el.focus === 'function') el.focus();
}

// Renders the authenticated SESSION workspace. Called only by renderAuthView().
function renderSessionWorkspace(app, auth){
  SessionWorkspace.ensureLoaded(auth.principal);
  SessionOvertime.ensureLoaded(auth.principal);                // AFI-4b1: binds (or destroys) the Overtime data too
  SessionPayroll.ensureLoaded(auth.principal);                 // AFI-4c1: and the Payroll data (AFI-4c2: My payroll too)
  SessionAudit.ensureLoaded(auth.principal);                   // AFI-4g: and the CEO's Audit data
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  const kept = (active && active !== app && typeof active.id === 'string' && /^(sw|auth)[A-Za-z-]+$/.test(active.id) && typeof app.contains === 'function' && app.contains(active))
    ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
  app.innerHTML = sessionWorkspaceHTML(auth, SessionEmployeeStore.snapshot());
  const model = AuthBoot.allowsWorkspace() ? sessionNavModel(auth.principal) : null;
  if(model) bindSessionShell(app, model);                      // U1: before the section buttons' own listeners
  bindSessionWorkspace(app);
  const hint = SessionEmployeeStore.takeFocus();
  const otHint = SessionOvertimeStore.takeFocus();
  const prHint = SessionPayrollStore.takeFocus();
  const auHint = SessionAuditStore.takeFocus();
  if(SessionPayrollStore.snapshot().open){
    const el = sessionPayrollFocusTarget(app, prHint);
    if(el && typeof el.focus === 'function'){ el.focus(); return; }
    return sessionWorkspaceFocus(app, prHint ? 'heading' : null, kept);
  }
  if(SessionOvertimeStore.snapshot().open){
    const el = sessionOvertimeFocusTarget(app, otHint);
    if(el && typeof el.focus === 'function'){ el.focus(); return; }
    return sessionWorkspaceFocus(app, otHint ? 'heading' : null, kept);
  }
  if(SessionAuditStore.snapshot().open){
    const el = sessionAuditFocusTarget(app, auHint);
    if(el && typeof el.focus === 'function'){ el.focus(); return; }
    return sessionWorkspaceFocus(app, auHint ? 'heading' : null, kept);
  }
  sessionWorkspaceFocus(app, hint, kept);
}

/* ------------------------------------------------------------
   U1 — SESSION GRADUATED SHELL (Option B)
   ------------------------------------------------------------
   The v2.11.0 shell chrome (sidebar, brand lockup, grouped navigation, mobile
   drawer, skip link, #main landmark) for the AUTHENTICATED SESSION state only. It
   reuses the existing shell CSS classes and NAV_GROUPS group labels and icons; it is
   NOT renderShell(): the LOCAL shell, its data-nav routing over State.view, Global
   Search, Quick Actions and every LOCAL view stay unreachable in SESSION.

     SESSION_ROUTES        the only SESSION destinations — the four existing SESSION
                           sections. Each names its section button id (the same ids the
                           section tabs carried), its NAV_GROUPS group and item, and a
                           fixed label per role. A role absent from `labels` cannot see
                           the route.
     sessionNavModel(p)    pure: the principal's visible groups and items, or null for a
                           missing principal or an unknown role (fail closed: no shell).
     sessionShellHTML()    the chrome around the existing workspace card.
     bindSessionShell()    drawer open/close, Escape, focus trap, skip link.

   AUTHORITY: the model decides visibility only. Every read and write is still decided
   by the server Policy and scope; a route shown in error ends in the server's 403 and
   the section's denied message. Section switching stays in bindSessionWorkspace() above
   through the section button ids, so the existing
   "no switch while a write is in flight" rule and every store are unchanged.

   Called only by sessionWorkspaceHTML() / renderSessionWorkspace(), which run only
   from renderAuthView() while AuthBoot is AUTHENTICATED. Every label is a fixed
   string; nothing from the server is rendered here. The mobile drawer state is
   SessionShellDrawer (memory only; never State, never storage).

   Classic shared global scope; existing CSS classes only.
   ------------------------------------------------------------ */

const SESSION_ROUTES = Object.freeze([
  Object.freeze({ id: 'main', button: 'swSectionMain', group: 'people', navItem: 'employees',
    labels: Object.freeze({ ceo: 'Employees', employee: 'My profile' }) }),
  Object.freeze({ id: 'overtime', button: 'swSectionOvertime', group: 'finance', navItem: 'overtime',
    labels: Object.freeze({ ceo: 'Overtime', employee: 'My overtime' }) }),
  Object.freeze({ id: 'payroll', button: 'swSectionPayroll', group: 'finance', navItem: 'payroll',
    labels: Object.freeze({ ceo: 'Payroll', employee: 'My payroll' }) }),
  Object.freeze({ id: 'audit', button: 'swSectionAudit', group: 'system', navItem: 'activity',
    labels: Object.freeze({ ceo: 'Audit' }) })
]);
// Per-role group labels over NAV_GROUPS (display only): an Employee has no Finance access, so
// their own overtime and payroll sit under "My work".
const SESSION_GROUP_LABELS = Object.freeze({ employee: Object.freeze({ finance: 'My work' }) });
const SESSION_HOME_ROUTE = 'main';
const SESSION_SHELL_FOOT = 'Data stored on the TAM OS server.';

// The principal's navigation, or null (no shell). Reads only principal.principalType,
// SESSION_ROUTES and NAV_GROUPS; returns a new frozen value each call.
function sessionNavModel(principal){
  if(!principal || typeof principal !== 'object') return null;
  const role = principal.principalType;
  if(role !== PRINCIPAL_TYPES.CEO && role !== PRINCIPAL_TYPES.EMPLOYEE) return null;
  const groups = [];
  SESSION_ROUTES.forEach(function(r){
    if(!Object.prototype.hasOwnProperty.call(r.labels, role)) return;
    const g = NAV_GROUPS.find(function(x){ return x.id === r.group; });
    const n = g ? g.items.find(function(i){ return i.id === r.navItem; }) : null;
    if(!g || !n) return;
    let out = groups.find(function(x){ return x.id === g.id; });
    if(!out){
      const own = Object.prototype.hasOwnProperty.call(SESSION_GROUP_LABELS, role) && Object.prototype.hasOwnProperty.call(SESSION_GROUP_LABELS[role], g.id);
      out = { id: g.id, label: own ? SESSION_GROUP_LABELS[role][g.id] : g.label, items: [] }; groups.push(out);
    }
    out.items.push(Object.freeze({ id: r.id, button: r.button, label: r.labels[role], ic: n.ic }));
  });
  if(!groups.some(function(g){ return g.items.some(function(i){ return i.id === SESSION_HOME_ROUTE; }); })) return null;
  return Object.freeze({ role: role, home: SESSION_HOME_ROUTE,
    groups: Object.freeze(groups.map(function(g){ return Object.freeze({ id: g.id, label: g.label, items: Object.freeze(g.items) }); })) });
}

// True when the model offers the route; anything else is the home route.
function sessionRouteAllowed(model, id){
  return !!model && model.groups.some(function(g){ return g.items.some(function(i){ return i.id === id; }); });
}

function sessionNavItemHTML(item, active, busy){
  const on = item.id === active;
  return '<button class="nav-item' + (on ? ' active' : '') + '" type="button" id="' + item.button + '"' + (on ? ' aria-current="page"' : '') + (busy ? ' disabled' : '') + '>'
    + '<span class="ic" aria-hidden="true">' + item.ic + '</span><span class="nav-label">' + escapeHtml(item.label) + '</span></button>';
}

// The shell around `content` (the workspace card). `active` is a route id of the model.
function sessionShellHTML(model, active, busy, content){
  const current = sessionRouteAllowed(model, active) ? active : model.home;
  const nav = model.groups.map(function(g){
    return '<div class="nav-group"><div class="nav-group-head"><span>' + escapeHtml(g.label) + '</span></div>'
      + '<div class="nav-group-items">' + g.items.map(function(i){ return sessionNavItemHTML(i, current, busy); }).join('') + '</div></div>';
  }).join('');
  return '<a class="skip-link" href="#main" id="skipLink">Skip to main content</a>'
    + '<button class="nav-hamburger" id="navHamburger" type="button" aria-label="Open navigation" aria-controls="sidebar" aria-expanded="false"><span aria-hidden="true">☰</span></button>'
    + '<div class="sidebar-backdrop" id="sidebarBackdrop" hidden></div>'
    + '<div class="sidebar" id="sidebar"><div class="brand"><div class="brand-lockup">'
    + '<img class="brand-monogram" src="' + BRAND_MONOGRAM + '" alt="" aria-hidden="true" width="34" height="34" draggable="false">'
    + '<div class="mark">TAM&nbsp;<span class="os">OS</span></div></div></div>'
    + '<nav class="nav" aria-label="Primary navigation">' + nav + '</nav>'
    + '<div class="sidebar-foot">' + escapeHtml(APP_NAME) + ' v' + APP_VERSION + '<br>' + escapeHtml(SESSION_SHELL_FOOT) + '</div></div>'
    + '<main class="main" id="main" tabindex="-1">' + content + '</main>';
}

// The mobile drawer: memory only, owned here (never State, never storage). The shell is
// re-rendered on every paint, so its open state is baked into the markup and re-applied.
// `held`: the closed drawer was left focusable because focus could not leave it (see
// sessionShellRescueFocus); the sidebar's focusout re-applies the state once focus is out.
const SessionShellDrawer = { open: false, ret: null, mq: null, held: false };

function sessionShellApplyDrawer(app){
  const drawer = sidebarIsDrawerMode();
  const open = drawer && SessionShellDrawer.open;
  if(app.classList) app.classList.toggle('drawer-open', open);
  const sidebar = app.querySelector('#sidebar');
  if(sidebar && typeof sidebar.setAttribute === 'function' && typeof sidebar.removeAttribute === 'function'){
    // A closed off-canvas drawer is inert: no keyboard focus, no screen-reader access.
    // Focus still inside it (e.g. a desktop -> mobile resize) must leave first; if it cannot,
    // the sidebar is never made inert or aria-hidden around the focused element.
    const hide = drawer && !open && sessionShellRescueFocus(app, sidebar);
    SessionShellDrawer.held = drawer && !open && !hide;
    if(hide){ sidebar.setAttribute('aria-hidden', 'true'); sidebar.setAttribute('inert', ''); }
    else { sidebar.removeAttribute('aria-hidden'); sidebar.removeAttribute('inert'); }
  }
  const back = app.querySelector('#sidebarBackdrop');
  if(back) back.hidden = !open;
  const ham = app.querySelector('#navHamburger');
  if(ham && typeof ham.setAttribute === 'function') ham.setAttribute('aria-expanded', String(open));
}

// Before the sidebar turns inert: true when focus is (now) outside it. Focus inside moves to
// the menu button, else to #main (tabindex -1: no new tab stop); each attempt is checked
// against document.activeElement, never assumed. False: focus could not leave the sidebar.
function sessionShellRescueFocus(app, sidebar){
  const inside = function(){
    const a = document.activeElement;
    return !!a && (typeof sidebar.contains !== 'function' || sidebar.contains(a));
  };
  if(!inside()) return true;
  const targets = [app.querySelector('#navHamburger'), app.querySelector('#main')];
  for(let i = 0; i < targets.length; i++){
    const t = targets[i];
    if(!t || typeof t.focus !== 'function' || t.isConnected === false) continue;
    t.focus();
    if(document.activeElement === t && !inside()) return true;
  }
  return false;
}

function sessionShellOpenDrawer(app){
  if(!sidebarIsDrawerMode()) return;
  SessionShellDrawer.ret = document.activeElement;
  SessionShellDrawer.open = true;
  sessionShellApplyDrawer(app);
  const sidebar = app.querySelector('#sidebar');
  const f = sidebar ? sidebarFocusables(sidebar) : [];
  if(f.length) f[0].focus();
}

// `restore` false: a navigation is about to move focus to the new heading itself.
function sessionShellCloseDrawer(app, restore){
  const wasOpen = SessionShellDrawer.open;
  const ret = SessionShellDrawer.ret;
  SessionShellDrawer.open = false; SessionShellDrawer.ret = null;
  sessionShellApplyDrawer(app);
  if(!wasOpen || !restore) return;
  const target = (ret && ret !== document.body && typeof ret.focus === 'function' && document.contains(ret)) ? ret : app.querySelector('#navHamburger');
  if(target && typeof target.focus === 'function') target.focus();
}

// Binds the chrome of a freshly rendered shell (the whole #app is re-rendered on every
// paint, so nothing is bound twice). Section buttons are bound by bindSessionWorkspace().
function bindSessionShell(app, model){
  const skip = app.querySelector('#skipLink');
  if(skip) skip.addEventListener('click', function(e){
    e.preventDefault();
    const main = app.querySelector('#main');
    if(main && typeof main.focus === 'function') main.focus();
  });
  const ham = app.querySelector('#navHamburger');
  if(ham) ham.addEventListener('click', function(e){ e.preventDefault(); if(SessionShellDrawer.open) sessionShellCloseDrawer(app, true); else sessionShellOpenDrawer(app); });
  const back = app.querySelector('#sidebarBackdrop');
  if(back) back.addEventListener('click', function(){ sessionShellCloseDrawer(app, true); });
  const sidebar = app.querySelector('#sidebar');
  if(sidebar) sidebar.addEventListener('keydown', function(e){
    if(!SessionShellDrawer.open) return;
    if(e.key === 'Escape'){ e.preventDefault(); sessionShellCloseDrawer(app, true); return; }
    if(e.key === 'Tab'){
      const f = sidebarFocusables(sidebar); if(!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    }
  });
  // A held (focusable) closed drawer is made inert as soon as focus leaves it.
  if(sidebar) sidebar.addEventListener('focusout', function(e){
    if(!SessionShellDrawer.held) return;
    if(e && e.relatedTarget && typeof sidebar.contains === 'function' && sidebar.contains(e.relatedTarget)) return;
    sessionShellApplyDrawer(app);
  });
  // A tap in the mobile drawer navigates, then dismisses it (as in the LOCAL shell).
  model.groups.forEach(function(g){ g.items.forEach(function(i){
    const b = app.querySelector('#' + i.button);
    if(b) b.addEventListener('click', function(){ if(SessionShellDrawer.open) sessionShellCloseDrawer(app, false); });
  }); });
  // A viewport change (e.g. desktop -> mobile) re-applies the drawer state; bound once, for the page.
  if(!SessionShellDrawer.mq && typeof matchMedia === 'function'){
    SessionShellDrawer.mq = matchMedia('(max-width:768px)');
    const onMq = function(){
      const root = document.getElementById('app');
      if(!root || !root.querySelector('#sidebar')) return;
      if(!sidebarIsDrawerMode() && SessionShellDrawer.open) sessionShellCloseDrawer(root, false); else sessionShellApplyDrawer(root);
    };
    if(SessionShellDrawer.mq.addEventListener) SessionShellDrawer.mq.addEventListener('change', onMq); else if(SessionShellDrawer.mq.addListener) SessionShellDrawer.mq.addListener(onMq);
  }
  sessionShellApplyDrawer(app);
}

// Leaving the shell (any non-AUTHENTICATED view): no drawer stays open behind the auth views.
function sessionShellReset(app){
  SessionShellDrawer.open = false; SessionShellDrawer.ret = null; SessionShellDrawer.held = false;
  if(app.classList) app.classList.remove('drawer-open');
}
