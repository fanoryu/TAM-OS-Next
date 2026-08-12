/* ============================================================
   DOMAIN LAYER — BUSINESS EVENTS (Enterprise Foundation, PR-5)
   ------------------------------------------------------------
   Additive, behavior-neutral catalogue of business events (Contract
   PR-5.3 §3). Events are immutable past-tense facts emitted on a
   successful command; today they are recorded through the existing
   append-only audit trail. This map documents the correspondence
   between a domain event and the audit `type` already written by the
   existing instrumentation — it introduces no new event bus.
   ============================================================ */

// Domain event -> existing audit `type` string (see AUDIT_TYPE_LABELS in
// js/ui/activity-log.js). One-way documentation map; not invoked at load.
const DOMAIN_EVENTS = Object.freeze({
  PayrollGenerated:        'payroll.generate',
  PayrollReviewed:         'payroll.review',
  PayrollApproved:         'payroll.approve',
  PayrollCommitted:        'payroll.post',
  OvertimeApproved:        'overtime.approved',
  OvertimeCommitted:       'overtime.committed-to-payroll',
  TransactionExecuted:     'finance.execute',
  SupplementalReviewed:    'supplemental.review',
  SupplementalApproved:    'supplemental.approve',
  SupplementalPosted:      'supplemental.post',
  SupplementalExecuted:    'supplemental.execute',
  SupplementalCancelled:   'supplemental.cancel',
  ImportCommitted:         'import.commit',
  ImportUndone:            'import.undo'
});
