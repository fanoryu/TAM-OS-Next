/* ============================================================
   SESSION OVERTIME VIEW (AFI-4b1, AFI-4b2) — js/ui/session-overtime-view.js
   ------------------------------------------------------------
   The Overtime section of the authenticated SESSION workspace, rendered by
   sessionWorkspaceHTML() (js/ui/session-workspace-view.js) — its only caller — when the
   section is shown. It is NOT the LOCAL Overtime page (js/people/overtime.js) and never
   reaches it, the business shell, its navigation, Global Search or "Acting as":
   AuthBoot.allowsWorkspace() stays false.

     CEO       Overtime: the month bar (Previous, the month, Next), the company's records of
               that month (date, owner, hours, status), a record's detail, "Add overtime" for a
               live, Active Employee, and the actions the matrix offers for the record shown —
               Edit / Delete / Submit on a Draft, Review / Reject on a Submitted record, Approve /
               Reject on a Reviewed one (Approve against the valuation preview shown with it),
               nothing on an Approved one (its frozen valuation is shown) or a Rejected one.
     Employee  My overtime: the same, for their own records only — Edit / Delete / Submit on
               their own Draft; the frozen valuation of their own Approved record; never a
               preview, never Review, Reject or Approve.

   Data comes only from SessionOvertime / SessionOvertimeStore (js/core/session-overtime.js);
   nothing is written here but the DOM. A draft is handed to SessionOvertime.setDraft() as it
   is typed (memory only, no render). Every message is a fixed string; every server value and
   every draft value is escaped; hours are shown exactly as the server sent them. The opaque
   record and Employee ids never appear in the page: a row is opened by its position in the
   list that was rendered, and the CEO's owner choice by its position in the selector.

   VALUATION (AFI-4b2): shown only in a record's detail, in one block that says which it is —
   "Valuation preview — not yet approved" or "Approved valuation (frozen at approval)" — with the
   amount, the monthly salary basis, the overtime hours, the standard monthly hours and the
   method, each exactly the string the server sent (the SESSION money convention: "(Rp)" in the
   label, the exact value). Nothing is computed, rounded, converted or reformatted here; no hourly
   rate, multiplier or pay result is ever shown, and the month list never carries money.

   Classic shared global scope; existing CSS classes only.
   ============================================================ */

