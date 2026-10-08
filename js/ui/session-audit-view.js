/* ============================================================
   SESSION AUDIT VIEW (AFI-4g) — js/ui/session-audit-view.js
   ------------------------------------------------------------
   The CEO's Audit section of the authenticated SESSION workspace, rendered by
   sessionWorkspaceHTML() (js/ui/session-workspace-view.js) — its only caller — when the section
   is shown, for the CEO only (D-AFI4g-3 = A). It is NOT the LOCAL activity log
   (js/ui/activity-log.js) and never reaches it, the business shell, its navigation, Global Search
   or "Acting as": AuthBoot.allowsWorkspace() stays false. An Employee has no Audit section.

     Month          the month bar (Previous, the month, Next) and the month's audit events, oldest
                    first: time (WIB), action, record, actor and the field names — "View" opens one
     Event          every stored field of one event (D-BF4g-3 = A: the eleven, never the company):
                    the WIB wall time and the exact stored UTC instant, the action and operation
                    with their codes, the record, the actor and membership, the target user, the
                    request and the changed field NAMES — and "Show record history"
     Record history every event naming the record of the event opened (D-AFI4g-5 = A), oldest
                    first; empty is one neutral sentence that never says whether the record exists

   Data comes only from SessionAudit / SessionAuditStore (js/core/session-audit.js); nothing is
   written here but the DOM. Every message is a fixed string; every server value is escaped and
   every id is shown exactly as stored — never a name looked up elsewhere (D-AFI4g-7 = A). Times are
   Western Indonesia Time (WIB, UTC+7), the company calendar the month is read in (D-AFI4g-4 = A).
   A 500 is reported as a failure with an informational note about the 2,000-event limit — never
   as its confirmed cause (D-AFI4g-6 = A). A row is opened by its position in the list rendered,
   through one delegated listener.

   Classic shared global scope; existing CSS classes only.
   ============================================================ */

const SESSION_AUDIT_ERRORS = Object.freeze({
  DENIED: 'You do not have access to the audit history.',
  NOT_FOUND: 'The audit history could not be found.',
  CONFLICT: 'TAM OS reported a conflict. Try again.',
  RATE_LIMITED: 'Too many requests.',
  VALIDATION: 'TAM OS could not process this request.',
  CLIENT_FAULT: 'TAM OS could not process this request.',
  SERVER_ERROR: 'The audit history could not be loaded. Try again in a moment.',
  UNAVAILABLE: 'The audit history could not be loaded. Check your connection, then try again.',
  INVALID_RESPONSE: 'TAM OS sent an unexpected response. Try again in a moment.'
});
// D-AFI4g-6 = A: informational only — the server reports no cause, so none is claimed.
const SESSION_AUDIT_LIMIT_NOTE = 'TAM OS shows at most 2,000 audit events for one month or one record. A month or record with more events cannot be shown; that is one possible reason, but TAM OS did not report the cause.';
const SESSION_AUDIT_TEXT = Object.freeze({
  lead: 'Every recorded change in the company, by month of the company calendar (Western Indonesia Time, WIB). Read only.',
  monthInvalid: 'Enter a month, from 1900 onwards, as YYYY-MM.',
  emptyRecord: 'No audit history is available for this record.',
  recordLead: 'Every audit event that names this record, oldest first.',
  fieldsNote: 'Field names only: the audit history records which fields changed, never their values.',
  loadingMonth: 'Loading audit history…',
  loadingRecord: 'Loading the record history…'
});
const SESSION_AUDIT_ACTIONS = Object.freeze({
  'employee.create': 'Employee created', 'employee.update': 'Employee updated', 'employee.delete': 'Employee archived',
  'account.manage': 'Login access',
  'overtime.createSelfDraft': 'Overtime draft created', 'overtime.updateSelfDraft': 'Overtime draft updated',
  'overtime.deleteSelfDraft': 'Overtime draft deleted', 'overtime.submitSelf': 'Overtime submitted', 'overtime.manage': 'Overtime decision',
  'payroll.manage': 'Payroll plan', 'supplemental.manage': 'Supplemental payroll', 'finance.execute': 'Payment recorded'
});
const SESSION_AUDIT_OPERATIONS = Object.freeze({
  provision: 'Create login', reissue: 'Resend activation email', disable: 'Disable login', enable: 'Enable login',
  submit: 'Submit', review: 'Review', reject: 'Reject', approve: 'Approve',
  create: 'Create', recalculate: 'Recalculate', return: 'Return to Draft', cancel: 'Cancel', commit: 'Commit', post: 'Post to Finance',
  execute: 'Record payment'
});
const SESSION_AUDIT_ENTITIES = Object.freeze({
  employee: 'Employee', overtime: 'Overtime record', payrollPlan: 'Payroll plan', supplementalPayroll: 'Supplemental payroll',
  financePosting: 'Finance posting'
});

