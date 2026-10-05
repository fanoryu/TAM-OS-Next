/* ============================================================
   SESSION PAYROLL VIEW (AFI-4c1, AFI-4c2) — js/ui/session-payroll-view.js
   ------------------------------------------------------------
   The Payroll section of the authenticated SESSION workspace — CEO only — rendered by
   sessionWorkspaceHTML() (js/ui/session-workspace-view.js), its only caller, when the section
   is shown. It is NOT the LOCAL Payroll Workspace (js/people/payroll-workspace.js) and never
   reaches it, the business shell, its navigation, Global Search or "Acting as":
   AuthBoot.allowsWorkspace() stays false.

     the month bar (Previous, the month, Next); "Prepare payroll for <month>" (generate, after an
     inline confirmation); the employees the last preparation left out, named from the CEO
     Employee list (D-AFI4c1-4 = A); the month's plans in the server's order — employee code,
     name, status, base salary, overtime, total — Cancelled and Committed plans included; a
     plan's detail with its contributing overtime; and the actions the matrix offers for the plan
     shown: Review / Approve / Cancel on a Draft, Approve / Return to draft / Cancel on a Reviewed
     plan, Return to draft / Cancel on a Ready plan, nothing on a Committed or Cancelled one.

   STATUS WORDS (D-AFI4c1-3 = A): the server's own vocabulary — Draft, Reviewed, Ready, Committed,
   Cancelled. The Approve action makes a plan Ready, which is shown as "Ready — approved, not
   paid": an approved payroll plan, never a payment. Committed is shown as the status only
   (D-AFI4c1-1 = A) — no Commit control and no other meaning here.

   MONEY: every amount is exactly the string the server sent, escaped, with "(Rp)" in its label —
   never computed, summed, rounded, converted or reformatted here, and never totalled across the
   month. Data comes only from SessionPayroll / SessionPayrollStore (js/core/session-payroll.js);
   nothing is written here but the DOM. Every message is a fixed string; every server value is
   escaped. The opaque plan ids never appear in the page: a row is opened by its position in the
   list that was rendered. The contributing overtime of a plan shows its record id, hours and
   frozen amount, for traceability.

   AFI-4c2 (owner decisions D-AFI4c2-1..3 = A): on a Ready plan the CEO also gets "Commit payroll"
   — an inline confirmation showing the plan's own server strings (employee, month, base salary,
   overtime hours and amount, total, version) and saying that Commit makes it the final payroll
   obligation, that it can no longer be returned or cancelled, and that it is NOT a payment and
   posts nothing to Finance. Committed reads "Committed — final, not paid" (CEO and Employee). An
   unconfirmed commit whose re-read still shows the plan Ready at the same version and total
   offers "Retry commit" (the same intent again). A Ready plan shows what changed since it was
   prepared (the drift read) — explanation only, never a reason to offer or refuse Commit. A
   Commit 409 never claims its cause. An Employee's section is "My payroll": their own Committed
   plans by month and a payslip-like card of the server's fields only — no control, no other
   payroll concept.

   Classic shared global scope; existing CSS classes only.
   ============================================================ */

