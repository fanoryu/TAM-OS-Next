/* ============================================================
   DOMAIN LAYER — EMPLOYEE COMPENSATION AGGREGATE (PR-5H "The Arbiter")
   ------------------------------------------------------------
   The FOURTH aggregate boundary. It is the BUSINESS AUTHORITY for the
   employee.compensation.update command: it decides whether a controlled
   update of the Employee's monthly base salary may proceed and what the
   sanitized value is. It is pure and has NO side effects.

   Scope is intentionally narrow: monthlyBaseSalary only. No allowances,
   bonuses, deductions, payroll recalculation, salary history, effective
   dating, approvals, currency, or tax — those are explicitly out of scope.

   Uses the existing DEFAULT aggregate entry contract (prepare / patch), so
   no Domain routing change is required (ARCH-001 / ADR-008 remain Proposed
   and untouched).

   Contract (enforced by the verifier):
     - MUST NOT mutate State, mutate an Employee, call persistEmployees(),
       append history, update updatedAt, render UI, toast, access
       localStorage, or perform audit/payroll/finance/contract/workflow calls.
     - MAY only READ (existence via the shared employeeExists helper) and
       RETURN a sanitized patch or a typed business failure.

   prepare(id, patch) returns:
     { ok: true,  patch: { monthlyBaseSalary: <number or null> } }
     { ok: false, error: 'EmployeeNotFound' | 'NoCompensationFieldsProvided'
                       | 'InvalidMonthlyBaseSalary' }
   ============================================================ */
const EmployeeCompensationAggregate = Object.freeze({
  prepare: function (id, patch) {
    // 1. Employee existence (read-only; never mutates State). PR-5F: shared helper.
    var e = employeeExists(id);
    if (!e) return { ok: false, error: 'EmployeeNotFound' };

    // 2. Strict allowlist: only monthlyBaseSalary is considered. Every other
    //    property is discarded before the patch reaches the handler.
    patch = patch || {};
    var allow = (typeof EMPLOYEE_COMPENSATION_FIELDS !== 'undefined') ? EMPLOYEE_COMPENSATION_FIELDS : ['monthlyBaseSalary'];
    var field = allow[0];
    if (!Object.prototype.hasOwnProperty.call(patch, field)) {
      return { ok: false, error: 'NoCompensationFieldsProvided' };
    }

    // 3. Normalize the submitted value. An intentionally empty value (null,
    //    undefined, or blank string) becomes null; otherwise it must be a
    //    finite, non-negative number (numeric strings and surrounding
    //    whitespace are accepted).
    var raw = patch[field];
    var value;
    if (raw === null || raw === undefined) {
      value = null;
    } else {
      var s = String(raw).trim();
      if (s === '') {
        value = null;
      } else {
        var n = Number(s);
        if (!isFinite(n) || n < 0) return { ok: false, error: 'InvalidMonthlyBaseSalary' };
        value = n;
      }
    }

    // 4. Return a fresh sanitized patch only. No mutation performed; all
    //    unrelated Employee data is preserved by construction.
    return { ok: true, patch: { monthlyBaseSalary: value } };
  }
});

// Expose on the global object so the Domain facade can resolve this aggregate by
// name (top-level `const` objects are not attached to `window`, unlike function
// declarations). No eval; classic shared global scope.
if (typeof window !== 'undefined') { window.EmployeeCompensationAggregate = EmployeeCompensationAggregate; }
