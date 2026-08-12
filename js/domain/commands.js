/* ============================================================
   DOMAIN LAYER — BUSINESS COMMANDS (Enterprise Foundation, PR-5)
   ------------------------------------------------------------
   DESCRIPTIVE catalogue of state-changing business commands (Contract
   PR-5.3 §1). Each entry names the EXISTING global handler that already
   performs the command, the aggregate it targets, and the lifecycle
   transition it causes. This is metadata, not an execution path: the UI
   continues to call the existing functions directly, and this layer does
   NOT execute commands (call-site migration is a later, separate phase).

   `handler` is a function NAME resolved on demand (read-only) by the
   Domain facade, so this module carries no load-order dependency on the
   handlers and never invokes them.
   ============================================================ */

const DOMAIN_COMMANDS = Object.freeze({
  // PR-5C.1 — first OPERATIONAL command routed through Domain.command().
  // Narrow, non-financial, non-lifecycle: contact fields only.
  'employee.contact.update': Object.freeze({ aggregate: 'Employee', boundary: 'EmployeeContactAggregate', handler: 'updateEmployeeContact', transition: 'update contact fields (phone/email/notes) — OPERATIONAL via Domain.command(); business authority = EmployeeContactAggregate (PR-5D)' }),
  // PR-5E — second OPERATIONAL command routed through Domain.command().
  // Narrow, non-financial, non-lifecycle: employment fields only.
  'employee.employment.update': Object.freeze({ aggregate: 'Employee', boundary: 'EmployeeEmploymentAggregate', handler: 'updateEmployeeEmployment', transition: 'controlled update of Employee employment fields (jobTitle/department/employmentStatus/joinDate/contractType) — OPERATIONAL via Domain.command(); business authority = EmployeeEmploymentAggregate (PR-5E)' }),
  // PR-5G — third OPERATIONAL command routed through Domain.command().
  // Narrow lifecycle state machine over employmentStatus (Active/Resigned/Terminated).
  'employee.lifecycle.transition': Object.freeze({ aggregate: 'Employee', boundary: 'EmployeeLifecycleAggregate', boundaryMethod: 'transition', boundaryPayload: 'transition', handler: 'transitionEmployeeLifecycle', transition: 'controlled Employee lifecycle transition (Active↔Resigned, Active↔Terminated) — OPERATIONAL via Domain.command(); business authority = EmployeeLifecycleAggregate (PR-5G)' }),
  // PR-5H — fourth OPERATIONAL command routed through Domain.command().
  // Narrow: monthly base salary only. Uses the DEFAULT prepare/patch contract.
  'employee.compensation.update': Object.freeze({ aggregate: 'Employee', boundary: 'EmployeeCompensationAggregate', handler: 'updateEmployeeCompensation', transition: 'controlled update of Employee monthly base compensation — OPERATIONAL via Domain.command(); business authority = EmployeeCompensationAggregate (PR-5H)' }),
  // PR-5I — fifth OPERATIONAL command, first Contract boundary. Narrow: stored
  // Contract date facts (startDate + durationMonths) only; endDate stays derived.
  // Uses the DEFAULT prepare/patch contract.
  'contract.dates.update': Object.freeze({ aggregate: 'Contract', boundary: 'ContractDateAggregate', handler: 'updateContractDates', transition: 'controlled update of Contract start date and duration (endDate remains derived) — OPERATIONAL via Domain.command(); business authority = ContractDateAggregate (PR-5I)' }),
  // PR-5J — sixth OPERATIONAL command, first Payroll boundary. Narrow, pre-posting
  // PayrollPlan lifecycle transition (Draft/Reviewed/Ready/Cancelled) over the stored
  // status only; posting to Finance (→ Committed) stays out of scope. Uses the shared
  // lifecycle contract (boundaryMethod/boundaryPayload = transition).
  'payroll.lifecycle.transition': Object.freeze({ aggregate: 'PayrollPlan', boundary: 'PayrollLifecycleAggregate', boundaryMethod: 'transition', boundaryPayload: 'transition', handler: 'transitionPayrollLifecycle', transition: 'controlled pre-posting PayrollPlan lifecycle transition (Draft↔Reviewed, Draft/Reviewed→Ready, →Cancelled) — OPERATIONAL via Domain.command(); business authority = PayrollLifecycleAggregate (PR-5J); posting to Finance is out of scope' }),
  // PR-5K — seventh OPERATIONAL command, second Contract boundary. Narrow, dedicated
  // Contract status transition over the stored status only (Draft→Active/Cancelled,
  // Active→Cancelled; Renewed/Cancelled terminal). Renewed is produced only by the
  // renewal workflow; creation/renewal status writes remain out of scope. Uses the
  // shared lifecycle contract (boundaryMethod/boundaryPayload = transition).
  'contract.status.transition': Object.freeze({ aggregate: 'Contract', boundary: 'ContractStatusAggregate', boundaryMethod: 'transition', boundaryPayload: 'transition', handler: 'transitionContractStatus', transition: 'controlled Contract status transition (Draft→Active/Cancelled, Active→Cancelled; Renewed/Cancelled terminal) — OPERATIONAL via Domain.command(); business authority = ContractStatusAggregate (PR-5K); Renewed is renewal-only, creation/renewal status writes out of scope' }),
  // SPR-077 — eighth OPERATIONAL command, third Contract boundary. The Contract
  // RENEWAL workflow: the predecessor moves to the terminal `Renewed` status and a
  // successor Contract is created, both inside the ONE `contracts` collection (one
  // storage-key write — ATR-011 confirmed this is NOT a compound-persistence
  // operation). The aggregate is the business authority: it decides eligibility and
  // AUTHORS the successor's shape, the predecessor's renewed status, and both
  // history notes; the handler applies them, persists once through
  // ContractRepository, and rolls back in memory on a failed persist. Uses the
  // default boundaryMethod (prepare) with a dedicated boundaryPayload (`renewal`).
  'contract.renewal.execute': Object.freeze({ aggregate: 'Contract', boundary: 'ContractRenewalAggregate', boundaryPayload: 'renewal', handler: 'renewContract', transition: 'Contract renewal (predecessor Draft/Active → Renewed, successor created as Active/Draft) — OPERATIONAL via Domain.command(); business authority = ContractRenewalAggregate (SPR-077); one collection, one persist, in-memory rollback' }),
  // SPR-095 — ninth aggregate-backed command, fourth Contract boundary. The Contract
  // CORE field set ADR-014 assigns to one authority: identity/link (employeeId +
  // employeeName), contractNumber, monthlySalary, notes and the five-field schedule
  // group. It owns NO lifecycle field — status, startDate and durationMonths stay with
  // their specialized aggregates. Uses the DEFAULT prepare/patch contract.
  //
  // DOMAIN PREPARATION ONLY (ADR-014 sequencing step 1): this command is registered,
  // aggregate-backed and Repository-mediated, but NOTHING invokes it. The full Contract
  // editor still writes these fields directly through persistContracts(). Editor routing
  // is step 2, is gated on OQ-2, and is not authorized. Runtime behaviour is unchanged.
  'contract.core.update': Object.freeze({ aggregate: 'Contract', boundary: 'ContractCoreAggregate', handler: 'updateContractCore', transition: 'controlled update of the Contract core fields (employee link pair, contractNumber, monthlySalary, notes, atomic schedule group) — business authority = ContractCoreAggregate (ADR-014 / SPR-095); REGISTERED BUT NOT ROUTED: no UI seam invokes it and the editor is not migrated' }),
  // Payroll
  'payroll.commit':        Object.freeze({ aggregate: 'PayrollPlan',          handler: 'commitReadyPayroll',        transition: 'Ready -> Committed (freezes snapshots)' }),
  // Finance
  'finance.execute':       Object.freeze({ aggregate: 'Transaction',          handler: 'executeTransaction',        transition: 'planned -> actual' }),
  // Supplemental
  'supplemental.generate': Object.freeze({ aggregate: 'SupplementalPayment',  handler: 'generateSupplementalForPlan', transition: 'create (from overtime drift)' }),
  'supplemental.transition': Object.freeze({ aggregate: 'SupplementalPayment', handler: 'transitionSupplemental',    transition: 'Draft -> Review -> Approved -> ... -> Executed/Cancelled' }),
  'supplemental.post':     Object.freeze({ aggregate: 'SupplementalPayment',  handler: 'postSupplemental',          transition: 'Approved -> Posted (links a finance transaction)' }),
  // Audit (system-owned side effect of authorized actions)
  'audit.log':             Object.freeze({ aggregate: 'AuditTrail',           handler: 'logActivity',               transition: 'append (never mutate)' })
});