const SESSION_PAYROLL_STATUS_TEXT = Object.freeze({
  Draft: 'Draft', Reviewed: 'Reviewed', Ready: 'Ready — approved, not paid', Committed: 'Committed — final, not paid', Cancelled: 'Cancelled'
});
const SESSION_PAYROLL_EXCLUSION_TEXT = Object.freeze({
  archived: 'Archived employee',
  not_active: 'Employment status is not Active',
  salary_missing: 'No monthly base salary on the employee record'
});
const SESSION_PAYROLL_ERRORS = Object.freeze({
  DENIED: 'You do not have access to this information.',
  NOT_FOUND: 'This payroll plan was not found.',
  CONFLICT: 'TAM OS reported a conflict. Try again.',
  RATE_LIMITED: 'Too many requests.',
  VALIDATION: 'TAM OS could not process this request.',
  CLIENT_FAULT: 'TAM OS could not process this request.',
  SERVER_ERROR: 'Payroll information could not be loaded. Try again in a moment.',
  UNAVAILABLE: 'Payroll information could not be loaded. Check your connection, then try again.',
  INVALID_RESPONSE: 'TAM OS sent an unexpected response. Try again in a moment.'
});
const SESSION_PAYROLL_MUTATION_ERRORS = Object.freeze({
  VALIDATION: 'TAM OS could not accept this request.',
  DENIED: 'You do not have permission to make this change.',
  NOT_FOUND: 'This payroll plan is no longer available. The list was read again.',
  RATE_LIMITED: 'Too many requests.',
  SERVER_ERROR: 'The change was not made. Try again in a moment.',
  CLIENT_FAULT: 'TAM OS could not process this request.',
  CRYPTO_UNAVAILABLE: 'This browser cannot create a secure commit key. Nothing was sent.'
});
// The backend reports one generic conflict: the wording never claims which cause it was.
const SESSION_PAYROLL_CONFLICTS = Object.freeze({
  generate: 'TAM OS could not prepare payroll for this month (a conflict was reported). The plans below were read again from TAM OS.',
  transition: 'This plan changed or the action is no longer available. It was read again from TAM OS — check it, then choose again.',
  commit: 'TAM OS did not commit this plan: it changed, its total no longer matches, or its inputs changed. It was read again — check it and any changes listed below.'
});
const SESSION_PAYROLL_NOTICES = Object.freeze({
  generated: 'Payroll prepared for this month. The plans below were read again from TAM OS.',
  reviewed: 'Payroll plan marked as reviewed.',
  approved: 'Payroll plan approved: it is now Ready — approved, not paid.',
  returned: 'Payroll plan returned to Draft.',
  cancelled: 'Payroll plan cancelled.',
  commitStale: 'TAM OS could not confirm the commit, and the plan read again has changed. Check it before choosing again.'
});
// AFI-4c2: notices that name the plan's month.
const SESSION_PAYROLL_MONTH_NOTICES = Object.freeze({
  committed: ['Payroll plan committed: it is the final payroll obligation for ', ' — not paid.'],
  commitConfirmed: ['TAM OS could not confirm the commit at first, but the plan read again is committed: it is the final payroll obligation for ', ' — not paid.']
});
const SESSION_PAYROLL_TARGETS = Object.freeze({ review: 'Reviewed', approve: 'Ready', return: 'Draft', cancel: 'Cancelled', commit: 'Committed' });
// AFI-4c2: the BF-4c2 drift reasons, in their canonical order — what changed, never a value.
const SESSION_PAYROLL_DRIFT_TEXT = Object.freeze({
  employee_archived: 'The employee is now archived.',
  employee_not_active: "The employee's employment status is no longer Active.",
  salary_missing: 'The employee no longer has a monthly base salary.',
  salary_changed: "The employee's monthly base salary changed after this plan was prepared.",
  overtime_changed: "The employee's approved overtime for this month changed after this plan was prepared."
});
const SESSION_PAYROLL_PANELS = Object.freeze({
  generate: { title: 'Prepare payroll for this month?',
    text: 'TAM OS creates a Draft plan for each eligible employee and recalculates existing Drafts from the current salaries and approved overtime. Reviewed and Ready plans are not changed. Nothing is paid and nothing is posted to Finance.',
    submit: 'Prepare payroll', busy: 'Preparing…', danger: false },
  review: { title: 'Mark this plan as reviewed?', text: 'A reviewed plan can still be approved, returned to Draft or cancelled.', submit: 'Mark reviewed', busy: 'Working…', danger: false },
  approve: { title: 'Approve this payroll plan?', text: 'The plan becomes Ready — approved, not paid. It can still be returned to Draft or cancelled.', submit: 'Approve', busy: 'Approving…', danger: false },
  return: { title: 'Return this plan to Draft?', text: 'A Draft is recalculated the next time payroll is prepared for this month.', submit: 'Return to draft', busy: 'Working…', danger: false },
  cancel: { title: 'Cancel this payroll plan?', text: 'A cancelled plan is final and no longer counts the overtime it included. Preparing payroll again creates a new Draft for an eligible employee.', submit: 'Cancel plan', busy: 'Cancelling…', danger: true },
  commit: { title: 'Commit this payroll plan?',
    text: 'It can no longer be changed, returned or cancelled. It is not a payment — nothing is paid and nothing is posted to Finance.',
    submit: 'Commit payroll', busy: 'Committing…', danger: true }
});
const SESSION_PAYROLL_ACTION_BUTTONS = Object.freeze({
  review: { id: 'swpReviewBtn', label: 'Review', cls: 'btn' },
  approve: { id: 'swpApproveBtn', label: 'Approve', cls: 'btn btn-accent' },
  return: { id: 'swpReturnBtn', label: 'Return to draft', cls: 'btn' },
  cancel: { id: 'swpCancelBtn', label: 'Cancel plan', cls: 'btn btn-danger' },
  commit: { id: 'swpCommitBtn', label: 'Commit payroll', cls: 'btn btn-accent' }
});

