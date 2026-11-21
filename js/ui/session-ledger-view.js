/* ============================================================
   SESSION LEDGER VIEW (Phase 1, D-INT-1 / D-INT-2) — js/ui/session-ledger-view.js
   ------------------------------------------------------------
   The CEO's Finance section of the authenticated SESSION workspace, rendered by
   sessionWorkspaceHTML() (js/ui/session-workspace-view.js) — its only caller — when the section is
   shown, for the CEO only. It is NOT the LOCAL Transactions page or the LOCAL dashboard and never
   reaches them, the business shell, its navigation, Global Search or "Acting as". An Employee has
   no Finance section.

     Date range    From / To (inclusive, company calendar dates) and Apply — shared by both views
     Dashboard     income, expenses and net per Financial Post (GA, NP & IP, TJB, RnD), the
                   general total, the voided transactions (shown, never counted), the separate
                   Payroll line (posted for the payroll months the range touches; paid in the
                   range) — never split across the Financial Posts — and the consolidated total,
                   which counts payroll once, as paid
     Transactions  the history of the range (oldest first, Voided rows marked with their reason),
                   "Record transaction" (an inline form: income or expense, Financial Post,
                   category, description, amount, date) and "Void" on an Active row (an inline
                   panel asking for the reason). There is no edit and no delete: a void is the only
                   correction, and the voided row stays in the history.
     Export CSV    AWP-05 (OD-13 = A): the view shown, once read, as a CSV download built in the
                   browser (js/core/session-csv.js) — never Payroll or the consolidated total (GP-03)

   Data comes only from SessionLedger / SessionLedgerStore (js/core/session-ledger.js); nothing
   is written here but the DOM. MONEY is exactly the string the server sent, escaped, with "(Rp)"
   in its label — never parsed, rounded or recomputed here. Every message is a fixed string; every
   server value and every draft value is escaped. A row is acted on by its position in the list
   rendered, through one delegated listener.

   Classic shared global scope; existing CSS classes only.
   ============================================================ */

