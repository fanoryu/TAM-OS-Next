/* ============================================================
   SESSION FINANCE REQUESTS VIEW (I4, ADR-016) — js/ui/session-requests-view.js
   ------------------------------------------------------------
   The Finance Requests section of the authenticated SESSION workspace, rendered by
   sessionWorkspaceHTML() (js/ui/session-workspace-view.js) — its only caller — when the section is
   shown: "Finance Requests" for the CEO, "My reimbursements" for an Employee.

     List      the requests whose date is in the range (From / To, Apply), a status filter, "New
               payment request" (CEO) or "New reimbursement" (Employee), and one row per request:
               date, type, for (the payee, or the employee), Financial Post, category, amount, status
     Detail    every field the server returned, the status with its reason, the payment when Paid,
               the operations this principal is offered for its status (sessionRequestsOffered), an
               inline confirmation panel for each — reject and cancel ask for a reason, pay for the
               date and method — and, for the CEO, the request's activity history
     Form      create (CEO: a payment request with its payee and needed-by date; Employee: a
               reimbursement with its expense date) or edit a Draft

   Data comes only from SessionRequests / SessionRequestsStore (js/core/session-requests.js);
   nothing is written here but the DOM. MONEY is exactly the string the server sent, escaped, with
   "(Rp)" in its label — never parsed, rounded or recomputed here. Every message is a fixed string;
   every server value and every draft value is escaped. A row is opened by its position in the list
   rendered, through one delegated listener; the opaque id never appears in the page.

   Classic shared global scope; existing CSS classes only.
   ============================================================ */

