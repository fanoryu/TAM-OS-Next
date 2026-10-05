/* ============================================================
   SESSION PAYROLL VIEW (AFI-4c1, AFI-4c2, AFI-4d) — js/ui/session-payroll-view.js
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

   AFI-4d (owner decisions D-AFI4d-1 = A, D-AFI4d-2 = A): SUPPLEMENTAL PAYROLL — a separate payroll
   obligation for overtime approved after an employee's payroll for the month was committed; the
   committed payroll itself never changes. The CEO's month page adds a Supplemental payroll card:
   the eligible committed plans (named from the plan's own snapshot; records, hours and amount as
   the server sent them) with "Prepare supplemental payroll" (not offered for "0.00"), and the
   month's Supplemental documents, each opening its own detail in this section — its frozen
   overtime, and only the actions BF-4d offers: Review / Cancel on a Draft (no Approve: there is no
   Draft → Ready), Approve / Return to draft / Cancel on a Reviewed one, Commit / Return to draft /
   Cancel on a Ready one, nothing on a Committed or Cancelled one. A Committed plan's detail lists
   its Supplemental documents. Commit works exactly like the payroll Commit (one intent, "Retry
   commit"). An Employee's My payroll lists their own Committed Supplemental documents as separate
   rows, each opening its own read-only card; the payroll card links to them. A base plan and a
   Supplemental document are never added together — there is no combined total anywhere.

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

// AFI-4d: Supplemental payroll words. Every message is fixed; the server never names a 409 cause.
const SESSION_SUPPLEMENTAL_TITLE = 'Supplemental payroll';
const SESSION_SUPPLEMENTAL_MINE_TITLE = 'Supplemental payroll — overtime approved after payroll was committed';
const SESSION_SUPPLEMENTAL_MUTATION_ERRORS = Object.freeze({
  VALIDATION: 'TAM OS could not accept this request.',
  DENIED: 'You do not have permission to make this change.',
  NOT_FOUND: 'This supplemental payroll is no longer available. The month was read again.',
  RATE_LIMITED: 'Too many requests.',
  SERVER_ERROR: 'The change was not made. Try again in a moment.',
  CLIENT_FAULT: 'TAM OS could not process this request.',
  CRYPTO_UNAVAILABLE: 'This browser cannot create a secure commit key. Nothing was sent.'
});
const SESSION_SUPPLEMENTAL_CONFLICTS = Object.freeze({
  suppGenerate: 'TAM OS did not prepare supplemental payroll (a conflict was reported). The month was read again from TAM OS — check it before trying again.',
  transition: 'This supplemental payroll changed or the action is no longer available. It was read again from TAM OS — check it, then choose again.',
  suppCommit: 'TAM OS did not commit this supplemental payroll: it changed, its amount no longer matches, or its overtime changed. It was read again — check it before choosing again.'
});
const SESSION_SUPPLEMENTAL_NOTICES = Object.freeze({
  suppGeneratedDraft: 'Supplemental payroll prepared: its Draft holds the approved overtime that is eligible now. The month was read again from TAM OS.',
  suppGeneratedOpen: 'This plan already has an open supplemental payroll that is Reviewed or Ready, and TAM OS returned it unchanged. Overtime approved since is not added to it: return it to Draft and prepare again to include it, or commit it first.',
  suppReviewed: 'Supplemental payroll marked as reviewed.',
  suppApproved: 'Supplemental payroll approved: it is now Ready — approved, not paid.',
  suppReturned: 'Supplemental payroll returned to Draft.',
  suppCancelled: 'Supplemental payroll cancelled. Its overtime is released.',
  suppCommitStale: 'TAM OS could not confirm the commit, and the supplemental payroll read again has changed. Check it before choosing again.'
});
const SESSION_SUPPLEMENTAL_MONTH_NOTICES = Object.freeze({
  suppCommitted: ['Supplemental payroll committed: it is a final payroll obligation for ', ' — not paid.'],
  suppCommitConfirmed: ['TAM OS could not confirm the commit at first, but the supplemental payroll read again is committed: it is a final payroll obligation for ', ' — not paid.']
});
const SESSION_SUPPLEMENTAL_TARGETS = Object.freeze({ suppReview: 'Reviewed', suppApprove: 'Ready', suppReturn: 'Draft', suppCancel: 'Cancelled', suppCommit: 'Committed' });
const SESSION_SUPPLEMENTAL_PANELS = Object.freeze({
  suppGenerate: { title: 'Prepare supplemental payroll?',
    text: 'TAM OS creates a Draft of the approved overtime this committed payroll does not contain, or recalculates the open Draft. An open Reviewed or Ready supplemental payroll is returned unchanged. The committed payroll is not changed. Nothing is paid and nothing is posted to Finance.',
    submit: 'Prepare supplemental payroll', busy: 'Preparing…', danger: false },
  suppReview: { title: 'Mark this supplemental payroll as reviewed?', text: 'A reviewed supplemental payroll can be approved, returned to Draft or cancelled.', submit: 'Mark reviewed', busy: 'Working…', danger: false },
  suppApprove: { title: 'Approve this supplemental payroll?', text: 'It becomes Ready — approved, not paid. It can still be returned to Draft or cancelled.', submit: 'Approve', busy: 'Approving…', danger: false },
  suppReturn: { title: 'Return this supplemental payroll to Draft?', text: 'It keeps its overtime. Preparing supplemental payroll for this plan again recalculates it.', submit: 'Return to draft', busy: 'Working…', danger: false },
  suppCancel: { title: 'Cancel this supplemental payroll?', text: 'A cancelled supplemental payroll is final and releases its overtime, which can then be prepared again.', submit: 'Cancel supplemental', busy: 'Cancelling…', danger: true },
  suppCommit: { title: 'Commit this supplemental payroll?',
    text: 'It can no longer be changed, returned or cancelled. It is not a payment — nothing is paid and nothing is posted to Finance.',
    submit: 'Commit supplemental', busy: 'Committing…', danger: true }
});
const SESSION_SUPPLEMENTAL_ACTION_BUTTONS = Object.freeze({
  review: { id: 'swpSuppReviewBtn', label: 'Review', cls: 'btn', panel: 'suppReview' },
  approve: { id: 'swpSuppApproveBtn', label: 'Approve', cls: 'btn btn-accent', panel: 'suppApprove' },
  return: { id: 'swpSuppReturnBtn', label: 'Return to draft', cls: 'btn', panel: 'suppReturn' },
  cancel: { id: 'swpSuppCancelBtn', label: 'Cancel supplemental', cls: 'btn btn-danger', panel: 'suppCancel' },
  commit: { id: 'swpSuppCommitBtn', label: 'Commit supplemental', cls: 'btn btn-accent', panel: 'suppCommit' }
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
  return head + sessionPayrollMinePlansHTML(w, dis) + sessionSupplementalMineListHTML(w, dis);   // AFI-4d: separate Supplemental rows (D-AFI4d-2 = A)
}
function sessionPayrollMinePlansHTML(w, dis){
  if(w.listStatus === SESSION_PAYROLL_STATUS.ERROR && w.error && w.error.scope === 'list'){
    const retry = w.error.kind === 'DENIED' ? '' : '<div class="auth-actions"><button class="btn btn-accent" type="button" id="swpRetryBtn"' + dis + '>Retry</button></div>';
    return sessionPayrollErrorHTML(w.error) + retry;
  }
  if(w.listStatus !== SESSION_PAYROLL_STATUS.READY || !w.list || w.listMonth !== w.month) return '<p class="auth-lead" role="status" aria-busy="true">Loading your payroll…</p>';
  if(!w.list.length) return '<div class="empty">No committed payroll for ' + escapeHtml(sessionPayrollMonthLabel(w.month)) + '.</div>';
  const rows = w.list.map(function(p, i){
    return '<tr><td>' + escapeHtml(sessionPayrollMonthLabel(p.monthKey)) + '</td><td>' + escapeHtml(sessionPayrollStatusText(p.status)) + '</td>'
      + '<td>' + escapeHtml(p.baseSalary) + '</td><td>' + escapeHtml(p.overtimeAmount) + '</td><td>' + escapeHtml(p.totalAmount) + '</td>'
      + '<td><button class="btn" type="button" id="swpOpen' + i + '"' + dis + '>View</button></td></tr>';
  }).join('');
  return '<div class="table-wrap"><table><thead><tr><th scope="col">Month</th><th scope="col">Status</th>'
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
    + sessionSupplementalRelatedHTML(w, p, '')
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
        + (sessionSupplementalOwnsMessage(w) ? '' : sessionPayrollMutationHTML(w)))
    + (generating ? '' : sessionPayrollMonthBarHTML(w, dis))
    + sessionPayrollExcludedHTML(w, dis)
    + '<h2 class="section-title">' + escapeHtml(sessionPayrollMonthLabel(w.month)) + '</h2>';
  return head + sessionPayrollPlansHTML(w, dis) + sessionSupplementalAreaHTML(w, dis);   // AFI-4d: the Supplemental card follows the plans
}

// The month's plans (the CEO list), or its loading / error / empty state.
function sessionPayrollPlansHTML(w, dis){
  if(w.listStatus === SESSION_PAYROLL_STATUS.ERROR && w.error && w.error.scope === 'list'){
    const retry = w.error.kind === 'DENIED' ? '' : '<div class="auth-actions"><button class="btn btn-accent" type="button" id="swpRetryBtn"' + dis + '>Retry</button></div>';
    return sessionPayrollErrorHTML(w.error) + retry;
  }
  if(w.listStatus !== SESSION_PAYROLL_STATUS.READY || !w.list || w.listMonth !== w.month) return '<p class="auth-lead" role="status" aria-busy="true">Loading payroll plans…</p>';
  if(!w.list.length) return '<div class="empty">No payroll plans for ' + escapeHtml(sessionPayrollMonthLabel(w.month)) + '. Prepare payroll for this month to create them.</div>';
  const rows = w.list.map(function(p, i){
    return '<tr><td>' + escapeHtml(p.employeeCode) + '</td><td>' + escapeHtml(p.employeeName) + '</td><td>' + escapeHtml(sessionPayrollStatusText(p.status)) + '</td>'
      + '<td>' + escapeHtml(p.baseSalary) + '</td><td>' + escapeHtml(p.overtimeAmount) + '</td><td>' + escapeHtml(p.totalAmount) + '</td>'
      + '<td><button class="btn" type="button" id="swpOpen' + i + '"' + dis + '>View</button></td></tr>';
  }).join('');
  return '<div class="table-wrap"><table><thead><tr><th scope="col">Code</th><th scope="col">Employee</th><th scope="col">Status</th>'
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
    + (p.status === 'Committed' ? sessionSupplementalRelatedHTML(w, p, dis) : '')
    + back + reload + actions + '</div>'
    + (w.panel && w.panel.id === p.id ? sessionPayrollPanelHTML(w) : '');
}

// The section title (the workspace heading) and body. AFI-4c2: an Employee's is My payroll.
function renderSessionPayrollTitle(w, principal){
  if(sessionPayrollIsEmployee(principal)) return 'My payroll';
  if(w.suppDetailId) return SESSION_SUPPLEMENTAL_TITLE;          // AFI-4d
  return w.detailId ? 'Payroll plan' : 'Payroll';
}
function renderSessionPayrollHTML(principal, w){
  if(sessionPayrollIsEmployee(principal)) return w.suppDetailId ? sessionSupplementalMineDetailHTML(w) : w.detailId ? sessionPayrollMineDetailHTML(w) : sessionPayrollMineListHTML(w);
  if(w.suppDetailId) return sessionSupplementalDetailHTML(principal, w);      // AFI-4d
  return w.detailId ? sessionPayrollDetailHTML(principal, w) : sessionPayrollListHTML(w);
}

/* ---------- AFI-4d: Supplemental payroll ---------- */