const SESSION_LEDGER_ERRORS = Object.freeze({
  DENIED: 'You do not have access to the company finances.',
  NOT_FOUND: 'This transaction was not found.',
  CONFLICT: 'TAM OS reported a conflict: this transaction may already be voided, or the request was already used with other values. Check the history, then try again.',
  RATE_LIMITED: 'Too many requests.',
  VALIDATION: 'Correct the highlighted fields, then try again.',
  CLIENT_FAULT: 'TAM OS could not process this request.',
  // PD-7: a range above its cap fails closed as a server error, so the guidance is to narrow the range.
  SERVER_ERROR: 'The finance information could not be loaded. A date range with too many transactions cannot be shown in full: choose a shorter From and To range, then apply it. If a short range also fails, try again later.',
  UNAVAILABLE: 'The finance information could not be loaded. Check your connection, then try again.',
  INVALID_RESPONSE: 'TAM OS sent an unexpected response. Try again in a moment.'
});
// An ambiguous write: it may or may not have been stored. A resubmit sends the same request key,
// so it is recorded at most once.
const SESSION_LEDGER_AMBIGUOUS = 'TAM OS could not confirm the result. It may already be recorded. Check the history, or submit again: the same request is never recorded twice.';
const SESSION_LEDGER_TEXT = Object.freeze({
  lead: 'Company income and expenses by Financial Post, with payroll reported separately. Amounts are in Rupiah, exactly as recorded.',
  rangeInvalid: 'Enter a From and a To date (From not after To, at most 366 days, from 1900 onwards).',
  noCrypto: 'This browser cannot create a secure request key, so nothing was sent.',
  created: 'Transaction recorded.',
  voided: 'Transaction voided. It stays in the history, marked Voided, and no longer counts in any total.',
  // AWP-05 (OD-13 = A): the CSV export of the view shown.
  exported: 'CSV file prepared for download: exactly the rows shown for this range. Downloads are not recorded in the audit history.',
  exportUnavailable: 'This browser cannot prepare a download, so nothing was exported.',
  exportReportNote: 'Export CSV holds the Financial Post lines, the voided line and the approved-not-paid line of this range. Payroll and the consolidated total are not exported.',
  loadingReport: 'Loading the financial dashboard…',
  loadingList: 'Loading transactions…',
  payrollNote: 'Payroll is not allocated to a Financial Post. Posted is the payroll recorded for the months this range touches; paid is the payroll paid on dates in this range. Only paid payroll counts in the consolidated total, so nothing is counted twice.',
  voidedNote: 'Voided transactions are shown in the history and never counted.',
  // I4: the Approved-not-paid line of the report.
  approvedNote: 'An approved request is a commitment, not a payment. It becomes an expense only when its payment is recorded, on the payment date, and is then counted once in the expenses above.',
  noEdit: 'A recorded transaction cannot be edited or deleted. To correct one, void it with a reason and record it again.',
  voidLead: 'Voiding keeps the transaction in the history, marked Voided, and removes it from every total. It cannot be undone.'
});
const SESSION_LEDGER_KIND_LABELS = Object.freeze({ income: 'Income', expense: 'Expense' });
const SESSION_LEDGER_FORM = Object.freeze([
  Object.freeze({ name: 'kind', label: 'Type', type: 'kind', error: 'Choose income or expense.' }),
  Object.freeze({ name: 'financialPost', label: 'Financial Post', type: 'post', error: 'Choose a Financial Post.' }),
  Object.freeze({ name: 'category', label: 'Category', type: 'text', hint: 'For example Operasional Rutin. Payroll (Gaji) is recorded through Payroll, never here.', error: 'Enter a category of 1–64 characters, without leading or trailing spaces. Gaji, Payroll and Salary are not allowed.' }),
  Object.freeze({ name: 'description', label: 'Description', type: 'textarea', error: 'Enter a description of 1–500 characters, without leading or trailing spaces.' }),
  Object.freeze({ name: 'amount', label: 'Amount (Rp)', type: 'text', inputmode: 'decimal', hint: 'Whole Rupiah written as 150000.00.', error: 'Enter a whole Rupiah amount above zero, written as 150000.00.' }),
  Object.freeze({ name: 'transactionDate', label: 'Date', type: 'date', error: 'Enter a date from 1900 up to today.' })
]);

function sessionLedgerErrorHTML(error, id){
  let msg = SESSION_LEDGER_ERRORS[error.kind] || SESSION_LEDGER_ERRORS.UNAVAILABLE;
  if(error.kind === 'RATE_LIMITED' && typeof authWaitText === 'function') msg += authWaitText(error.retryAfter);
  if(error.requestId) msg += ' Reference: ' + error.requestId + '.';
  const final = error.kind === 'DENIED' || error.kind === 'VALIDATION' || error.kind === 'CLIENT_FAULT';
  return '<p class="auth-message auth-message-warn" id="' + id + '" role="alert" tabindex="-1">' + escapeHtml(msg) + '</p>'
    + (final ? '' : '<div class="auth-actions"><button class="btn btn-accent" type="button" id="sfRetryBtn">Retry</button></div>');
}

function sessionLedgerRangeHTML(w, dis){
  const d = w.rangeDraft || { from: '', to: '' };
  const message = w.notice === 'rangeInvalid' || w.notice === 'noCrypto'
    ? '<p class="auth-message auth-message-warn" id="sfMessage" role="alert" tabindex="-1">' + escapeHtml(SESSION_LEDGER_TEXT[w.notice]) + '</p>' : '';
  return '<form class="head-controls" id="sfRangeForm" role="group" aria-label="Date range" novalidate>'
    + '<label for="sfFrom">From</label><input class="input" type="date" id="sfFrom" name="from" autocomplete="off" value="' + escapeHtml(d.from) + '"' + dis + '>'
    + '<label for="sfTo">To</label><input class="input" type="date" id="sfTo" name="to" autocomplete="off" value="' + escapeHtml(d.to) + '"' + dis + '>'
    + '<button class="btn" type="submit" id="sfApplyBtn"' + dis + '>Apply</button></form>' + message;
}