const SESSION_OVERTIME_MONTH_NAMES = Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
const SESSION_OVERTIME_ERRORS = Object.freeze({
  DENIED: 'You do not have access to this information.',
  NOT_FOUND: 'This overtime record was not found.',
  CONFLICT: 'TAM OS reported a conflict. Try again.',
  RATE_LIMITED: 'Too many requests.',
  VALIDATION: 'TAM OS could not process this request.',
  CLIENT_FAULT: 'TAM OS could not process this request.',
  SERVER_ERROR: 'Overtime information could not be loaded. Try again in a moment.',
  UNAVAILABLE: 'Overtime information could not be loaded. Check your connection, then try again.',
  INVALID_RESPONSE: 'TAM OS sent an unexpected response. Try again in a moment.'
});
// The form, in form order. Fixed names only; the owner is the CEO's create selector.
const SESSION_OVERTIME_FIELDS = Object.freeze([
  { name: 'employeeId', label: 'Employee', type: 'owner', required: true, error: 'Choose an active employee.' },
  { name: 'monthKey', label: 'Month', type: 'month', required: true, hint: 'The month the overtime belongs to (YYYY-MM).', error: 'Enter a month, from 1900 onwards, as YYYY-MM.' },
  { name: 'overtimeDate', label: 'Date', type: 'date', hint: 'Optional. It must fall inside the month.', error: 'Enter a real date inside the chosen month, or leave it empty.' },
  { name: 'hours', label: 'Hours', type: 'text', inputmode: 'decimal', required: true, hint: 'Quarter hours, for example 7.50, 2.25 or 1 (more than 0, at most 744).', error: 'Enter hours in quarter steps, more than 0 and at most 744 — for example 7.50.' },
  { name: 'workDescription', label: 'Work description', type: 'text', hint: 'Optional.', error: 'Use at most 160 characters, on one line.' },
  { name: 'notes', label: 'Notes', type: 'textarea', hint: 'Optional.', error: 'Use at most 2000 characters.' }
].map(Object.freeze));
const SESSION_OVERTIME_MUTATION_ERRORS = Object.freeze({
  VALIDATION: 'Some entries need attention. Check the marked fields.',
  VALIDATION_UNNAMED: 'TAM OS could not accept these entries. Check the form, then try again.',
  DENIED: 'You do not have permission to make this change.',
  NOT_FOUND: 'This overtime record is no longer available. The list was reloaded.',
  NOT_FOUND_CREATE: 'The employee for this record was not found. Check the employee, then try again.',
  RATE_LIMITED: 'Too many requests.',
  SERVER_ERROR: 'The change was not saved. Try again in a moment.',
  CLIENT_FAULT: 'TAM OS could not process this request.'
});
// The backend reports one generic conflict: the wording never claims which cause it was.
const SESSION_OVERTIME_CONFLICTS = Object.freeze({
  create: 'The overtime record could not be created because of a conflict. The employee may no longer be active.',
  update: 'This record changed or can no longer be edited. Reload the record, then review your changes before saving again.',
  delete: 'This record changed or can no longer be deleted. Reload the record to see what can be done now.',
  submit: 'This record changed or the action is no longer available. Reload the record to see what can be done now.',
  review: 'This record changed or the action is no longer available. Reload the record to see what can be done now.',
  reject: 'This record changed or the action is no longer available. Reload the record to see what can be done now.'
});
const SESSION_OVERTIME_NOTICES = Object.freeze({
  created: 'Overtime record created as a Draft.',
  saved: 'Overtime record saved.',
  deleted: 'Draft deleted.',
  submitted: 'Overtime record submitted.',
  reviewed: 'Overtime record marked as reviewed.',
  rejected: 'Overtime record rejected.',
  approved: 'Overtime record approved. Its valuation is now frozen.',
  unchanged: 'No changes to save.',
  reloaded: 'The record was read again from TAM OS. Your edits are kept; Save applies them to the latest version.'
});
const SESSION_OVERTIME_TARGETS = Object.freeze({ submit: 'Submitted', review: 'Reviewed', reject: 'Rejected', approve: 'Approved' });
const SESSION_OVERTIME_PANELS = Object.freeze({
  delete: { title: 'Delete this Draft?', text: 'The Draft is deleted permanently. This cannot be undone.', submit: 'Delete Draft', busy: 'Deleting…', danger: true },
  submit: { title: 'Submit this record?', text: 'It is sent for review and can no longer be edited or deleted.', submit: 'Submit', busy: 'Submitting…', danger: false },
  review: { title: 'Mark this record as reviewed?', text: 'A reviewed record can still be rejected later.', submit: 'Mark reviewed', busy: 'Working…', danger: false },
  reject: { title: 'Reject this record?', text: 'A rejected record is final: it cannot be edited, submitted or reviewed again.', submit: 'Reject', busy: 'Rejecting…', danger: true },
  approve: { title: 'Approve this overtime?', text: 'Approval freezes this valuation. An approved record is final: it cannot be edited, rejected or valued again.', submit: 'Approve', busy: 'Approving…', danger: false }
});
// AFI-4b2: the valuation block's fixed wording (BF-4b2 / D-BF4b-3: an internal TAM method).
const SESSION_OVERTIME_VALUATION_TEXT = Object.freeze({
  preview: 'Valuation preview — not yet approved',
  approved: 'Approved valuation (frozen at approval)',
  previewLead: 'Computed by TAM OS from the current monthly salary. It may change until the record is approved.',
  approvedLead: 'Frozen when the record was approved. Later salary changes do not alter it.',
  method: 'TAM-OT-1 — internal TAM overtime method (not a statutory calculation)',
  loading: 'Reading the valuation…',
  unvalued: 'This record cannot be valued now (the employee may be archived or have no salary).'
});
const SESSION_OVERTIME_ACTION_BUTTONS = Object.freeze({
  edit: { id: 'swoEditBtn', label: 'Edit', cls: 'btn' },
  delete: { id: 'swoDeleteBtn', label: 'Delete', cls: 'btn btn-danger' },
  submit: { id: 'swoSubmitBtn', label: 'Submit', cls: 'btn' },
  review: { id: 'swoReviewBtn', label: 'Review', cls: 'btn' },
  reject: { id: 'swoRejectBtn', label: 'Reject', cls: 'btn btn-danger' },
  approve: { id: 'swoApproveBtn', label: 'Approve', cls: 'btn btn-accent' }
});

function sessionOvertimeValue(v){
  return (v === null || v === undefined || v === '') ? '—' : escapeHtml(String(v));
}
function sessionOvertimeMonthLabel(key){
  return OvertimeCalendar.isMonth(key) ? SESSION_OVERTIME_MONTH_NAMES[+key.slice(5, 7) - 1] + ' ' + key.slice(0, 4) : '—';
}
function sessionOvertimeLabel(principal, w, employeeId){
  return sessionOvertimeOwnerLabel(principal, w.labelsStatus, w.people, employeeId);
}
function sessionOvertimeBusy(w){ return w.mutation.status === SESSION_OVERTIME_MUTATION_STATUS.PENDING; }