const SESSION_REQUESTS_ERRORS = Object.freeze({
  DENIED: 'You do not have access to this. TAM OS refused the request.',
  NOT_FOUND: 'This request was not found. It may be outside your access. The list has been read again.',
  CONFLICT: 'This request changed or moved on since it was shown (or this exact request was already sent with other values). TAM OS has read it again: check its current status, then decide again. Nothing was changed by this attempt.',
  RATE_LIMITED: 'Too many requests.',
  VALIDATION: 'Correct the highlighted fields, then try again.',
  CLIENT_FAULT: 'TAM OS could not process this request.',
  SERVER_ERROR: 'The finance requests could not be loaded. A date range with too many requests cannot be shown in full: choose a shorter From and To range, then apply it. If a short range also fails, try again later.',
  UNAVAILABLE: 'The finance requests could not be loaded. Check your connection, then try again.',
  INVALID_RESPONSE: 'TAM OS sent an unexpected response. Try again in a moment.'
});
// An ambiguous write: it may or may not have been stored. A resubmit of a create or a payment sends
// the same request key, so it is recorded at most once; a transition names the version shown.
const SESSION_REQUESTS_AMBIGUOUS = 'TAM OS could not confirm the result. It may already be recorded. Check the request, or confirm again: the same request is never recorded or paid twice.';
const SESSION_REQUESTS_TEXT = Object.freeze({
  leadCeo: 'Payment requests and employee reimbursements. A request is paid only after it is approved; paying it records the expense. Amounts are in Rupiah, exactly as recorded.',
  leadEmployee: 'Your reimbursement claims: create a draft, submit it, then follow its approval and payment.',
  rangeInvalid: 'Enter a From and a To date (From not after To, at most 366 days, from 1900 onwards).',
  noCrypto: 'This browser cannot create a secure request key, so nothing was sent.',
  created: 'Draft saved. Review it, then submit it for approval.',
  updated: 'Draft updated.',
  submit: 'Submitted for approval.',
  approve: 'Approved. It is now waiting for payment.',
  reject: 'Rejected.',
  cancel: 'Cancelled.',
  pay: 'Paid. The expense has been recorded in Transactions.',
  loadingList: 'Loading requests…',
  loadingDetail: 'Loading the request…',
  loadingHistory: 'Loading the history…',
  unchanged: 'Nothing was changed: edit a field first, or cancel.'
});
const SESSION_REQUESTS_KIND_LABELS = Object.freeze({ paymentRequest: 'Payment request', reimbursement: 'Reimbursement' });
const SESSION_REQUESTS_STATUS_TONES = Object.freeze({ Draft: 'neutral', Submitted: 'info', Approved: 'attention', Paid: 'done', Rejected: 'stop', Cancelled: 'stop' });
const SESSION_REQUESTS_STATUS_TEXT = Object.freeze({ Draft: 'Draft', Submitted: 'Submitted', Approved: 'Approved — not paid', Paid: 'Paid', Rejected: 'Rejected', Cancelled: 'Cancelled' });
const SESSION_REQUESTS_METHOD_TEXT = Object.freeze({ cash: 'Cash', bankTransfer: 'Bank transfer', qris: 'QRIS', virtualAccount: 'Virtual account', creditCard: 'Credit card', other: 'Other' });
const SESSION_REQUESTS_OP_BUTTONS = Object.freeze({
  update: Object.freeze({ id: 'frEditBtn', label: 'Edit draft', cls: 'btn' }),
  submit: Object.freeze({ id: 'frSubmitBtn', label: 'Submit for approval', cls: 'btn btn-accent' }),
  approve: Object.freeze({ id: 'frApproveBtn', label: 'Approve', cls: 'btn btn-accent' }),
  reject: Object.freeze({ id: 'frRejectBtn', label: 'Reject', cls: 'btn btn-danger' }),
  pay: Object.freeze({ id: 'frPayBtn', label: 'Record payment', cls: 'btn btn-accent' }),
  cancel: Object.freeze({ id: 'frCancelBtn', label: 'Cancel request', cls: 'btn btn-danger' })
});
const SESSION_REQUESTS_OP_TEXT = Object.freeze({
  submit: Object.freeze({ title: 'Submit for approval', lead: 'Once submitted, the request can no longer be edited. The CEO approves or rejects it.', confirm: 'Submit', busy: 'Submitting…' }),
  approve: Object.freeze({ title: 'Approve request', lead: 'Approving commits the company to pay this amount. It is not a payment: nothing is recorded as an expense until the payment is recorded.', confirm: 'Approve', busy: 'Approving…' }),
  reject: Object.freeze({ title: 'Reject request', lead: 'A rejected request is closed for good. The reason is shown to the requester.', confirm: 'Reject request', busy: 'Rejecting…' }),
  cancel: Object.freeze({ title: 'Cancel request', lead: 'A cancelled request is closed for good and can never be paid.', confirm: 'Cancel request', busy: 'Cancelling…' }),
  pay: Object.freeze({ title: 'Record payment', lead: 'Recording the payment marks the request Paid and records the expense in Transactions, dated the payment date. It cannot be undone here.', confirm: 'Record payment', busy: 'Recording payment…' })
});
// The form: the CEO's payment request has a payee and a needed-by date; a reimbursement an expense date.
function sessionRequestsFormDefs(kind){
  const date = kind === 'paymentRequest'
    ? Object.freeze({ name: 'documentDate', label: 'Needed by', type: 'date', error: 'Enter a date from 1900 up to one year from today.' })
    : Object.freeze({ name: 'documentDate', label: 'Expense date', type: 'date', error: 'Enter a date from 1900 up to today.' });
  const defs = [
    Object.freeze({ name: 'financialPost', label: 'Financial Post', type: 'post', error: 'Choose a Financial Post.' }),
    Object.freeze({ name: 'category', label: 'Category', type: 'text', hint: 'For example Transport. Payroll (Gaji) is never a request.', error: 'Enter a category of 1–64 characters, without leading or trailing spaces. Gaji, Payroll and Salary are not allowed.' }),
    Object.freeze({ name: 'description', label: 'Description', type: 'textarea', error: 'Enter a description of 1–500 characters, without leading or trailing spaces.' }),
    Object.freeze({ name: 'amount', label: 'Amount (Rp)', type: 'text', inputmode: 'decimal', hint: 'Whole Rupiah written as 150000.00.', error: 'Enter a whole Rupiah amount above zero, written as 150000.00.' })
  ];
  if(kind === 'paymentRequest') defs.push(Object.freeze({ name: 'payee', label: 'Payee', type: 'text', error: 'Enter the payee, 1–160 characters, without leading or trailing spaces.' }));
  defs.push(date);
  return defs;
}

