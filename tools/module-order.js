/*
 * module-order.js — the single source of truth for JS load order (v2.6.2+).
 * Classic ordered scripts share one global scope; this array defines the exact
 * order they must load in (index.html mirrors it as <script src> tags, and the
 * build/verify tools require it). Paths are relative to js/.
 *
 * Order is behavior-critical: it reproduces the original single-file script order.
 * Do NOT reorder casually — top-level const initializations depend on it.
 */
'use strict';
module.exports = [
  // --- core leaves + data ---
  'core/constants.js',
  'core/utils.js',
  // UX-006A Identity Foundation — a core leaf with no cross-module deps. Owns a
  // canonical IdentityProvider seam + local dev/test adapter; no State, no
  // bootstrap, no persistence, no schema. Loaded early after the other leaves.
  'core/identity.js',
  // UX-006B Personal Workspace & SELF-scope — derived workspace + scope query
  // layer over unchanged raw resolvers. Depends on identity (getCurrentUser,
  // PRINCIPAL_TYPES) at call time; reads State/empById lazily post-load. No
  // State slice, no bootstrap, no persistence, no schema. Headless (no live UI
  // consumer wired in 006B).
  'core/workspace.js',
  // UX-006C1 Authorization Foundation — centralized headless policy: mutation-only
  // ACTIONS, can()/canPrincipal()/POLICY, scope precondition via the frozen
  // isInScope. Depends on identity (getCurrentUser/PRINCIPAL_TYPES) and workspace
  // (isInScope) at call time. No live mutation wiring, no State, no bootstrap, no
  // persistence, no schema. Loads after workspace.js.
  'core/authz.js',
  'core/data-grid.js',
  'core/global-search.js',
  'core/storage-adapter.js',
  'ui/charts.js',
  'core/state.js',
  'core/state-load-migrations.js',
  'core/domain-services.js',
  'import/parser.js',
  'ui/shell-render.js',
  // UX-006D1 Reachable Principal Selection — a compact "Acting as" selector the
  // shell mounts into .brand. Depends on identity (LocalIdentityProvider,
  // getCurrentUser), utils (escapeHtml), and the shell facade (render) at CALL
  // time; defines only functions at load time. Loads after shell-render.js (whose
  // renderShell/bindShell/syncShellState call it) and before bootstrap. No State,
  // no persistence, no schema.
  'ui/identity-selector.js',
  'ui/global-search-ui.js',
  // --- finance pages (from 09) ---
  'finance/dashboard.js',
  'finance/execution-center.js',
  'finance/transaction-modals.js',
  'finance/transactions.js',
  'finance/add-upload.js',
  // --- HR persistence + portability (10) ---
  'core/hr-persistence-portability.js',
  // --- repository layer (Milestone Delta, PR-8A): the first persistence-mechanics
  //     boundary between handler mutation and the existing collection persistence.
  //     Loads AFTER the persist functions (persistEmployees) it delegates to and
  //     BEFORE the migrated handler (people/employees.js). Owns no business behavior. ---
  'repository/employee-repository.js',
  // --- PR-10A: the SECOND entity Repository. Loads AFTER the persist functions
  //     (persistContracts) it delegates to and BEFORE the migrated handler
  //     (people/contracts.js). Owns no business behavior. ---
  'repository/contract-repository.js',
  // --- PR-11A: the THIRD entity Repository. Loads AFTER the persist functions
  //     (persistPayrollPlans) it delegates to and BEFORE the migrated handler
  //     (people/payroll-ops-engine.js). Owns no business behavior. ---
  'repository/payroll-repository.js',
  // --- import UI + analytics + settings + reports (from 11) ---
  'import/import-preview.js',
  'analytics/plan-vs-actual.js',
  'analytics/compare.js',
  'analytics/trends.js',
  'analytics/executive-dashboard.js',
  'finance/cashflow.js',
  'finance/budget.js',
  'analytics/executive-insights.js',
  'ui/settings-about.js',
  'ui/activity-log.js',
  'analytics/reports.js',
  // --- people & contracts (from 12) ---
  'people/people-core.js',
  'people/employees.js',
  'people/contracts.js',
  'people/payroll-planning.js',
  'people/recurring-expenses.js',
  'people/monthly-plan.js',
  'people/legacy-mapping.js',
  'people/hr-dashboard-reports.js',
  // --- stabilization (13), overtime (14), onboarding (15) ---
  'core/stabilization.js',
  'people/overtime.js',
  'core/onboarding-reset.js',
  // --- smart import + dedup (16, 17) ---
  'import/smart-import-extract.js',
  'import/smart-import-commit.js',
  'people/employee-dedup.js',
  'import/smart-import-ui.js',
  // --- native payroll ops + workspace (from 18) ---
  'people/payroll-ops-engine.js',
  'people/payroll-workspace.js',
  // --- supplemental payroll engine (v2.7.0) ---
  'people/supplemental-engine.js',
  // --- domain layer (Enterprise Foundation, PR-5): additive, behavior-neutral
  //     single source of truth over the existing handlers. Loaded after all
  //     domain functions are defined and before bootstrap. ---
  'domain/aggregates.js',
  'domain/commands.js',
  'domain/queries.js',
  'domain/events.js',
  'domain/aggregate-helpers.js',
  'domain/employee-contact-aggregate.js',
  'domain/employee-employment-aggregate.js',
  'domain/employee-lifecycle-aggregate.js',
  'domain/employee-compensation-aggregate.js',
  'domain/contract-date-aggregate.js',
  'domain/payroll-lifecycle-aggregate.js',
  'domain/contract-status-aggregate.js',
  'domain/contract-renewal-aggregate.js',
  // --- SPR-095: the fourth Contract aggregate (ADR-014 Contract Core field
  //     authority). Purely declarative like its siblings — it defines a frozen
  //     object and invokes nothing at load time. Registered but NOT routed. ---
  'domain/contract-core-aggregate.js',
  'domain/domain-layer.js',
  // --- platform layer (Milestone Delta, PR-6A): the application boundary above
  //     the Domain. Loads AFTER the Domain facade (which it delegates to) and
  //     before bootstrap. Owns no business behavior. ---
  'platform/application-gateway.js',
  // --- transport layer (Milestone Delta, PR-7A): the canonical application
  //     transport boundary ABOVE the Application Gateway. Loads AFTER the
  //     gateway it delegates to (and only to) and before bootstrap. Owns no
  //     business behavior. ---
  'transport/transport-adapter.js',
  // --- bootstrap (19) ---
  'core/app-bootstrap.js'
];
