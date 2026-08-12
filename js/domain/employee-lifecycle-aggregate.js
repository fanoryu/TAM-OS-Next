/* ============================================================
   DOMAIN LAYER — EMPLOYEE LIFECYCLE AGGREGATE (PR-5G "The Gatekeeper")
   ------------------------------------------------------------
   The THIRD aggregate boundary. It is the BUSINESS AUTHORITY for the
   employee.lifecycle.transition command: it decides whether a requested
   lifecycle transition is legal from the Employee's current state. It is
   pure and has NO side effects.

   Lifecycle is a narrow state machine over the existing `employmentStatus`
   field — NOT a new stored state and NOT a workflow engine. Only these
   transitions are supported:

     Active     → Resigned
     Active     → Terminated
     Resigned   → Active
     Terminated → Active

   Every other transition is rejected. The transition map below is the single
   source of truth for the rule; the handler (transitionEmployeeLifecycle)
   consults the same map for its defense-in-depth check.

   Contract (enforced by the verifier):
     - MUST NOT mutate State, mutate an Employee, call persistEmployees(),
       append history, update updatedAt, render UI, access localStorage, or
       perform audit logging.
     - MAY only READ (existence via empById) and RETURN a typed decision.

   transition(id, transition) returns:
     { ok: true,  transition: { from, to } }   // sanitized, legal transition
     { ok: false, error: 'EmployeeNotFound' | 'InvalidLifecycleState'
                       | 'IllegalLifecycleTransition' }
   ============================================================ */

// The lifecycle sub-states (a subset of EMPLOYMENT_STATUSES) and the legal
// transitions between them. Single source of truth for the lifecycle rule.
const EMPLOYEE_LIFECYCLE_STATES = ['Active', 'Resigned', 'Terminated'];
const EMPLOYEE_LIFECYCLE_TRANSITIONS = Object.freeze({
  'Active':     ['Resigned', 'Terminated'],
  'Resigned':   ['Active'],
  'Terminated': ['Active']
});

const EmployeeLifecycleAggregate = Object.freeze({
  transition: function (id, transition) {
    // 1. Employee existence (read-only; never mutates State). PR-5F: shared helper.
    var e = employeeExists(id);
    if (!e) return { ok: false, error: 'EmployeeNotFound' };

    // 2. The requested target must be a recognized lifecycle state.
    var to = (transition == null ? '' : String(transition)).trim();
    if (EMPLOYEE_LIFECYCLE_STATES.indexOf(to) === -1) return { ok: false, error: 'InvalidLifecycleState' };

    // 3. The transition must be legal from the Employee's CURRENT state.
    var from = e.employmentStatus;
    var allowed = EMPLOYEE_LIFECYCLE_TRANSITIONS[from] || [];
    if (allowed.indexOf(to) === -1) return { ok: false, error: 'IllegalLifecycleTransition' };

    // 4. Return the sanitized, legal transition only. No mutation performed.
    return { ok: true, transition: { from: from, to: to } };
  }
});

// Expose on the global object so the Domain facade can resolve this aggregate by
// name (top-level `const` objects are not attached to `window`, unlike function
// declarations). No eval; classic shared global scope.
if (typeof window !== 'undefined') { window.EmployeeLifecycleAggregate = EmployeeLifecycleAggregate; }