// The month's Supplemental documents of one base plan (for the plan's own card).
function sessionSupplementalRelated(w, plan){
  if(!plan || w.suppListStatus !== SESSION_PAYROLL_STATUS.READY || !w.suppList || w.suppListMonth !== plan.monthKey) return [];
  return w.suppList.filter(function(d){ return d.payrollPlanId === plan.id; });
}
// A base plan's own Supplemental documents, each opened by its position (no id in the page).
function sessionSupplementalRelatedHTML(w, plan, dis){
  if(w.suppListStatus !== SESSION_PAYROLL_STATUS.READY || !w.suppList || w.suppListMonth !== plan.monthKey) return '';
  const related = sessionSupplementalRelated(w, plan);
  const body = related.length
    ? '<div class="table-wrap"><table><thead><tr><th scope="col">Supplemental payroll</th><th scope="col">Status</th><th scope="col">Overtime hours</th><th scope="col">Amount (Rp)</th><th scope="col" aria-label="Open supplemental payroll"></th></tr></thead><tbody>'
      + related.map(function(d, i){
        return '<tr><td>' + (i + 1) + ' of ' + related.length + '</td><td>' + escapeHtml(sessionPayrollStatusText(d.status)) + '</td><td>' + escapeHtml(d.overtimeHours) + '</td>'
          + '<td>' + escapeHtml(d.overtimeAmount) + '</td><td><button class="btn" type="button" id="swpSuppLink' + i + '"' + dis + '>View</button></td></tr>';
      }).join('') + '</tbody></table></div>'
    : '<p class="hint">No supplemental payroll for this payroll.</p>';
  return '<section class="card" id="swpSuppRelated" aria-labelledby="swpSuppRelatedTitle"><h2 class="section-title" id="swpSuppRelatedTitle">' + escapeHtml(SESSION_SUPPLEMENTAL_TITLE) + ' for this payroll</h2>'
    + '<p class="hint">Each supplemental payroll is a separate obligation for overtime approved after this payroll was committed.</p>' + body + '</section>';
}

