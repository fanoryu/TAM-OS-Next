/* ============================================================
   AUTHORIZATION FOUNDATION (UX-006C1) — js/core/authz.js
   ------------------------------------------------------------
   Centralized, headless authorization: it answers ONE question — *which
   MUTATION/action may the current principal perform on a record already in
   scope?* It is strictly separate from UX-006B scope, which answers *which
   records are visible*. Reads are owned entirely by scope (getScopedRecords);
   there are NO read actions here.

   HEADLESS FOUNDATION (UX-006C1): this module defines the policy primitives and
   is proven by tools/verify-authz-runtime.js. It wires NO live business mutation
   boundary — that is UX-006C2. No UI, no Action Center, no navigation, no Global
   Search, no Data Grid change.

   TRUST BOUNDARY: client-side policy is UX enforcement only. Identity is
   spoofable client-side; these checks reduce accidental cross-principal actions
   in the UI but are NOT a server security control. Real authorization is a
   future backend responsibility. Do NOT describe this as secure authorization,
   and this is NOT authentication (no password/token/session/oauth).

   Scope vs authorization: authorization consults the frozen UX-006B scope
   predicate (isInScope) as a defense-in-depth precondition (AZ-1). It never
   duplicates SELF relations. Fail-closed everywhere (AZ-2): unknown/indeterminate
   state DENIES and never falls back to CEO/company capability.

   Classic shared global scope; mirrors identity.js / workspace.js conventions.
   ============================================================ */

/* ---------- ACTIONS — mutation/action-only vocabulary (frozen) ----------
   Grounded in the real mutation surface. NO `*.read` / `*.read.self` actions:
   read visibility is a scope concern (UX-006B), not authorization. */
const ACTIONS = Object.freeze({
  EMPLOYEE_CREATE:    'employee.create',
  EMPLOYEE_UPDATE:    'employee.update',
  EMPLOYEE_DELETE:    'employee.delete',
  CONTRACT_CREATE:    'contract.create',
  CONTRACT_UPDATE:    'contract.update',
  CONTRACT_DELETE:    'contract.delete',
  PAYROLL_MANAGE:     'payroll.manage',
  OVERTIME_SUBMIT_SELF:'overtime.submitSelf',
  // UX-006C2B — Employee self-service on OWN Draft overtime (reviewed C2B amendment,
  // ACTIONS 13 -> 16). Ownership is enforced by the AZ-1 scope precondition; the
  // predicates below additionally require the record be a Draft.
  OVERTIME_CREATE_SELF_DRAFT:'overtime.createSelfDraft',
  OVERTIME_UPDATE_SELF_DRAFT:'overtime.updateSelfDraft',
  OVERTIME_DELETE_SELF_DRAFT:'overtime.deleteSelfDraft',
  OVERTIME_MANAGE:    'overtime.manage',
  FINANCE_EXECUTE:    'finance.execute',
  // UX-006C2C-2 — reviewed Finance vocabulary split (Decision F2, ACTIONS 16 -> 17).
  // The Finance surface has two distinct behaviour classes: `finance.execute` is the
  // IRREVERSIBLE posting of a planned transaction to an actual (unchanged meaning);
  // `finance.manage` is the reversible/administrative standalone transaction mutation
  // (create / edit / archive / schedule / cancel / duplicate / delete). Both are
  // CEO-only. Keeping them separate keeps the audit trail and any future backend
  // policy truthful — an "edit" is never authorized as an "execute".
  FINANCE_MANAGE:     'finance.manage',
  IMPORT_COMMIT:      'import.commit',
  SUPPLEMENTAL_MANAGE:'supplemental.manage',
  SETTINGS_MANAGE:    'settings.manage',
  // UX-006C2C-3 — frozen mapping ruling (ACTIONS 17 -> 20). Three capabilities the
  // existing vocabulary cannot express without becoming misleading:
  //   `import.undo`   reverse a committed Smart Import batch, DELETING the records it
  //                   created (transactions, payroll plans, contracts, employees).
  //                   `import.commit` means commit; granting it must never confer this.
  //   `data.restore`  replace stored data from a backup — one month, or the Complete
  //                   Backup (every collection + settings). Not configuration
  //                   (`settings.manage`) and not transaction administration
  //                   (`finance.manage`); it is a data-lifecycle capability.
  //   `data.reset`    irreversibly destroy all stored data. Deliberately separate from
  //                   `data.restore` (recoverable, takes a safety backup) exactly as
  //                   `finance.execute` is separate from `finance.manage`.
  // All three are CEO-only. Rejected during the ruling: `recurring.manage`,
  // `bank.manage`, `employee.merge`.
  IMPORT_UNDO:        'import.undo',
  DATA_RESTORE:       'data.restore',
  DATA_RESET:         'data.reset'
});
// The set of valid action strings, for fail-closed validation of unknown actions.
const ACTION_SET = Object.freeze(Object.keys(ACTIONS).map(function(k){ return ACTIONS[k]; }));