function sessionAuditMonthLabel(key){
  return OvertimeCalendar.isMonth(key) ? SESSION_OVERTIME_MONTH_NAMES[+key.slice(5, 7) - 1] + ' ' + key.slice(0, 4) : '—';
}
// "Action" or "Action — Operation", from the fixed vocabularies (the decoder admits no other).
function sessionAuditActionLabel(e){
  return SESSION_AUDIT_ACTIONS[e.action] + (e.operation === null ? '' : ' — ' + SESSION_AUDIT_OPERATIONS[e.operation]);
}
function sessionAuditRecordLabel(entity, entityId){
  return SESSION_AUDIT_ENTITIES[entity] + ' ' + entityId;
}
function sessionAuditFields(fields){
  return fields.length ? fields.join(', ') : '—';
}
function sessionAuditTimeHTML(e){
  return '<time datetime="' + escapeHtml(e.occurredAt) + '">' + escapeHtml(auditJakartaTime(e.occurredAt)) + '</time>';
}

// The failure of a read: the message, the wait for a 429, the server reference when known, the
// limit note after a 500, and Retry — never for a refusal.
function sessionAuditErrorHTML(error){
  let msg = SESSION_AUDIT_ERRORS[error.kind] || SESSION_AUDIT_ERRORS.UNAVAILABLE;
  if(error.kind === 'RATE_LIMITED' && typeof authWaitText === 'function') msg += authWaitText(error.retryAfter);
  if(error.requestId) msg += ' Reference: ' + error.requestId + '.';
  const note = error.kind === 'SERVER_ERROR' ? '<p class="hint" id="swauLimitNote">' + escapeHtml(SESSION_AUDIT_LIMIT_NOTE) + '</p>' : '';
  const final = error.kind === 'DENIED' || error.kind === 'VALIDATION' || error.kind === 'CLIENT_FAULT';
  return '<p class="auth-message auth-message-warn" id="swauError" role="alert">' + escapeHtml(msg) + '</p>' + note
    + (final ? '' : '<div class="auth-actions"><button class="btn btn-accent" type="button" id="swauRetryBtn">Retry</button></div>');
}

// The events of a list, oldest first; "View" opens one by its position.
function sessionAuditTableHTML(rows, from){
  const body = rows.map(function(e, i){
    return '<tr><td>' + sessionAuditTimeHTML(e) + '</td><td>' + escapeHtml(sessionAuditActionLabel(e)) + '</td>'
      + '<td>' + escapeHtml(sessionAuditRecordLabel(e.entity, e.entityId)) + '</td><td>' + escapeHtml(e.actorUserId) + '</td>'
      + '<td>' + escapeHtml(sessionAuditFields(e.fields)) + '</td>'
      + '<td><button class="btn" type="button" data-swau-open="' + i + '">View</button></td></tr>';
  }).join('');
  return '<p class="hint">' + rows.length + (rows.length === 1 ? ' event' : ' events') + ', oldest first. Times are WIB.</p>'
    + '<div class="table-wrap" id="swauList" data-swau-from="' + from + '"><table><thead><tr><th scope="col">Time (WIB)</th><th scope="col">Action</th>'
    + '<th scope="col">Record</th><th scope="col">Actor user id</th><th scope="col">Fields changed</th><th scope="col" aria-label="Open event"></th></tr></thead>'
    + '<tbody>' + body + '</tbody></table></div>';
}

function sessionAuditMonthBarHTML(w){
  return '<div class="auth-actions" role="group" aria-label="Month">'
    + '<button class="btn" type="button" id="swauPrevMonth">Previous month</button>'
    + '<label for="swauMonth">Month</label><input class="input" type="month" id="swauMonth" name="month" autocomplete="off" value="' + escapeHtml(w.month || '') + '">'
    + '<button class="btn" type="button" id="swauNextMonth">Next month</button></div>';
}

function sessionAuditMonthHTML(w){
  const message = w.notice === 'monthInvalid'
    ? '<p class="auth-message auth-message-warn" id="swauMessage" role="alert" tabindex="-1">' + escapeHtml(SESSION_AUDIT_TEXT.monthInvalid) + '</p>' : '';
  const head = '<p class="hint">' + escapeHtml(SESSION_AUDIT_TEXT.lead) + '</p>' + sessionAuditMonthBarHTML(w) + message
    + '<h2 class="section-title" id="swauListTitle" tabindex="-1">' + escapeHtml(sessionAuditMonthLabel(w.month)) + ' (WIB)</h2>';
  if(w.listStatus === SESSION_AUDIT_STATUS.ERROR && w.error && w.error.scope === 'list') return head + sessionAuditErrorHTML(w.error);
  if(w.listStatus !== SESSION_AUDIT_STATUS.READY || !w.list || w.listMonth !== w.month) return head + '<p class="auth-lead" role="status" aria-busy="true">' + escapeHtml(SESSION_AUDIT_TEXT.loadingMonth) + '</p>';
  if(!w.list.length) return head + '<div class="empty" role="status">No audit events in ' + escapeHtml(sessionAuditMonthLabel(w.month)) + ' (WIB).</div>';
  return head + sessionAuditTableHTML(w.list, 'month');
}

