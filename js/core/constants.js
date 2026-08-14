/* ============================================================
   TAM FINANCE OS — application logic
   ============================================================ */

/* ============================================================
   TAM INTELLIGENCE OS — single-file application script
   Section map (v2.2.1 Architecture Review & Stabilization):
     1.  Constants & app identity
     2.  Storage Adapter (single persistence gateway)
     3.  Utilities & centralized notifications
     4.  Chart engine (self-contained SVG)
     5.  State, settings, load & migrations
     6.  Data services & derived business logic
     7.  Parsers / Excel-CSV import
     8.  Navigation, shell & page renderers
     9.  Modal renderers
     10. People & Contracts engine (employees/contracts/payroll/plans)
     11. Reports, settings & dashboard integration
     12. v2.2.1 Stabilization layer: save coordinator, normalization
         migration, validators, integrity checker, a11y helpers
     13. Initialization
   Business calculations are centralized (one implementation each):
     statusOf/computeStatus, contractCalc, payrollAmount, monthTotals,
     execStats, recurringDueInMonth, coveringContract, empEligible.
   ============================================================ */

/* ---------- app identity ---------- */
const APP_NAME = 'TAM OS';
const APP_VERSION = '2.10.0';
const APP_RELEASE_NAME = 'Governed Workspace';
const APP_TAGLINE = 'Finance Execution Engine';
const FILE_BASE = 'tam-intelligence-os-v' + APP_VERSION; // versioned base for the file itself and every download
const APP_POSITIONING = 'Integrated Management Intelligence for PT Total Asset Manajemen';
const COMPANY_NAME_DEFAULT = 'PT Total Asset Manajemen';
/* BRAND-1: persistent-chrome monogram (Model C). Inline data URI = the existing approved
   favicon mark (resize-only from tam-os-logo-secondary.png), so the portable artifact stays
   self-contained offline. Reuse of an existing asset — the symbol is not redrawn (R1). */
const BRAND_MONOGRAM = 'data:image/png;base64,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';
const SCHEMA_VERSION = 6;

/* ---------- transaction lifecycle ---------- */
const STATUS = {
  PLANNED:'planned', SCHEDULED:'scheduled', PARTIAL:'partial',
  COMPLETED:'completed', CANCELLED:'cancelled', ARCHIVED:'archived',
};
const STATUS_META = {
  planned:   {label:'Planned',   color:'#C9A15C', dot:'🟡', pill:'pill-status-planned'},
  scheduled: {label:'Scheduled', color:'#6FA3D8', dot:'🔵', pill:'pill-status-scheduled'},
  partial:   {label:'Partial',   color:'#D98A3D', dot:'🟠', pill:'pill-status-partial'},
  completed: {label:'Completed', color:'#4FAE7C', dot:'🟢', pill:'pill-status-completed'},
  cancelled: {label:'Cancelled', color:'#C1543F', dot:'🔴', pill:'pill-status-cancelled'},
  archived:  {label:'Archived',  color:'#96A1BA', dot:'⚪', pill:'pill-status-archived'},
};
const PAYMENT_METHODS = ['Cash','Bank Transfer','QRIS','Virtual Account','Credit Card','Other'];
// Legacy company-account strings (v2.5.x). Retained for backward compatibility with
// transactions/recurring rows that stored one of these strings; v2.6.9 introduces the
// structured Company Bank Accounts store (tam_company_accounts_v1) that supersedes it.
const BANK_ACCOUNTS = ['Mandiri Operational','Mandiri Payroll','BCA','BSI','Cash'];

/* ============================================================
   INDONESIAN BANK MASTER (v2.6.9) — single source of truth.
   A static, reusable reference list (NOT company accounts). Grouped by
   type and alphabetically sorted within each group; "Other Bank" is the
   catch-all. This is a constant (no storage key, no schema change): it is
   reference data, so there is exactly one array and no duplication.
   Company Bank Accounts (tam_company_accounts_v1) reference a bank by name
   from this master; Employee banking selects its bank from here too.
   ============================================================ */
