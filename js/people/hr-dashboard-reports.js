/* ============================================================
   DASHBOARD & REPORT INTEGRATION HELPERS (v2.2.0)
   ============================================================ */

/* Readiness-1 — principal-scoped read helpers for this module.
   Every dashboard figure and every report row below is a READ, and §10 of the
   readiness ruling is explicit: an aggregate must be derived from the SAME scoped
   dataset as the records it summarises. A scoped employee list beside a company-wide
   headcount, salary total or "by employee" report would leak precisely what the
   scoping removed. These four helpers are the module's single seam; no renderer here
   touches State.* for a privacy-relevant store directly.
   CEO -> full company (unchanged). Employee -> own records. No principal -> none. */
function hrScopedEmployees(){ return (typeof getScopedRecords === 'function') ? getScopedRecords('employee') : (State.employees || []); }
function hrScopedContracts(){ return (typeof getScopedRecords === 'function') ? getScopedRecords('contract') : (State.contracts || []); }
function hrScopedPayrollPlans(){ return (typeof getScopedRecords === 'function') ? getScopedRecords('payrollPlan') : (State.payrollPlans || []); }
function hrScopedOvertime(){ return (typeof getScopedRecords === 'function') ? getScopedRecords('overtime') : (State.overtimeRecords || []); }
function hrDashboardStats(monthKey){
  const activeEmployees = hrScopedEmployees().filter(empEligible).length;
  // UX-003C — contract counts come from the ONE canonical helper. activeContracts
  // now means EVERY effectively-active contract, and expiringSoon is a SUBSET of
  // it, so "N active, M of them ending soon" is literally true.
  const ctCounts = contractTimelineCounts();
  const activeContracts = ctCounts.active;
  const expiringSoon = ctCounts.endingSoon;
  const plans = hrScopedPayrollPlans().filter(p=>p.monthKey===monthKey && isPayrollCommitted(p));
  const payrollPlanned = plans.reduce((s,p)=>s+(p.plannedAmount||0),0);
  const plan = monthlyPlanFor(monthKey);
  // payroll generation status for the month
  let payrollGen='Not generated';
  const eligible = hrScopedEmployees().filter(empEligible).filter(e=>coveringContract(e.id, monthKey));
  if(plans.length){ payrollGen = plans.length>=eligible.length ? 'Committed' : 'Partially committed'; }
  else if(State.payrollDraft && State.payrollDraft.monthKey===monthKey){ payrollGen='Generated, not committed'; }
  return {activeEmployees, activeContracts, expiringSoon, payrollPlanned, payrollCount:plans.length, planStatus:plan?plan.status:'Not started', payrollGen, eligibleCount:eligible.length};
}
function hrDashboardAlerts(monthKey){
  const alerts = [];
  const warn = Number(State.settings.contractExpiryWarningDays)||90;
  // UX-003C — resolve through the canonical model. withinWarningWindow IS the
  // 'Expiring Soon' alias, so the alert set is unchanged; the predicate is not duplicated.
  const soon = hrScopedContracts().filter(c=>contractTimeline(c).withinWarningWindow);
  soon.slice(0,4).forEach(c=>{ const cc=contractCalc(c); alerts.push({type:'warn', text:`Contract ${escapeHtml(c.contractNumber||'')} (${escapeHtml(c.employeeName||'')}) is expiring soon — ${cc.daysUntilEnd} days left.`}); });
  const expired = hrScopedContracts().filter(c=>contractTimeline(c).state==='Expired' && c.status==='Active');
  expired.slice(0,3).forEach(c=>alerts.push({type:'warn', text:`Contract ${escapeHtml(c.contractNumber||'')} (${escapeHtml(c.employeeName||'')}) has expired — renew or close it.`}));
  hrScopedEmployees().filter(empEligible).forEach(e=>{ if(!activeContractToday(e.id)) alerts.push({type:'warn', text:`${escapeHtml(e.fullName)} is Active with no current contract.`}); });
  const st = hrDashboardStats(monthKey);
  if(st.eligibleCount>0 && st.payrollGen==='Not generated') alerts.push({type:'info', text:`Payroll for ${escapeHtml(keyToMonthObj(monthKey).month)} has not been generated yet (${st.eligibleCount} eligible employee${st.eligibleCount>1?'s':''}).`});
  if(st.payrollGen==='Generated, not committed') alerts.push({type:'warn', text:`Payroll for ${escapeHtml(keyToMonthObj(monthKey).month)} is generated but not committed to the monthly plan.`});
  if(st.planStatus==='Draft') alerts.push({type:'info', text:`Monthly plan for ${escapeHtml(keyToMonthObj(monthKey).month)} is still in Draft.`});
  // duplicate payroll safety check
  const seen={}; let dup=0;
  State.txns.filter(t=>t.source==='payroll' && t.monthKey===monthKey).forEach(t=>{ const k=t.employeeId+'|'+t.contractId; if(seen[k]) dup++; else seen[k]=1; });
  if(dup) alerts.push({type:'warn', text:`${dup} potential duplicate payroll transaction(s) detected for ${escapeHtml(keyToMonthObj(monthKey).month)}.`});
  return alerts;
}
/* UX-002B Phase 3 — the "Payroll Planned" tile that used to sit here was a duplicate
   of "Total Payroll Planned" in the payroll strip. The two are merged; the surviving
   tile lives in payrollStripHTML() and now carries the committed-plan count that this
   one used to show. The expiring-soon value is rendered ONCE, here, as the Active
   Contracts sub-value — the composite payroll tile no longer repeats it.
   contractEffectiveStatus() and hrDashboardStats() are untouched: expiry semantics
   are UX-003's, not this phase's. */
