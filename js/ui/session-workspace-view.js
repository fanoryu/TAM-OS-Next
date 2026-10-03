/* ============================================================
   SESSION EMPLOYEE WORKSPACE VIEW (AFI-4a1, AFI-4a2) — js/ui/session-workspace-view.js
   ------------------------------------------------------------
   The SESSION workspace, rendered into #app by renderAuthView()
   (js/ui/auth-view.js) — its only caller — while AuthBoot is AUTHENTICATED. It is
   NOT the business shell: AuthBoot.allowsWorkspace() stays false, so render()
   never mounts the shell, its navigation, Global Search or "Acting as", and no
   other domain (Payroll, Finance) has an entry here.

   AFI-4b1: two SESSION sections, switched by buttons under the heading — CEO
   "Employees | Overtime", Employee "My profile | My overtime". The existing section
   stays the default; the Overtime section is renderSessionOvertimeHTML()
   (js/ui/session-overtime-view.js, SessionOvertime's memory-only data) — never the
   LOCAL Overtime page. Sections do not switch while a write of either is in flight.
   AFI-4c1: the CEO gets a third section, "Payroll" (renderSessionPayrollHTML(),
   js/ui/session-payroll-view.js, SessionPayroll's memory-only data) — never the LOCAL
   Payroll Workspace; an Employee's sections are unchanged and never include it.

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

// AFI-4b1: the two SESSION sections. A section button shows its section; neither switches while
// a write of either section is in flight. AFI-4c1: the CEO's third section, Payroll (CEO only).
function sessionWorkspaceSectionsHTML(ceo, overtime, busy, payroll){
  const dis = busy ? ' disabled' : '';
  const tab = function(id, label, current){
    return '<button class="tab' + (current ? ' active' : '') + '" type="button" id="' + id + '" aria-pressed="' + current + '"' + dis + '>' + label + '</button>';
  };
  return '<nav aria-label="Workspace sections"><div class="tabs">'
    + tab('swSectionMain', ceo ? 'Employees' : 'My profile', !overtime && !payroll) + tab('swSectionOvertime', ceo ? 'Overtime' : 'My overtime', overtime)
    + (ceo ? tab('swSectionPayroll', 'Payroll', payroll === true) : '')
    + '</div></nav>';
}

function sessionWorkspaceHTML(auth, w){
  const principal = auth.principal;
  const who = (principal && principal.displayName) ? principal.displayName : '';
  const ceo = !!principal && principal.principalType === PRINCIPAL_TYPES.CEO;
  const employee = !!principal && principal.principalType === PRINCIPAL_TYPES.EMPLOYEE;
  const ot = SessionOvertimeStore.snapshot();
  const pr = SessionPayrollStore.snapshot();
  const payroll = ceo && pr.open;                                      // AFI-4c1: CEO only
  const overtime = (ceo || employee) && ot.open && !payroll;
  const busy = w.mutation.status === SESSION_MUTATION_STATUS.PENDING || ot.mutation.status === SESSION_OVERTIME_MUTATION_STATUS.PENDING
    || pr.mutation.status === SESSION_PAYROLL_MUTATION_STATUS.PENDING;
  let title = ceo ? (w.detailId ? (w.form ? 'Edit employee record' : 'Employee record') : 'Employees') : (employee ? 'My profile' : 'TAM OS');
  let body;
  if(payroll){ title = renderSessionPayrollTitle(pr); body = renderSessionPayrollHTML(principal, pr); }
  else if(overtime){ title = renderSessionOvertimeTitle(principal, ot); body = renderSessionOvertimeHTML(principal, ot); }
  else if(ceo) body = w.detailId ? sessionWorkspaceDetailHTML(w) : sessionWorkspaceListHTML(w);
  else if(employee) body = sessionWorkspaceSelfHTML(w);
  else body = '<p class="auth-message auth-message-warn" role="alert">' + escapeHtml(SESSION_WORKSPACE_ERRORS.UNAVAILABLE) + '</p>';
  return '<main class="auth-screen" id="main"><section class="card" aria-labelledby="authTitle">'
    + '<div class="page-head"><div><h1 class="auth-title" id="authTitle" tabindex="-1">' + escapeHtml(title) + '</h1>'
    + '<p class="auth-lead">Signed in as <strong>' + escapeHtml(who) + '</strong>.</p></div>'
    + '<div class="auth-actions"><button class="btn" id="authSignOutBtn" type="button"' + (auth.busy ? ' disabled aria-busy="true"' : '') + '>' + (auth.busy ? 'Signing out…' : 'Sign out') + '</button></div></div>'
    + (ceo || employee ? sessionWorkspaceSectionsHTML(ceo, overtime, busy, payroll) : '')
    + body + '</section></main>';
}

function bindSessionWorkspace(app){
  const on = function(id, fn){ const el = app.querySelector('#' + id); if(el) el.addEventListener('click', fn); };
  on('authSignOutBtn', function(){ AuthBoot.signOut(); });
  // AFI-4b1: the section switch — never while an Employee write is in flight. AFI-4c1: nor while
  // an Overtime or Payroll write is; Payroll is shown only to the CEO (SessionPayroll.show).
  const idle = function(){
    return SessionEmployeeStore.snapshot().mutation.status !== SESSION_MUTATION_STATUS.PENDING
      && SessionOvertimeStore.snapshot().mutation.status !== SESSION_OVERTIME_MUTATION_STATUS.PENDING
      && SessionPayrollStore.snapshot().mutation.status !== SESSION_PAYROLL_MUTATION_STATUS.PENDING;
  };
  const sectionTo = function(overtime){
    return function(){ if(!idle()) return; SessionPayroll.show(false); SessionOvertime.show(overtime); };
  };
  on('swSectionMain', sectionTo(false));
  on('swSectionOvertime', sectionTo(true));
  on('swSectionPayroll', function(){ if(!idle()) return; SessionOvertime.show(false); SessionPayroll.show(true); });
  if(SessionPayrollStore.snapshot().open){ bindSessionPayroll(app); return; }
  if(SessionOvertimeStore.snapshot().open){ bindSessionOvertime(app); return; }
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
  SessionPayroll.ensureLoaded(auth.principal);                 // AFI-4c1: and the Payroll data (CEO only)
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  const kept = (active && active !== app && typeof active.id === 'string' && /^(sw|auth)[A-Za-z-]+$/.test(active.id) && typeof app.contains === 'function' && app.contains(active))
    ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
  app.innerHTML = sessionWorkspaceHTML(auth, SessionEmployeeStore.snapshot());
  bindSessionWorkspace(app);
  const hint = SessionEmployeeStore.takeFocus();
  const otHint = SessionOvertimeStore.takeFocus();
  const prHint = SessionPayrollStore.takeFocus();
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
  sessionWorkspaceFocus(app, hint, kept);
}
