/* ============================================================
   PERSONAL WORKSPACE & SELF-SCOPE (UX-006B) — js/core/workspace.js
   ------------------------------------------------------------
   The first identity->business-data boundary. It derives a workspace and a
   SELF-scoped record view from the frozen UX-006A identity (getCurrentUser),
   binding an employee principal to its canonical Employee record and filtering
   business records to that principal's data scope.

   HEADLESS FOUNDATION (owner amendment R1): UX-006B ships the data/workspace/
   scope PRIMITIVES only. It wires NO live production UI consumer. In particular
   Global Search is intentionally left unchanged (global-search-ui.js /
   global-search.js untouched); the live principal-aware Global Search source
   integration is UX-006D, once a reachable principal-selection UX exists. This
   avoids regressing shipped Global Search while getCurrentUser() is null by
   default (no default principal, no selector yet).

   TRUST BOUNDARY: SELF scope is CLIENT-SIDE data-scope enforcement, NOT secure
   authorization. Identity is spoofable client-side; this reduces accidental
   cross-employee visibility in the UI but is not a server security control.
   Real security remains a future backend responsibility.

   SCOPE, NOT AUTHORIZATION: this module answers "which records are in this
   principal's data scope?" It never answers "which actions may the principal
   perform?" — no can(...)/canRead/canEdit/isAuthorized/hasPermission. Action
   authorization is UX-006C.

   Derived, not persisted: workspaces are a pure function of the current
   principal + company state. No State.identity slice, no bootstrap lifecycle,
   no storage key, no schema change (SCHEMA_VERSION stays 6). Everything is
   resolved lazily at call time (after loadState populates State).

   Binding: User.employeeId -> Employee.id (the opaque uid every business record
   already stores as record.employeeId). Employee.employeeId is a human code and
   is NEVER used for linkage. Classic shared global scope; mirrors identity.js /
   EmployeeRepository conventions.
   ============================================================ */

/* ---------- workspace classification ---------- */
const WORKSPACE_TYPES = Object.freeze({ EXECUTIVE: 'executive', PERSONAL: 'personal' });
const WORKSPACE_SCOPES = Object.freeze({ ALL_COMPANY: 'ALL_COMPANY', SELF: 'SELF' });
const EXECUTIVE_WORKSPACE_ID = 'workspace:executive:company';

/* ---------- bound-employee resolution (internal) ----------
   Resolves the canonical Employee record for the current principal, by strict
   identity equality User.employeeId === Employee.id (via the unchanged raw
   resolver empById). Returns null for a CEO (no employee binding), when no
   principal is selected, or when the referenced Employee does not exist. It
   NEVER creates an Employee and NEVER matches by name/email/human code. */
// Declared as a top-level `const` (function EXPRESSION), not a function
// declaration: in a classic script a `const` binding is NOT attached to the
// global `window` object, so this stays genuinely internal (not stable public
// API) while the runtime harness still reaches it via its same-scope export.
// Resolve the canonical Employee record for an EXPLICIT principal (does NOT read
// getCurrentUser). Binds strictly by principal.employeeId === Employee.id via the
// unchanged raw resolver empById; never by the human Employee.employeeId code, and
// never auto-creates. Internal lexical const (not on window).
const getBoundEmployeeForPrincipal = function(principal){
  if(!principal || principal.principalType !== PRINCIPAL_TYPES.EMPLOYEE) return null;
  const emp = (typeof empById === 'function') ? empById(principal.employeeId) : undefined;
  return emp || null;   // missing Employee record => null (fail closed)
};

// Current-context convenience: resolve the bound Employee for the currently
// selected principal. Delegates to the explicit-principal helper.
const getBoundEmployee = function(){
  const u = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  return getBoundEmployeeForPrincipal(u);
};

/* ---------- derived scope context (internal) ----------
   { workspace, principal, employee }, derived once from current state. Internal
   only — not a stable public API. Fail-closed: an employee with invalid linkage
   yields no workspace (never ALL_COMPANY); a CEO resolves without an employee. */
// Internal `const` (see getBoundEmployee) — not attached to window.
const getScopeContext = function(){
  const principal = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  const workspace = getCurrentWorkspace();
  const employee = getBoundEmployee();
  return { workspace: workspace, principal: principal, employee: employee };
};