function sessionRequestsStatusHTML(r){ return statusBadgeHTML(SESSION_REQUESTS_STATUS_TEXT[r.status], SESSION_REQUESTS_STATUS_TONES[r.status]); }
// Who the request is for: the payee of a payment request; the employee of a reimbursement (the CEO
// sees the name when the employee list (archived included) was read; an Employee sees "You").
function sessionRequestsForText(w, principal, r){
  if(r.kind === 'paymentRequest') return r.payee;
  if(sessionRequestsIsEmployee(principal)) return 'You';
  return w.employees && Object.prototype.hasOwnProperty.call(w.employees, r.employeeId) ? w.employees[r.employeeId] : 'Employee (name not available)';
}
function sessionRequestsRangeLabel(r){ return r ? (r.from === r.to ? r.from : r.from + ' to ' + r.to) : '—'; }

// A read's error with, unless it is final, the Retry of that read (`scope`: list, detail or history; I4-F01).
function sessionRequestsErrorHTML(error, id, scope){
  let msg = SESSION_REQUESTS_ERRORS[error.kind] || SESSION_REQUESTS_ERRORS.UNAVAILABLE;
  if(error.kind === 'NOT_FOUND') msg = 'This request was not found. It may be outside your access.';
  if(error.kind === 'RATE_LIMITED' && typeof authWaitText === 'function') msg += authWaitText(error.retryAfter);
  if(error.requestId) msg += ' Reference: ' + error.requestId + '.';
  const final = error.kind === 'DENIED' || error.kind === 'VALIDATION' || error.kind === 'CLIENT_FAULT' || error.kind === 'NOT_FOUND';
  return '<p class="auth-message auth-message-warn" id="' + id + '" role="alert" tabindex="-1">' + escapeHtml(msg) + '</p>'
    + (final ? '' : '<div class="auth-actions"><button class="btn btn-accent" type="button" id="frRetryBtn" data-fr-retry="' + scope + '">Retry</button></div>');
}

// The write message: pending, ambiguous, refused — or the success notice.
function sessionRequestsMessageHTML(w){
  const m = w.mutation;
  if(m.status === SESSION_REQUESTS_MUTATION_STATUS.PENDING){
    const busy = m.kind === 'create' || m.kind === 'update' ? 'Saving…' : SESSION_REQUESTS_OP_TEXT[m.kind].busy;
    return '<p class="auth-message" id="frMutationMessage" role="status" aria-busy="true" tabindex="-1">' + escapeHtml(busy) + '</p>';
  }
  if(m.status === SESSION_REQUESTS_MUTATION_STATUS.AMBIGUOUS) return '<p class="auth-message auth-message-warn" id="frMutationMessage" role="alert" tabindex="-1">' + escapeHtml(SESSION_REQUESTS_AMBIGUOUS) + '</p>';
  if(m.status === SESSION_REQUESTS_MUTATION_STATUS.ERROR){
    let msg = m.fields && m.fields.length === 1 && m.fields[0] === 'unchanged' ? SESSION_REQUESTS_TEXT.unchanged : (SESSION_REQUESTS_ERRORS[m.error.kind] || SESSION_REQUESTS_ERRORS.UNAVAILABLE);
    if(m.error.kind === 'RATE_LIMITED' && typeof authWaitText === 'function') msg += authWaitText(m.error.retryAfter);
    if(m.error.requestId) msg += ' Reference: ' + m.error.requestId + '.';
    return '<p class="auth-message auth-message-warn" id="frMutationMessage" role="alert" tabindex="-1">' + escapeHtml(msg) + '</p>';
  }
  if(w.notice === 'rangeInvalid' || w.notice === 'noCrypto') return '<p class="auth-message auth-message-warn" id="frMessage" role="alert" tabindex="-1">' + escapeHtml(SESSION_REQUESTS_TEXT[w.notice]) + '</p>';
  if(w.notice && SESSION_REQUESTS_TEXT[w.notice]) return '<p class="auth-message" id="frMessage" role="status" tabindex="-1">' + escapeHtml(SESSION_REQUESTS_TEXT[w.notice]) + '</p>';
  return '';
}