// The Supplemental confirmation and write messages belong to the Supplemental card or detail.
function sessionSupplementalOwnsMessage(w){
  return SESSION_SUPPLEMENTAL_PANEL_KINDS.indexOf(w.mutation.kind) !== -1
    || (w.mutation.status === SESSION_PAYROLL_MUTATION_STATUS.IDLE && !!w.notice && /^supp/.test(w.notice));
}
// An unconfirmed Supplemental write, reported by what the read that followed it shows.
function sessionSupplementalAmbiguousText(w){
  const m = w.mutation;
  const d = w.suppDetailStatus === SESSION_PAYROLL_STATUS.READY && w.suppDetail ? w.suppDetail.doc : null;
  if(m.kind === 'suppCommit' && d && sessionSupplementalIntentState(w.suppIntent, d) === 'unresolved'){
    return 'TAM OS could not confirm the commit. The supplemental payroll read again is still Ready with the same amount. Retry commit sends the same commit again — it can never commit it twice.';
  }
  if(m.kind === 'suppCommit' && w.suppDetailStatus === SESSION_PAYROLL_STATUS.ERROR) return 'TAM OS could not confirm the commit, and the supplemental payroll could not be read again. Nothing is sent again — use Retry to read it.';
  if(m.kind === 'suppGenerate') return 'TAM OS could not confirm whether supplemental payroll was prepared. The month was read again from TAM OS — check it before preparing again.';
  if(w.suppDetailStatus === SESSION_PAYROLL_STATUS.LOADING || w.suppDetailStatus === SESSION_PAYROLL_STATUS.IDLE) return 'TAM OS could not confirm the change. The supplemental payroll is being read again…';
  if(d && d.status === SESSION_SUPPLEMENTAL_TARGETS[m.kind]) return 'TAM OS could not confirm the change, but the supplemental payroll read again is now ' + d.status + '.';
  if(d) return 'TAM OS could not confirm the change. The supplemental payroll read again is ' + d.status + ', not ' + SESSION_SUPPLEMENTAL_TARGETS[m.kind] + ' — check it before trying again.';
  return 'TAM OS could not confirm the change, and the supplemental payroll could not be read again. Use Retry to read it.';
}
function sessionSupplementalMutationHTML(w){
  if(!sessionSupplementalOwnsMessage(w)) return '';
  const m = w.mutation;
  let text = null, warn = true;
  if(m.status === SESSION_PAYROLL_MUTATION_STATUS.AMBIGUOUS) text = sessionSupplementalAmbiguousText(w);
  else if(m.status === SESSION_PAYROLL_MUTATION_STATUS.ERROR && m.error){
    const k = m.error.kind;
    if(k === 'CONFLICT') text = SESSION_SUPPLEMENTAL_CONFLICTS[m.kind] || SESSION_SUPPLEMENTAL_CONFLICTS.transition;
    else text = SESSION_SUPPLEMENTAL_MUTATION_ERRORS[k] || SESSION_SUPPLEMENTAL_MUTATION_ERRORS.CLIENT_FAULT;
    if(k === 'RATE_LIMITED' && typeof authWaitText === 'function') text += authWaitText(m.error.retryAfter);
  } else if(m.status === SESSION_PAYROLL_MUTATION_STATUS.IDLE && w.notice && SESSION_SUPPLEMENTAL_NOTICES[w.notice]){
    text = SESSION_SUPPLEMENTAL_NOTICES[w.notice]; warn = w.notice === 'suppCommitStale' || w.notice === 'suppGeneratedOpen';
  } else if(m.status === SESSION_PAYROLL_MUTATION_STATUS.IDLE && w.notice && SESSION_SUPPLEMENTAL_MONTH_NOTICES[w.notice] && w.suppDetail){
    const n = SESSION_SUPPLEMENTAL_MONTH_NOTICES[w.notice];
    text = n[0] + sessionPayrollMonthLabel(w.suppDetail.doc.monthKey) + n[1]; warn = false;
  }
  if(!text) return '';
  if(warn && m.error && m.error.requestId) text += ' Reference: ' + m.error.requestId + '.';
  return '<p class="auth-message' + (warn ? ' auth-message-warn' : '') + '" id="swpMutationMessage" role="' + (warn ? 'alert' : 'status') + '" tabindex="-1">' + escapeHtml(text) + '</p>';
}