const BANK_MASTER_GROUPS = [
  { group:'State Banks', banks:[
    'Bank Mandiri','Bank Negara Indonesia (BNI)','Bank Rakyat Indonesia (BRI)','Bank Tabungan Negara (BTN)',
  ]},
  { group:'Private', banks:[
    'Bank Bukopin','Bank Mega','Bank Sinarmas','BCA','CIMB Niaga','Danamon','Maybank Indonesia','OCBC','Panin Bank','Permata',
  ]},
  { group:'Digital', banks:[
    'Allo Bank','Bank Jago','Bank Neo Commerce','Bank Raya Indonesia','Bank Saqu','blu by BCA Digital','SeaBank Indonesia','Superbank',
  ]},
  { group:'Islamic (Syariah)', banks:[
    'Bank Aladin Syariah','Bank Mega Syariah','Bank Muamalat','Bank Panin Dubai Syariah','Bank Syariah Indonesia','Bank Victoria Syariah','BCA Syariah',
  ]},
  { group:'Regional (BPD)', banks:[
    'Bank BJB','Bank DKI','Bank Jateng','Bank Jatim','Bank Kaltimtara','Bank Lampung','Bank Nagari','Bank NTB Syariah','Bank Papua','Bank Riau Kepri Syariah','Bank Sulselbar','Bank Sumsel Babel','Bank Sumut',
  ]},
  { group:'International', banks:[
    'Bank of China Indonesia','Citibank Indonesia','HSBC Indonesia','Standard Chartered Indonesia','UOB Indonesia',
  ]},
  { group:'Other', banks:['Other Bank'] },
];
// Flat, de-duplicated list derived from the grouped master (single source — no second array).
const INDONESIAN_BANKS = BANK_MASTER_GROUPS.reduce((acc,g)=>{ g.banks.forEach(b=>{ if(!acc.includes(b)) acc.push(b); }); return acc; }, []);

/* Company Bank Account (v2.6.9) enums — structured, user-managed accounts. */
const COMPANY_ACCOUNT_PURPOSES = ['Operational','Payroll','Tax','Savings','Petty Cash','Other'];
const COMPANY_ACCOUNT_STATUSES = ['Active','Inactive','Archived'];

/* ---------- People & Contracts lifecycle (v2.2.0) ---------- */
const EMPLOYMENT_STATUSES = ['Active','Inactive','On Leave','Resigned','Terminated'];
const EMP_STATUS_META = {
  'Active':     {pill:'pill-status-completed', eligible:true},
  'On Leave':   {pill:'pill-status-partial',   eligible:false},
  'Inactive':   {pill:'pill-status-archived',  eligible:false},
  'Resigned':   {pill:'pill-status-cancelled', eligible:false},
  'Terminated': {pill:'pill-status-cancelled', eligible:false},
};
const CONTRACT_TYPES = ['Permanent','Fixed-Term (PKWT)','Probation','Freelance','Internship'];
// Draft / Active / Cancelled / Renewed are stored states the user sets.
// Expiring Soon / Expired are derived from dates and never stored.
const CONTRACT_STORED_STATUSES = ['Draft','Active','Renewed','Cancelled'];
const CONTRACT_STATUS_META = {
  'Draft':         {pill:'pill-status-planned'},
  'Active':        {pill:'pill-status-completed'},
  'Expiring Soon': {pill:'pill-status-partial'},
  'Expired':       {pill:'pill-status-archived'},
  'Renewed':       {pill:'pill-status-scheduled'},
  'Cancelled':     {pill:'pill-status-cancelled'},
};
/* UX-003B — CANONICAL CONTRACT TIMELINE MODEL (DERIVED ONLY, TWO DIMENSIONS).
   PD-T1..PD-T4: "where is this contract in its lifecycle?" and "how close is it
   to ending?" are INDEPENDENT questions. They are two dimensions, never one
   flattened list — a contract ending this month is still effectively Active.

   Dimension 1 — EFFECTIVE STATE. Exactly one, always present.
   Dimension 2 — EXPIRY HORIZON. Exactly one; 'None' for anything not
   effectively Active. Calendar horizons are pure calendar facts and are NOT
   gated by settings.contractExpiryWarningDays — only WithinWarningWindow
   depends on that threshold.

   NOTHING here is ever stored. The stored lifecycle remains exactly
   CONTRACT_STORED_STATUSES above; 'Scheduled' is derived from startDate vs. the
   reference date and must never become a stored status. */
