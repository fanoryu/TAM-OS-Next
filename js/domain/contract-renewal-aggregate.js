/* ============================================================
   DOMAIN LAYER — CONTRACT RENEWAL AGGREGATE (SPR-077 "The Successor")
   ------------------------------------------------------------
   The EIGHTH aggregate boundary and the THIRD Contract boundary. It is the
   BUSINESS AUTHORITY for the contract.renewal.execute command: it decides
   whether a Contract may be renewed and AUTHORS the complete renewal — the
   successor Contract's business shape, the predecessor's canonical renewed
   status, and the history note text belonging to each side. It is pure and has
   NO side effects.

   AUTHORITY SPLIT (identical to every prior Epsilon slice — ATR-011 §2):
   the aggregate DECIDES and AUTHORS; the handler (renewContract) APPLIES. The
   aggregate never mutates a Contract, never assigns an id or a timestamp, and
   never appends a history entry — it returns the note TEXT under its own
   authority and the handler performs the append with the handler-owned
   timestamp, exactly as updateContractDates and transitionContractStatus do.
   This keeps the aggregate deterministic and testable, and keeps rollback
   ownership where every other slice already places it.

   RENEWAL ELIGIBILITY — derived from the existing stored status model, never
   invented. CONTRACT_STATUS_TRANSITIONS (contract-status-aggregate.js) records
   Renewed and Cancelled as TERMINAL. Renewal is therefore offered only from a
   non-terminal stored status:
     Draft     → renewable
     Active    → renewable
     Renewed   → NOT renewable (terminal; already has a successor)
     Cancelled → NOT renewable (terminal)
   The pre-SPR-077 row menu offered "Renew" unconditionally, so a Renewed
   contract could be renewed a second time — silently overwriting renewedToId
   and ORPHANING the first successor (which keeps pointing back via
   renewedFromId). That is a link-corruption path, not valid behavior, so it is
   closed here per SPR-077 §8 ("preserve existing valid behavior unless a
   contradiction or corruption risk is found").

   OVERLAP IS DELIBERATELY NOT ENFORCED. ADR-012 (Contract Overlap Enforcement)
   is **Proposed**, not Accepted, and explicitly authorizes no implementation and
   no runtime change. overlappingActiveContracts stays diagnostic-only, exactly
   as it is for contract.dates.update.

   Contract (enforced by the verifier):
     - MUST NOT mutate State, mutate a Contract, call persistContracts() /
       persistHR(), append a history entry, write updatedAt, generate an id or
       timestamp, render UI, toast, access localStorage, or audit.
     - MAY only READ (existence via contractById) and RETURN a typed decision.

   Uses the DEFAULT aggregate entry method (prepare) with a dedicated payload key
   (`renewal`), so no Domain facade routing change is required.

   prepare(id, patch) returns:
     { ok: true, renewal: {
         predecessorId,
         predecessorStatus: 'Renewed',
         predecessorNote,                 // history note TEXT (handler appends)
         successorNote,                   // history note TEXT (handler appends)
         successor: { employeeId, employeeName, contractNumber, startDate,
                      durationMonths, monthlySalary, status, notes }
       } }
     { ok: false, error: 'ContractNotFound' | 'RenewalNotAllowed'
                       | 'ContractAlreadyRenewed' | 'InvalidContractNumber'
                       | 'InvalidStartDate' | 'InvalidDurationMonths'
                       | 'InvalidContractDateRange' | 'InvalidMonthlySalary'
                       | 'InvalidContractStatusState' }
   ============================================================ */

// Stored statuses a Contract may be renewed FROM. Single source of truth for the
// rule; the handler consults the same list for its defense-in-depth check. It is
// exactly the set of NON-terminal stored statuses in CONTRACT_STATUS_TRANSITIONS.
const CONTRACT_RENEWABLE_STATUSES = Object.freeze(['Draft', 'Active']);