function sessionLedgerRangeLabel(r){
  return r ? (r.from === r.to ? r.from : r.from + ' to ' + r.to) : '—';
}

// AWP-05 (OD-13 = A): the CSV of the view shown, from the answer already read, or null while that read
// has not succeeded. Every text cell goes through SessionCsv.text (formula-safe); every amount is the
// exact server string (SessionCsv.money); a value with no meaning on its line is empty, never 0.
// GP-03: the Payroll line and the consolidated total (which counts payroll) are never exported.
const SESSION_LEDGER_CSV_TRANSACTIONS = Object.freeze(['Date', 'Type', 'Financial Post', 'Category', 'Description', 'Amount (Rp)', 'Status', 'Void reason']);
const SESSION_LEDGER_CSV_REPORT = Object.freeze(['From', 'To', 'Section', 'Financial Post', 'Income (Rp)', 'Expenses (Rp)', 'Net (Rp)', 'Amount (Rp)', 'Count']);
function sessionLedgerTransactionsCsv(w){
  if(w.listStatus !== SESSION_LEDGER_STATUS.READY || !w.list || !w.range) return null;
  const c = SessionCsv;
  const rows = w.list.map(function(t){
    return [c.text(t.transactionDate), c.text(SESSION_LEDGER_KIND_LABELS[t.kind]), c.text(transactionPostName(t.financialPost)), c.text(t.category),
      c.text(t.description), c.money(t.amount), c.text(t.status), c.text(t.void ? t.void.reason : null)];
  });
  return { content: c.document(SESSION_LEDGER_CSV_TRANSACTIONS, rows), filename: c.filename(['transactions', w.range.from, 'to', w.range.to]) };
}
function sessionLedgerReportCsv(w){
  if(w.reportStatus !== SESSION_LEDGER_STATUS.READY || !w.report || !w.range) return null;
  const c = SessionCsv, r = w.report;
  const lead = [c.text(r.from), c.text(r.to)];
  const flow = function(section, name, l){ return lead.concat([c.text(section), c.text(name), c.money(l.income), c.money(l.expense), c.money(l.net), '', c.count(l.count)]); };
  const amount = function(section, name, l){ return lead.concat([c.text(section), c.text(name), '', '', '', c.money(l.amount), c.count(l.count)]); };
  const rows = r.posts.map(function(p){ return flow('Income and expenses', p.name, p); })
    .concat([flow('Income and expenses', 'All Financial Posts', r.general), amount('Voided, not counted', null, r.voided)])
    .concat(r.approvedNotPaid.posts.map(function(p){ return amount('Approved, not paid', transactionPostName(p.code), p); }))
    .concat([amount('Approved, not paid', 'All Financial Posts', r.approvedNotPaid)]);
  return { content: c.document(SESSION_LEDGER_CSV_REPORT, rows), filename: c.filename(['financial-report', w.range.from, 'to', w.range.to]) };
}
function sessionLedgerExportHTML(w, note){
  const dis = w.mutation.status === SESSION_LEDGER_MUTATION_STATUS.PENDING || w.form || w.voidTarget ? ' disabled' : '';
  return '<div class="auth-actions"><button class="btn" type="button" id="sfExportBtn"' + dis + '>Export CSV</button></div>'
    + (note ? '<p class="hint" id="sfExportNote">' + escapeHtml(note) + '</p>' : '');
}

