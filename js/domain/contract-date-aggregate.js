/* ============================================================
   DOMAIN LAYER — CONTRACT DATE AGGREGATE (PR-5I "The Binder")
   ------------------------------------------------------------
   The FIRST Contract aggregate boundary. It is the BUSINESS AUTHORITY for the
   contract.dates.update command: a controlled update of a Contract's stored
   date facts. It is pure and has NO side effects.

   AUTHORITATIVE DATE MODEL (established by the SPR-049 architecture incident):
   Contract date extent is `startDate` + `durationMonths` (both STORED); the
   endDate is DERIVED by existing Contract logic (contractCalc) and is never a
   stored field. This aggregate therefore controls startDate and durationMonths
   only, and NEVER writes an endDate. contractCalc() semantics are unchanged.

   Uses the existing DEFAULT aggregate entry contract (prepare / patch), so no
   Domain routing change is required.

   Contract (enforced by the verifier):
     - MUST NOT mutate State, mutate a Contract/Employee, call persistContracts()
       / persistHR(), append history, update updatedAt, render UI, toast, access
       localStorage, audit, or invoke payroll/finance/Employee handlers.
     - MAY only READ (existence via contractById) and RETURN a typed decision.

   prepare(id, patch) returns:
     { ok: true,  patch: { startDate?: <YYYY-MM-DD>, durationMonths?: <int>0 } }
     { ok: false, error: 'ContractNotFound' | 'NoContractDateFieldsProvided'
                       | 'InvalidStartDate' | 'InvalidDurationMonths'
                       | 'InvalidContractDateRange' }
   ============================================================ */

// Stored Contract date fields controlled by this aggregate (single source of
// truth for the allowlist). endDate is intentionally absent — it is derived.
const CONTRACT_DATE_FIELDS = ['startDate', 'durationMonths'];

// Strict canonical date check: exactly YYYY-MM-DD AND a real calendar date
// (round-trip via UTC, no locale/timezone parsing). Rejects impossible dates.
function isCanonicalContractDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
  var dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Pure, read-only equivalent of the existing contractCalc() end derivation
// (people-core.js): end = last calendar day of (startMonth + durationMonths).
// Returns true iff a valid effective extent exists (derived end >= start).
function contractExtentIsValid(startDate, durationMonths) {
  if (!isCanonicalContractDate(startDate)) return false;
  if (!(typeof durationMonths === 'number') || !isFinite(durationMonths) ||
      !Number.isInteger(durationMonths) || durationMonths <= 0) return false;
  var sy = +startDate.slice(0, 4), sm = +startDate.slice(5, 7);
  var endD = new Date(sy, (sm - 1) + durationMonths, 0);   // day 0 = last day of prior month
  if (isNaN(endD.getTime())) return false;
  var end = endD.getFullYear() + '-' + String(endD.getMonth() + 1).padStart(2, '0') + '-' + String(endD.getDate()).padStart(2, '0');
  return end >= startDate;
}

const ContractDateAggregate = Object.freeze({
  prepare: function (id, patch) {
    // 1. Contract existence (read-only; never mutates State).
    var c = (typeof contractById === 'function') ? contractById(id) : null;
    if (!c) return { ok: false, error: 'ContractNotFound' };

    // 2. Strict allowlist: only startDate and durationMonths are considered.
    patch = patch || {};
    var hasStart = Object.prototype.hasOwnProperty.call(patch, 'startDate');
    var hasDur = Object.prototype.hasOwnProperty.call(patch, 'durationMonths');
    if (!hasStart && !hasDur) return { ok: false, error: 'NoContractDateFieldsProvided' };

    // Effective extent starts from the existing stored values; each submitted
    // allowed field overrides its part (partial updates are supported).
    var clean = {};
    var effStart = c.startDate ? String(c.startDate).slice(0, 10) : null;
    var effDur = Number(c.durationMonths) || 0;

    // 3. Normalize + validate startDate (strict canonical calendar date).
    if (hasStart) {
      var s = (patch.startDate == null ? '' : String(patch.startDate)).trim();
      if (!isCanonicalContractDate(s)) return { ok: false, error: 'InvalidStartDate' };
      clean.startDate = s;
      effStart = s;
    }

    // 4. Normalize + validate durationMonths (finite positive integer).
    if (hasDur) {
      var raw = (patch.durationMonths == null ? '' : String(patch.durationMonths)).trim();
      var n = Number(raw);
      if (raw === '' || !isFinite(n) || !Number.isInteger(n) || n <= 0) return { ok: false, error: 'InvalidDurationMonths' };
      clean.durationMonths = n;
      effDur = n;
    }

    // 5. Effective range validation (defensive; equivalent to contractCalc).
    //    With a strict canonical startDate and a positive-integer duration the
    //    derived end is always >= start, so this typed failure is defensive.
    if (!contractExtentIsValid(effStart, effDur)) return { ok: false, error: 'InvalidContractDateRange' };

    // 6. Return a fresh sanitized patch of only the SUBMITTED allowed fields.
    //    endDate is never included; all unrelated Contract data is preserved.
    return { ok: true, patch: clean };
  }
});

// Expose on the global object so the Domain facade can resolve this aggregate by
// name (top-level `const` objects are not attached to `window`, unlike function
// declarations). No eval; classic shared global scope.
if (typeof window !== 'undefined') { window.ContractDateAggregate = ContractDateAggregate; }
