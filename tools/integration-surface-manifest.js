/*
 * integration-surface-manifest.js — UX-006C3 INTEGRATION FREEZE.
 *
 * The single source of truth for the authorization-aware integration surface, mirroring
 * the tools/module-order.js precedent: a tools-side manifest that the verifier reads and
 * cross-checks against the real source, so the freeze is MACHINE-ENFORCED (ruling C3-R8)
 * rather than a documentation status. A new or removed integration surface fails
 * verification until this manifest is updated and re-reviewed.
 *
 * Frozen semantics it encodes (Atlas rulings C3-R1 … C3-R5):
 *   navigationOnly entries        -> availability 'visible-normal'.  Never hidden, never
 *                                    disabled: view access is not mutation authority, and
 *                                    destinations are multi-capability / read-useful.
 *   mutation-control entries      -> availability 'visible-disabled-when-denied', and ONLY
 *                                    where the control maps to exactly ONE frozen action.
 *   `action`                      -> null for navigation-only; a single ACTIONS value for a
 *                                    mutation control. Never an aggregate/union.
 *
 * The UI availability expressed here is an AFFORDANCE ONLY (C3-R3). The mutation boundary
 * keeps its own can(...) gate and denies independently; a disabled control is never the
 * authorization boundary.
 */
'use strict';

// --- sidebar navigation: mirrors NAV_GROUPS in js/ui/shell-render.js (27 items) ---
const SIDEBAR = [
  { group:'dashboard', items:['execDashboard','execinsights'] },
  { group:'people',    items:['employees','contracts'] },
  { group:'finance',   items:['financeOverview','payroll','transactions','monthlyplan','overtime',
                              'supplementals','add','recurring','cashflow','budgetcenter',
                              'executioncenter','bankaccounts','projects','vendors','calendar'] },
  { group:'analytics', items:['planvsactual','compare','trends','reports'] },
  { group:'system',    items:['settings','activity','about','releasenotes'] }
];

// --- Quick Actions: mirrors QUICK_ACTIONS_BY_VIEW (6 views, 12 entries) ---
const QUICK_ACTIONS = [
  { view:'employeeDetail',  destinations:['contractDetail','payroll'] },
  { view:'contractDetail',  destinations:['employeeDetail','payroll'] },
  { view:'payroll',         destinations:['executioncenter'] },
  { view:'payrollDetail',   destinations:['transactions','executioncenter'] },
  { view:'overtime',        destinations:['payroll','executioncenter'] },
  { view:'executioncenter', destinations:['transactions','payroll','overtime'] }
];

// --- Action Center: mirrors actionCenterSources() in js/analytics/executive-dashboard.js ---
const ACTION_CENTER = [
  { generator:'computeExecutiveAlerts',  to:'financeOverview' },
  { generator:'hrDashboardAlerts',       to:'contracts' },
  { generator:'overtimeDashboardAlerts', to:'overtime' },
  { generator:'payrollDashboardAlerts',  to:'payroll' }
];

/* --- mutation controls with authorization-aware availability (C3-R2) ---
   Each entry maps to EXACTLY ONE frozen action. A control whose destination or behaviour
   spans several capabilities is deliberately absent: no aggregate rule is invented, the
   control simply stays normal and its mutation boundary denies. `marker` is the literal
   the verifier looks for at the render site, so ordering/format changes cannot silently
   drop the availability without failing the freeze. */
const MUTATION_CONTROLS = [
  { id:'genPay',              file:'js/people/payroll-workspace.js', action:'payroll.manage',
    label:'Generate Payroll',            marker:'authzDisabled(ACTIONS.PAYROLL_MANAGE' },
  { id:'lockBtn',             file:'js/people/payroll-workspace.js', action:'payroll.manage',
    label:'Lock / Unlock Period',        marker:'authzDisabled(ACTIONS.PAYROLL_MANAGE' },
  { id:'resetAppData',        file:'js/ui/settings-about.js',        action:'data.reset',
    label:'Reset All Data',              marker:'authzDisabled(ACTIONS.DATA_RESET' },
  { id:'drStartFresh',        file:'js/ui/settings-about.js',        action:'data.reset',
    label:'Start Fresh',                 marker:'authzDisabled(ACTIONS.DATA_RESET' },
  { id:'drDemo',              file:'js/ui/settings-about.js',        action:'employee.create',
    label:'Load Demo Data',              marker:'authzDisabled(ACTIONS.EMPLOYEE_CREATE' },
  { id:'data-restore-backup', file:'js/finance/add-upload.js',       action:'data.restore',
    label:'Restore month backup',        marker:'authzDisabled(ACTIONS.DATA_RESTORE' },
  { id:'irUndo',              file:'js/import/smart-import-ui.js',   action:'import.undo',
    label:'Undo Last Smart Import',      marker:'authzDisabled(ACTIONS.IMPORT_UNDO' }
];

const NAV_COUNT = SIDEBAR.reduce((n,g)=>n+g.items.length, 0);                       // 27
const QUICK_ACTION_COUNT = QUICK_ACTIONS.reduce((n,v)=>n+v.destinations.length, 0); // 12
const ACTION_CENTER_COUNT = ACTION_CENTER.length;                                   // 4

module.exports = {
  SIDEBAR, QUICK_ACTIONS, ACTION_CENTER, MUTATION_CONTROLS,
  NAV_COUNT, QUICK_ACTION_COUNT, ACTION_CENTER_COUNT,
  // The frozen inventory total from the merged UX-006C3 decision-preparation memo.
  NAVIGATION_TOTAL: NAV_COUNT + QUICK_ACTION_COUNT + ACTION_CENTER_COUNT,           // 43
  // Every navigation surface is navigation-only: it assigns view state and re-renders.
  // No entry may perform a domain mutation (verified behaviourally by the C3 harness).
  NAVIGATION_AVAILABILITY: 'visible-normal',
  MUTATION_CONTROL_AVAILABILITY: 'visible-disabled-when-denied'
};