function sessionLedgerDashboardHTML(w){
  const head = '<h2 class="section-title" id="sfViewTitle" tabindex="-1">Financial dashboard, ' + escapeHtml(sessionLedgerRangeLabel(w.range)) + '</h2>';
  if(w.reportStatus === SESSION_LEDGER_STATUS.ERROR && w.error && w.error.scope === 'report') return head + sessionLedgerErrorHTML(w.error, 'sfReadError');
  if(w.reportStatus !== SESSION_LEDGER_STATUS.READY || !w.report) return head + '<p class="auth-lead" role="status" aria-busy="true">' + escapeHtml(SESSION_LEDGER_TEXT.loadingReport) + '</p>';
  const r = w.report;
  const row = function(label, l, scope){
    return '<tr><th scope="' + (scope || 'row') + '">' + escapeHtml(label) + '</th><td>' + moneyHTML(l.income) + '</td><td>' + moneyHTML(l.expense) + '</td><td>' + moneyHTML(l.net) + '</td>'
      + '<td>' + (l.count === undefined ? '—' : escapeHtml(String(l.count))) + '</td></tr>';
  };
  const posts = '<div class="table-wrap" id="sfPosts"><table><caption>Income and expenses by Financial Post</caption><thead><tr><th scope="col">Financial Post</th>'
    + '<th scope="col">Income (Rp)</th><th scope="col">Expenses (Rp)</th><th scope="col">Net (Rp)</th><th scope="col">Transactions</th></tr></thead><tbody>'
    + r.posts.map(function(p){ return row(p.name, p); }).join('')
    + row('All Financial Posts', r.general) + '</tbody></table></div>'
    + '<p class="hint">' + escapeHtml(SESSION_LEDGER_TEXT.voidedNote) + ' Voided in this range: ' + escapeHtml(String(r.voided.count)) + ' (Rp ' + moneyHTML(r.voided.amount) + ').</p>';
  const p = r.payroll;
  const payroll = '<h3 class="section-title">Payroll</h3><div class="table-wrap" id="sfPayroll"><table><caption>Payroll, reported separately</caption><thead><tr><th scope="col">Payroll</th><th scope="col">Amount (Rp)</th><th scope="col">Records</th></tr></thead><tbody>'
    + '<tr><th scope="row">Posted for ' + escapeHtml(p.posted.fromMonth === p.posted.toMonth ? p.posted.fromMonth : p.posted.fromMonth + ' to ' + p.posted.toMonth) + '</th><td>' + moneyHTML(p.posted.amount) + '</td><td>' + escapeHtml(String(p.posted.count)) + '</td></tr>'
    + '<tr><th scope="row">Paid in this range</th><td>' + moneyHTML(p.paid.amount) + '</td><td>' + escapeHtml(String(p.paid.count)) + '</td></tr>'
    + '</tbody></table></div><p class="hint">' + escapeHtml(SESSION_LEDGER_TEXT.payrollNote) + '</p>';
  const c = r.consolidated;
  const consolidated = '<h3 class="section-title">Consolidated (cash basis)</h3><div class="table-wrap" id="sfConsolidated"><table><caption>Consolidated total, cash basis: general income and expenses plus payroll paid in this range</caption><thead><tr><th scope="col">Total</th><th scope="col">Income (Rp)</th><th scope="col">Expenses (Rp)</th><th scope="col">Net (Rp)</th></tr></thead><tbody>'
    + '<tr><th scope="row">Financial Posts and payroll paid (cash basis)</th><td>' + moneyHTML(c.income) + '</td><td>' + moneyHTML(c.expense) + '</td><td>' + moneyHTML(c.net) + '</td></tr></tbody></table></div>';
  // I4 (ADR-016 §6): the Approved-not-paid finance requests, per Financial Post — shown apart, never counted in a total above.
  const a = r.approvedNotPaid;
  const pending = '<h3 class="section-title">Approved, not paid</h3><div class="table-wrap" id="sfApprovedNotPaid"><table><caption>Approved finance requests dated in this range, waiting for payment — not counted in any total above</caption>'
    + '<thead><tr><th scope="col">Financial Post</th><th scope="col">Amount (Rp)</th><th scope="col">Requests</th></tr></thead><tbody>'
    + a.posts.map(function(p){ return '<tr><th scope="row">' + escapeHtml(transactionPostName(p.code)) + '</th><td>' + moneyHTML(p.amount) + '</td><td>' + escapeHtml(String(p.count)) + '</td></tr>'; }).join('')
    + '<tr><th scope="row">All Financial Posts</th><td>' + moneyHTML(a.amount) + '</td><td>' + escapeHtml(String(a.count)) + '</td></tr></tbody></table></div>'
    + '<p class="hint">' + escapeHtml(SESSION_LEDGER_TEXT.approvedNote) + '</p>';
  return head + sessionLedgerExportHTML(w, SESSION_LEDGER_TEXT.exportReportNote) + posts + payroll + consolidated + pending;
}