function sessionRequestsFieldHTML(def, value, invalid, disabled){
  const id = 'frf-' + def.name;
  const hintId = def.hint ? id + '-hint' : '';
  const errorId = invalid ? id + '-error' : '';
  const described = [hintId, errorId].filter(Boolean).join(' ');
  const attrs = ' id="' + id + '" name="' + def.name + '" required aria-required="true"' + (invalid ? ' aria-invalid="true"' : '')
    + (described ? ' aria-describedby="' + described + '"' : '') + (disabled ? ' disabled' : '');
  const option = function(v, label){ return '<option value="' + escapeHtml(v) + '"' + (v === value ? ' selected' : '') + '>' + escapeHtml(label) + '</option>'; };
  let control;
  if(def.type === 'post') control = '<select class="input"' + attrs + '>' + option('', 'Choose a Financial Post') + FINANCIAL_POSTS.map(function(p){ return option(p.code, p.name); }).join('') + '</select>';
  else if(def.type === 'textarea') control = '<textarea class="input" rows="3"' + attrs + '>' + escapeHtml(value) + '</textarea>';
  else control = '<input class="input" type="' + def.type + '"' + (def.inputmode ? ' inputmode="' + def.inputmode + '"' : '') + ' autocomplete="off"' + attrs + ' value="' + escapeHtml(value) + '">';
  return '<div class="field"><label for="' + id + '">' + escapeHtml(def.label) + ' <span aria-hidden="true">*</span></label>' + control
    + (def.hint ? '<p class="hint" id="' + hintId + '">' + escapeHtml(def.hint) + '</p>' : '')
    + (invalid ? '<p class="hint auth-message-warn" id="' + errorId + '">' + escapeHtml(def.error) + '</p>' : '')
    + (def.name === 'amount' ? '<p class="hint" id="frf-amount-preview" aria-live="polite">' + escapeHtml(sessionLedgerAmountPreview(value)) + '</p>' : '') + '</div>';
}

function sessionRequestsFormHTML(w){
  const f = w.form;
  const busy = w.mutation.status === SESSION_REQUESTS_MUTATION_STATUS.PENDING;
  const invalid = (w.mutation.kind === 'create' || w.mutation.kind === 'update') && w.mutation.fields ? w.mutation.fields : [];
  const title = f.mode === 'edit' ? 'Edit draft' : (f.kind === 'paymentRequest' ? 'New payment request' : 'New reimbursement');
  const lead = f.mode === 'edit' ? 'Only a Draft can be edited. Save keeps it a Draft; submit it from the request when it is ready.'
    : 'Saving creates a Draft. Nothing is sent for approval until you submit it.';
  return '<form class="card" id="frForm" aria-labelledby="frFormTitle" novalidate><h2 class="section-title" id="frFormTitle" tabindex="-1">' + escapeHtml(title) + '</h2>'
    + '<p class="hint">' + escapeHtml(lead) + '</p><div class="form-grid">'
    + sessionRequestsFormDefs(f.kind).map(function(def){ return sessionRequestsFieldHTML(def, f.values[def.name], invalid.indexOf(def.name) !== -1, busy); }).join('')
    + '</div>' + sessionRequestsMessageHTML(w)
    + '<div class="auth-actions"><button class="btn btn-accent" type="submit" id="frFormSubmit"' + (busy ? ' disabled aria-busy="true"' : '') + '>' + (f.mode === 'edit' ? 'Save changes' : 'Save draft') + '</button>'
    + '<button class="btn" type="button" id="frFormCancel"' + (busy ? ' disabled' : '') + '>Cancel</button></div></form>';
}

