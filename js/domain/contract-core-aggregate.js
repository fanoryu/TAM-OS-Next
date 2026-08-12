/* ============================================================
   DOMAIN LAYER — CONTRACT CORE AGGREGATE (SPR-095 "The Preparation")
   ------------------------------------------------------------
   The FOURTH Contract aggregate boundary and the business authority ADR-014
   assigns to the Contract's identity, employee link, compensation, schedule and
   notes fields. It is pure and has NO side effects.

   SCOPE HONESTY (SPR-095): this module is DOMAIN PREPARATION ONLY. Nothing in
   the running application invokes contract.core.update — the full Contract
   editor still writes these fields directly and still persists through
   persistContracts(). Editor routing migration is step 2 of ADR-014's recorded
   sequence, is gated on OQ-2, and is NOT authorized here. Runtime behaviour is
   unchanged by this file.

   OWNERSHIP — exactly the ten fields of ADR-014's field-authority matrix:
     employeeId · employeeName · contractNumber · monthlySalary · notes ·
     workHoursPerDay · workDaysPerWeek · weeksPerMonth · scheduleEffectiveDate ·
     scheduleNotes

   Everything else is REFUSED, not ignored. `status`, `startDate` and
   `durationMonths` stay with ContractStatusAggregate / ContractDateAggregate;
   `endDate` is derived by contractCalc and never stored; `updatedAt`, `history`,
   `renewedFromId` and `renewedToId` are system-authored by handlers; `id` and
   `createdAt` are immutable after creation. A patch naming any of them is a
   typed failure — silently discarding them would let a caller believe a field
   was written when it was not.

   MEASURED INVARIANTS (ADR-014 rationale §1–§2, PD-1, PD-2):
     1. employeeId + employeeName are an ATOMIC PAIR. employeeName is a
        denormalized display cache; moving one without the other leaves the
        Contract showing the wrong person's name against the right person's id.
     2. The five schedule fields are ONE value object. readSchedule() treats the
        schedule as present when ANY of hours/days/weeks is truthy and coerces
        the rest with `|| 0`, so a partial schedule overrides the employee and
        company schedules and yields standardHours = 0, hence hourlyRate = 0 —
        silently zeroing overtime pay. A partial group is therefore rejected.
     3. PD-1 — contractNumber is editable only while the Contract is in Draft
        (it is snapshotted into payroll rows and transaction descriptions).
     4. PD-2 — employee reassignment is permitted only while the Contract is in
        Draft AND no payroll, overtime or transaction is linked to it.

   Uses the existing DEFAULT aggregate entry contract (prepare / patch), so no
   Domain routing change is required.

   Contract (enforced by the verifier):
     - MUST NOT mutate State, mutate a Contract/Employee, call persistContracts()
       / persistHR(), append history, update updatedAt, render UI, toast, access
       localStorage, audit, or invoke payroll/finance/Employee handlers.
     - MAY only READ (existence and linkage) and RETURN a typed decision.

   prepare(id, patch) returns:
     { ok: true,  patch: { <only the submitted owned fields, normalized> } }
     { ok: false, error: 'ContractNotFound' | 'ForbiddenContractField'
                       | 'NoContractCoreFieldsProvided' | 'IncompleteEmployeeLink'
                       | 'EmployeeNotFound' | 'EmployeeLinkMismatch'
                       | 'EmployeeReassignmentNotAllowed' | 'InvalidContractNumber'
                       | 'ContractNumberNotEditable' | 'InvalidMonthlySalary'
                       | 'IncompleteScheduleGroup' | 'InvalidScheduleComponent'
                       | 'InvalidScheduleEffectiveDate' }
   ============================================================ */

// The ten owned fields (single source of truth for the allowlist — ADR-014).
const CONTRACT_CORE_FIELDS = ['employeeId', 'employeeName', 'contractNumber', 'monthlySalary', 'notes',
  'workHoursPerDay', 'workDaysPerWeek', 'weeksPerMonth', 'scheduleEffectiveDate', 'scheduleNotes'];