/* Returns TILES ONLY — the caller supplies the grid. The three operational strips are
   rendered inside one shared grid so they pack into the fewest rows at every width.
   Three separate 3-column grids would collapse to 3 SINGLE columns below 1050px
   (.grid-3's media rule), which is why they are no longer wrapped individually. */
function hrStatStripHTML(monthKey){
  const st = hrDashboardStats(monthKey);
  return `<div class="card stat-card"><div class="stat-label">Active Employees</div><div class="stat-value">${st.activeEmployees}</div><div class="stat-sub dim">eligible for payroll</div></div>
    <div class="card stat-card"><div class="stat-label">Active Contracts</div><div class="stat-value">${st.activeContracts}</div><div class="stat-sub ${st.expiringSoon?'neg':'dim'}">${st.expiringSoon} of these ending soon</div></div>
    <div class="card stat-card"><div class="stat-label">Monthly Plan</div><div class="stat-value" style="font-size:15px;">${st.planStatus==='Not started'?'<span class="faint">Not started</span>':hrStatusBadge(st.planStatus,PLAN_STATUS_META)}</div><div class="stat-sub dim">Payroll: ${escapeHtml(st.payrollGen)}</div></div>`;
}

/* ---------- HR reports ---------- */
function hrReportDefs(){
  return [
    {id:'employees', label:'Employee List'},
    {id:'active-contracts', label:'Active Contracts'},
    {id:'expiring', label:'Expiring Contracts'},
    {id:'payroll-month', label:'Monthly Payroll Plan'},
    {id:'payroll-employee', label:'Payroll by Employee'},
    {id:'payroll-contract', label:'Payroll by Contract'},
    {id:'contract-cost', label:'Contract Cost Summary'},
    {id:'overtime-month', label:'Monthly Overtime Summary'},
    {id:'overtime-employee', label:'Overtime by Employee'},
    {id:'overtime-contract', label:'Overtime by Contract'},
    {id:'overtime-top', label:'Employees with Highest Overtime'},
    {id:'overtime-pending', label:'Overtime Pending Review'},
    {id:'payroll-overtime', label:'Payroll with Overtime Breakdown'},
    {id:'import-batches', label:'Smart Import Batches'},
    {id:'employee-duplicate-audit', label:'Employee Duplicate Audit'},
    {id:'payroll-register', label:'Monthly Payroll Register'},
    {id:'payroll-department', label:'Payroll by Department'},
    {id:'payroll-components', label:'Payroll Components'},
    {id:'payroll-execution', label:'Payroll Execution Status'},
    {id:'payroll-excluded', label:'Excluded Employees Report'},
  ];
}
function hrReportRows(id, monthKey){
  if(id==='employees'){
    let emps = hrScopedEmployees().slice();
    if(!State.settings.includeInactiveInReports) emps = emps.filter(e=>e.active!==false);
    return {headers:['Employee ID','Name','Job Title','Department','Status','Active Contract','Base Salary'],
      rows:emps.map(e=>{ const ct=activeContractToday(e.id); return [e.employeeId,e.fullName,e.jobTitle,e.department,e.employmentStatus,ct?ct.contractNumber:'—',fmtIDR(e.monthlyBaseSalary)]; })};
  }
  if(id==='active-contracts'){
    // UX-003C — effectively-Active is one canonical state; it already covers what
    // the legacy pair ['Active','Expiring Soon'] used to enumerate.
    const cs = hrScopedContracts().filter(c=>contractTimeline(c).state==='Active');
    return {headers:['Contract #','Employee','Start','End','Progress','Monthly','Status'],
      rows:cs.map(c=>{ const cc=contractCalc(c); return [c.contractNumber,c.employeeName,cc.startDate,cc.endDate,cc.progress,fmtIDR(c.monthlySalary),contractPresentation(c).label]; })};
  }
  if(id==='expiring'){
    const cs = hrScopedContracts().filter(c=>{ const t=contractTimeline(c); return t.withinWarningWindow || t.state==='Expired'; });
    return {headers:['Contract #','Employee','End Date','Days Left','Status'],
      rows:cs.map(c=>{ const cc=contractCalc(c); return [c.contractNumber,c.employeeName,cc.endDate,cc.daysUntilEnd,contractPresentation(c).label]; })};
  }
  if(id==='payroll-month'){
    const ps = hrScopedPayrollPlans().filter(p=>p.monthKey===monthKey);
    return {headers:['Employee','Contract','Progress','Base','Overtime','Allowance','Bonus','Benefits','Deduction','Planned','Status'],
      rows:ps.map(p=>[p.employeeName,p.contractNumber,p.contractProgress,fmtIDR(p.baseSalary),fmtIDR(p.overtime),fmtIDR(p.allowance),fmtIDR(p.bonus),fmtIDR(p.benefits),fmtIDR(p.deduction),fmtIDR(p.plannedAmount),p.status])};
  }
  if(id==='payroll-employee'){
    const map={}; hrScopedPayrollPlans().forEach(p=>{ (map[p.employeeName]=map[p.employeeName]||{n:0,sum:0}); map[p.employeeName].n++; map[p.employeeName].sum+=p.plannedAmount||0; });
    return {headers:['Employee','Payroll Plans','Total Planned'], rows:Object.entries(map).map(([k,v])=>[k,v.n,fmtIDR(v.sum)])};
  }
  if(id==='payroll-contract'){
    const map={}; hrScopedPayrollPlans().forEach(p=>{ (map[p.contractNumber]=map[p.contractNumber]||{n:0,sum:0}); map[p.contractNumber].n++; map[p.contractNumber].sum+=p.plannedAmount||0; });
    return {headers:['Contract','Payroll Plans','Total Planned'], rows:Object.entries(map).map(([k,v])=>[k,v.n,fmtIDR(v.sum)])};
  }
  if(id==='contract-cost'){
    return {headers:['Contract #','Employee','Monthly','Duration','Total Contract Value','Status'],
      rows:hrScopedContracts().map(c=>[c.contractNumber,c.employeeName,fmtIDR(c.monthlySalary),c.durationMonths,fmtIDR((c.monthlySalary||0)*(c.durationMonths||0)),contractPresentation(c).label])};
  }
  const otAmt = o=>num(o.approvedAmount!=null?o.approvedAmount:o.calculatedAmount);
  if(id==='overtime-month'){
    const recs = hrScopedOvertime().filter(o=>o.monthKey===monthKey);
    return {headers:['Employee','Contract','Date','Hours','Hourly Rate','Amount','Status'],
      rows:recs.map(o=>[o.employeeName,o.contractNumber,o.overtimeDate||'',o.overtimeHours,fmtIDRfull(o.hourlyRate),fmtIDR(otAmt(o)),o.status])};
  }
  if(id==='overtime-employee'){
    const map={}; hrScopedOvertime().forEach(o=>{ (map[o.employeeName]=map[o.employeeName]||{h:0,amt:0,n:0}); map[o.employeeName].h+=num(o.overtimeHours); map[o.employeeName].amt+=otAmt(o); map[o.employeeName].n++; });
    return {headers:['Employee','Records','Total Hours','Total Amount'], rows:Object.entries(map).map(([k,v])=>[k,v.n,v.h,fmtIDR(v.amt)])};
  }
  if(id==='overtime-contract'){
    const map={}; hrScopedOvertime().forEach(o=>{ const k=o.contractNumber||'—'; (map[k]=map[k]||{h:0,amt:0,n:0}); map[k].h+=num(o.overtimeHours); map[k].amt+=otAmt(o); map[k].n++; });
    return {headers:['Contract','Records','Total Hours','Total Amount'], rows:Object.entries(map).map(([k,v])=>[k,v.n,v.h,fmtIDR(v.amt)])};
  }
  if(id==='overtime-top'){
    const map={}; hrScopedOvertime().forEach(o=>{ (map[o.employeeName]=map[o.employeeName]||{h:0,amt:0}); map[o.employeeName].h+=num(o.overtimeHours); map[o.employeeName].amt+=otAmt(o); });
    const rows=Object.entries(map).map(([k,v])=>[k,v.h,v.amt]).sort((a,b)=>b[1]-a[1]).map(r=>[r[0],r[1],fmtIDR(r[2])]);
    return {headers:['Employee','Total Hours','Total Amount'], rows};
  }
  if(id==='overtime-pending'){
    const recs = hrScopedOvertime().filter(o=>['Draft','Submitted','Reviewed'].includes(o.status));
    return {headers:['Employee','Month','Date','Hours','Amount','Status'], rows:recs.map(o=>[o.employeeName,o.monthKey,o.overtimeDate||'',o.overtimeHours,fmtIDR(otAmt(o)),o.status])};
  }
  if(id==='payroll-overtime'){
    const ps = hrScopedPayrollPlans().filter(p=>p.monthKey===monthKey);
    return {headers:['Employee','Contract','Base','Overtime','Planned Total','OT Records','Status'],
      rows:ps.map(p=>[p.employeeName,p.contractNumber,fmtIDR(p.baseSalary),fmtIDR(p.overtime),fmtIDR(p.plannedAmount),(p.overtimeIds||[]).length,p.status])};
  }
  if(id==='import-batches'){
    return {headers:['File','Committed','Employees','Contracts','Payroll','Transactions','Duplicates Skipped','Status'],
      rows:State.importBatches.map(b=>[b.fileName, new Date(b.ts).toLocaleString('id-ID'), b.counts.employees, b.counts.contracts, b.counts.payrollPlans, b.counts.txns, b.counts.duplicatesSkipped||0, b.undone?'Undone':'Active'])};
  }
  if(id==='employee-duplicate-audit'){
    // Part 12 — one row per normalized name that has (or had) duplicates, plus any merged names.
    const rows=[];
    findEmployeeDuplicateGroups().forEach(g=>{
      const canon=g.canonical; const t=employeeLinkTotals; let cts=0,pps=0,txs=0;
      g.employees.forEach(e=>{ const x=t(e.id); cts+=x.contracts; pps+=x.payrollPlans; txs+=x.txns; });
      rows.push([g.name, g.employees.map(e=>e.employeeId||e.id).join(' / '), (canon.employeeId||canon.id)+' (suggested)', cts, pps, txs, 'Needs Merge']);
    });
    (State.employeeMerges||[]).forEach(m=>{
      rows.push([m.canonicalName||'—', (m.duplicateCodes||m.duplicateEmployeeIds).join(' / '), m.canonicalCode||m.canonicalEmployeeId, m.relinkedCounts.contracts, m.relinkedCounts.payrollPlans, m.relinkedCounts.txns, 'Merged '+new Date(m.ts).toLocaleDateString('id-ID')]);
    });
    return {headers:['Normalized Name','Employee IDs','Canonical Employee','Contracts','Payroll Plans','Transactions','Merge Status'], rows};
  }
  if(id==='payroll-register'){
    const ps=payrollPlansForMonth(monthKey,true);
    return {headers:['Employee','Contract','Progress','Department','Base','Overtime','Additions','Deductions','Planned','Status'],
      rows:ps.map(p=>{ const s=payrollHistoricalSnapshot(p); return [p.employeeName,p.contractNumber,p.contractProgress,p.department,fmtIDR(s.baseSalary),fmtIDR(s.overtimeAmount),fmtIDR(num(p.allowance)+num(p.bonus)+num(p.benefits)+num(p.otherAddition)),fmtIDR(num(p.deduction)+num(p.otherDeduction)),fmtIDR(s.totalPayroll),p.status]; })};
  }
  if(id==='payroll-department'){
    const map={}; payrollPlansForMonth(monthKey).forEach(p=>{ const d=p.department||'—'; (map[d]=map[d]||{n:0,sum:0}); map[d].n++; map[d].sum+=num(payrollHistoricalSnapshot(p).totalPayroll); });
    return {headers:['Department','Employees','Total Planned'], rows:Object.entries(map).map(([k,v])=>[k,v.n,fmtIDR(v.sum)])};
  }
  if(id==='payroll-components'){
    const ps=payrollPlansForMonth(monthKey);
    return {headers:['Employee','Base','Overtime','Allowance','Bonus','Benefits','Other +','Deduction','Other −','Planned'],
      rows:ps.map(p=>{ const s=payrollHistoricalSnapshot(p); return [p.employeeName,fmtIDR(s.baseSalary),fmtIDR(s.overtimeAmount),fmtIDR(p.allowance),fmtIDR(p.bonus),fmtIDR(p.benefits),fmtIDR(p.otherAddition),fmtIDR(p.deduction),fmtIDR(p.otherDeduction),fmtIDR(s.totalPayroll)]; })};
  }
  if(id==='payroll-execution'){
    const ps=payrollPlansForMonth(monthKey).filter(isPayrollCommitted);
    return {headers:['Employee','Planned','Actual Paid','Remaining','Transaction Status','Execution Date'],
      rows:ps.map(p=>{ const t=payrollTxnOf(p); return [p.employeeName,fmtIDR(payrollHistoricalSnapshot(p).totalPayroll),t&&t.actual!=null?fmtIDR(t.actual):'—',t?fmtIDR(num(t.planned)-num(t.actual)):'—',t?statusOf(t):'—',(t&&t.execution&&t.execution.executionDate)||'—']; })};
  }
  if(id==='payroll-excluded'){
    const ex=hrScopedEmployees().map(e=>({e,reason:payrollExclusionReason(e,monthKey)})).filter(x=>x.reason);
    return {headers:['Employee','Department','Reason'], rows:ex.map(x=>[x.e.fullName,x.e.department||'—',x.reason])};
  }
  return {headers:[], rows:[]};
}
function exportHRReportCsv(id, monthKey){
  const def = hrReportDefs().find(d=>d.id===id);
  const {headers, rows} = hrReportRows(id, monthKey);
  const lines = [`# ${APP_NAME} v${APP_VERSION} — ${def?def.label:id}`, headers.map(csvSafe).join(',')];
  rows.forEach(r=>lines.push(r.map(csvSafe).join(',')));
  downloadBlob(lines.join('\n'), `${FILE_BASE}-${id}.csv`, 'text/csv');
  toast('Report exported (CSV).');
}