function sessionPayrollValue(v){
  return (v === null || v === undefined || v === '') ? '—' : escapeHtml(String(v));
}
function sessionPayrollStatusText(status){
  return Object.prototype.hasOwnProperty.call(SESSION_PAYROLL_STATUS_TEXT, status) ? SESSION_PAYROLL_STATUS_TEXT[status] : '—';
}
function sessionPayrollMonthLabel(key){
  return OvertimeCalendar.isMonth(key) ? SESSION_OVERTIME_MONTH_NAMES[+key.slice(5, 7) - 1] + ' ' + key.slice(0, 4) : '—';
}
function sessionPayrollBusy(w){ return w.mutation.status === SESSION_PAYROLL_MUTATION_STATUS.PENDING; }

// The failure message, with the wait for a 429 and the server reference when known.
function sessionPayrollErrorHTML(error){
  let msg = SESSION_PAYROLL_ERRORS[error.kind] || SESSION_PAYROLL_ERRORS.UNAVAILABLE;
  if(error.kind === 'RATE_LIMITED' && typeof authWaitText === 'function') msg += authWaitText(error.retryAfter);
  if(error.requestId) msg += ' Reference: ' + error.requestId + '.';
  return '<p class="auth-message auth-message-warn" role="alert">' + escapeHtml(msg) + '</p>';
}

// An unconfirmed write, reported by what the read that followed it shows (never as a success).
function sessionPayrollAmbiguousText(w){
  const m = w.mutation;
  // AFI-4c2: the commit still unresolved after its re-read (D-AFI4c2-1 = A).
  if(m.kind === 'commit' && w.detailStatus === SESSION_PAYROLL_STATUS.READY && w.detail && sessionPayrollIntentState(w.commitIntent, w.detail.plan) === 'unresolved'){
    return 'TAM OS could not confirm the commit. The plan read again is still Ready with the same total. Retry commit sends the same commit again — it can never commit the plan twice.';
  }
  if(m.kind === 'commit' && w.detailStatus === SESSION_PAYROLL_STATUS.ERROR) return 'TAM OS could not confirm the commit, and the plan could not be read again. Nothing is sent again — use Retry to read the plan.';
  if(m.kind === 'generate') return 'TAM OS could not confirm whether payroll was prepared. The plans below were read again from TAM OS — check them before preparing payroll again.';
  if(w.detailStatus === SESSION_PAYROLL_STATUS.LOADING || w.detailStatus === SESSION_PAYROLL_STATUS.IDLE) return 'TAM OS could not confirm the change. The plan is being read again…';
  const p = w.detailStatus === SESSION_PAYROLL_STATUS.READY && w.detail ? w.detail.plan : null;
  if(p && p.status === SESSION_PAYROLL_TARGETS[m.kind]) return 'TAM OS could not confirm the change, but the plan read again is now ' + p.status + '.';
  if(p) return 'TAM OS could not confirm the change. The plan read again is ' + p.status + ', not ' + SESSION_PAYROLL_TARGETS[m.kind] + ' — check it before trying again.';
  return 'TAM OS could not confirm the change, and the plan could not be read again. Use Retry to read it.';
}