// Stored statuses a SUCCESSOR contract may be created in. Mirrors the existing
// renewal form's Initial Status choices exactly (Active | Draft) — unchanged.
const CONTRACT_RENEWAL_TARGET_STATUSES = Object.freeze(['Active', 'Draft']);

const ContractRenewalAggregate = Object.freeze({
  prepare: function (id, patch) {
    // 1. Predecessor existence (read-only; never mutates State).
    var c = (typeof contractById === 'function') ? contractById(id) : null;
    if (!c) return { ok: false, error: 'ContractNotFound' };

    // 2. Eligibility: only a non-terminal stored status may be renewed.
    if (CONTRACT_RENEWABLE_STATUSES.indexOf(c.status) === -1) return { ok: false, error: 'RenewalNotAllowed' };

    // 3. A contract that already points at a successor is never renewed again
    //    (defends the linkage even if a status were somehow inconsistent).
    if (c.renewedToId) return { ok: false, error: 'ContractAlreadyRenewed' };

    patch = patch || {};

    // 4. Successor contract number — required, trimmed (matches the form's
    //    `required` input and the existing editor's trim convention).
    var number = (patch.contractNumber == null ? '' : String(patch.contractNumber)).trim();
    if (number === '') return { ok: false, error: 'InvalidContractNumber' };

    // 5. Successor start date — strict canonical calendar date, reusing the
    //    single source of truth from ContractDateAggregate (PR-5I).
    var start = (patch.startDate == null ? '' : String(patch.startDate)).trim();
    if (typeof isCanonicalContractDate !== 'function' || !isCanonicalContractDate(start)) return { ok: false, error: 'InvalidStartDate' };

    // 6. Successor duration — finite positive integer (same rule as PR-5I).
    var rawDur = (patch.durationMonths == null ? '' : String(patch.durationMonths)).trim();
    var dur = Number(rawDur);
    if (rawDur === '' || !isFinite(dur) || !Number.isInteger(dur) || dur <= 0) return { ok: false, error: 'InvalidDurationMonths' };

    // 7. Derived extent validity (defensive; equivalent to contractCalc).
    if (typeof contractExtentIsValid !== 'function' || !contractExtentIsValid(start, dur)) return { ok: false, error: 'InvalidContractDateRange' };

    // 8. Successor monthly salary — optional (null is a valid stored value, as in
    //    the existing editor); when supplied it must be a finite non-negative number.
    var salary = null;
    if (patch.monthlySalary != null && String(patch.monthlySalary).trim() !== '') {
      var s = Number(patch.monthlySalary);
      if (!isFinite(s) || s < 0) return { ok: false, error: 'InvalidMonthlySalary' };
      salary = s;
    }

    // 9. Successor initial status — exactly the existing form's two choices.
    var target = (patch.status == null ? '' : String(patch.status)).trim();
    if (CONTRACT_RENEWAL_TARGET_STATUSES.indexOf(target) === -1) return { ok: false, error: 'InvalidContractStatusState' };

    // 10. Author the renewal. Business text (notes + both history notes) is
    //     produced here under aggregate authority; the handler only applies it.
    //     Wording is preserved verbatim from the pre-SPR-077 renewal workflow.
    var predNumber = c.contractNumber || '';
    return {
      ok: true,
      renewal: {
        predecessorId: c.id,
        predecessorStatus: 'Renewed',
        predecessorNote: 'Renewed into ' + number,
        successorNote: 'Renewed from ' + predNumber,
        successor: {
          employeeId: c.employeeId,
          employeeName: c.employeeName,
          contractNumber: number,
          startDate: start,
          durationMonths: dur,
          monthlySalary: salary,
          status: target,
          notes: 'Renewal of ' + predNumber
        }
      }
    };
  }
});

// Expose on the global object so the Domain facade can resolve this aggregate by
// name (top-level `const` objects are not attached to `window`, unlike function
// declarations). No eval; classic shared global scope.
if (typeof window !== 'undefined') { window.ContractRenewalAggregate = ContractRenewalAggregate; }