function sessionRequestsListHTML(w, principal){
  const busy = w.mutation.status === SESSION_REQUESTS_MUTATION_STATUS.PENDING;
  const dis = busy ? ' disabled' : '';
  const d = w.rangeDraft || { from: '', to: '' };
  const kind = sessionRequestsCreateKind(principal);
  const statusOption = function(v, label){ return '<option value="' + escapeHtml(v) + '"' + (v === w.filter ? ' selected' : '') + '>' + escapeHtml(label) + '</option>'; };
  const controls = '<form class="head-controls" id="frRangeForm" role="group" aria-label="Date range" novalidate>'
    + '<label for="frFrom">From</label><input class="input" type="date" id="frFrom" name="from" autocomplete="off" value="' + escapeHtml(d.from) + '"' + dis + '>'
    + '<label for="frTo">To</label><input class="input" type="date" id="frTo" name="to" autocomplete="off" value="' + escapeHtml(d.to) + '"' + dis + '>'
    + '<button class="btn" type="submit" id="frApplyBtn"' + dis + '>Apply</button>'
    + '<label for="frFilter">Status</label><select class="input" id="frFilter" name="status"' + dis + '>' + statusOption('', 'All statuses')
    + FINANCE_REQUEST_STATUSES.map(function(s){ return statusOption(s, SESSION_REQUESTS_STATUS_TEXT[s]); }).join('') + '</select></form>'
    + '<div class="auth-actions"><button class="btn btn-accent" type="button" id="frNewBtn"' + dis + '>' + (kind === 'paymentRequest' ? 'New payment request' : 'New reimbursement') + '</button></div>';
  const head = '<h2 class="section-title" id="frListTitle" tabindex="-1">Requests dated ' + escapeHtml(sessionRequestsRangeLabel(w.range)) + '</h2>';
  if(w.listStatus === SESSION_REQUESTS_STATUS.ERROR && w.errors.list) return controls + head + sessionRequestsErrorHTML(w.errors.list, 'frReadError', 'list');
  if(w.listStatus !== SESSION_REQUESTS_STATUS.READY || !w.list) return controls + head + '<p class="auth-lead" role="status" aria-busy="true">' + escapeHtml(SESSION_REQUESTS_TEXT.loadingList) + '</p>';
  const rows = w.list.filter(function(r){ return !w.filter || r.status === w.filter; });
  if(!rows.length) return controls + head + '<div class="empty" role="status">' + (w.list.length ? 'No ' + escapeHtml(SESSION_REQUESTS_STATUS_TEXT[w.filter]) + ' requests in this range.' : 'No requests dated ' + escapeHtml(sessionRequestsRangeLabel(w.range)) + '.') + '</div>';
  const body = rows.map(function(r, i){
    return '<tr><td>' + escapeHtml(r.documentDate) + '</td><td>' + escapeHtml(SESSION_REQUESTS_KIND_LABELS[r.kind]) + '</td><td>' + escapeHtml(sessionRequestsForText(w, principal, r)) + '</td>'
      + '<td>' + escapeHtml(transactionPostName(r.financialPost)) + '</td><td>' + escapeHtml(r.category) + '</td><td>' + moneyHTML(r.amount) + '</td>'
      + '<td>' + sessionRequestsStatusHTML(r) + '</td><td><button class="btn" type="button" data-fr-open="' + i + '"' + dis + '>Open</button></td></tr>';
  }).join('');
  return controls + head + '<p class="hint">' + rows.length + (rows.length === 1 ? ' request' : ' requests') + (w.filter ? ' ' + escapeHtml(SESSION_REQUESTS_STATUS_TEXT[w.filter]) : '') + ', by date.</p>'
    + '<div class="table-wrap" id="frList"><table><thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">For</th><th scope="col">Financial Post</th>'
    + '<th scope="col">Category</th><th scope="col">Amount (Rp)</th><th scope="col">Status</th><th scope="col" aria-label="Open"></th></tr></thead><tbody>' + body + '</tbody></table></div>';
}