// The one message about the write (or a notice), shown where that write is.
function sessionPayrollMutationHTML(w){
  const m = w.mutation;
  let text = null, warn = true;
  if(m.status === SESSION_PAYROLL_MUTATION_STATUS.AMBIGUOUS) text = sessionPayrollAmbiguousText(w);
  else if(m.status === SESSION_PAYROLL_MUTATION_STATUS.ERROR && m.error){
    const k = m.error.kind;
    if(k === 'CONFLICT') text = m.kind === 'generate' ? SESSION_PAYROLL_CONFLICTS.generate : m.kind === 'commit' ? SESSION_PAYROLL_CONFLICTS.commit : SESSION_PAYROLL_CONFLICTS.transition;
    else text = SESSION_PAYROLL_MUTATION_ERRORS[k] || SESSION_PAYROLL_MUTATION_ERRORS.CLIENT_FAULT;
    if(k === 'RATE_LIMITED' && typeof authWaitText === 'function') text += authWaitText(m.error.retryAfter);
  } else if(m.status === SESSION_PAYROLL_MUTATION_STATUS.IDLE && w.notice && SESSION_PAYROLL_NOTICES[w.notice]){
    text = SESSION_PAYROLL_NOTICES[w.notice]; warn = w.notice === 'commitStale';
  } else if(m.status === SESSION_PAYROLL_MUTATION_STATUS.IDLE && w.notice && SESSION_PAYROLL_MONTH_NOTICES[w.notice] && w.detail){
    const n = SESSION_PAYROLL_MONTH_NOTICES[w.notice];
    text = n[0] + sessionPayrollMonthLabel(w.detail.plan.monthKey) + n[1]; warn = false;
  }
  if(!text) return '';
  if(warn && m.error && m.error.requestId) text += ' Reference: ' + m.error.requestId + '.';
  return '<p class="auth-message' + (warn ? ' auth-message-warn' : '') + '" id="swpMutationMessage" role="' + (warn ? 'alert' : 'status') + '" tabindex="-1">' + escapeHtml(text) + '</p>';
}

// The open confirmation: what it acts on, its explanation, Cancel and the action.
function sessionPayrollPanelHTML(w){
  const panel = SESSION_PAYROLL_PANELS[w.panel.kind];
  const busy = sessionPayrollBusy(w);
  const dis = busy ? ' disabled' : '';
  let what;
  if(w.panel.kind === 'generate') what = 'Month: ' + sessionPayrollMonthLabel(w.month) + '.';
  else if(w.panel.kind === 'commit'){
    // AFI-4c2: exactly the plan's server strings — the total shown is the total sent.
    const p = w.detail.plan;
    what = ['Committing makes this plan the final payroll obligation for ', sessionPayrollMonthLabel(p.monthKey), ': ', p.employeeName, ' (', p.employeeCode, ')',
      ', base salary (Rp) ', p.baseSalary, ', overtime ', p.overtimeHours, ' hours (Rp) ', p.overtimeAmount, ', total (Rp) ', p.totalAmount, ', version ', String(p.version), '.'].join('');
  } else {
    const p = w.detail.plan;
    what = p.employeeName + ' (' + p.employeeCode + ') — ' + sessionPayrollMonthLabel(p.monthKey) + ' — ' + sessionPayrollStatusText(p.status) + '.';
  }
  return '<section class="card" aria-labelledby="swpPanelTitle"' + (busy ? ' aria-busy="true"' : '') + '>'
    + '<h2 class="section-title" id="swpPanelTitle" tabindex="-1">' + escapeHtml(panel.title) + '</h2>'
    + '<p class="auth-lead">' + escapeHtml(what) + ' ' + escapeHtml(panel.text) + '</p>'
    + sessionPayrollMutationHTML(w)
    + '<div class="auth-actions"><button class="btn" type="button" id="swpPanelCancel"' + dis + '>Back</button>'
    + '<button class="btn ' + (panel.danger ? 'btn-danger' : 'btn-accent') + '" type="button" id="swpPanelConfirm"' + dis + (busy ? ' aria-busy="true"' : '') + '>'
    + escapeHtml(busy ? panel.busy : panel.submit) + '</button></div></section>';
}

function sessionPayrollMonthBarHTML(w, dis){
  return '<div class="auth-actions" role="group" aria-label="Month">'
    + '<button class="btn" type="button" id="swpPrevMonth"' + dis + '>Previous month</button>'
    + '<label for="swpMonth">Month</label><input class="input" type="month" id="swpMonth" name="month" autocomplete="off"' + dis + ' value="' + escapeHtml(w.month || '') + '">'
    + '<button class="btn" type="button" id="swpNextMonth"' + dis + '>Next month</button></div>';
}