const CONTRACT_EFFECTIVE_STATES = ['Draft','Cancelled','Renewed','Scheduled','Active','Expired'];
const CONTRACT_EXPIRY_HORIZONS  = ['EndingToday','EndingThisWeek','EndingThisMonth',
  'EndingNextMonth','WithinWarningWindow','None'];
/* LEGACY DISPLAY MAPPING — kept deliberately separate from both canonical
   vocabularies. It maps the effective state onto the six values every existing
   consumer (badges, filters, counters, alerts, reports) has always received.
   UX-003B introduces the model ONLY; surfacing Scheduled or the horizon labels
   in the UI is UX-003C. */
const CONTRACT_LEGACY_STATE_DISPLAY = {
  'Draft':'Draft', 'Cancelled':'Cancelled', 'Renewed':'Renewed',
  'Scheduled':'Active',        // legacy facade only — Scheduled is NOT Active canonically
  'Active':'Active',
  'Expired':'Expired',
};
/* COMPATIBILITY ALIAS. 'Expiring Soon' is neither a canonical effective state
   nor a canonical horizon: it is the de-facto legacy label for "effectively
   Active and inside the configured warning window". Never stored. */
const CONTRACT_LEGACY_EXPIRING_ALIAS = 'Expiring Soon';
/* UX-003C — PRESENTATION LABELS for the canonical timeline model.
   Deliberately SEPARATE from CONTRACT_STATUS_META: that map drives the Contracts
   status FILTER dropdown (its keys become the options, matched against the legacy
   contractEffectiveStatus()). Adding canonical labels there would create filter
   options that can never match. Filter behaviour therefore stays exactly as it
   was; only the rendered label is richer.
   Keys are "<state>" or "<state>+<horizon>". Nothing here is ever stored. */
const CONTRACT_PRESENTATION_META = {
  'Draft':                     {label:'Draft',           pill:'pill-status-planned'},
  'Cancelled':                 {label:'Cancelled',       pill:'pill-status-cancelled'},
  'Renewed':                   {label:'Renewed',         pill:'pill-status-scheduled'},
  'Scheduled':                 {label:'Scheduled',       pill:'pill-status-scheduled'},
  'Expired':                   {label:'Expired',         pill:'pill-status-archived'},
  'Active':                    {label:'Active',          pill:'pill-status-completed'},
  // URGENCY BEFORE LIFECYCLE: a contract ending today reads "Ends Today", not
  // "Final Month". The order below is the wording precedence.
  'Active+EndingToday':        {label:'Ends Today',      pill:'pill-status-partial'},
  'Active+EndingThisWeek':     {label:'Ends This Week',  pill:'pill-status-partial'},
  'Active+EndingThisMonth':    {label:'Final Month',     pill:'pill-status-partial'},
  'Active+EndingNextMonth':    {label:'Ends Next Month', pill:'pill-status-partial'},
  'Active+WithinWarningWindow':{label:'Ending Soon',     pill:'pill-status-partial'},
};
/* UX-003C — the Contracts status FILTER vocabulary. It is the CANONICAL effective
   state, in display order: a user filtering "Active" must never see a Scheduled
   badge. CONTRACT_STATUS_META no longer drives this list; the legacy
   'Expiring Soon' alias survives inside contractEffectiveStatus() for
   compatibility, but it no longer forces Scheduled contracts into Active. */