function sessionAuditRecordHTML(w){
  const r = w.record;
  const head = '<h2 class="section-title" id="swauRecordTitle" tabindex="-1">History of ' + escapeHtml(sessionAuditRecordLabel(r.entity, r.entityId)) + '</h2>'
    + '<p class="hint">' + escapeHtml(SESSION_AUDIT_TEXT.recordLead) + '</p>';
  const back = '<div class="auth-actions"><button class="btn" type="button" id="swauBackBtn">Back to ' + escapeHtml(sessionAuditMonthLabel(w.month)) + '</button></div>';
  let body;
  if(w.historyStatus === SESSION_AUDIT_STATUS.ERROR && w.error && w.error.scope === 'record') body = sessionAuditErrorHTML(w.error);
  else if(w.historyStatus !== SESSION_AUDIT_STATUS.READY || !w.history) body = '<p class="auth-lead" role="status" aria-busy="true">' + escapeHtml(SESSION_AUDIT_TEXT.loadingRecord) + '</p>';
  else if(!w.history.length) body = '<div class="empty" role="status">' + escapeHtml(SESSION_AUDIT_TEXT.emptyRecord) + '</div>';
  else body = sessionAuditTableHTML(w.history, 'record');
  return head + body + back;
}

function sessionAuditDetailHTML(w){
  const e = w.selected.event;
  const fromRecord = w.selected.from === 'record';
  const rows = [
    ['Event id', e.id],
    ['Time (WIB)', auditJakartaTime(e.occurredAt)],
    ['Time (UTC, as stored)', e.occurredAt],
    ['Action', SESSION_AUDIT_ACTIONS[e.action] + ' (' + e.action + ')'],
    ['Operation', e.operation === null ? '—' : SESSION_AUDIT_OPERATIONS[e.operation] + ' (' + e.operation + ')'],
    ['Record type', SESSION_AUDIT_ENTITIES[e.entity] + ' (' + e.entity + ')'],
    ['Record id', e.entityId],
    ['Actor user id', e.actorUserId],
    ['Actor membership id', e.actorMembershipId],
    ['Target user id', e.targetUserId === null ? '—' : e.targetUserId],
    ['Request id', e.requestId],
    ['Fields changed', e.fields.length ? e.fields.join(', ') : 'None recorded']
  ];
  return '<h2 class="section-title" id="swauDetailTitle" tabindex="-1">' + escapeHtml(sessionAuditActionLabel(e)) + '</h2>'
    + '<div class="table-wrap"><table><tbody>' + rows.map(function(r){ return '<tr><th scope="row">' + escapeHtml(r[0]) + '</th><td>' + escapeHtml(r[1]) + '</td></tr>'; }).join('') + '</tbody></table></div>'
    + '<p class="hint">' + escapeHtml(SESSION_AUDIT_TEXT.fieldsNote) + '</p>'
    + '<div class="auth-actions"><button class="btn" type="button" id="swauBackBtn">' + (fromRecord ? 'Back to record history' : 'Back to ' + escapeHtml(sessionAuditMonthLabel(w.month))) + '</button>'
    + (fromRecord ? '' : '<button class="btn btn-accent" type="button" id="swauRecordBtn">Show record history</button>') + '</div>';
}

// The section title (the workspace heading) and body.
function renderSessionAuditTitle(w){
  if(w.selected) return 'Audit event';
  return w.record ? 'Record history' : 'Audit history';
}
function renderSessionAuditHTML(w){
  if(w.selected) return sessionAuditDetailHTML(w);
  return w.record ? sessionAuditRecordHTML(w) : sessionAuditMonthHTML(w);
}

function bindSessionAudit(app){
  const on = function(id, type, fn){ const el = app.querySelector('#' + id); if(el) el.addEventListener(type, fn); };
  on('swauPrevMonth', 'click', function(){ SessionAudit.shiftMonth(-1); });
  on('swauNextMonth', 'click', function(){ SessionAudit.shiftMonth(1); });
  on('swauMonth', 'change', function(){ SessionAudit.setMonth(this.value); });
  on('swauBackBtn', 'click', function(){ SessionAudit.back(); });
  on('swauRetryBtn', 'click', function(){ SessionAudit.retry(); });
  on('swauRecordBtn', 'click', function(){ SessionAudit.openRecord(); });
  // One listener for every row: the button's position in the list that was rendered.
  on('swauList', 'click', function(ev){
    const button = ev && ev.target && typeof ev.target.closest === 'function' ? ev.target.closest('[data-swau-open]') : null;
    if(!button) return;
    SessionAudit.openEvent(Number(button.getAttribute('data-swau-open')), this.getAttribute('data-swau-from'));
  });
}

// After a render: the element the section asked for, else null (the workspace decides).
function sessionAuditFocusTarget(app, hint){
  if(hint === 'section') return app.querySelector('#authTitle');
  if(hint === 'list') return app.querySelector('#swauListTitle');
  if(hint === 'record') return app.querySelector('#swauRecordTitle');
  if(hint === 'detail') return app.querySelector('#swauDetailTitle');
  if(hint === 'message') return app.querySelector('#swauMessage');
  return null;
}