// The employees the last confirmed preparation of this month left out, with the reason.
function sessionPayrollExcludedHTML(w, dis){
  if(!w.excluded || !w.excluded.length || w.excludedMonth !== w.month) return '';
  const names = w.excluded.map(function(e){
    const name = sessionPayrollExcludedName(w.labelsStatus, w.people, e.employeeId);
    return '<li>' + escapeHtml(name === null ? 'Loading name…' : name) + ' — ' + escapeHtml(SESSION_PAYROLL_EXCLUSION_TEXT[e.reason]) + '</li>';
  }).join('');
  const retry = w.labelsStatus === SESSION_PAYROLL_STATUS.ERROR
    ? '<p class="hint">Employee names could not be loaded; employees are shown by their record id.</p>'
      + '<div class="auth-actions"><button class="btn" type="button" id="swpLabelsRetryBtn"' + dis + '>Retry employee names</button></div>' : '';
  return '<section class="card" id="swpExcluded" aria-labelledby="swpExcludedTitle"><h2 class="section-title" id="swpExcludedTitle">Not included (' + w.excluded.length + ')</h2>'
    + '<ul>' + names + '</ul>' + retry + '</section>';
}

// AFI-4c2: an Employee's own Committed plans of the month — no preparation, no exclusions.
function sessionPayrollMineListHTML(w){
  const dis = sessionPayrollBusy(w) ? ' disabled' : '';
  const head = sessionPayrollMonthBarHTML(w, dis) + '<h2 class="section-title">' + escapeHtml(sessionPayrollMonthLabel(w.month)) + '</h2>';
  if(w.listStatus === SESSION_PAYROLL_STATUS.ERROR && w.error && w.error.scope === 'list'){
    const retry = w.error.kind === 'DENIED' ? '' : '<div class="auth-actions"><button class="btn btn-accent" type="button" id="swpRetryBtn"' + dis + '>Retry</button></div>';
    return head + sessionPayrollErrorHTML(w.error) + retry;
  }
  if(w.listStatus !== SESSION_PAYROLL_STATUS.READY || !w.list || w.listMonth !== w.month) return head + '<p class="auth-lead" role="status" aria-busy="true">Loading your payroll…</p>';
  if(!w.list.length) return head + '<div class="empty">No committed payroll for ' + escapeHtml(sessionPayrollMonthLabel(w.month)) + '.</div>';
  const rows = w.list.map(function(p, i){
    return '<tr><td>' + escapeHtml(sessionPayrollMonthLabel(p.monthKey)) + '</td><td>' + escapeHtml(sessionPayrollStatusText(p.status)) + '</td>'
      + '<td>' + escapeHtml(p.baseSalary) + '</td><td>' + escapeHtml(p.overtimeAmount) + '</td><td>' + escapeHtml(p.totalAmount) + '</td>'
      + '<td><button class="btn" type="button" id="swpOpen' + i + '"' + dis + '>View</button></td></tr>';
  }).join('');
  return head + '<div class="table-wrap"><table><thead><tr><th scope="col">Month</th><th scope="col">Status</th>'
    + '<th scope="col">Base salary (Rp)</th><th scope="col">Overtime (Rp)</th><th scope="col">Total (Rp)</th><th scope="col" aria-label="Open payroll"></th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table></div>';
}

