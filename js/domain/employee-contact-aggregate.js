/* ============================================================
   DOMAIN LAYER — EMPLOYEE CONTACT AGGREGATE (PR-5D "The Steward")
   ------------------------------------------------------------
   The FIRST aggregate boundary. It is the BUSINESS AUTHORITY for the
   employee.contact.update command: it decides whether the command may
   proceed and what the sanitized input is. It is pure until the handler
   runs and has NO side effects.

   Contract (enforced by the verifier):
     - MUST NOT mutate State, call persistEmployees(), append history,
       render UI, access localStorage, or perform audit logging.
     - MAY only READ (existence check via empById) and RETURN either a
       sanitized patch or a typed business failure.

   The implementation authority remains updateEmployeeContact(), which
   performs every mutation, persistence, and history/audit effect. The
   handler keeps its own guards (defense in depth); this aggregate adds a
   business-decision layer in front of it and changes no runtime behavior.

   prepare(id, patch) returns:
     { ok: true,  patch: <sanitized {phone?,email?,notes?}> }
     { ok: false, error: 'EmployeeNotFound' | 'NoContactFieldsProvided' }
   ============================================================ */
const EmployeeContactAggregate = Object.freeze({
  prepare: function (id, patch) {
    // 1. Employee existence (read-only; never mutates State). PR-5F: shared helper.
    var e = employeeExists(id);
    if (!e) return { ok: false, error: 'EmployeeNotFound' };

    // 2. Contact allowlist + 3. normalization (trim). Every other property
    //    is discarded before the patch reaches the handler. PR-5F: shared helper.
    var allow = (typeof EMPLOYEE_CONTACT_FIELDS !== 'undefined') ? EMPLOYEE_CONTACT_FIELDS : ['phone', 'email', 'notes'];
    var clean = normalizeAllowedFields(patch, allow);

    // 5. Business error: no allowed field supplied.
    if (Object.keys(clean).length === 0) return { ok: false, error: 'NoContactFieldsProvided' };

    // 4. Return the sanitized command input only. No mutation performed.
    return { ok: true, patch: clean };
  }
});

// Expose on the global object so the Domain facade can resolve this aggregate by
// name (top-level `const` objects are not attached to `window`, unlike function
// declarations). No eval; classic shared global scope.
if (typeof window !== 'undefined') { window.EmployeeContactAggregate = EmployeeContactAggregate; }
