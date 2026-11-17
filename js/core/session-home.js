/* ============================================================
   UX-1 — SESSION HOME DATA (Owner GO 2026-11-17, UX-OD-04 / UX-OD-08)
   ============================================================
   The in-memory data of the role's Home page in SESSION mode: a read-only summary built
   ONLY from existing, authorized month reads — no new API, route, metric or write, and
   never a payroll total. Owned here; rendered by ui/session-workspace-view.js.

     CEO       PayrollApi.month      the current month's plans (counted by status — never money)
               OvertimeApi.month     the month's overtime records (those waiting for a decision)
               TransactionApi.report the month's Financial report (fields shown as returned)
               AuditApi.month        the month's audit events (the last five)
     Employee  PayrollApi.myMonth    own Committed plans — this month, else the two before
               OvertimeApi.month     own records of the month (the server scopes the read)

   Every tile is { status: 'loading' | 'ready' | 'denied' | 'error', data? }: a failed read
   is never a zero. Finance postings and payment records are not read here: that knowledge
   stays with the SESSION Payroll modules (AFI-4e / AFI-4f), whose page shows them.

   Every answer is applied only while its load is current and the session is signed in; a
   401 ends the session (AuthBoot.sessionLost). Memory only — never State, never storage;
   cleared by reset() when the SESSION shell is left (sessionShellReset). The server decides
   every read: a route shown in error ends in its 403, shown as "no access".

   Classic shared global scope; no DOM.
   ============================================================ */

const SessionHome = (function(){
  let open = true, loaded = false, token = 0, month = null, tiles = {};

  function paint(){ if(open && typeof render === 'function') render(); }
  function failed(out){ return Object.freeze({ status: out.kind === API_RESULT_KINDS.DENIED ? 'denied' : 'error', kind: out.kind }); }
  function principalNow(){
    const a = AuthBoot.snapshot();
    return a.state === AUTH_STATES.AUTHENTICATED ? a.principal : null;
  }
  function ceoPrincipal(p){ return !!p && p.principalType === PRINCIPAL_TYPES.CEO; }
  function employeePrincipal(p){ return !!p && p.principalType === PRINCIPAL_TYPES.EMPLOYEE && typeof p.employeeId === 'string' && p.employeeId !== ''; }

  // One tile read; true while it is still the current load.
  async function read(t, name, call){
    tiles[name] = Object.freeze({ status: 'loading' });
    const out = await call();
    if(t !== token) return false;
    if(!out.ok && out.kind === API_RESULT_KINDS.UNAUTHENTICATED){ AuthBoot.sessionLost(); return false; }
    tiles[name] = out.ok ? Object.freeze({ status: 'ready', data: out.data }) : failed(out);
    paint();
    return true;
  }

  // The Employee's latest own Committed plan of the last three months, or null.
  async function readPayslip(t, p, key){
    tiles.latestPay = Object.freeze({ status: 'loading' });
    let found = null;
    for(let i = 0; i < 3 && !found; i++){
      const out = await PayrollApi.myMonth(key, p.employeeId);
      if(t !== token) return;
      if(!out.ok && out.kind === API_RESULT_KINDS.UNAUTHENTICATED){ AuthBoot.sessionLost(); return; }
      if(!out.ok){ tiles.latestPay = failed(out); paint(); return; }
      found = out.data.find(function(x){ return x.status === 'Committed'; }) || null;
      key = OvertimeCalendar.shift(key, -1);
    }
    tiles.latestPay = Object.freeze({ status: 'ready', data: found });
    paint();
  }

  function load(){
    const p = principalNow();
    token += 1; loaded = true; tiles = {};
    const t = token;
    month = sessionPayrollCurrentMonth();
    const key = month;
    if(ceoPrincipal(p)){
      const range = transactionMonthRange(new Date());
      read(t, 'payroll', function(){ return PayrollApi.month(key); });
      read(t, 'overtime', function(){ return OvertimeApi.month(key); });
      read(t, 'report', function(){ return TransactionApi.report(range.from, range.to); });
      read(t, 'audit', function(){ return AuditApi.month(key); });
    } else if(employeePrincipal(p)){
      readPayslip(t, p, key);
      read(t, 'overtime', function(){ return OvertimeApi.month(key); });
    }
  }

  return Object.freeze({
    isOpen(){ return open; },
    setOpen(value){ open = value === true; },
    // The first paint of Home reads its data; opening Home again reads it again (load()).
    ensureLoaded(){ if(open && !loaded) load(); },
    load: load,
    reset(){ open = true; loaded = false; token += 1; month = null; tiles = {}; },
    snapshot(){ return Object.freeze({ open: open, month: month, tiles: Object.freeze(Object.assign({}, tiles)) }); }
  });
})();