// The failure message, with the wait for a 429 and the server reference when known.
function sessionOvertimeErrorHTML(error, text){
  let msg = text || SESSION_OVERTIME_ERRORS[error.kind] || SESSION_OVERTIME_ERRORS.UNAVAILABLE;
  if(error.kind === 'RATE_LIMITED' && typeof authWaitText === 'function') msg += authWaitText(error.retryAfter);
  if(error.requestId) msg += ' Reference: ' + error.requestId + '.';
  return '<p class="auth-message auth-message-warn" role="alert">' + escapeHtml(msg) + '</p>';
}

// An unconfirmed write, reported by what the read that followed it shows (never as a success).
function sessionOvertimeAmbiguousText(w){
  const m = w.mutation;
  if(m.kind === 'create') return 'TAM OS could not confirm whether the record was created. The list below was read again from TAM OS — check it before adding the record again.';
  const reading = w.detailStatus === SESSION_OVERTIME_STATUS.LOADING || w.detailStatus === SESSION_OVERTIME_STATUS.IDLE;
  if(reading) return 'TAM OS could not confirm the change. The record is being read again…';
  const gone = w.detailStatus === SESSION_OVERTIME_STATUS.ERROR && w.error && w.error.scope === 'detail' && w.error.kind === 'NOT_FOUND';
  const d = w.detailStatus === SESSION_OVERTIME_STATUS.READY ? w.detail : null;
  // AFI-4b2: an unconfirmed approval, by what the record read again shows — never resent.
  if(m.kind === 'approve' && d && d.status === 'Approved'){
    const frozen = w.valuationStatus === SESSION_OVERTIME_STATUS.READY && w.valuation && w.valuation.kind === 'approved' ? ' Its frozen amount is Rp ' + w.valuation.amount + '.' : '';
    return 'TAM OS could not confirm the approval, but the record read again is now Approved.' + frozen;
  }
  if(m.kind === 'approve' && d && d.status === 'Reviewed') return 'TAM OS could not confirm the approval. The record read again is still Reviewed: it was not approved. Check the current amount, then approve again.';
  if(m.kind === 'delete'){
    if(gone) return 'TAM OS could not confirm the deletion. When the record was read again it no longer existed: the Draft is gone.';
    if(d && m.target && d.id === m.target.id && d.version === m.target.version && d.status === 'Draft') return 'TAM OS could not confirm the deletion. The record read again still exists unchanged: the Draft was not deleted, and you may try again.';
    if(d) return 'TAM OS could not confirm the deletion. The record read again has changed — check it before trying again.';
  } else if(SESSION_OVERTIME_TARGETS[m.kind]){
    if(d && d.status === SESSION_OVERTIME_TARGETS[m.kind]) return 'TAM OS could not confirm the change, but the record read again is now ' + SESSION_OVERTIME_TARGETS[m.kind] + '.';
    if(d) return 'TAM OS could not confirm the change. The record read again is ' + d.status + ', not ' + SESSION_OVERTIME_TARGETS[m.kind] + ' — check it before trying again.';
  } else if(d){
    return 'TAM OS could not confirm the change. The record was read again from TAM OS — check it before saving again.';
  }
  if(gone) return 'TAM OS could not confirm the change. When the record was read again it was not found.';
  return 'TAM OS could not confirm the change, and the record could not be read again. Use Retry to read it.';
}

// AFI-4b2 (D-AFI4b2-1): a refused approval (409 — the server names no cause), explained by the
// record and the fresh preview read after it. Amounts are compared as the exact strings sent.
function sessionOvertimeApproveConflictText(w){
  const sent = w.mutation.target ? w.mutation.target.amount : null;
  if(w.detailStatus === SESSION_OVERTIME_STATUS.LOADING || w.detailStatus === SESSION_OVERTIME_STATUS.IDLE) return 'TAM OS did not approve the record: it or its amount changed. The record is being read again…';
  if(w.detailStatus === SESSION_OVERTIME_STATUS.ERROR) return (w.error && w.error.kind === 'NOT_FOUND') ? 'TAM OS did not approve the record. When it was read again it was not found.' : 'TAM OS did not approve the record, and it could not be read again. Use Retry to read it.';
  const d = w.detail;
  if(!d || d.status !== 'Reviewed') return 'The record changed: it is now ' + (d ? d.status : 'unknown') + ' and can no longer be approved.';
  if(w.valuationStatus === SESSION_OVERTIME_STATUS.ERROR) return (w.valuationError && w.valuationError.kind === 'CONFLICT') ? SESSION_OVERTIME_VALUATION_TEXT.unvalued : 'TAM OS did not approve the record, and its current amount could not be read. Use Retry to read it.';
  if(!sessionOvertimePreviewMatches(d, w.valuationStatus, w.valuation)) return 'TAM OS did not approve the record: it or its amount changed. The current amount is being read again…';
  if(w.valuation.amount !== sent) return 'The amount changed from Rp ' + sent + ' to Rp ' + w.valuation.amount + '. Check it, then approve again.';
  return 'The record changed. Check it, then approve again.';
}