/* ---------- resource-bearing actions ----------
   Which actions require a scoped resource. System/collection actions
   (import.commit, settings.manage) legitimately take no record resource. Each
   resource-bearing action maps to its scope entity type (for the AZ-1 scope
   precondition, evaluated via the frozen isInScope predicate). */
const ACTION_RESOURCE_ENTITY = Object.freeze({
  'employee.create':     null,          // create has no pre-existing record
  'employee.update':     'employee',
  'employee.delete':     'employee',
  'contract.create':     null,
  'contract.update':     'contract',
  'contract.delete':     'contract',
  'payroll.manage':      'payrollPlan',
  'overtime.submitSelf': 'overtime',
  'overtime.createSelfDraft': 'overtime',   // candidate record; AZ-1 verifies own scope
  'overtime.updateSelfDraft': 'overtime',
  'overtime.deleteSelfDraft': 'overtime',
  'overtime.manage':     'overtime',
  'finance.execute':     null,          // txn scope is Executive-only (no employee SELF path)
  'finance.manage':      null,          // same: transaction administration is Executive-only
  'import.commit':       null,
  'supplemental.manage': null,
  'settings.manage':     null,
  'import.undo':         null,          // batch-scoped system op; no per-record scope path
  'data.restore':        null,          // whole-dataset replacement; Executive-only
  'data.reset':          null           // whole-dataset destruction; Executive-only
});

/* ---------- POLICY — centralized action -> predicate registry ----------
   The SINGLE home of authorization rules. Each action maps to a pure predicate
   over (principal, resource, ctx) -> boolean. CEO is a pass-through (true) for
   every action; Employee is deny-by-default with exactly one allowed mutation
   in UX-006C1: overtime.submitSelf on an own in-scope Draft. No scattered role
   checks live outside this module. */
// Internal `const` (function expression) so a classic script does not attach it
// to `window` (a function declaration would). Not application API.
const ceoOnly = function(principal){ return !!principal && principal.principalType === PRINCIPAL_TYPES.CEO; };

// UX-006C2B — CEO pass-through; Employee allowed ONLY when the (own, per AZ-1 scope)
// overtime record is a Draft. Shared by create/update/delete self-Draft policies.
const selfDraftOnly = function(principal, resource){
  if(!principal) return false;
  if(principal.principalType === PRINCIPAL_TYPES.CEO) return true;
  if(principal.principalType === PRINCIPAL_TYPES.EMPLOYEE){
    return !!resource && resource.status === 'Draft';
  }
  return false;
};