const CONTRACT_FILTER_STATES = ['Active','Scheduled','Expired','Draft','Cancelled','Renewed'];
const RECUR_FREQUENCIES = {'Monthly':1, 'Quarterly':3, 'Semiannual':6, 'Annual':12};
// Monthly planning workflow. Approved & Closed are future-ready (no multi-user
// approval yet) — Draft, Reviewed, Committed are functional this release.
const PLAN_STATUSES = ['Draft','Reviewed','Approved','Committed','Closed'];
const PLAN_STATUS_META = {
  'Draft':     {pill:'pill-status-planned',   functional:true},
  'Reviewed':  {pill:'pill-status-scheduled', functional:true},
  'Approved':  {pill:'pill-status-partial',   functional:false},
  'Committed': {pill:'pill-status-completed', functional:true},
  'Closed':    {pill:'pill-status-archived',  functional:false},
};
/* ---------- Overtime engine constants (v2.3.0) ---------- */
// Single-user release: Draft, Reviewed, Approved, Rejected, Committed to Payroll
// are all functional. Submitted exists for future multi-user approval.
const OVERTIME_STATUSES = ['Draft','Submitted','Reviewed','Approved','Rejected','Committed to Payroll'];
const OVERTIME_STATUS_META = {
  'Draft':               {pill:'pill-status-planned'},
  'Submitted':           {pill:'pill-status-scheduled'},
  'Reviewed':            {pill:'pill-status-scheduled'},
  'Approved':            {pill:'pill-status-completed'},
  'Rejected':            {pill:'pill-status-cancelled'},
  'Committed to Payroll':{pill:'pill-status-archived'},
};
// Final-rounding rules applied ONLY to the payable amount — never to the hourly
// rate before multiplying by hours (that is what preserves Rp218,750 exactly).
const OVERTIME_ROUNDING = {
  'none':     {label:'No rounding',        step:0},
  'rupiah':   {label:'Nearest Rupiah',     step:1},
  'hundred':  {label:'Nearest 100 Rupiah', step:100},
  'thousand': {label:'Nearest 1,000 Rupiah', step:1000},
};
function hrStatusBadge(status, metaMap){
  const m = (metaMap && metaMap[status]) || {pill:'pill-other'};
  return `<span class="pill ${m.pill}">${escapeHtml(status)}</span>`;
}

// Derive the correct status from a transaction's amounts, unless it's been
// explicitly set to a terminal/manual state (cancelled, archived, scheduled).
function computeStatus(t){
  if(t.status==='cancelled') return 'cancelled';
  if(t.status==='archived') return 'archived';
  const a = t.actual;
  if(a===null || a===undefined){
    return t.status==='scheduled' ? 'scheduled' : 'planned';
  }
  if(a<=0) return t.status==='scheduled' ? 'scheduled' : 'planned';
  if(a < (t.planned||0)) return 'partial';
  return 'completed';
}
function statusOf(t){ return t.status ? t.status : computeStatus(t); }
function statusBadge(status){
  const m = STATUS_META[status] || STATUS_META.planned;
  return `<span class="pill ${m.pill}">${m.dot} ${m.label}</span>`;
}

/* ---------- constants ---------- */
const MONTH_NUM = {Januari:1,Pebruari:2,Februari:2,Maret:3,April:4,Mei:5,Juni:6,Juli:7,Agustus:8,September:9,Oktober:10,November:11,Desember:12};
const NUM_MONTH = {1:'Januari',2:'Pebruari',3:'Maret',4:'April',5:'Mei',6:'Juni',7:'Juli',8:'Agustus',9:'September',10:'Oktober',11:'November',12:'Desember'};
const MONTH_ORDER = ['Januari','Pebruari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const KNOWN_CATEGORIES = ['Gaji','Operasional Rutin','Operasional Kegiatan'];
const CATEGORY_CLASS = {'Gaji':'pill-gaji','Operasional Rutin':'pill-rutin','Operasional Kegiatan':'pill-kegiatan','Pendapatan':'pill-income'};
const CATEGORY_COLOR = {'Gaji':'#C9A15C','Operasional Rutin':'#6FA3D8','Operasional Kegiatan':'#C1543F','Pendapatan':'#4FAE7C','Lainnya':'#96A1BA'};