// The one message about the write (or a notice), shown where that write is.
function sessionOvertimeMutationHTML(w){
  const m = w.mutation;
  let text = null, warn = true;
  if(m.status === SESSION_OVERTIME_MUTATION_STATUS.AMBIGUOUS) text = sessionOvertimeAmbiguousText(w);
  else if(m.status === SESSION_OVERTIME_MUTATION_STATUS.ERROR && m.error){
    const k = m.error.kind;
    if(k === 'CONFLICT' && m.kind === 'approve') text = sessionOvertimeApproveConflictText(w);
    else if(k === 'CONFLICT') text = SESSION_OVERTIME_CONFLICTS[m.kind];
    else if(k === 'VALIDATION') text = (m.fields || []).some((f) => SESSION_OVERTIME_FORM_FIELDS.indexOf(f) !== -1) ? SESSION_OVERTIME_MUTATION_ERRORS.VALIDATION : SESSION_OVERTIME_MUTATION_ERRORS.VALIDATION_UNNAMED;
    else if(k === 'NOT_FOUND' && m.kind === 'create') text = SESSION_OVERTIME_MUTATION_ERRORS.NOT_FOUND_CREATE;
    else text = SESSION_OVERTIME_MUTATION_ERRORS[k] || SESSION_OVERTIME_MUTATION_ERRORS.CLIENT_FAULT;
    if(k === 'RATE_LIMITED' && typeof authWaitText === 'function') text += authWaitText(m.error.retryAfter);
  } else if(m.status === SESSION_OVERTIME_MUTATION_STATUS.IDLE && w.notice && SESSION_OVERTIME_NOTICES[w.notice]){
    text = SESSION_OVERTIME_NOTICES[w.notice]; warn = false;
  }
  if(!text) return '';
  if(warn && m.error && m.error.requestId) text += ' Reference: ' + m.error.requestId + '.';
  return '<p class="auth-message' + (warn ? ' auth-message-warn' : '') + '" id="swoMutationMessage" role="' + (warn ? 'alert' : 'status') + '" tabindex="-1">' + escapeHtml(text) + '</p>';
}

// The first and last day of a month, for the date field's range ('' when the month is not valid).
function sessionOvertimeDateRange(monthKey){
  if(!OvertimeCalendar.isMonth(monthKey)) return null;
  return { min: monthKey + '-01', max: monthKey + '-' + String(OvertimeCalendar.daysIn(monthKey)).padStart(2, '0') };
}

function sessionOvertimeFieldHTML(def, w, principal, invalid, disabled){
  const f = w.form;
  const id = 'swo-' + def.name;
  const value = f.values[def.name];
  const hintId = def.hint ? id + '-hint' : '';
  const errorId = invalid ? id + '-error' : '';
  const described = [hintId, errorId].filter(Boolean).join(' ');
  const attrs = ' id="' + id + '" name="' + def.name + '"' + (def.required ? ' required aria-required="true"' : '')
    + (invalid ? ' aria-invalid="true"' : '') + (described ? ' aria-describedby="' + described + '"' : '');
  let control;
  if(def.type === 'owner'){
    // CEO create: live, Active Employees only, by position — never the opaque id in the page.
    const eligible = sessionOvertimeEligible(w.people);
    const loading = w.labelsStatus !== SESSION_OVERTIME_STATUS.READY;
    control = '<select class="input"' + attrs + (disabled || loading ? ' disabled' : '') + '>'
      + '<option value=""' + (value === '' ? ' selected' : '') + '>' + (w.labelsStatus === SESSION_OVERTIME_STATUS.ERROR ? 'Employees could not be loaded' : (loading ? 'Loading…' : 'Choose an employee')) + '</option>'
      + eligible.map(function(e, i){
        return '<option value="' + i + '"' + (e.id === value ? ' selected' : '') + '>' + escapeHtml(e.fullName + ' (' + e.employeeCode + ')') + '</option>';
      }).join('') + '</select>';
  } else if(def.type === 'textarea'){
    control = '<textarea class="input" rows="4"' + attrs + (disabled ? ' disabled' : '') + '>' + escapeHtml(value) + '</textarea>';
  } else {
    const range = def.type === 'date' ? sessionOvertimeDateRange(f.values.monthKey) : null;
    control = '<input class="input" type="' + def.type + '"' + (def.inputmode ? ' inputmode="' + def.inputmode + '"' : '') + ' autocomplete="off"' + attrs
      + (range ? ' min="' + range.min + '" max="' + range.max + '"' : '') + (disabled ? ' disabled' : '') + ' value="' + escapeHtml(value) + '">';
  }
  return '<div class="field"><label for="' + id + '">' + escapeHtml(def.label) + (def.required ? ' <span aria-hidden="true">*</span>' : '') + '</label>' + control
    + (def.hint ? '<p class="hint" id="' + hintId + '">' + escapeHtml(def.hint) + '</p>' : '')
    + (invalid ? '<p class="hint auth-message-warn" id="' + errorId + '">' + escapeHtml(def.error) + '</p>' : '') + '</div>';
}