const POLICY = Object.freeze({
  'employee.create':     ceoOnly,
  'employee.update':     ceoOnly,
  'employee.delete':     ceoOnly,
  'contract.create':     ceoOnly,
  'contract.update':     ceoOnly,
  'contract.delete':     ceoOnly,
  'payroll.manage':      ceoOnly,
  'overtime.createSelfDraft': selfDraftOnly,
  'overtime.updateSelfDraft': selfDraftOnly,
  'overtime.deleteSelfDraft': selfDraftOnly,
  'overtime.manage':     ceoOnly,
  'finance.execute':     ceoOnly,
  'finance.manage':      ceoOnly,
  'import.commit':       ceoOnly,
  'supplemental.manage': ceoOnly,
  'settings.manage':     ceoOnly,
  // UX-006C2C-3 — explicit CEO-only entries (never a default/inherited allow).
  'import.undo':         ceoOnly,
  'data.restore':        ceoOnly,
  'data.reset':          ceoOnly,
  // The single approved employee self-service mutation (UX-006C1). CEO also
  // passes (company overtime management is CEO-side). Employee is allowed ONLY
  // to transition an own in-scope Overtime record from Draft -> Submitted.
  'overtime.submitSelf': function(principal, resource){
    if(!principal) return false;
    if(principal.principalType === PRINCIPAL_TYPES.CEO) return true;
    if(principal.principalType === PRINCIPAL_TYPES.EMPLOYEE){
      // resource must be an Overtime record currently in Draft (the scope
      // precondition in canPrincipal already proved it is the principal's own
      // record). Draft -> Submitted is the only authorized transition here.
      return !!resource && resource.status === 'Draft';
    }
    return false;
  }
});

/* ---------- canPrincipal(principal, action, resource, ctx) — pure policy (INTERNAL) ----------
   Deterministic, DOM-free, side-effect-free boolean. Fail-closed (AZ-2): any
   unknown/indeterminate input denies, and never falls back to CEO. Applies the
   AZ-1 scope precondition (via the frozen isInScope predicate) for resource-
   bearing actions before consulting POLICY. `ctx` is optional and reserved for
   a future backend/context provider; UX-006C1 does not require it.
   Declared as an internal `const` (function expression) so it is NOT attached to
   the production `window` — it is the pure/internal seam, not application API. */
const canPrincipal = function(principal, action, resource, ctx){
  try {
    if(!principal) return false;                                   // no principal
    if(principal.principalType !== PRINCIPAL_TYPES.CEO
       && principal.principalType !== PRINCIPAL_TYPES.EMPLOYEE) return false;  // unknown principal
    if(typeof action !== 'string' || ACTION_SET.indexOf(action) === -1) return false;  // unknown/malformed action
    const predicate = POLICY[action];
    if(typeof predicate !== 'function') return false;              // unsupported action
    const entity = ACTION_RESOURCE_ENTITY[action];
    if(entity){
      // Resource-bearing action: require a resource that is in the principal's
      // scope (AZ-1). Delegates to the frozen UX-006B scope predicate — no
      // duplicated SELF logic here.
      if(!resource || typeof resource !== 'object') return false;  // missing/malformed required resource
      // Use the EXPLICIT-principal scope predicate so this stays deterministic
      // from the SUPPLIED principal and never depends on the globally-selected
      // currentUser. Delegates to the frozen UX-006B scope knowledge.
      const inScope = (typeof isInScopeForPrincipal === 'function')
        ? isInScopeForPrincipal(principal, entity, resource) : false;
      if(inScope !== true) return false;                           // out-of-scope resource => deny
    }
    return predicate(principal, resource, ctx) === true;
  } catch(_e){
    return false;                                                  // policy exception => deny
  }
};

/* ---------- can(action, resource?) — the single canonical consumer entry point (PUBLIC) ----------
   Resolves the current principal from the frozen identity seam and delegates to
   the pure canPrincipal. Returns a strict boolean; fail-closed to false. This is
   the ONLY authorization symbol application/UI code may depend on. */
function can(action, resource){
  const principal = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  return canPrincipal(principal, action, resource, undefined);
}

// Classic shared global scope; expose ONLY the stable public API on the global
// object. Internal symbols (canPrincipal, POLICY, ACTION_SET,
// ACTION_RESOURCE_ENTITY, ceoOnly) are deliberately NOT exposed as application
// API; tests reach them via the harness's appended __TAM__ export, which runs in
// this same lexical script scope. No eval, no module system.
if (typeof window !== 'undefined') {
  window.ACTIONS = ACTIONS;
  window.can = can;
}