// AFI-4c2: the payslip-like card of one own Committed plan — the server's fields only.
function sessionPayrollMineDetailHTML(w){
  const back = '<div class="auth-actions"><button class="btn" type="button" id="swpBackBtn">Back to my payroll</button>';
  if(w.detailStatus === SESSION_PAYROLL_STATUS.ERROR && w.error && w.error.scope === 'detail'){
    const retry = (w.error.kind === 'DENIED' || w.error.kind === 'NOT_FOUND') ? '' : '<button class="btn btn-accent" type="button" id="swpRetryBtn">Retry</button>';
    return sessionPayrollErrorHTML(w.error) + back + retry + '</div>';
  }
  if(w.detailStatus !== SESSION_PAYROLL_STATUS.READY || !w.detail) return '<p class="auth-lead" role="status" aria-busy="true">Loading your payroll…</p>' + back + '</div>';
  const p = w.detail.plan;
  const rows = [
    ['Employee', p.employeeName], ['Code', p.employeeCode], ['Department', p.department], ['Month', sessionPayrollMonthLabel(p.monthKey)],
    ['Status', sessionPayrollStatusText(p.status)], ['Base salary (Rp)', p.baseSalary], ['Overtime hours', p.overtimeHours],
    ['Overtime (Rp)', p.overtimeAmount], ['Total (Rp)', p.totalAmount]
  ];
  const ot = w.detail.overtime.length
    ? '<div class="table-wrap"><table><thead><tr><th scope="col">Record</th><th scope="col">Hours</th><th scope="col">Amount (Rp)</th></tr></thead><tbody>'
      + w.detail.overtime.map(function(r){ return '<tr><td>' + escapeHtml(r.id) + '</td><td>' + escapeHtml(r.hours) + '</td><td>' + escapeHtml(r.amount) + '</td></tr>'; }).join('')
      + '</tbody></table></div>'
    : '<p class="hint">No approved overtime is counted in this payroll.</p>';
  return '<section class="card" id="swpPayslip" aria-labelledby="swpPayslipTitle"><h2 class="section-title" id="swpPayslipTitle">Payroll — ' + escapeHtml(sessionPayrollMonthLabel(p.monthKey)) + '</h2>'
    + '<div class="table-wrap"><table><tbody>' + rows.map(function(r){ return '<tr><th scope="row">' + escapeHtml(r[0]) + '</th><td>' + sessionPayrollValue(r[1]) + '</td></tr>'; }).join('') + '</tbody></table></div>'
    + '<h3 class="section-title">Approved overtime counted</h3>' + ot + '</section>'
    + back + '</div>';
}

// AFI-4c2: what changed since a Ready plan was prepared (the drift read) — explanation only.
function sessionPayrollDriftHTML(w){
  const p = w.detail.plan;
  if(p.status !== 'Ready' || w.driftId !== p.id) return '';
  if(w.driftStatus === SESSION_PAYROLL_STATUS.LOADING) return '<p class="hint" role="status" aria-busy="true">Checking this plan against TAM OS…</p>';
  if(w.driftStatus === SESSION_PAYROLL_STATUS.ERROR) return '<p class="hint">TAM OS could not check this plan for changes.</p>';
  if(w.driftStatus !== SESSION_PAYROLL_STATUS.READY || !w.drift || w.drift.current) return '';
  return '<section class="card" id="swpDrift" aria-labelledby="swpDriftTitle"><h2 class="section-title" id="swpDriftTitle">Changed since this plan was prepared</h2>'
    + '<ul>' + w.drift.reasons.map(function(r){ return '<li>' + escapeHtml(SESSION_PAYROLL_DRIFT_TEXT[r]) + '</li>'; }).join('') + '</ul>'
    + '<p class="auth-lead">' + escapeHtml('This plan no longer matches TAM OS. Return it to Draft, then prepare payroll for ' + sessionPayrollMonthLabel(p.monthKey) + ' again.') + '</p></section>';
}

