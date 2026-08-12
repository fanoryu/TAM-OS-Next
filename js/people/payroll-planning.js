/* ============================================================
   SHARED PAYROLL/PLAN UTILITIES (formerly "PAYROLL PLANNING")
   ------------------------------------------------------------
   RETIRED SURFACE (SPR-078). This module used to host the legacy Payroll Planning
   screen and its own posting path. The Payroll Workspace superseded that screen in
   v2.5.0 ("Payroll Planning is now the primary monthly payroll operations
   workspace"), and its route was removed at that time: no `State.view` value
   rendered it, no navigation entry reached it, and the only callers of
   renderPayrollPlanning() were its own internal re-renders. It was unreachable UI.

   Its posting function, commitPayroll(), was therefore DEAD CODE — and it was a
   second, divergent Payroll posting authority: it enforced no period lock, no
   commit blockers, and no `Ready` source-status gate, wrote no audit entry, never
   set committedAt, and wrote the payroll status as lowercase 'committed', which is
   NOT a member of PAYROLL_STATUSES. Rows it produced carried a real Finance
   transaction while reading as stage "Draft", were invisible to the integrity
   checker and HR reports, and were rejected by PayrollLifecycleAggregate as
   InvalidPayrollLifecycleState — permanently un-transitionable.

   SPR-078 removed that entire dead surface: commitPayroll, renderPayrollPlanning,
   renderPayrollDraft, payrollRowHTML, generatePayrollRows, buildPayrollTxn,
   payrollAmount, and samePayrollComponents. None had an external consumer.

   commitReadyPayroll (payroll-ops-engine.js) is now the SOLE live Payroll posting
   path and the single Payroll posting authority.

   WHAT REMAINS: the two shared utilities that other modules genuinely depend on
   and that are defined nowhere else. This file is kept (rather than deleted) for
   exactly that reason, and its load-order position is unchanged.
     - num()               — used by 12 modules across core, finance, people, import
     - ensureMonthlyPlan() — used by payroll-ops-engine, monthly-plan, smart-import
   ============================================================ */

// Numeric coercion used repository-wide. Sole definition; never returns NaN.
function num(x){ const n=Number(x); return isFinite(n)?n:0; }

// Get (or lazily create) the MonthlyPlan for a period. Sole definition. Creates a
// Draft plan when none exists and guarantees committedTxnIds is an array. Shared by
// the live posting path (commitReadyPayroll), the Monthly Plan Generator, and
// Smart Import. Behavior is unchanged by SPR-078.
function ensureMonthlyPlan(monthKey){
  let plan = monthlyPlanFor(monthKey);
  if(!plan){ const mo=keyToMonthObj(monthKey); plan={id:uid('mp'), monthKey, month:mo.month, year:mo.year, monthNum:mo.monthNum, status:'Draft', committedTxnIds:[], createdAt:new Date().toISOString()}; State.monthlyPlans.push(plan); }
  if(!Array.isArray(plan.committedTxnIds)) plan.committedTxnIds=[];
  return plan;
}