// The inline create / edit form card. Edit holds back Save until the record it saves against is
// loaded and still a Draft the principal may edit.
function sessionOvertimeFormHTML(principal, w){
  const f = w.form;
  const busy = sessionOvertimeBusy(w);
  const dis = busy ? ' disabled' : '';
  const invalid = (w.mutation.status === SESSION_OVERTIME_MUTATION_STATUS.ERROR && w.mutation.fields) ? w.mutation.fields : [];
  const edit = f.mode === 'edit';
  const ceoCreate = !edit && !!principal && principal.principalType === PRINCIPAL_TYPES.CEO;
  let state = '', canSave = !busy, reload = false;
  if(edit){
    if(w.detailStatus === SESSION_OVERTIME_STATUS.ERROR && w.error && w.error.scope === 'detail'){ state = sessionOvertimeErrorHTML(w.error); canSave = false; reload = w.error.kind !== 'NOT_FOUND' && w.error.kind !== 'DENIED'; }
    else if(w.detailStatus !== SESSION_OVERTIME_STATUS.READY || !w.detail){ state = '<p class="auth-lead" role="status">Reading the record again…</p>'; canSave = false; }
    else if(sessionOvertimeActions(principal, w.detail).indexOf('edit') === -1){ state = '<p class="auth-message auth-message-warn" role="alert">This record is no longer a Draft and can no longer be edited.</p>'; canSave = false; }
    if(w.mutation.status === SESSION_OVERTIME_MUTATION_STATUS.ERROR && w.mutation.error && w.mutation.error.kind === 'CONFLICT') reload = true;
  } else if(ceoCreate && w.labelsStatus === SESSION_OVERTIME_STATUS.ERROR){
    state = '<p class="auth-message auth-message-warn" role="alert">The employee list could not be loaded, so no employee can be chosen.</p>'
      + '<div class="auth-actions"><button class="btn" type="button" id="swoLabelsRetryBtn"' + dis + '>Retry employee list</button></div>';
  }
  const owner = edit ? '<p class="auth-lead">Employee: <strong>' + escapeHtml(sessionOvertimeLabel(principal, w, w.detail ? w.detail.employeeId : null)) + '</strong></p>' : '';
  const defs = SESSION_OVERTIME_FIELDS.filter((def) => def.name !== 'employeeId' || ceoCreate);
  return '<section class="card" aria-labelledby="swoFormTitle"><h2 class="section-title" id="swoFormTitle" tabindex="-1">' + (edit ? 'Edit overtime' : 'Add overtime') + '</h2>'
    + '<form id="swoForm" method="post" novalidate' + (busy ? ' aria-busy="true"' : '') + '>'
    + '<p class="hint">Fields marked * are required. A new record starts as a Draft.</p>' + owner
    + '<div class="form-grid">' + defs.map(function(def){
      return sessionOvertimeFieldHTML(def, w, principal, invalid.indexOf(def.name) !== -1, busy);
    }).join('') + '</div>'
    + state + sessionOvertimeMutationHTML(w)
    + '<div class="auth-actions"><button class="btn" type="button" id="swoFormCancel"' + dis + '>Cancel</button>'
    + (reload ? '<button class="btn" type="button" id="swoReloadBtn"' + dis + '>Reload record</button>' : '')
    + '<button class="btn btn-accent" type="submit" id="swoFormSave"' + (canSave ? '' : ' disabled') + (busy ? ' aria-busy="true"' : '') + '>' + (busy ? 'Saving…' : 'Save') + '</button></div>'
    + '</form></section>';
}

