/* ============================================================
   REPOSITORY LAYER — CONTRACT REPOSITORY (PR-10A "The Contract Foundation")
   ------------------------------------------------------------
   The SECOND entity Repository — a persistence-MECHANICS boundary between a
   Contract handler's mutation and the existing collection persistence. It proves
   the Repository architecture validated on the Employee aggregate (PR-8A…PR-9C)
   generalizes to a second aggregate WITHOUT changing the Platform, the Repository
   contract, or the persistence model. Introduced on ONE bounded reference slice
   (the contract.dates.update handler).

   Persistence shape:
     Handler (updateContractDates)
       -> ContractRepository.save()        (this layer — persistence mechanics only)
          -> persistContracts()            (existing collection persist; UNCHANGED)
             -> StorageAdapter.set(...)    (existing storage-backend boundary; UNCHANGED)
                -> localStorage / window.storage

   The Repository owns ONLY persistence mechanics: it DELEGATES to the existing
   persist function and NORMALIZES its strict-boolean result into one explicit
   result contract. It owns NO business behavior — no validation, no mutation, no
   updatedAt, no history, no rollback, no UI, and it never calls Domain, an
   Aggregate, or a Handler, and never reinterprets a business outcome. The HANDLER
   remains the sole owner of validation, mutation, updatedAt, history, the single
   persistence invocation, rollback, and the typed result.

   RESULT CONTRACT (identical to EmployeeRepository; strict — no truthy/falsy
   ambiguity):
     success -> { ok: true }
     failure -> { ok: false, error: 'PersistFailed' }

   Entity-named per the ATR-008 Hybrid direction (EmployeeRepository /
   ContractRepository share the same mechanics; the name marks the collection).
   ============================================================ */

const ContractRepository = Object.freeze({
  // Persist the Contract collection's CURRENT in-memory state. The handler has
  // already applied its mutation (mutation is handler-owned); this method only
  // delegates the write to the existing persistContracts() and normalizes its
  // strict boolean into the explicit result contract. Async because the
  // underlying storage write is async. It performs no mutation and no rollback.
  async save(){
    const ok = await persistContracts();
    return (ok === true) ? { ok: true } : { ok: false, error: 'PersistFailed' };
  }
});

// Expose on the global object so the reference handler resolves it by name.
// Classic shared global scope; no eval, no module system.
if (typeof window !== 'undefined') { window.ContractRepository = ContractRepository; }