function sessionRequestsActionHTML(w, r){
  const a = w.action;
  const t = SESSION_REQUESTS_OP_TEXT[a.op];
  const busy = w.mutation.status === SESSION_REQUESTS_MUTATION_STATUS.PENDING;
  const fields = w.mutation.kind === a.op && w.mutation.fields ? w.mutation.fields : [];
  const dis = busy ? ' disabled' : '';
  const bad = function(n){ return fields.indexOf(n) !== -1; };
  let inputs = '';
  if(a.op === 'reject' || a.op === 'cancel'){
    inputs = '<div class="field"><label for="frReason">Reason <span aria-hidden="true">*</span></label><input class="input" type="text" id="frReason" name="reason" autocomplete="off" required aria-required="true"'
      + (bad('reason') ? ' aria-invalid="true" aria-describedby="frReason-error"' : '') + dis + ' value="' + escapeHtml(a.reason) + '">'
      + (bad('reason') ? '<p class="hint auth-message-warn" id="frReason-error">Enter a reason of 1–200 characters, without leading or trailing spaces.</p>' : '') + '</div>';
  } else if(a.op === 'pay'){
    const option = function(v, label){ return '<option value="' + escapeHtml(v) + '"' + (v === a.paymentMethod ? ' selected' : '') + '>' + escapeHtml(label) + '</option>'; };
    inputs = '<div class="form-grid"><div class="field"><label for="frPaidOn">Payment date <span aria-hidden="true">*</span></label><input class="input" type="date" id="frPaidOn" name="paidOn" autocomplete="off" required aria-required="true"'
      + (bad('paidOn') ? ' aria-invalid="true" aria-describedby="frPaidOn-error"' : '') + dis + ' value="' + escapeHtml(a.paidOn) + '">'
      + (bad('paidOn') ? '<p class="hint auth-message-warn" id="frPaidOn-error">Enter a date from 1900 up to today.</p>' : '') + '</div>'
      + '<div class="field"><label for="frMethod">Payment method <span aria-hidden="true">*</span></label><select class="input" id="frMethod" name="paymentMethod" required aria-required="true"'
      + (bad('paymentMethod') ? ' aria-invalid="true" aria-describedby="frMethod-error"' : '') + dis + '>' + option('', 'Choose a method')
      + FINANCE_EXECUTION_PAYMENT_METHODS.map(function(m){ return option(m, SESSION_REQUESTS_METHOD_TEXT[m]); }).join('') + '</select>'
      + (bad('paymentMethod') ? '<p class="hint auth-message-warn" id="frMethod-error">Choose a payment method.</p>' : '') + '</div></div>';
  }
  const danger = a.op === 'reject' || a.op === 'cancel';
  return '<form class="card" id="frActionForm" aria-labelledby="frActionTitle" novalidate><h3 class="section-title" id="frActionTitle" tabindex="-1">' + escapeHtml(t.title) + '</h3>'
    + '<p class="auth-lead">' + escapeHtml(SESSION_REQUESTS_KIND_LABELS[r.kind] + ' of Rp ' + moneyDisplay(r.amount) + ' — ' + r.category + ': ' + r.description) + '</p>'
    + '<p class="hint">' + escapeHtml(t.lead) + '</p>' + inputs + sessionRequestsMessageHTML(w)
    + '<div class="auth-actions"><button class="btn ' + (danger ? 'btn-danger' : 'btn-accent') + '" type="submit" id="frActionConfirm"' + (busy ? ' disabled aria-busy="true"' : '') + '>' + escapeHtml(t.confirm) + '</button>'
    + '<button class="btn" type="button" id="frActionCancel"' + dis + '>Back</button></div></form>';
}

function sessionRequestsHistoryHTML(w){
  let body;
  if(w.historyStatus === SESSION_REQUESTS_STATUS.ERROR && w.errors.history) body = sessionRequestsErrorHTML(w.errors.history, 'frHistoryError', 'history');
  else if(w.historyStatus !== SESSION_REQUESTS_STATUS.READY || !w.history) body = '<p class="auth-lead" role="status" aria-busy="true">' + escapeHtml(SESSION_REQUESTS_TEXT.loadingHistory) + '</p>';
  else if(!w.history.length) body = '<p class="hint">No activity recorded for this request.</p>';
  else body = '<ul class="ux-list" id="frHistory">' + w.history.map(function(e){ return '<li><span>' + escapeHtml(sessionAuditActionLabel(e)) + '</span><span class="mono">' + sessionAuditTimeHTML(e) + '</span></li>'; }).join('') + '</ul>';
  return '<h3 class="section-title">Activity</h3>' + body;
}