/* ---------- derived workspace selector (PUBLIC) ----------
   CEO -> deterministic Executive Workspace (system-owned, ALL_COMPANY).
   Valid Employee -> deterministic Personal Workspace (owned by Employee.id, SELF).
   Employee with missing/invalid linkage, no principal, or unknown type -> null.
   Never returns Executive as a recovery for an employee failure. Deterministic
   across repeated calls for the same canonical state. */
function getCurrentWorkspace(){
  const u = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  if(!u) return null;
  if(u.principalType === PRINCIPAL_TYPES.CEO){
    return Object.freeze({
      id: EXECUTIVE_WORKSPACE_ID,
      type: WORKSPACE_TYPES.EXECUTIVE,
      scope: WORKSPACE_SCOPES.ALL_COMPANY,
      ownerRef: Object.freeze({ kind: 'system' })
    });
  }
  if(u.principalType === PRINCIPAL_TYPES.EMPLOYEE){
    const emp = getBoundEmployee();
    if(!emp) return null;              // missing linkage => no workspace (fail closed)
    return Object.freeze({
      id: 'workspace:personal:' + emp.id,
      type: WORKSPACE_TYPES.PERSONAL,
      scope: WORKSPACE_SCOPES.SELF,
      ownerRef: Object.freeze({ kind: 'employee', employeeId: emp.id })
    });
  }
  return null;                          // unknown principal type => fail closed
}

/* ---------- ENTITY_SCOPE — centralized SELF relations (internal) ----------
   The SINGLE home of entity-specific SELF knowledge. Each supported entity type
   maps to its canonical dataset accessor and its explicit SELF predicate. There
   is NO blind `record.employeeId` applied to arbitrary types: a new entity type
   must add an explicit predicate here (a deliberate decision point, never a
   silent default). This is record scope, not authorization. */
const ENTITY_SCOPE = Object.freeze({
  employee:    { collection: function(){ return State.employees      || []; }, self: function(r, eid){ return r && r.id === eid; } },
  contract:    { collection: function(){ return State.contracts       || []; }, self: function(r, eid){ return r && r.employeeId === eid; } },
  payrollPlan: { collection: function(){ return State.payrollPlans    || []; }, self: function(r, eid){ return r && r.employeeId === eid; } },
  overtime:    { collection: function(){ return State.overtimeRecords || []; }, self: function(r, eid){ return r && r.employeeId === eid; } },
  /* Readiness-1 — two further entity types, each with an EXPLICIT predicate over an
     ownership field the domain already carries. No ownership metadata is invented.
     payrollAdjustment: recurring additions/deductions are created per employee and
       already store employeeId (payroll-ops-engine.js filters on it).
     transaction: finance rows carry an OPTIONAL employeeId — payroll postings set it,
       ordinary company expenses do not. The Atlas ruling is that an Employee receives
       only records with an existing, explicit, unambiguous relationship, so a row with
       no employeeId is simply not in an Employee's scope. That is a deliberate
       fail-closed omission, NOT an invented ownership model: CEO still reads every row. */
  payrollAdjustment: { collection: function(){ return State.payrollAdjustments || []; }, self: function(r, eid){ return r && r.employeeId === eid; } },
  transaction:       { collection: function(){ return State.txns               || []; }, self: function(r, eid){ return !!(r && r.employeeId) && r.employeeId === eid; } }
});

/* ---------- getScopedRecords(entityType) — the single scope query (PUBLIC) ----------
   CEO            -> the full canonical dataset for the supported entity type.
   Valid Employee -> only records satisfying the entity's SELF predicate.
   No principal / missing-or-invalid linkage / unknown principal type -> [].
   Unknown entity type -> [] (fail closed).
   Never returns privileged/full-company data as a fallback for a failure, and
   never throws for an unsupported/invalid scope request. Returns a NEW array so
   callers cannot mutate the underlying collection. */
function getScopedRecords(entityType){
  const entry = ENTITY_SCOPE[entityType];
  if(!entry) return [];                                  // unknown entity type => closed
  const u = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  if(!u) return [];                                      // no principal => closed
  const all = entry.collection();
  if(u.principalType === PRINCIPAL_TYPES.CEO){
    return all.slice();                                  // ALL_COMPANY (full dataset copy)
  }
  if(u.principalType === PRINCIPAL_TYPES.EMPLOYEE){
    const emp = getBoundEmployee();
    if(!emp) return [];                                  // invalid linkage => closed
    const eid = u.employeeId;
    return all.filter(function(r){ return entry.self(r, eid); });
  }
  return [];                                             // unknown principal type => closed
}