// UX-1 (UX-OD-07): what the typed amount reads as, display only — the field value is sent exactly as
// typed. An entry that looks like grouped thousands ("150.000", "150,000") is named, never converted.
function sessionLedgerAmountPreview(value){
  const v = typeof value === 'string' ? value : '';
  // G-4 correction (2026-11-17): the transaction validator (transactionIsAmount) decides; the preview
  // never reads back a value it would refuse (zero, more than 15 digits). Was: any whole N.00.
  if(transactionIsAmount(v)) return 'Reads as Rp ' + moneyDisplay(v) + '.';
  if(/^[0-9]+\.[0-9]{2}$/.test(v)) return 'This amount is not accepted. Use a whole Rupiah amount above zero, up to 15 digits, written as 150000.00.';
  if(/[.,][0-9]{3}(?![0-9])/.test(v) || /,/.test(v)) return 'Write the amount without thousands separators, for example 150000.00. Dots and commas are not read as thousands.';
  return '';
}

function sessionLedgerFieldHTML(def, value, invalid, disabled){
  const id = 'sff-' + def.name;
  const hintId = def.hint ? id + '-hint' : '';
  const errorId = invalid ? id + '-error' : '';
  const described = [hintId, errorId].filter(Boolean).join(' ');
  const attrs = ' id="' + id + '" name="' + def.name + '" required aria-required="true"' + (invalid ? ' aria-invalid="true"' : '')
    + (described ? ' aria-describedby="' + described + '"' : '') + (disabled ? ' disabled' : '');
  const option = function(v, label){ return '<option value="' + escapeHtml(v) + '"' + (v === value ? ' selected' : '') + '>' + escapeHtml(label) + '</option>'; };
  let control;
  if(def.type === 'kind') control = '<select class="input"' + attrs + '>' + TRANSACTION_KINDS.map(function(k){ return option(k, SESSION_LEDGER_KIND_LABELS[k]); }).join('') + '</select>';
  else if(def.type === 'post') control = '<select class="input"' + attrs + '>' + option('', 'Choose a Financial Post') + FINANCIAL_POSTS.map(function(p){ return option(p.code, p.name); }).join('') + '</select>';
  else if(def.type === 'textarea') control = '<textarea class="input" rows="3"' + attrs + '>' + escapeHtml(value) + '</textarea>';
  else control = '<input class="input" type="' + def.type + '"' + (def.inputmode ? ' inputmode="' + def.inputmode + '"' : '') + ' autocomplete="off"' + attrs + ' value="' + escapeHtml(value) + '">';
  return '<div class="field"><label for="' + id + '">' + escapeHtml(def.label) + ' <span aria-hidden="true">*</span></label>' + control
    + (def.hint ? '<p class="hint" id="' + hintId + '">' + escapeHtml(def.hint) + '</p>' : '')
    + (invalid ? '<p class="hint auth-message-warn" id="' + errorId + '">' + escapeHtml(def.error) + '</p>' : '')
    + (def.name === 'amount' ? '<p class="hint" id="sff-amount-preview" aria-live="polite">' + escapeHtml(sessionLedgerAmountPreview(value)) + '</p>' : '') + '</div>';
}