function sessionRequestsDetailHTML(w, principal){
  const busy = w.mutation.status === SESSION_REQUESTS_MUTATION_STATUS.PENDING;
  const dis = busy || w.action ? ' disabled' : '';
  const back = '<div class="auth-actions"><button class="btn" type="button" id="frBackBtn"' + (busy ? ' disabled' : '') + '>Back to the list</button></div>';
  if(w.detailStatus === SESSION_REQUESTS_STATUS.ERROR && w.errors.detail) return back + sessionRequestsMessageHTML(w) + sessionRequestsErrorHTML(w.errors.detail, 'frReadError', 'detail');
  if(!w.detail) return back + sessionRequestsMessageHTML(w) + '<p class="auth-lead" role="status" aria-busy="true">' + escapeHtml(SESSION_REQUESTS_TEXT.loadingDetail) + '</p>';
  const r = w.detail;
  const rows = [
    ['Type', escapeHtml(SESSION_REQUESTS_KIND_LABELS[r.kind])],
    ['Status', sessionRequestsStatusHTML(r)],
    [r.kind === 'paymentRequest' ? 'Payee' : 'Employee', escapeHtml(sessionRequestsForText(w, principal, r))],
    ['Amount (Rp)', moneyHTML(r.amount)],
    ['Financial Post', escapeHtml(transactionPostName(r.financialPost))],
    ['Category', escapeHtml(r.category)],
    ['Description', escapeHtml(r.description)],
    [r.kind === 'paymentRequest' ? 'Needed by' : 'Expense date', escapeHtml(r.documentDate)]
  ];
  if(r.statusReason !== null) rows.push([r.status === 'Rejected' ? 'Reason for rejection' : 'Reason for cancellation', escapeHtml(r.statusReason)]);
  if(r.payment) rows.push(['Paid on', escapeHtml(r.payment.paidOn)], ['Payment method', escapeHtml(SESSION_REQUESTS_METHOD_TEXT[r.payment.paymentMethod])]);
  rows.push(['Created', sessionAuditTimeHTML({ occurredAt: r.createdAt })], ['Last changed', sessionAuditTimeHTML({ occurredAt: r.updatedAt })], ['Version', escapeHtml(String(r.version))]);
  const note = r.status === 'Approved' ? '<p class="hint">Approved, not paid: the amount is committed but not yet an expense. It counts in no income, expense or net total until the payment is recorded.</p>'
    : (r.status === 'Paid' ? '<p class="hint">The payment is recorded as an expense in Transactions on the payment date.</p>' : '');
  const offered = sessionRequestsOffered(principal, r);
  const buttons = offered.length && !w.action
    ? '<div class="auth-actions" id="frOps">' + offered.map(function(op){ const b = SESSION_REQUESTS_OP_BUTTONS[op]; return '<button class="' + b.cls + '" type="button" id="' + b.id + '"' + dis + '>' + escapeHtml(b.label) + '</button>'; }).join('') + '</div>'
    : '';
  const reloading = w.detailStatus === SESSION_REQUESTS_STATUS.LOADING ? '<p class="hint" role="status" aria-busy="true">' + escapeHtml(SESSION_REQUESTS_TEXT.loadingDetail) + '</p>' : '';
  return back + (w.action ? '' : sessionRequestsMessageHTML(w)) + reloading
    + '<h2 class="section-title" id="frDetailTitle" tabindex="-1">' + escapeHtml(SESSION_REQUESTS_KIND_LABELS[r.kind] + ', ' + r.documentDate) + '</h2>'
    + '<dl class="ux-kv" id="frDetail">' + rows.map(function(x){ return '<dt>' + escapeHtml(x[0]) + '</dt><dd>' + x[1] + '</dd>'; }).join('') + '</dl>' + note
    + buttons + (w.action ? sessionRequestsActionHTML(w, r) : '')
    + (sessionRequestsIsCeo(principal) ? sessionRequestsHistoryHTML(w) : '');
}

// The section title (the workspace heading) and body.
function renderSessionRequestsTitle(principal, w){
  if(w.form) return w.form.mode === 'edit' ? 'Edit draft' : (w.form.kind === 'paymentRequest' ? 'New payment request' : 'New reimbursement');
  if(w.detailId) return sessionRequestsIsCeo(principal) ? 'Finance request' : 'Reimbursement';
  return sessionRequestsIsCeo(principal) ? 'Finance Requests' : 'My reimbursements';
}
function renderSessionRequestsHTML(principal, w){
  const lead = '<p class="hint">' + escapeHtml(sessionRequestsIsCeo(principal) ? SESSION_REQUESTS_TEXT.leadCeo : SESSION_REQUESTS_TEXT.leadEmployee) + '</p>';
  if(w.form) return lead + sessionRequestsFormHTML(w);
  if(w.detailId) return lead + sessionRequestsDetailHTML(w, principal);
  return lead + sessionRequestsMessageHTML(w) + sessionRequestsListHTML(w, principal);
}