function sessionPayrollListHTML(w){
  const busy = sessionPayrollBusy(w);
  const dis = busy ? ' disabled' : '';
  const generating = w.panel && w.panel.kind === 'generate';
  const head = (generating ? sessionPayrollPanelHTML(w)
      : '<div class="auth-actions"><button class="btn btn-accent" type="button" id="swpGenerateBtn"' + dis + '>Prepare payroll for ' + escapeHtml(sessionPayrollMonthLabel(w.month)) + '</button></div>'
        + sessionPayrollMutationHTML(w))
    + (generating ? '' : sessionPayrollMonthBarHTML(w, dis))
    + sessionPayrollExcludedHTML(w, dis)
    + '<h2 class="section-title">' + escapeHtml(sessionPayrollMonthLabel(w.month)) + '</h2>';
  if(w.listStatus === SESSION_PAYROLL_STATUS.ERROR && w.error && w.error.scope === 'list'){
    const retry = w.error.kind === 'DENIED' ? '' : '<div class="auth-actions"><button class="btn btn-accent" type="button" id="swpRetryBtn"' + dis + '>Retry</button></div>';
    return head + sessionPayrollErrorHTML(w.error) + retry;
  }
  if(w.listStatus !== SESSION_PAYROLL_STATUS.READY || !w.list || w.listMonth !== w.month) return head + '<p class="auth-lead" role="status" aria-busy="true">Loading payroll plans…</p>';
  if(!w.list.length) return head + '<div class="empty">No payroll plans for ' + escapeHtml(sessionPayrollMonthLabel(w.month)) + '. Prepare payroll for this month to create them.</div>';
  const rows = w.list.map(function(p, i){
    return '<tr><td>' + escapeHtml(p.employeeCode) + '</td><td>' + escapeHtml(p.employeeName) + '</td><td>' + escapeHtml(sessionPayrollStatusText(p.status)) + '</td>'
      + '<td>' + escapeHtml(p.baseSalary) + '</td><td>' + escapeHtml(p.overtimeAmount) + '</td><td>' + escapeHtml(p.totalAmount) + '</td>'
      + '<td><button class="btn" type="button" id="swpOpen' + i + '"' + dis + '>View</button></td></tr>';
  }).join('');
  return head + '<div class="table-wrap"><table><thead><tr><th scope="col">Code</th><th scope="col">Employee</th><th scope="col">Status</th>'
    + '<th scope="col">Base salary (Rp)</th><th scope="col">Overtime (Rp)</th><th scope="col">Total (Rp)</th><th scope="col" aria-label="Open plan"></th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table></div>';
}

function sessionPayrollDetailHTML(principal, w){
  const busy = sessionPayrollBusy(w);
  const dis = busy ? ' disabled' : '';
  const back = '<div class="auth-actions"><button class="btn" type="button" id="swpBackBtn"' + dis + '>Back to list</button>';
  if(w.detailStatus === SESSION_PAYROLL_STATUS.ERROR && w.error && w.error.scope === 'detail'){
    const retry = (w.error.kind === 'DENIED' || w.error.kind === 'NOT_FOUND') ? '' : '<button class="btn btn-accent" type="button" id="swpRetryBtn"' + dis + '>Retry</button>';
    return sessionPayrollMutationHTML(w) + sessionPayrollErrorHTML(w.error) + back + retry + '</div>';
  }
  if(w.detailStatus !== SESSION_PAYROLL_STATUS.READY || !w.detail) return sessionPayrollMutationHTML(w) + '<p class="auth-lead" role="status" aria-busy="true">Loading the payroll plan…</p>' + back + '</div>';
  const p = w.detail.plan;
  // Only the actions the matrix offers for this plan; the confirmation replaces them. AFI-4c2: an
  // open commit intent replaces Commit payroll — by Retry commit while it is unresolved.
  const intentState = sessionPayrollIntentState(w.commitIntent, p);
  const actions = w.panel ? '' : sessionPayrollActions(principal, p).filter(function(k){ return !(k === 'commit' && w.commitIntent); }).map(function(k){
    const b = SESSION_PAYROLL_ACTION_BUTTONS[k];
    return '<button class="' + b.cls + '" type="button" id="' + b.id + '"' + dis + '>' + escapeHtml(b.label) + '</button>';
  }).join('') + (!w.panel && intentState === 'unresolved' ? '<button class="btn btn-accent" type="button" id="swpRetryCommitBtn"' + dis + '>Retry commit</button>' : '');
  const conflict = w.mutation.status === SESSION_PAYROLL_MUTATION_STATUS.ERROR && w.mutation.error && w.mutation.error.kind === 'CONFLICT';
  const reload = (conflict || w.mutation.status === SESSION_PAYROLL_MUTATION_STATUS.AMBIGUOUS) && !w.panel ? '<button class="btn" type="button" id="swpReloadBtn"' + dis + '>Reload plan</button>' : '';
  const rows = [
    ['Employee code', p.employeeCode], ['Employee', p.employeeName], ['Department', p.department], ['Month', sessionPayrollMonthLabel(p.monthKey)],
    ['Status', sessionPayrollStatusText(p.status)], ['Base salary (Rp)', p.baseSalary], ['Overtime (Rp)', p.overtimeAmount],
    ['Overtime hours', p.overtimeHours], ['Overtime records', String(p.overtimeCount)], ['Total (Rp)', p.totalAmount], ['Version', String(p.version)]
  ];
  const ot = w.detail.overtime.length
    ? '<div class="table-wrap"><table><thead><tr><th scope="col">Overtime record</th><th scope="col">Hours</th><th scope="col">Approved amount (Rp)</th></tr></thead><tbody>'
      + w.detail.overtime.map(function(r){ return '<tr><td>' + escapeHtml(r.id) + '</td><td>' + escapeHtml(r.hours) + '</td><td>' + escapeHtml(r.amount) + '</td></tr>'; }).join('')
      + '</tbody></table></div>'
    : '<p class="hint">No approved overtime is counted in this plan.</p>';
  return '<h2 class="section-title">' + escapeHtml(p.employeeName) + ' — ' + escapeHtml(sessionPayrollMonthLabel(p.monthKey)) + '</h2>'
    + (w.panel ? '' : sessionPayrollMutationHTML(w))
    + '<div class="table-wrap"><table><tbody>' + rows.map(function(r){ return '<tr><th scope="row">' + escapeHtml(r[0]) + '</th><td>' + sessionPayrollValue(r[1]) + '</td></tr>'; }).join('') + '</tbody></table></div>'
    + '<section class="card" aria-labelledby="swpOvertimeTitle"><h2 class="section-title" id="swpOvertimeTitle">Approved overtime counted</h2>' + ot + '</section>'
    + sessionPayrollDriftHTML(w)
    + back + reload + actions + '</div>'
    + (w.panel && w.panel.id === p.id ? sessionPayrollPanelHTML(w) : '');
}