// The atomic schedule value object (a subset of the ten — ADR-014 rationale §2).
const CONTRACT_CORE_SCHEDULE_FIELDS = ['workHoursPerDay', 'workDaysPerWeek', 'weeksPerMonth',
  'scheduleEffectiveDate', 'scheduleNotes'];

// The three numeric schedule components readSchedule() coerces with `|| 0`.
const CONTRACT_CORE_SCHEDULE_COMPONENTS = ['workHoursPerDay', 'workDaysPerWeek', 'weeksPerMonth'];

// Read-only linkage check for PD-2. Reads through the existing linkage helpers
// only (never State) so this module stays pure and load-order independent.
function contractHasLinkedRecords(id) {
  var pp = (typeof payrollPlansForContract === 'function') ? payrollPlansForContract(id) : [];
  if (pp && pp.length) return true;
  var tx = (typeof txnsForContract === 'function') ? txnsForContract(id) : [];
  if (tx && tx.length) return true;
  var ot = (typeof overtimeRecordsForContract === 'function') ? overtimeRecordsForContract(id) : [];
  return !!(ot && ot.length);
}

const ContractCoreAggregate = Object.freeze({
  prepare: function (id, patch) {
    // 1. Contract existence (read-only; never mutates State).
    var c = (typeof contractById === 'function') ? contractById(id) : null;
    if (!c) return { ok: false, error: 'ContractNotFound' };

    patch = patch || {};
    var keys = Object.keys(patch);

    // 2. STRICT allowlist. Any field outside the ten owned by this aggregate is
    //    REFUSED — including the specialized fields owned by the status/date
    //    aggregates and every system-authored or immutable field.
    for (var i = 0; i < keys.length; i++) {
      if (CONTRACT_CORE_FIELDS.indexOf(keys[i]) === -1) return { ok: false, error: 'ForbiddenContractField' };
    }
    if (keys.length === 0) return { ok: false, error: 'NoContractCoreFieldsProvided' };

    var has = function (k) { return Object.prototype.hasOwnProperty.call(patch, k); };
    var clean = {};

    // 3. ATOMIC PAIR — employeeId + employeeName move together or not at all.
    var hasEmpId = has('employeeId'), hasEmpName = has('employeeName');
    if (hasEmpId !== hasEmpName) return { ok: false, error: 'IncompleteEmployeeLink' };
    if (hasEmpId) {
      var empId = (patch.employeeId == null ? '' : String(patch.employeeId)).trim();
      var emp = (typeof empById === 'function') ? (empById(empId) || null) : null;
      if (!emp) return { ok: false, error: 'EmployeeNotFound' };
      // The submitted name must be the linked employee's real name. The pair is
      // never silently rewritten — a mismatched submission is a typed failure.
      var empName = (patch.employeeName == null ? '' : String(patch.employeeName)).trim();
      if (empName !== String(emp.fullName == null ? '' : emp.fullName).trim()) return { ok: false, error: 'EmployeeLinkMismatch' };
      // PD-2 — REASSIGNMENT (a change of employee) is Draft-only and refused once
      // any payroll, overtime or transaction is linked; those rows keep the
      // original employeeId and would split one contract's history across two
      // people. Re-submitting the SAME employee is not a reassignment.
      if (emp.id !== c.employeeId) {
        if (c.status !== 'Draft') return { ok: false, error: 'EmployeeReassignmentNotAllowed' };
        if (contractHasLinkedRecords(c.id)) return { ok: false, error: 'EmployeeReassignmentNotAllowed' };
      }
      clean.employeeId = emp.id;
      clean.employeeName = empName;
    }

    // 4. PD-1 — contractNumber is editable only while the Contract is in Draft.
    //    Re-submitting the unchanged number is not an edit and stays allowed.
    if (has('contractNumber')) {
      var num = (patch.contractNumber == null ? '' : String(patch.contractNumber)).trim();
      if (num === '') return { ok: false, error: 'InvalidContractNumber' };
      if (num !== String(c.contractNumber == null ? '' : c.contractNumber).trim() && c.status !== 'Draft') {
        return { ok: false, error: 'ContractNumberNotEditable' };
      }
      clean.contractNumber = num;
    }

    // 5. monthlySalary — prospective compensation only (ADR-014 §5). Blank clears
    //    it to null, matching the existing editor's stored shape.
    if (has('monthlySalary')) {
      var rawSal = (patch.monthlySalary == null ? '' : String(patch.monthlySalary)).trim();
      if (rawSal === '') clean.monthlySalary = null;
      else {
        var sal = Number(rawSal);
        if (!isFinite(sal) || sal < 0) return { ok: false, error: 'InvalidMonthlySalary' };
        clean.monthlySalary = sal;
      }
    }

    // 6. notes — carried for single-authority reasons only; no invariant (ADR-014 §4).
    if (has('notes')) clean.notes = (patch.notes == null ? '' : String(patch.notes)).trim();

    // 7. ATOMIC SCHEDULE GROUP — all five fields or none. A partial submission
    //    cannot be normalized safely, because readSchedule() would treat the
    //    result as a complete contract-level schedule.
    var submittedSchedule = CONTRACT_CORE_SCHEDULE_FIELDS.filter(has);
    if (submittedSchedule.length > 0) {
      if (submittedSchedule.length !== CONTRACT_CORE_SCHEDULE_FIELDS.length) return { ok: false, error: 'IncompleteScheduleGroup' };
      // The three numeric components are all set or all cleared. A mix would
      // override the employee/company schedule and zero the hourly rate.
      var comps = {}, provided = 0;
      for (var j = 0; j < CONTRACT_CORE_SCHEDULE_COMPONENTS.length; j++) {
        var ck = CONTRACT_CORE_SCHEDULE_COMPONENTS[j];
        var rawC = (patch[ck] == null ? '' : String(patch[ck])).trim();
        if (rawC === '') { comps[ck] = null; continue; }
        var n = Number(rawC);
        if (!isFinite(n) || n <= 0) return { ok: false, error: 'InvalidScheduleComponent' };
        comps[ck] = n; provided++;
      }
      if (provided !== 0 && provided !== CONTRACT_CORE_SCHEDULE_COMPONENTS.length) return { ok: false, error: 'IncompleteScheduleGroup' };
      CONTRACT_CORE_SCHEDULE_COMPONENTS.forEach(function (ck) { clean[ck] = comps[ck]; });
      // scheduleEffectiveDate is captured for atomicity; it has no consumer today
      // (ADR-014 §2). Blank clears it; a present value must be a real date.
      var eff = (patch.scheduleEffectiveDate == null ? '' : String(patch.scheduleEffectiveDate)).trim();
      if (eff === '') clean.scheduleEffectiveDate = null;
      else {
        var canonical = (typeof isCanonicalContractDate === 'function') ? isCanonicalContractDate(eff) : false;
        if (!canonical) return { ok: false, error: 'InvalidScheduleEffectiveDate' };
        clean.scheduleEffectiveDate = eff;
      }
      var sn = (patch.scheduleNotes == null ? '' : String(patch.scheduleNotes)).trim();
      clean.scheduleNotes = sn === '' ? null : sn;
    }

    // 8. Return a fresh sanitized patch of only the SUBMITTED owned fields. All
    //    unrelated Contract data — including every specialized and system field —
    //    is preserved because it is simply never present here.
    return { ok: true, patch: clean };
  }
});

// Expose on the global object so the Domain facade can resolve this aggregate by
// name (top-level `const` objects are not attached to `window`, unlike function
// declarations). No eval; classic shared global scope.
if (typeof window !== 'undefined') { window.ContractCoreAggregate = ContractCoreAggregate; }