// The open Supplemental confirmation: exactly the server strings it acts on.
function sessionSupplementalPanelHTML(w, eligible){
  const panel = SESSION_SUPPLEMENTAL_PANELS[w.panel.kind];
  const busy = sessionPayrollBusy(w);
  const dis = busy ? ' disabled' : '';
  let what;
  if(w.panel.kind === 'suppGenerate'){
    const plan = sessionSupplementalPlanOf(w.listStatus, w.list, eligible.payrollPlanId);
    what = [plan ? plan.employeeName + ' (' + plan.employeeCode + ')' : 'This committed payroll', ' — ', sessionPayrollMonthLabel(w.month), ': ', String(eligible.eligibleCount),
      ' approved overtime records, ', eligible.eligibleHours, ' hours (Rp) ', eligible.eligibleAmount, ' eligible now.'].join('');
  } else {
    const d = w.suppDetail.doc;
    if(w.panel.kind === 'suppCommit'){
      what = ['Committing makes this supplemental payroll a final payroll obligation for ', sessionPayrollMonthLabel(d.monthKey), ': ', d.employeeName, ' (', d.employeeCode, ')',
        ', overtime ', d.overtimeHours, ' hours in ', String(d.overtimeCount), ' records (Rp) ', d.overtimeAmount, ', version ', String(d.version), '.'].join('');
    } else {
      what = [d.employeeName, ' (', d.employeeCode, ') — ', sessionPayrollMonthLabel(d.monthKey), ' — ', sessionPayrollStatusText(d.status), ' — (Rp) ', d.overtimeAmount, '.'].join('');
    }
  }
  return '<section class="card" aria-labelledby="swpPanelTitle"' + (busy ? ' aria-busy="true"' : '') + '>'
    + '<h2 class="section-title" id="swpPanelTitle" tabindex="-1">' + escapeHtml(panel.title) + '</h2>'
    + '<p class="auth-lead">' + escapeHtml(what) + ' ' + escapeHtml(panel.text) + '</p>'
    + sessionSupplementalMutationHTML(w)
    + '<div class="auth-actions"><button class="btn" type="button" id="swpPanelCancel"' + dis + '>Back</button>'
    + '<button class="btn ' + (panel.danger ? 'btn-danger' : 'btn-accent') + '" type="button" id="swpPanelConfirm"' + dis + (busy ? ' aria-busy="true"' : '') + '>'
    + escapeHtml(busy ? panel.busy : panel.submit) + '</button></div></section>';
}