/* ---------- isInScope(entityType, record) — single-record scope predicate (INTERNAL, UX-006C) ----------
   Answers "is this record within the current principal's data scope?" for the
   UX-006C authorization boundary's defense-in-depth precondition. It is backed
   by the SAME centralized ENTITY_SCOPE knowledge as getScopedRecords — it never
   duplicates a SELF comparison. Declared as a top-level `const` (function
   expression) so a classic script does NOT attach it to `window`: it is an
   INTERNAL lexical helper, NOT a fourth stable Workspace public API, and only
   the centralized authz module (and the test harness, via __TAM__) may use it.
   CEO (ALL_COMPANY) -> true for any supported record; valid Employee -> the
   entity's SELF predicate; no principal / invalid linkage / unknown type /
   missing record -> false (fail closed). */
// EXPLICIT-PRINCIPAL scope predicate — evaluates scope for the SUPPLIED principal
// and does NOT read getCurrentUser(). This is what the UX-006C authorization
// boundary must use so canPrincipal(principal, …) is deterministic from its
// supplied principal, never from whichever principal happens to be globally
// selected. Backed by the centralized ENTITY_SCOPE (no duplicated SELF logic).
// Employee linkage is validated against the SUPPLIED principal. Internal.
const isInScopeForPrincipal = function(principal, entityType, record){
  const entry = ENTITY_SCOPE[entityType];
  if(!entry || !record) return false;                    // unknown type / missing record => closed
  if(!principal) return false;                           // no principal => closed
  if(principal.principalType === PRINCIPAL_TYPES.CEO) return true;   // ALL_COMPANY
  if(principal.principalType === PRINCIPAL_TYPES.EMPLOYEE){
    const emp = getBoundEmployeeForPrincipal(principal);
    if(!emp) return false;                               // invalid linkage (for THIS principal) => closed
    return entry.self(record, principal.employeeId) === true;   // reuse the centralized SELF predicate
  }
  return false;                                          // unknown principal type => closed
};

// Current-context convenience: scope for the currently-selected principal.
// Delegates to the explicit-principal predicate. Internal (not on window).
const isInScope = function(entityType, record){
  const u = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  return isInScopeForPrincipal(u, entityType, record);
};

/* ---------- getScopedRecordById(entityType, id) — scoped single-record read (PUBLIC) ----------
   Readiness-1. The detail-page counterpart of getScopedRecords: resolve a record by
   id AND confirm it is inside the CURRENT principal's scope, in one call.

   This exists because a detail view is reached by an id that was captured earlier —
   from a list row, a search result, a Quick Action or a deep link — and that id may
   have been resolved under a DIFFERENT principal. Trusting it would let a stale
   selection survive a principal switch (CEO opens a colleague, switches to Employee,
   and the colleague's salary stays on screen). Scope is therefore re-evaluated at
   RENDER time, from the current principal, every time.

   Returns the record, or null when it does not exist or is out of scope — the two
   cases are deliberately indistinguishable to the caller, so a renderer cannot leak
   the existence of a foreign record by rendering a different message for it.
   CEO -> any record; valid Employee -> own records only; null/invalid -> null. */
function getScopedRecordById(entityType, id){
  const entry = ENTITY_SCOPE[entityType];
  if(!entry || !id) return null;                           // unknown type / no id => closed
  const rec = entry.collection().find(function(r){ return r && r.id === id; });
  if(!rec) return null;                                    // does not exist
  return isInScope(entityType, rec) ? rec : null;          // exists but out of scope => closed
}

// Classic shared global scope; expose ONLY the stable public API on the global
// object (mirrors identity.js). Internal helpers (getBoundEmployee,
// getBoundEmployeeForPrincipal, getScopeContext, ENTITY_SCOPE, isInScope,
// isInScopeForPrincipal) are deliberately NOT exposed as application API; tests
// reach them via the harness's appended __TAM__ export, which runs in this same
// lexical script scope. No eval, no module system.
if (typeof window !== 'undefined') {
  window.WORKSPACE_TYPES = WORKSPACE_TYPES;
  window.getCurrentWorkspace = getCurrentWorkspace;
  window.getScopedRecords = getScopedRecords;
  window.getScopedRecordById = getScopedRecordById;
}
