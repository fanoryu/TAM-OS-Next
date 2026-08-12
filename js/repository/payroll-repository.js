/* ============================================================
   REPOSITORY LAYER — PAYROLL REPOSITORY (PR-11A "The Payroll Foundation")
   ------------------------------------------------------------
   The THIRD and FINAL entity Repository — a persistence-MECHANICS boundary between
   a Payroll handler's mutation and the existing collection persistence. It completes
   aggregate-backed Repository adoption (7 of 7) across Employee, Contract, and
   Payroll WITHOUT changing the Platform, the Repository contract, or the persistence
   model. Introduced on ONE bounded slice (the payroll.lifecycle.transition handler).

   Persistence shape:
     Handler (transitionPayrollLifecycle)
       -> PayrollRepository.save()         (this layer — persistence mechanics only)
          -> persistPayrollPlans()         (existing collection persist; UNCHANGED)
             -> StorageAdapter.set(...)    (existing storage-backend boundary; UNCHANGED)
                -> localStorage / window.storage

   The Repository owns ONLY persistence mechanics: it DELEGATES to the existing
   persist function and NORMALIZES its strict-boolean result into one explicit
   result contract. It owns NO business behavior — no validation, no period lock, no
   committed-immutability check, no mutation, no updatedAt, no history, no rollback,
   no UI, and NO AUDIT, and it never calls Domain, an Aggregate, or a Handler, and
   never reinterprets a business outcome. The HANDLER remains the sole owner of
   validation, mutation, updatedAt, history, the single persistence invocation,
   rollback, the typed result, and the best-effort post-persistence audit.

   PAYROLL-SPECIFIC NOTE: unlike the Employee and Contract slices, the migrated
   Payroll handler writes a best-effort audit entry AFTER a successful persist. That
   audit is a HANDLER invariant and deliberately stays outside this Repository — see
   the AUDIT INVARIANT rules in the handler header (payroll-ops-engine.js).

   RESULT CONTRACT (identical to EmployeeRepository / ContractRepository; strict —
   no truthy/falsy ambiguity):
     success -> { ok: true }
     failure -> { ok: false, error: 'PersistFailed' }

   Entity-named per the ATR-008 Hybrid direction (EmployeeRepository /
   ContractRepository / PayrollRepository share the same mechanics; the name marks
   the collection). No generic Repository, factory, shared base class, or transaction
   abstraction is introduced.

   ------------------------------------------------------------
   DESIGN NOTE — SCOPE AND MATURITY OF THIS BOUNDARY (durable)
   ------------------------------------------------------------
   PayrollRepository is the THIRD entity-named Repository in the Hybrid Repository
   architecture (ATR-008), alongside EmployeeRepository and ContractRepository.

   Its contract is deliberately COLLECTION-GRAINED and CLIENT-SIDE: one save() that
   writes one in-memory collection through the existing persist function to the
   existing client storage boundary. It models no unit of work spanning collections
   and no remote endpoint.

   With this slice, aggregate-backed Repository adoption reaches 7 of 7. That figure
   means EXACTLY ONE thing: every aggregate-backed handler delegates its persistence
   through an entity-named Repository.

   It does NOT mean:
     - that all persistence operations are Repository-mediated (most collection
       writes in the application still call their persist function directly);
     - that compound persistence is solved;
     - that multi-store transactions are supported (they are not expressible in this
       contract, which normalizes a single collection write);
     - that backend readiness is achieved (the application is client-only by
       constitutional rule; no server, database, or API exists or is implied).

   The non-aggregate Payroll persistence paths (salary-override set/clear, payroll
   generation, payroll regeneration, the one-time schema migration) and the COMPOUND
   posting paths (commitReadyPayroll and payroll-planning, which each write four
   stores in one logical operation) remain INTENTIONALLY DIRECT. They are outside the
   adoption boundary by design, not unfinished work, and are pending separate
   architecture review and authorization. Do not migrate them opportunistically.
   ============================================================ */

const PayrollRepository = Object.freeze({
  // Persist the PayrollPlan collection's CURRENT in-memory state. The handler has
  // already applied its mutation (mutation is handler-owned); this method only
  // delegates the write to the existing persistPayrollPlans() and normalizes its
  // strict boolean into the explicit result contract. Async because the underlying
  // storage write is async. It performs no mutation, no rollback, and no audit.
  async save(){
    const ok = await persistPayrollPlans();
    return (ok === true) ? { ok: true } : { ok: false, error: 'PersistFailed' };
  }
});

// Expose on the global object so the migrated handler resolves it by name.
// Classic shared global scope; no eval, no module system.
if (typeof window !== 'undefined') { window.PayrollRepository = PayrollRepository; }