function sessionLedgerWriteHTML(w, kind){
  const m = w.mutation;
  if(m.kind !== kind) return '';
  if(m.status === SESSION_LEDGER_MUTATION_STATUS.PENDING) return '<p class="auth-message" id="sfMutationMessage" role="status" aria-busy="true" tabindex="-1">' + (kind === 'create' ? 'Recording…' : 'Voiding…') + '</p>';
  if(m.status === SESSION_LEDGER_MUTATION_STATUS.AMBIGUOUS) return '<p class="auth-message auth-message-warn" id="sfMutationMessage" role="alert" tabindex="-1">' + escapeHtml(SESSION_LEDGER_AMBIGUOUS) + '</p>';
  if(m.status === SESSION_LEDGER_MUTATION_STATUS.ERROR){
    let msg = SESSION_LEDGER_ERRORS[m.error.kind] || SESSION_LEDGER_ERRORS.UNAVAILABLE;
    if(m.error.kind === 'RATE_LIMITED' && typeof authWaitText === 'function') msg += authWaitText(m.error.retryAfter);
    if(m.error.requestId) msg += ' Reference: ' + m.error.requestId + '.';
    return '<p class="auth-message auth-message-warn" id="sfMutationMessage" role="alert" tabindex="-1">' + escapeHtml(msg) + '</p>';
  }
  return '';
}

function sessionLedgerFormHTML(w){
  const busy = w.mutation.status === SESSION_LEDGER_MUTATION_STATUS.PENDING;
  const invalid = w.mutation.kind === 'create' && w.mutation.fields ? w.mutation.fields : [];
  return '<form class="card" id="sfForm" aria-labelledby="sfFormTitle" novalidate><h3 class="section-title" id="sfFormTitle" tabindex="-1">Record transaction</h3>'
    + '<p class="hint">' + escapeHtml(SESSION_LEDGER_TEXT.noEdit) + '</p><div class="form-grid">'
    + SESSION_LEDGER_FORM.map(function(def){ return sessionLedgerFieldHTML(def, w.form.values[def.name], invalid.indexOf(def.name) !== -1, busy); }).join('')
    + '</div>' + sessionLedgerWriteHTML(w, 'create')
    + '<div class="auth-actions"><button class="btn btn-accent" type="submit" id="sfFormSubmit"' + (busy ? ' disabled aria-busy="true"' : '') + '>Record transaction</button>'
    + '<button class="btn" type="button" id="sfFormCancel"' + (busy ? ' disabled' : '') + '>Cancel</button></div></form>';
}

function sessionLedgerVoidHTML(w){
  const v = w.voidTarget;
  const t = v.transaction;
  const busy = w.mutation.status === SESSION_LEDGER_MUTATION_STATUS.PENDING;
  const invalid = w.mutation.kind === 'void' && w.mutation.fields && w.mutation.fields.indexOf('reason') !== -1;
  return '<form class="card" id="sfVoidForm" aria-labelledby="sfVoidTitle" novalidate><h3 class="section-title" id="sfVoidTitle" tabindex="-1">Void transaction</h3>'
    + '<p class="auth-lead">' + escapeHtml(SESSION_LEDGER_KIND_LABELS[t.kind] + ' of Rp ' + t.amount + ' on ' + t.transactionDate + ', ' + transactionPostName(t.financialPost) + ', ' + t.category + ': ' + t.description) + '</p>'
    + '<p class="hint">' + escapeHtml(SESSION_LEDGER_TEXT.voidLead) + '</p>'
    + '<div class="field"><label for="sfVoidReason">Reason <span aria-hidden="true">*</span></label><input class="input" type="text" id="sfVoidReason" name="reason" autocomplete="off" required aria-required="true"'
    + (invalid ? ' aria-invalid="true" aria-describedby="sfVoidReason-error"' : '') + (busy ? ' disabled' : '') + ' value="' + escapeHtml(v.reason) + '">'
    + (invalid ? '<p class="hint auth-message-warn" id="sfVoidReason-error">Enter a reason of 1–200 characters, without leading or trailing spaces.</p>' : '') + '</div>'
    + sessionLedgerWriteHTML(w, 'void')
    + '<div class="auth-actions"><button class="btn btn-danger" type="submit" id="sfVoidSubmit"' + (busy ? ' disabled aria-busy="true"' : '') + '>Void transaction</button>'
    + '<button class="btn" type="button" id="sfVoidCancel"' + (busy ? ' disabled' : '') + '>Cancel</button></div></form>';
}