// The open action panel: the record named by owner, month and hours, Cancel and the action.
function sessionOvertimePanelHTML(principal, w){
  const d = w.detail;
  const panel = SESSION_OVERTIME_PANELS[w.panel.kind];
  const busy = sessionOvertimeBusy(w);
  const dis = busy ? ' disabled' : '';
  const conflict = w.mutation.status === SESSION_OVERTIME_MUTATION_STATUS.ERROR && w.mutation.error && w.mutation.error.kind === 'CONFLICT';
  const what = sessionOvertimeLabel(principal, w, d.employeeId) + ' — ' + sessionOvertimeMonthLabel(d.monthKey) + (d.overtimeDate ? ', ' + d.overtimeDate : '') + ' — ' + d.hours + ' hours (' + d.status + ').';
  // AFI-4b2: the approval repeats the exact amount of the preview it is sent against.
  const amount = (w.panel.kind === 'approve' && w.valuation) ? '<p class="auth-lead">Amount to approve (Rp): <strong>' + escapeHtml(w.valuation.amount) + '</strong></p>' : '';
  return '<section class="card" aria-labelledby="swoPanelTitle"' + (busy ? ' aria-busy="true"' : '') + '>'
    + '<h2 class="section-title" id="swoPanelTitle" tabindex="-1">' + escapeHtml(panel.title) + '</h2>'
    + '<p class="auth-lead">' + escapeHtml(what) + ' ' + escapeHtml(panel.text) + '</p>' + amount
    + sessionOvertimeMutationHTML(w)
    + '<div class="auth-actions"><button class="btn" type="button" id="swoPanelCancel"' + dis + '>Cancel</button>'
    + (conflict ? '<button class="btn" type="button" id="swoReloadBtn"' + dis + '>Reload record</button>' : '')
    + '<button class="btn ' + (panel.danger ? 'btn-danger' : 'btn-accent') + '" type="button" id="swoPanelConfirm"' + dis + (busy ? ' aria-busy="true"' : '') + '>'
    + escapeHtml(busy ? panel.busy : panel.submit) + '</button></div></section>';
}

function sessionOvertimeMonthBarHTML(w, dis){
  return '<div class="auth-actions" role="group" aria-label="Month">'
    + '<button class="btn" type="button" id="swoPrevMonth"' + dis + '>Previous month</button>'
    + '<label for="swoMonth">Month</label><input class="input" type="month" id="swoMonth" name="month" autocomplete="off"' + dis + ' value="' + escapeHtml(w.month || '') + '">'
    + '<button class="btn" type="button" id="swoNextMonth"' + dis + '>Next month</button></div>';
}

function sessionOvertimeListHTML(principal, w){
  const busy = sessionOvertimeBusy(w);
  const dis = busy ? ' disabled' : '';
  const head = (w.form ? sessionOvertimeFormHTML(principal, w)
      : '<div class="auth-actions"><button class="btn btn-accent" type="button" id="swoAddBtn"' + dis + '>Add overtime</button></div>' + sessionOvertimeMutationHTML(w))
    + (w.form ? '' : sessionOvertimeMonthBarHTML(w, dis))
    + '<h2 class="section-title">' + escapeHtml(sessionOvertimeMonthLabel(w.month)) + '</h2>';
  const labels = (principal.principalType === PRINCIPAL_TYPES.CEO && w.labelsStatus === SESSION_OVERTIME_STATUS.ERROR && !w.form)
    ? '<p class="auth-message auth-message-warn" role="alert">Employee names could not be loaded; records show "Unknown employee".</p>'
      + '<div class="auth-actions"><button class="btn" type="button" id="swoLabelsRetryBtn"' + dis + '>Retry employee names</button></div>' : '';
  if(w.listStatus === SESSION_OVERTIME_STATUS.ERROR && w.error && w.error.scope === 'list'){
    const retry = w.error.kind === 'DENIED' ? '' : '<div class="auth-actions"><button class="btn btn-accent" type="button" id="swoRetryBtn"' + dis + '>Retry</button></div>';
    return head + sessionOvertimeErrorHTML(w.error) + retry;
  }
  if(w.listStatus !== SESSION_OVERTIME_STATUS.READY || !w.list || w.listMonth !== w.month) return head + '<p class="auth-lead" role="status" aria-busy="true">Loading overtime records…</p>';
  if(!w.list.length) return head + labels + '<div class="empty">No overtime records for ' + escapeHtml(sessionOvertimeMonthLabel(w.month)) + '.</div>';
  const rows = w.list.map(function(r, i){
    return '<tr><td>' + sessionOvertimeValue(r.overtimeDate) + '</td><td>' + escapeHtml(sessionOvertimeLabel(principal, w, r.employeeId)) + '</td>'
      + '<td>' + escapeHtml(r.hours) + '</td><td>' + escapeHtml(r.status) + '</td>'
      + '<td><button class="btn" type="button" id="swoOpen' + i + '"' + dis + '>View</button></td></tr>';
  }).join('');
  return head + labels + '<div class="table-wrap"><table><thead><tr><th scope="col">Date</th><th scope="col">Employee</th><th scope="col">Hours</th>'
    + '<th scope="col">Status</th><th scope="col" aria-label="Open record"></th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table></div>';
}

