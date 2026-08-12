/* ============================================================
   DOMAIN LAYER — CONTRACT STATUS AGGREGATE (PR-5K "The Ledger")
   ------------------------------------------------------------
   The SEVENTH aggregate boundary and the SECOND Contract boundary. It is the
   BUSINESS AUTHORITY for the contract.status.transition command: it decides
   whether a requested Contract status transition is legal from the contract's
   current stored status. It is pure and has NO side effects.

   AUTHORITATIVE STATUS MODEL (SPR-060/SPR-061 discovery, Atlas-accepted):
   The stored Contract statuses are Draft / Active / Renewed / Cancelled
   (core: CONTRACT_STORED_STATUSES). Derived display states (Expiring Soon,
   Expired) are computed by contractEffectiveStatus() and are NEVER stored —
   they are outside this aggregate's authority. This aggregate controls only
   the STORED status and only the dedicated status-transition pathway; contract
   creation (the full editor) and renewal (→ Renewed) are distinct operations
   and remain out of scope (documented residual authority for a future slice).

   TRANSITION GRAPH — derived from existing runtime behavior (setContractStatus
   UI eligibility: Activate offered on Draft; Cancel offered when the status is
   neither Cancelled nor Renewed), never invented:
     Draft     → Active | Cancelled
     Active    → Cancelled
     Renewed   → (terminal)
     Cancelled → (terminal)
   `Renewed` is produced EXCLUSIVELY by the renewal workflow and is never a
   generic transition target here.

   Contract (enforced by the verifier):
     - MUST NOT mutate State, mutate a Contract, call persistContracts()/
       persistHR(), append history, update updatedAt, render UI, toast, access
       localStorage, or audit.
     - MAY only READ (existence via contractById) and RETURN a typed decision.

   transition(contractId, transition) returns:
     { ok: true,  transition: { from, to } }   // sanitized, legal transition
     { ok: false, error: 'ContractNotFound' | 'InvalidContractStatusState'
                       | 'IllegalContractStatusTransition' }
   ============================================================ */

// The legal transitions between stored Contract statuses. Single source of
// truth for the rule; the handler (transitionContractStatus) consults the same
// map for its defense-in-depth check. Renewed and Cancelled are terminal;
// Renewed is never a target (only the renewal workflow produces it).
const CONTRACT_STATUS_TRANSITIONS = Object.freeze({
  'Draft':     ['Active', 'Cancelled'],
  'Active':    ['Cancelled'],
  'Renewed':   [],
  'Cancelled': []
});

const ContractStatusAggregate = Object.freeze({
  transition: function (contractId, transition) {
    // 1. Contract existence (read-only; never mutates State).
    var c = (typeof contractById === 'function') ? contractById(contractId) : null;
    if (!c) return { ok: false, error: 'ContractNotFound' };

    // Known stored statuses come from the single source of truth (core).
    var STATES = (typeof CONTRACT_STORED_STATUSES !== 'undefined') ? CONTRACT_STORED_STATUSES
      : ['Draft', 'Active', 'Renewed', 'Cancelled'];

    // 2. The contract's CURRENT stored status must be a recognized status.
    var from = c.status;
    if (STATES.indexOf(from) === -1) return { ok: false, error: 'InvalidContractStatusState' };

    // 3. The requested target must be a recognized stored status.
    var to = (transition == null ? '' : String(transition)).trim();
    if (STATES.indexOf(to) === -1) return { ok: false, error: 'InvalidContractStatusState' };

    // 4. The transition must be legal from the CURRENT status. This also enforces
    //    terminal-state validation (Renewed/Cancelled have no outgoing transitions)
    //    and that Renewed is never a generic target (no list contains it).
    var allowed = CONTRACT_STATUS_TRANSITIONS[from] || [];
    if (allowed.indexOf(to) === -1) return { ok: false, error: 'IllegalContractStatusTransition' };

    // 5. Return the sanitized, legal transition only. No mutation performed.
    return { ok: true, transition: { from: from, to: to } };
  }
});

// Expose on the global object so the Domain facade can resolve this aggregate by
// name (top-level `const` objects are not attached to `window`, unlike function
// declarations). No eval; classic shared global scope.
if (typeof window !== 'undefined') { window.ContractStatusAggregate = ContractStatusAggregate; }