function bindSessionRequests(app){
  const on = function(id, type, fn){ const el = app.querySelector('#' + id); if(el) el.addEventListener(type, fn); };
  on('frFrom', 'input', function(){ SessionRequests.setRangeDraft('from', this.value); });
  on('frTo', 'input', function(){ SessionRequests.setRangeDraft('to', this.value); });
  on('frRangeForm', 'submit', function(e){
    e.preventDefault();
    const from = app.querySelector('#frFrom'), to = app.querySelector('#frTo');
    if(from) SessionRequests.setRangeDraft('from', from.value);
    if(to) SessionRequests.setRangeDraft('to', to.value);
    SessionRequests.applyRange();
  });
  on('frFilter', 'change', function(){ SessionRequests.setFilter(this.value); });
  on('frRetryBtn', 'click', function(){ SessionRequests.retry(this.getAttribute('data-fr-retry')); });   // the read whose error it is shown with
  on('frNewBtn', 'click', function(){ SessionRequests.openCreate(); });
  on('frBackBtn', 'click', function(){ SessionRequests.back(); });
  on('frEditBtn', 'click', function(){ SessionRequests.openEdit(); });
  ['submit', 'approve', 'reject', 'pay', 'cancel'].forEach(function(op){ on(SESSION_REQUESTS_OP_BUTTONS[op].id, 'click', function(){ SessionRequests.openAction(op); }); });
  on('frFormCancel', 'click', function(){ SessionRequests.cancelForm(); });
  on('frActionCancel', 'click', function(){ SessionRequests.cancelAction(); });
  const form = app.querySelector('#frForm');
  if(form){
    const keep = function(){ SessionRequests.setDraft(this.name, this.value); };
    FINANCE_REQUEST_FIELDS.forEach(function(n){
      const el = form.querySelector('#frf-' + n);
      if(el){ el.addEventListener('input', keep); el.addEventListener('change', keep); }
    });
    const amount = form.querySelector('#frf-amount'), preview = form.querySelector('#frf-amount-preview');
    if(amount && preview) amount.addEventListener('input', function(){ preview.textContent = sessionLedgerAmountPreview(this.value); });
    form.addEventListener('submit', function(e){
      e.preventDefault();
      FINANCE_REQUEST_FIELDS.forEach(function(n){ const el = form.querySelector('#frf-' + n); if(el) SessionRequests.setDraft(n, el.value); });
      SessionRequests.submitForm();
    });
  }
  const action = app.querySelector('#frActionForm');
  if(action){
    const ids = { frReason: 'reason', frPaidOn: 'paidOn', frMethod: 'paymentMethod' };
    Object.keys(ids).forEach(function(id){
      const el = action.querySelector('#' + id);
      if(el){ const keep = function(){ SessionRequests.setActionField(ids[id], this.value); }; el.addEventListener('input', keep); el.addEventListener('change', keep); }
    });
    action.addEventListener('submit', function(e){
      e.preventDefault();
      Object.keys(ids).forEach(function(id){ const el = action.querySelector('#' + id); if(el) SessionRequests.setActionField(ids[id], el.value); });
      SessionRequests.confirmAction();
    });
  }
  // One listener for every row: the button's position in the list that was rendered.
  on('frList', 'click', function(ev){
    const button = ev && ev.target && typeof ev.target.closest === 'function' ? ev.target.closest('[data-fr-open]') : null;
    if(button && !button.disabled) SessionRequests.openDetail(Number(button.getAttribute('data-fr-open')));
  });
}

// After a render: the element the section asked for, else null (the workspace decides).
function sessionRequestsFocusTarget(app, hint){
  if(hint === 'section') return app.querySelector('#authTitle');
  if(hint === 'list') return app.querySelector('#frListTitle');
  if(hint === 'detail') return app.querySelector('#frDetailTitle') || app.querySelector('#frBackBtn');
  if(hint === 'form') return app.querySelector('#frf-financialPost');
  if(hint === 'action') return app.querySelector('#frReason') || app.querySelector('#frPaidOn') || app.querySelector('#frActionConfirm');
  if(hint === 'message') return app.querySelector('#frMutationMessage') || app.querySelector('#frMessage') || app.querySelector('#frReadError');
  return null;
}
