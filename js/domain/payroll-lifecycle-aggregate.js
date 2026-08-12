/* ============================================================
   DOMAIN LAYER — PAYROLL LIFECYCLE AGGREGATE (PR-5J "The Accountant")
   ------------------------------------------------------------
   The SIXTH aggregate boundary and the FIRST Payroll boundary. It is the
   BUSINESS AUTHORITY for the payroll.lifecycle.transition command: it decides
   whether a requested PRE-POSTING PayrollPlan lifecycle transition is legal
   from the plan's current stored status. It is pure and has NO side effects.

   AUTHORITATIVE LIFECYCLE MODEL (COD-002 Payroll Domain Discovery + ATR-001):
   The stored PayrollPlan statuses are Draft / Reviewed / Ready / Committed /
   Cancelled (core: PAYROLL_STATUSES). The operational stages (Draft → Review →
   Approved → Posted → Executed) are a DISPLAY mapping; Executed is derived from
   the linked finance transaction. This aggregate controls only the STORED
   status and only the PRE-POSTING transitions. Posting to Finance (→ Committed)
   is an explicit, separate action and is intentionally OUT of scope here.

   TRANSITION GRAPH — derived from existing runtime behavior, never invented:
     - Worksheet single-record menu (payrollWorksheetRowHTML → prow-* →
       setPayrollStatus): Review offered on Draft; Approve on Draft/Review;
       Return-to-Draft on Review/Approved; Cancel on any non-posted row.
     - Bulk actions (PAYROLL_BULK_ACTIONS): Review (Draft), Approve (Draft/Review).
     - Guards (setPayrollStatus): a locked period blocks every change; a
       Committed plan cannot leave Committed ("use the adjustment workflow").
   In stored-status terms this yields exactly:
     Draft     → Reviewed | Ready | Cancelled
     Reviewed  → Ready | Draft | Cancelled
     Ready     → Draft | Cancelled
     Committed → (immutable — pre-posting lifecycle is terminal here)
     Cancelled → (terminal)

   Contract (enforced by the verifier):
     - MUST NOT mutate State, mutate a PayrollPlan/Transaction/Overtime/
       MonthlyPlan, call persistPayrollPlans()/persist*(), append history,
       update updatedAt, render UI, toast, access localStorage, audit, or
       invoke posting/generation/override/import/supplemental handlers.
     - MAY only READ (existence via payrollPlanById, the period lock via
       isPayrollLocked) and RETURN a typed decision.

   transition(id, transition) returns:
     { ok: true,  transition: { from, to } }   // sanitized, legal transition
     { ok: false, error: 'PayrollPlanNotFound' | 'InvalidPayrollLifecycleState'
                       | 'PayrollPeriodLocked' | 'PayrollCommittedImmutable'
                       | 'IllegalPayrollLifecycleTransition' }
   ============================================================ */

// The legal PRE-POSTING transitions between stored PayrollPlan statuses.
// Single source of truth for the rule; the handler (transitionPayrollLifecycle)
// consults the same map for its defense-in-depth check. Committed and Cancelled
// are terminal for this command (posting to Finance is a separate action).
const PAYROLL_LIFECYCLE_TRANSITIONS = Object.freeze({
  'Draft':     ['Reviewed', 'Ready', 'Cancelled'],
  'Reviewed':  ['Ready', 'Draft', 'Cancelled'],
  'Ready':     ['Draft', 'Cancelled'],
  'Committed': [],
  'Cancelled': []
});

const PayrollLifecycleAggregate = Object.freeze({
  transition: function (id, transition) {
    // 1. PayrollPlan existence (read-only; never mutates State).
    var pp = (typeof payrollPlanById === 'function') ? payrollPlanById(id) : null;
    if (!pp) return { ok: false, error: 'PayrollPlanNotFound' };

    // Known stored statuses come from the single source of truth (core).
    var STATES = (typeof PAYROLL_STATUSES !== 'undefined') ? PAYROLL_STATUSES
      : ['Draft', 'Reviewed', 'Ready', 'Committed', 'Cancelled'];

    // 2. The plan's CURRENT stored status must be a recognized status.
    var from = pp.status;
    if (STATES.indexOf(from) === -1) return { ok: false, error: 'InvalidPayrollLifecycleState' };

    // 3. The requested target must be a recognized stored status.
    var to = (transition == null ? '' : String(transition)).trim();
    if (STATES.indexOf(to) === -1) return { ok: false, error: 'InvalidPayrollLifecycleState' };

    // 4. The Payroll period lock blocks every lifecycle change (mirrors setPayrollStatus).
    if (typeof isPayrollLocked === 'function' && isPayrollLocked(pp.monthKey)) {
      return { ok: false, error: 'PayrollPeriodLocked' };
    }

    // 5. Committed payroll is immutable — it cannot be returned to a pre-posting
    //    state. Existing runtime distinguishes this from a generic illegal
    //    transition (a dedicated guard + message), so it gets its own typed failure.
    if (from === 'Committed' && to !== 'Committed') {
      return { ok: false, error: 'PayrollCommittedImmutable' };
    }

    // 6. The transition must be legal from the CURRENT status.
    var allowed = PAYROLL_LIFECYCLE_TRANSITIONS[from] || [];
    if (allowed.indexOf(to) === -1) return { ok: false, error: 'IllegalPayrollLifecycleTransition' };

    // 7. Return the sanitized, legal transition only. No mutation performed.
    return { ok: true, transition: { from: from, to: to } };
  }
});

// Expose on the global object so the Domain facade can resolve this aggregate by
// name (top-level `const` objects are not attached to `window`, unlike function
// declarations). No eval; classic shared global scope.
if (typeof window !== 'undefined') { window.PayrollLifecycleAggregate = PayrollLifecycleAggregate; }
