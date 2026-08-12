/* ============================================================
   DOMAIN LAYER — EMPLOYEE EMPLOYMENT AGGREGATE (PR-5E "The Custodian")
   ------------------------------------------------------------
   The SECOND aggregate boundary. It is the BUSINESS AUTHORITY for the
   employee.employment.update command: it decides whether the command may
   proceed and what the sanitized input is. It is pure until the handler
   runs and has NO side effects.

   Contract (enforced by the verifier):
     - MUST NOT mutate State, call persistEmployees(), append history,
       render UI, access localStorage, or perform audit logging.
     - MAY only READ (existence check via empById) and RETURN either a
       sanitized patch or a typed business failure.

   The implementation authority remains updateEmployeeEmployment(), which
   performs every mutation, persistence, and history effect. The handler
   keeps its own guards (defense in depth); this aggregate adds a
   business-decision layer in front of it and changes no runtime behavior.

   prepare(id, patch) returns:
     { ok: true,  patch: <sanitized {jobTitle?,department?,employmentStatus?,joinDate?,contractType?}> }
     { ok: false, error: 'EmployeeNotFound' | 'NoEmploymentFieldsProvided'
                        | 'InvalidEmploymentStatus' | 'InvalidContractType' }
   ============================================================ */
const EmployeeEmploymentAggregate = Object.freeze({
  prepare: function (id, patch) {
    // 1. Employee existence (read-only; never mutates State). PR-5F: shared helper.
    var e = employeeExists(id);
    if (!e) return { ok: false, error: 'EmployeeNotFound' };

    // 2. Employment allowlist + 3. normalization (trim). Every other property
    //    is discarded before the patch reaches the handler. PR-5F: shared helper.
    var allow = (typeof EMPLOYEE_EMPLOYMENT_FIELDS !== 'undefined') ? EMPLOYEE_EMPLOYMENT_FIELDS : ['jobTitle', 'department', 'employmentStatus', 'joinDate', 'contractType'];
    var clean = normalizeAllowedFields(patch, allow);

    // 4. Business error: no allowed field supplied.
    if (Object.keys(clean).length === 0) return { ok: false, error: 'NoEmploymentFieldsProvided' };

    // 5. Normalize empty joinDate to null.
    if (Object.prototype.hasOwnProperty.call(clean, 'joinDate') && clean.joinDate === '') {
      clean.joinDate = null;
    }

    // 6. Validate employmentStatus against the canonical enum. PR-5F: shared helper.
    if (Object.prototype.hasOwnProperty.call(clean, 'employmentStatus') &&
        !validateEnum(clean.employmentStatus, (typeof EMPLOYMENT_STATUSES !== 'undefined') ? EMPLOYMENT_STATUSES : [])) {
      return { ok: false, error: 'InvalidEmploymentStatus' };
    }

    // 7. Validate contractType against the canonical enum. PR-5F: shared helper.
    if (Object.prototype.hasOwnProperty.call(clean, 'contractType') &&
        !validateEnum(clean.contractType, (typeof CONTRACT_TYPES !== 'undefined') ? CONTRACT_TYPES : [])) {
      return { ok: false, error: 'InvalidContractType' };
    }

    // 8. Return the sanitized command input only. No mutation performed.
    return { ok: true, patch: clean };
  }
});

// Expose on the global object so the Domain facade can resolve this aggregate by
// name (top-level `const` objects are not attached to `window`, unlike function
// declarations). No eval; classic shared global scope.
if (typeof window !== 'undefined') { window.EmployeeEmploymentAggregate = EmployeeEmploymentAggregate; }