// AFI-4b2: the valuation block of the detail shown, when this principal reads one — the CEO's
// preview of a Reviewed record, the frozen valuation of an Approved one. Exact strings only.
function sessionOvertimeValuationHTML(principal, w){
  const d = w.detail;
  if(!sessionOvertimeValuationWanted(principal, d)) return '';
  const approved = d.status === 'Approved';
  const T = SESSION_OVERTIME_VALUATION_TEXT;
  const dis = sessionOvertimeBusy(w) ? ' disabled' : '';
  let body;
  if(w.valuationStatus === SESSION_OVERTIME_STATUS.ERROR && w.valuationError){
    const unvalued = !approved && w.valuationError.kind === 'CONFLICT';
    const retry = (unvalued || w.valuationError.kind === 'DENIED' || w.valuationError.kind === 'NOT_FOUND') ? '' : '<div class="auth-actions"><button class="btn" type="button" id="swoValuationRetryBtn"' + dis + '>Retry valuation</button></div>';
    body = (unvalued ? '<p class="auth-message auth-message-warn" role="alert">' + escapeHtml(T.unvalued) + '</p>' : sessionOvertimeErrorHTML(w.valuationError)) + retry;
  } else if(w.valuationStatus !== SESSION_OVERTIME_STATUS.READY || !w.valuation || w.valuation.id !== d.id){
    body = '<p class="auth-lead" role="status" aria-busy="true">' + escapeHtml(T.loading) + '</p>';
  } else {
    const v = w.valuation;
    const rows = [['Amount (Rp)', v.amount], ['Monthly salary basis (Rp)', v.monthlySalaryBasis], ['Overtime hours', v.hours],
      ['Standard monthly hours', v.standardMonthlyHours], ['Method', v.method === OVERTIME_VALUATION_METHOD ? T.method : null]];
    body = '<p class="hint">' + escapeHtml(approved ? T.approvedLead : T.previewLead) + '</p>'
      + '<div class="table-wrap"><table><tbody>' + rows.map(function(r){ return '<tr><th scope="row">' + escapeHtml(r[0]) + '</th><td>' + sessionOvertimeValue(r[1]) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  return '<section class="card" id="swoValuation" aria-labelledby="swoValuationTitle"><h2 class="section-title" id="swoValuationTitle">' + escapeHtml(approved ? T.approved : T.preview) + '</h2>' + body + '</section>';
}

function sessionOvertimeDetailHTML(principal, w){
  if(w.form) return sessionOvertimeFormHTML(principal, w);
  const busy = sessionOvertimeBusy(w);
  const dis = busy ? ' disabled' : '';
  const back = '<div class="auth-actions"><button class="btn" type="button" id="swoBackBtn"' + dis + '>Back to list</button>';
  if(w.detailStatus === SESSION_OVERTIME_STATUS.ERROR && w.error && w.error.scope === 'detail'){
    const retry = (w.error.kind === 'DENIED' || w.error.kind === 'NOT_FOUND') ? '' : '<button class="btn btn-accent" type="button" id="swoRetryBtn"' + dis + '>Retry</button>';
    return sessionOvertimeMutationHTML(w) + sessionOvertimeErrorHTML(w.error) + back + retry + '</div>';
  }
  if(w.detailStatus !== SESSION_OVERTIME_STATUS.READY || !w.detail) return sessionOvertimeMutationHTML(w) + '<p class="auth-lead" role="status" aria-busy="true">Loading the record…</p>' + back + '</div>';
  const d = w.detail;
  // Only the actions the matrix offers for this record and principal; the panel replaces them.
  // Approve waits for a ready preview of this very record (AFI-4b2).
  const actions = w.panel ? '' : sessionOvertimeActions(principal, d).map(function(k){
    const off = busy || (k === 'approve' && !sessionOvertimePreviewMatches(d, w.valuationStatus, w.valuation));
    return '<button class="' + SESSION_OVERTIME_ACTION_BUTTONS[k].cls + '" type="button" id="' + SESSION_OVERTIME_ACTION_BUTTONS[k].id + '"' + (off ? ' disabled' : '') + '>' + escapeHtml(SESSION_OVERTIME_ACTION_BUTTONS[k].label) + '</button>';
  }).join('');
  const rows = [
    ['Employee', sessionOvertimeLabel(principal, w, d.employeeId)], ['Month', sessionOvertimeMonthLabel(d.monthKey)], ['Date', d.overtimeDate],
    ['Hours', d.hours], ['Work description', d.workDescription], ['Notes', d.notes], ['Status', d.status]
  ];
  return '<h2 class="section-title">' + escapeHtml(sessionOvertimeMonthLabel(d.monthKey)) + ' — ' + escapeHtml(d.hours) + ' hours</h2>'
    + (w.panel ? '' : sessionOvertimeMutationHTML(w))
    + '<div class="table-wrap"><table><tbody>' + rows.map(function(r){ return '<tr><th scope="row">' + escapeHtml(r[0]) + '</th><td>' + sessionOvertimeValue(r[1]) + '</td></tr>'; }).join('') + '</tbody></table></div>'
    + sessionOvertimeValuationHTML(principal, w)
    + back + actions + '</div>'
    + (w.panel && w.panel.id === d.id ? sessionOvertimePanelHTML(principal, w) : '');
}

// The section title (the workspace heading) and body.
function renderSessionOvertimeTitle(principal, w){
  const employee = !!principal && principal.principalType === PRINCIPAL_TYPES.EMPLOYEE;
  if(w.detailId) return w.form ? 'Edit overtime' : 'Overtime record';
  return employee ? 'My overtime' : 'Overtime';
}
function renderSessionOvertimeHTML(principal, w){
  return w.detailId ? sessionOvertimeDetailHTML(principal, w) : sessionOvertimeListHTML(principal, w);
}

function bindSessionOvertime(app){
  const on = function(id, type, fn){ const el = app.querySelector('#' + id); if(el) el.addEventListener(type, fn); };
  const click = function(id, fn){ on(id, 'click', fn); };
  click('swoAddBtn', function(){ SessionOvertime.openCreate(); });
  click('swoPrevMonth', function(){ SessionOvertime.shiftMonth(-1); });
  click('swoNextMonth', function(){ SessionOvertime.shiftMonth(1); });
  on('swoMonth', 'change', function(){ SessionOvertime.setMonth(this.value); });
  click('swoBackBtn', function(){ SessionOvertime.back(); });
  click('swoRetryBtn', function(){ SessionOvertime.retry(); });
  click('swoLabelsRetryBtn', function(){ SessionOvertime.retryLabels(); });
  click('swoReloadBtn', function(){ SessionOvertime.reloadRecord(); });
  click('swoEditBtn', function(){ SessionOvertime.openEdit(); });
  ['delete', 'submit', 'review', 'reject', 'approve'].forEach(function(k){ click(SESSION_OVERTIME_ACTION_BUTTONS[k].id, function(){ SessionOvertime.openPanel(k); }); });
  click('swoValuationRetryBtn', function(){ SessionOvertime.retryValuation(); });
  click('swoPanelCancel', function(){ SessionOvertime.cancelPanel(); });
  click('swoPanelConfirm', function(){ SessionOvertime.confirmPanel(); });
  click('swoFormCancel', function(){ SessionOvertime.cancelForm(); });
  const w = SessionOvertimeStore.snapshot();
  (w.list || []).forEach(function(row, i){ click('swoOpen' + i, function(){ SessionOvertime.openDetail(row.id); }); });
  // The draft follows the fields as they change; Save hands the last values over first. The
  // owner is chosen by position in the selector that was rendered.
  const form = app.querySelector('#swoForm');
  if(form){
    const eligible = sessionOvertimeEligible(w.people);
    const keep = function(el, name){
      if(name !== 'employeeId') return SessionOvertime.setDraft(name, el.value);
      const e = el.value === '' ? null : eligible[Number(el.value)];
      SessionOvertime.setDraft('employeeId', e ? e.id : '');
    };
    SESSION_OVERTIME_FIELDS.forEach(function(def){
      const el = form.querySelector('#swo-' + def.name);
      if(!el) return;
      el.addEventListener('input', function(){ if(def.name !== 'monthKey') keep(this, def.name); });
      el.addEventListener('change', function(){ keep(this, def.name); });
    });
    form.addEventListener('submit', function(e){
      e.preventDefault();
      SESSION_OVERTIME_FIELDS.forEach(function(def){
        const el = form.querySelector('#swo-' + def.name);
        if(el) keep(el, def.name);
      });
      SessionOvertime.submitForm();
    });
  }
}

// After a render: the element the section asked for, else null (the workspace decides).
function sessionOvertimeFocusTarget(app, hint){
  if(hint && hint.indexOf('field:') === 0 && SESSION_OVERTIME_FORM_FIELDS.indexOf(hint.slice(6)) !== -1) return app.querySelector('#swo-' + hint.slice(6));
  if(hint === 'message') return app.querySelector('#swoMutationMessage');
  if(hint === 'panel') return app.querySelector('#swoPanelTitle');
  if(hint === 'form') return app.querySelector('#swoFormTitle');
  if(hint === 'section') return app.querySelector('#authTitle');
  return null;
}