function sessionLedgerTransactionsHTML(w){
  const busy = w.mutation.status === SESSION_LEDGER_MUTATION_STATUS.PENDING;
  const dis = busy || w.form || w.voidTarget ? ' disabled' : '';
  const head = '<h2 class="section-title" id="sfViewTitle" tabindex="-1">Transactions, ' + escapeHtml(sessionLedgerRangeLabel(w.range)) + '</h2>'
    + (w.form ? sessionLedgerFormHTML(w) : (w.voidTarget ? sessionLedgerVoidHTML(w)
      : '<div class="auth-actions"><button class="btn btn-accent" type="button" id="sfAddBtn"' + dis + '>Record transaction</button></div>'));
  if(w.listStatus === SESSION_LEDGER_STATUS.ERROR && w.error && w.error.scope === 'list') return head + sessionLedgerErrorHTML(w.error, 'sfReadError');
  if(w.listStatus !== SESSION_LEDGER_STATUS.READY || !w.list) return head + '<p class="auth-lead" role="status" aria-busy="true">' + escapeHtml(SESSION_LEDGER_TEXT.loadingList) + '</p>';
  if(!w.list.length) return head + '<div class="empty" role="status">No transactions dated ' + escapeHtml(sessionLedgerRangeLabel(w.range)) + '.</div>' + sessionLedgerExportHTML(w, null);
  const body = w.list.map(function(t, i){
    const voided = t.status === 'Voided';
    return '<tr><td>' + escapeHtml(t.transactionDate) + '</td><td>' + escapeHtml(SESSION_LEDGER_KIND_LABELS[t.kind]) + '</td><td>' + escapeHtml(transactionPostName(t.financialPost)) + '</td>'
      + '<td>' + escapeHtml(t.category) + '</td><td>' + escapeHtml(t.description) + '</td><td>' + moneyHTML(t.amount) + '</td>'
      + '<td>' + (voided ? statusBadgeHTML('Voided', 'stop') + ' ' + escapeHtml(t.void.reason) : statusBadgeHTML('Active', 'done')) + '</td>'
      + '<td>' + (voided ? '' : '<button class="btn" type="button" data-sf-void="' + i + '"' + dis + '>Void</button>') + '</td></tr>';
  }).join('');
  return head + '<p class="hint">' + w.list.length + (w.list.length === 1 ? ' transaction' : ' transactions') + ', oldest first.</p>' + sessionLedgerExportHTML(w, null)
    + '<div class="table-wrap" id="sfList"><table><thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Financial Post</th><th scope="col">Category</th>'
    + '<th scope="col">Description</th><th scope="col">Amount (Rp)</th><th scope="col">Status</th><th scope="col" aria-label="Void"></th></tr></thead><tbody>' + body + '</tbody></table></div>';
}

// The section title (the workspace heading) and body.
// UI-INT-1: the v2.11.0 page title for the dashboard (was 'Finance').
function renderSessionLedgerTitle(w){ return w.view === 'transactions' ? 'Transactions' : 'Finance Overview'; }
function renderSessionLedgerHTML(w){
  const dis = w.mutation.status === SESSION_LEDGER_MUTATION_STATUS.PENDING || w.form || w.voidTarget ? ' disabled' : '';
  const notice = w.notice === 'created' || w.notice === 'voided' || w.notice === 'exported'
    ? '<p class="auth-message" id="sfMessage" role="status" tabindex="-1">' + escapeHtml(SESSION_LEDGER_TEXT[w.notice]) + '</p>'
    : (w.notice === 'exportUnavailable' ? '<p class="auth-message auth-message-warn" id="sfMessage" role="alert" tabindex="-1">' + escapeHtml(SESSION_LEDGER_TEXT.exportUnavailable) + '</p>' : '');
  return '<p class="hint">' + escapeHtml(SESSION_LEDGER_TEXT.lead) + '</p>' + sessionLedgerRangeHTML(w, dis) + notice
    + (w.view === 'transactions' ? sessionLedgerTransactionsHTML(w) : sessionLedgerDashboardHTML(w));
}