// The section title (the workspace heading) and body. AFI-4c2: an Employee's is My payroll.
function renderSessionPayrollTitle(w, principal){
  if(sessionPayrollIsEmployee(principal)) return 'My payroll';
  return w.detailId ? 'Payroll plan' : 'Payroll';
}
function renderSessionPayrollHTML(principal, w){
  if(sessionPayrollIsEmployee(principal)) return w.detailId ? sessionPayrollMineDetailHTML(w) : sessionPayrollMineListHTML(w);
  return w.detailId ? sessionPayrollDetailHTML(principal, w) : sessionPayrollListHTML(w);
}

function bindSessionPayroll(app){
  const on = function(id, type, fn){ const el = app.querySelector('#' + id); if(el) el.addEventListener(type, fn); };
  const click = function(id, fn){ on(id, 'click', fn); };
  click('swpGenerateBtn', function(){ SessionPayroll.openPanel('generate'); });
  click('swpPrevMonth', function(){ SessionPayroll.shiftMonth(-1); });
  click('swpNextMonth', function(){ SessionPayroll.shiftMonth(1); });
  on('swpMonth', 'change', function(){ SessionPayroll.setMonth(this.value); });
  click('swpBackBtn', function(){ SessionPayroll.back(); });
  click('swpRetryBtn', function(){ SessionPayroll.retry(); });
  click('swpLabelsRetryBtn', function(){ SessionPayroll.retryLabels(); });
  click('swpReloadBtn', function(){ SessionPayroll.reloadPlan(); });
  Object.keys(SESSION_PAYROLL_ACTION_BUTTONS).forEach(function(k){ click(SESSION_PAYROLL_ACTION_BUTTONS[k].id, function(){ SessionPayroll.openPanel(k); }); });
  click('swpPanelCancel', function(){ SessionPayroll.cancelPanel(); });
  click('swpPanelConfirm', function(){ SessionPayroll.confirmPanel(); });
  click('swpRetryCommitBtn', function(){ SessionPayroll.retryCommit(); });
  const w = SessionPayrollStore.snapshot();
  (w.list || []).forEach(function(row, i){ click('swpOpen' + i, function(){ SessionPayroll.openDetail(row.id); }); });
}

// After a render: the element the section asked for, else null (the workspace decides).
function sessionPayrollFocusTarget(app, hint){
  if(hint === 'message') return app.querySelector('#swpMutationMessage');
  if(hint === 'panel') return app.querySelector('#swpPanelTitle');
  if(hint === 'section') return app.querySelector('#authTitle');
  return null;
}