// The failure of one of the month's Supplemental reads, with one Retry for both.
function sessionSupplementalReadErrorHTML(error, dis){
  return sessionPayrollErrorHTML(error) + (error.kind === 'DENIED' ? '' : '<div class="auth-actions"><button class="btn btn-accent" type="button" id="swpSuppRetryBtn"' + dis + '>Retry supplemental payroll</button></div>');
}

// The CEO's Supplemental card of the month: what is eligible, then the documents.
function sessionSupplementalAreaHTML(w, dis){
  const month = sessionPayrollMonthLabel(w.month);
  const generating = w.panel && w.panel.kind === 'suppGenerate';
  let eligible;
  if(w.eligStatus === SESSION_PAYROLL_STATUS.ERROR && w.eligError) eligible = sessionSupplementalReadErrorHTML(w.eligError, dis);
  else if(w.eligStatus !== SESSION_PAYROLL_STATUS.READY || !w.elig || w.eligMonth !== w.month) eligible = '<p class="auth-lead" role="status" aria-busy="true">Checking for overtime approved after payroll was committed…</p>';
  else if(!w.elig.length) eligible = '<div class="empty">No approved overtime of ' + escapeHtml(month) + ' is waiting for supplemental payroll.</div>';
  else {
    eligible = '<div class="table-wrap"><table><thead><tr><th scope="col">Code</th><th scope="col">Employee</th><th scope="col">Overtime records</th><th scope="col">Overtime hours</th>'
      + '<th scope="col">Eligible amount (Rp)</th><th scope="col" aria-label="Prepare supplemental payroll"></th></tr></thead><tbody>'
      + w.elig.map(function(e, i){
        const plan = sessionSupplementalPlanOf(w.listStatus, w.list, e.payrollPlanId);
        const waiting = w.listStatus === SESSION_PAYROLL_STATUS.LOADING ? 'Loading name…' : 'Name not available';
        const open = (w.suppListStatus === SESSION_PAYROLL_STATUS.READY && w.suppList ? w.suppList : []).filter(function(d){
          return d.payrollPlanId === e.payrollPlanId && (d.status === 'Reviewed' || d.status === 'Ready');
        })[0];
        const action = e.eligibleAmount === '0.00' ? '<span class="hint">Nothing to settle: the amount is 0.00.</span>'
          : (open ? '<span class="hint">Open supplemental payroll is ' + escapeHtml(open.status) + '. </span>' : '')
            + '<button class="btn btn-accent" type="button" id="swpSuppPrep' + i + '"' + (dis || (w.panel ? ' disabled' : '')) + '>Prepare supplemental payroll</button>';
        return '<tr><td>' + escapeHtml(plan ? plan.employeeCode : '—') + '</td><td>' + escapeHtml(plan ? plan.employeeName : waiting) + '</td><td>' + escapeHtml(String(e.eligibleCount)) + '</td>'
          + '<td>' + escapeHtml(e.eligibleHours) + '</td><td>' + escapeHtml(e.eligibleAmount) + '</td><td>' + action + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  let docs;
  if(w.suppListStatus === SESSION_PAYROLL_STATUS.ERROR && w.suppListError) docs = w.eligStatus === SESSION_PAYROLL_STATUS.ERROR ? sessionPayrollErrorHTML(w.suppListError) : sessionSupplementalReadErrorHTML(w.suppListError, dis);
  else if(w.suppListStatus !== SESSION_PAYROLL_STATUS.READY || !w.suppList || w.suppListMonth !== w.month) docs = '<p class="auth-lead" role="status" aria-busy="true">Loading supplemental payroll…</p>';
  else if(!w.suppList.length) docs = '<div class="empty">No supplemental payroll for ' + escapeHtml(month) + '.</div>';
  else {
    docs = '<div class="table-wrap"><table><thead><tr><th scope="col">Code</th><th scope="col">Employee</th><th scope="col">Status</th><th scope="col">Overtime hours</th>'
      + '<th scope="col">Amount (Rp)</th><th scope="col" aria-label="Open supplemental payroll"></th></tr></thead><tbody>'
      + w.suppList.map(function(d, i){
        return '<tr><td>' + escapeHtml(d.employeeCode) + '</td><td>' + escapeHtml(d.employeeName) + '</td><td>' + escapeHtml(sessionPayrollStatusText(d.status)) + '</td>'
          + '<td>' + escapeHtml(d.overtimeHours) + '</td><td>' + escapeHtml(d.overtimeAmount) + '</td>'
          + '<td><button class="btn" type="button" id="swpSuppOpen' + i + '"' + dis + '>View</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  const eligibleEntry = generating && w.elig ? w.elig.filter(function(e){ return e.payrollPlanId === w.panel.id; })[0] : null;
  return '<section class="card" id="swpSupp" aria-labelledby="swpSuppTitle"><h2 class="section-title" id="swpSuppTitle">' + escapeHtml(SESSION_SUPPLEMENTAL_TITLE + ' — ' + month) + '</h2>'
    + '<p class="hint">Overtime approved after an employee\'s payroll for the month was committed. Each supplemental payroll is a separate obligation; the committed payroll is never changed.</p>'
    + (eligibleEntry ? sessionSupplementalPanelHTML(w, eligibleEntry) : sessionSupplementalMutationHTML(w))
    + '<h3 class="section-title">Eligible now</h3>' + eligible
    + '<h3 class="section-title">' + escapeHtml(SESSION_SUPPLEMENTAL_TITLE + ' of ' + month) + '</h3>' + docs + '</section>';
}

// The captured overtime of a document — its frozen amounts; a cancelled one holds none.
function sessionSupplementalLinesHTML(d, rows){
  if(rows.length) return '<div class="table-wrap"><table><thead><tr><th scope="col">Overtime record</th><th scope="col">Hours</th><th scope="col">Approved amount (Rp)</th></tr></thead><tbody>'
    + rows.map(function(r){ return '<tr><td>' + escapeHtml(r.id) + '</td><td>' + escapeHtml(r.hours) + '</td><td>' + escapeHtml(r.amount) + '</td></tr>'; }).join('')
    + '</tbody></table></div>';
  return d.status === 'Cancelled' ? '<p class="hint">A cancelled supplemental payroll no longer holds overtime: its overtime was released.</p>'
    : '<p class="hint">No overtime record is listed for this supplemental payroll.</p>';
}

// The CEO's Supplemental detail.
function sessionSupplementalDetailHTML(principal, w){
  const busy = sessionPayrollBusy(w);
  const dis = busy ? ' disabled' : '';
  const back = '<div class="auth-actions"><button class="btn" type="button" id="swpBackBtn"' + dis + '>Back to list</button>';
  if(w.suppDetailStatus === SESSION_PAYROLL_STATUS.ERROR && w.error && w.error.scope === 'suppDetail'){
    const retry = (w.error.kind === 'DENIED' || w.error.kind === 'NOT_FOUND') ? '' : '<button class="btn btn-accent" type="button" id="swpRetryBtn"' + dis + '>Retry</button>';
    return sessionSupplementalMutationHTML(w) + sessionPayrollErrorHTML(w.error) + back + retry + '</div>';
  }
  if(w.suppDetailStatus !== SESSION_PAYROLL_STATUS.READY || !w.suppDetail) return sessionSupplementalMutationHTML(w) + '<p class="auth-lead" role="status" aria-busy="true">Loading the supplemental payroll…</p>' + back + '</div>';
  const d = w.suppDetail.doc;
  // Only the actions the matrix offers; an open commit intent replaces Commit by Retry commit.
  const intentState = sessionSupplementalIntentState(w.suppIntent, d);
  const actions = w.panel ? '' : sessionSupplementalActions(principal, d).filter(function(k){ return !(k === 'commit' && w.suppIntent); }).map(function(k){
    const b = SESSION_SUPPLEMENTAL_ACTION_BUTTONS[k];
    return '<button class="' + b.cls + '" type="button" id="' + b.id + '"' + dis + '>' + escapeHtml(b.label) + '</button>';
  }).join('') + (!w.panel && intentState === 'unresolved' ? '<button class="btn btn-accent" type="button" id="swpSuppRetryCommitBtn"' + dis + '>Retry commit</button>' : '');
  const conflict = w.mutation.status === SESSION_PAYROLL_MUTATION_STATUS.ERROR && w.mutation.error && w.mutation.error.kind === 'CONFLICT';
  const reload = (conflict || w.mutation.status === SESSION_PAYROLL_MUTATION_STATUS.AMBIGUOUS) && !w.panel ? '<button class="btn" type="button" id="swpSuppReloadBtn"' + dis + '>Reload supplemental payroll</button>' : '';
  const rows = [
    ['Employee code', d.employeeCode], ['Employee', d.employeeName], ['Department', d.department], ['Month', sessionPayrollMonthLabel(d.monthKey)],
    ['Status', sessionPayrollStatusText(d.status)], ['Overtime hours', d.overtimeHours], ['Overtime records', String(d.overtimeCount)],
    ['Amount (Rp)', d.overtimeAmount], ['Version', String(d.version)]
  ];
  return '<h2 class="section-title">' + escapeHtml(d.employeeName) + ' — ' + escapeHtml(sessionPayrollMonthLabel(d.monthKey)) + '</h2>'
    + '<p class="hint">A separate payroll obligation for overtime approved after this employee\'s payroll for the month was committed. The committed payroll is not changed.</p>'
    + (w.panel ? '' : sessionSupplementalMutationHTML(w))
    + '<div class="table-wrap"><table><tbody>' + rows.map(function(r){ return '<tr><th scope="row">' + escapeHtml(r[0]) + '</th><td>' + sessionPayrollValue(r[1]) + '</td></tr>'; }).join('') + '</tbody></table></div>'
    + '<section class="card" aria-labelledby="swpSuppOvertimeTitle"><h2 class="section-title" id="swpSuppOvertimeTitle">Approved overtime settled here</h2>' + sessionSupplementalLinesHTML(d, w.suppDetail.overtime) + '</section>'
    + back + reload + actions + '</div>'
    + (w.panel && w.panel.id === d.id ? sessionSupplementalPanelHTML(w, null) : '');
}

// The Employee's own Committed Supplemental documents of the month — separate rows, never added
// to the payroll above (D-AFI4d-2 = A).
function sessionSupplementalMineListHTML(w, dis){
  const head = '<h2 class="section-title">' + escapeHtml(SESSION_SUPPLEMENTAL_MINE_TITLE) + '</h2>';
  if(w.suppListStatus === SESSION_PAYROLL_STATUS.ERROR && w.suppListError) return head + sessionSupplementalReadErrorHTML(w.suppListError, dis);
  if(w.suppListStatus !== SESSION_PAYROLL_STATUS.READY || !w.suppList || w.suppListMonth !== w.month) return head + '<p class="auth-lead" role="status" aria-busy="true">Loading your supplemental payroll…</p>';
  if(!w.suppList.length) return head + '<div class="empty">No supplemental payroll for ' + escapeHtml(sessionPayrollMonthLabel(w.month)) + '.</div>';
  const rows = w.suppList.map(function(d, i){
    return '<tr><td>' + escapeHtml(sessionPayrollMonthLabel(d.monthKey)) + '</td><td>' + escapeHtml(sessionPayrollStatusText(d.status)) + '</td>'
      + '<td>' + escapeHtml(d.overtimeHours) + '</td><td>' + escapeHtml(d.overtimeAmount) + '</td>'
      + '<td><button class="btn" type="button" id="swpSuppOpen' + i + '"' + dis + '>View</button></td></tr>';
  }).join('');
  return head + '<div class="table-wrap"><table><thead><tr><th scope="col">Month</th><th scope="col">Status</th><th scope="col">Overtime hours</th>'
    + '<th scope="col">Amount (Rp)</th><th scope="col" aria-label="Open supplemental payroll"></th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table></div>';
}

// The Employee's read-only card of one own Committed Supplemental document — the server's fields.
function sessionSupplementalMineDetailHTML(w){
  const back = '<div class="auth-actions"><button class="btn" type="button" id="swpBackBtn">Back to my payroll</button>';
  if(w.suppDetailStatus === SESSION_PAYROLL_STATUS.ERROR && w.error && w.error.scope === 'suppDetail'){
    const retry = (w.error.kind === 'DENIED' || w.error.kind === 'NOT_FOUND') ? '' : '<button class="btn btn-accent" type="button" id="swpRetryBtn">Retry</button>';
    return sessionPayrollErrorHTML(w.error) + back + retry + '</div>';
  }
  if(w.suppDetailStatus !== SESSION_PAYROLL_STATUS.READY || !w.suppDetail) return '<p class="auth-lead" role="status" aria-busy="true">Loading your supplemental payroll…</p>' + back + '</div>';
  const d = w.suppDetail.doc;
  const rows = [
    ['Employee', d.employeeName], ['Code', d.employeeCode], ['Department', d.department], ['Month', sessionPayrollMonthLabel(d.monthKey)],
    ['Status', sessionPayrollStatusText(d.status)], ['Overtime hours', d.overtimeHours], ['Overtime records', String(d.overtimeCount)], ['Amount (Rp)', d.overtimeAmount]
  ];
  return '<section class="card" id="swpSuppCard" aria-labelledby="swpSuppCardTitle"><h2 class="section-title" id="swpSuppCardTitle">' + escapeHtml(SESSION_SUPPLEMENTAL_TITLE + ' — ' + sessionPayrollMonthLabel(d.monthKey)) + '</h2>'
    + '<p class="hint">A separate payroll obligation for overtime approved after your payroll for this month was committed.</p>'
    + '<div class="table-wrap"><table><tbody>' + rows.map(function(r){ return '<tr><th scope="row">' + escapeHtml(r[0]) + '</th><td>' + sessionPayrollValue(r[1]) + '</td></tr>'; }).join('') + '</tbody></table></div>'
    + '<h3 class="section-title">Approved overtime settled here</h3>' + sessionSupplementalLinesHTML(d, w.suppDetail.overtime) + '</section>'
    + back + '</div>';
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
  // AFI-4d: Supplemental payroll — rows open by position, as the plans do.
  click('swpSuppRetryBtn', function(){ SessionPayroll.retrySupplemental(); });
  click('swpSuppReloadBtn', function(){ SessionPayroll.reloadSupplemental(); });
  click('swpSuppRetryCommitBtn', function(){ SessionPayroll.retrySupplementalCommit(); });
  Object.keys(SESSION_SUPPLEMENTAL_ACTION_BUTTONS).forEach(function(k){ const b = SESSION_SUPPLEMENTAL_ACTION_BUTTONS[k]; click(b.id, function(){ SessionPayroll.openPanel(b.panel); }); });
  (w.elig || []).forEach(function(e, i){ click('swpSuppPrep' + i, function(){ SessionPayroll.openPanel('suppGenerate', e.payrollPlanId); }); });
  (w.suppList || []).forEach(function(d, i){ click('swpSuppOpen' + i, function(){ SessionPayroll.openSupplemental(d.id); }); });
  sessionSupplementalRelated(w, w.detail && w.detail.plan).forEach(function(d, i){ click('swpSuppLink' + i, function(){ SessionPayroll.openSupplemental(d.id); }); });
}

// After a render: the element the section asked for, else null (the workspace decides).
function sessionPayrollFocusTarget(app, hint){
  if(hint === 'message') return app.querySelector('#swpMutationMessage');
  if(hint === 'panel') return app.querySelector('#swpPanelTitle');
  if(hint === 'section') return app.querySelector('#authTitle');
  return null;
}