function bindSessionLedger(app){
  const on = function(id, type, fn){ const el = app.querySelector('#' + id); if(el) el.addEventListener(type, fn); };
  on('sfFrom', 'input', function(){ SessionLedger.setRangeDraft('from', this.value); });
  on('sfTo', 'input', function(){ SessionLedger.setRangeDraft('to', this.value); });
  on('sfRangeForm', 'submit', function(e){
    e.preventDefault();
    const from = app.querySelector('#sfFrom'), to = app.querySelector('#sfTo');
    if(from) SessionLedger.setRangeDraft('from', from.value);
    if(to) SessionLedger.setRangeDraft('to', to.value);
    SessionLedger.applyRange();
  });
  on('sfRetryBtn', 'click', function(){ SessionLedger.retry(); });
  on('sfExportBtn', 'click', function(){ SessionLedger.exportCsv(); });
  on('sfAddBtn', 'click', function(){ SessionLedger.openCreate(); });
  on('sfFormCancel', 'click', function(){ SessionLedger.cancelCreate(); });
  on('sfVoidCancel', 'click', function(){ SessionLedger.cancelVoid(); });
  const form = app.querySelector('#sfForm');
  if(form){
    const keep = function(){ SessionLedger.setDraft(this.name, this.value); };
    SESSION_LEDGER_FORM.forEach(function(def){
      const el = form.querySelector('#sff-' + def.name);
      if(el){ el.addEventListener('input', keep); el.addEventListener('change', keep); }
    });
    const amount = form.querySelector('#sff-amount'), preview = form.querySelector('#sff-amount-preview');
    if(amount && preview) amount.addEventListener('input', function(){ preview.textContent = sessionLedgerAmountPreview(this.value); });
    form.addEventListener('submit', function(e){
      e.preventDefault();
      SESSION_LEDGER_FORM.forEach(function(def){ const el = form.querySelector('#sff-' + def.name); if(el) SessionLedger.setDraft(def.name, el.value); });
      SessionLedger.submitCreate();
    });
  }
  const voidForm = app.querySelector('#sfVoidForm');
  if(voidForm){
    const reason = voidForm.querySelector('#sfVoidReason');
    if(reason) reason.addEventListener('input', function(){ SessionLedger.setVoidReason(this.value); });
    voidForm.addEventListener('submit', function(e){
      e.preventDefault();
      if(reason) SessionLedger.setVoidReason(reason.value);
      SessionLedger.submitVoid();
    });
  }
  // One listener for every row: the button's position in the list that was rendered.
  on('sfList', 'click', function(ev){
    const button = ev && ev.target && typeof ev.target.closest === 'function' ? ev.target.closest('[data-sf-void]') : null;
    if(button) SessionLedger.openVoid(Number(button.getAttribute('data-sf-void')));
  });
}

// After a render: the element the section asked for, else null (the workspace decides).
function sessionLedgerFocusTarget(app, hint){
  if(hint === 'section') return app.querySelector('#authTitle');
  if(hint === 'view') return app.querySelector('#sfViewTitle');
  if(hint === 'form') return app.querySelector('#sff-kind');
  if(hint === 'void') return app.querySelector('#sfVoidReason');
  if(hint === 'message') return app.querySelector('#sfMutationMessage') || app.querySelector('#sfMessage') || app.querySelector('#sfReadError');
  return null;
}
