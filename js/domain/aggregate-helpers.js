/* ============================================================
   DOMAIN LAYER — SHARED AGGREGATE HELPERS (PR-5F "The Sentinel")
   ------------------------------------------------------------
   A small toolkit of pure, domain-focused utilities extracted from the two
   operational aggregates (EmployeeContactAggregate, EmployeeEmploymentAggregate)
   where identical logic was duplicated. These are business-SUPPORT helpers
   only: they READ (existence) and TRANSFORM/VALIDATE plain values. They have
   NO side effects — no State mutation, no persistEmployees(), no history, no
   updatedAt, no render, no localStorage, no audit logging. Output is identical
   to the inlined logic they replace; this is a refactor, not a feature.

   This is deliberately NOT a framework: no base/abstract aggregate, factory,
   registry, inheritance, dependency injection, or plugin surface. Just a
   handful of explicit functions the aggregates call directly.
   ============================================================ */

// Read-only Employee existence lookup (never mutates State). Returns the
// Employee record or null. Mirrors the guarded empById call both aggregates used.
function employeeExists(id) {
  return (typeof empById === 'function') ? (empById(id) || null) : null;
}

// Project `patch` onto the allowed field list, trimming string values. Every
// non-allowed property is discarded. Returns a fresh object; never mutates input.
function normalizeAllowedFields(patch, allow) {
  patch = patch || {};
  allow = allow || [];
  var clean = {};
  for (var i = 0; i < allow.length; i++) {
    var k = allow[i];
    if (Object.prototype.hasOwnProperty.call(patch, k)) {
      clean[k] = (patch[k] == null ? '' : String(patch[k])).trim();
    }
  }
  return clean;
}

// Pure membership test against a canonical enum list.
function validateEnum(value, allowed) {
  return !!allowed && allowed.indexOf(value) !== -1;
}
