/* ---- BUDGET CENTER ---- */
function renderBudgetCenter(main){
  const months = scopedMonths();
  if(!months.length){ main.innerHTML = emptyState('No data yet','Add or upload monthly data first.'); return; }
  const years = [...new Set(months.map(m=>m.year))];
  if(!State.budgetYear || !years.includes(State.budgetYear)) State.budgetYear = years[years.length-1];
  const yearMonths = months.filter(m=>m.year===State.budgetYear);
  const yRows = trendRows(yearMonths);
  const annualPlanned = yearMonths.reduce((s,m)=>s+monthTotals(m.key).planned,0);
  const knownActualRows = yRows.filter(r=>r.info.hasData);
  const annualActual = knownActualRows.reduce((s,r)=>s+r.tot.actual,0);
  const remaining = annualPlanned - annualActual;
  const utilization = annualPlanned ? (annualActual/annualPlanned*100) : 0;
  const catUtil = KNOWN_CATEGORIES.map(cat=>{
    let planned=0, actual=0, hasAny=false;
    yearMonths.forEach(m=>{ const cb=categoryBreakdown(m.key).find(c=>c.category===cat); if(cb){ planned+=cb.planned; if(cb.hasActual){ actual+=cb.actual; hasAny=true; } } });
    return {cat, planned, actual, hasAny, pctUsed: planned?actual/planned*100:0};
  });
  const atRisk = yRows.filter(r=>r.info.hasData && r.tot.planned && (r.tot.actual/r.tot.planned)>=0.9);

  const sim = State.budgetSim;
  const catBase = {};
  KNOWN_CATEGORIES.forEach(cat=>{ const cu=catUtil.find(c=>c.cat===cat); catBase[cat] = cu&&cu.hasAny? cu.actual/Math.max(1,knownActualRows.length) : 0; });
  const projGaji = catBase['Gaji']*(1+sim.payrollPct/100);
  const projRutin = catBase['Operasional Rutin']*(1+sim.opsPct/100);
  const projKegiatan = catBase['Operasional Kegiatan']*(1+sim.opsPct/100);
  const projTotal = (projGaji+projRutin+projKegiatan) * (1+sim.expensePct/100);
  const currentAvgActual = knownActualRows.length ? annualActual/knownActualRows.length : 0;
  const projVariance = currentAvgActual - projTotal;

  main.innerHTML = `
    <div class="page-head">
      <div><h1>Budget Center</h1><p class="desc">Annual and monthly budget utilization for ${escapeHtml(State.settings.companyName||COMPANY_NAME_DEFAULT)}.</p></div>
      <div class="head-controls"><select id="budgetYear" class="input">${years.map(y=>`<option value="${y}" ${y===State.budgetYear?'selected':''}>${y}</option>`).join('')}</select></div>
    </div>
    <div class="grid grid-4 stack-section">
      <div class="card stat-card"><div class="stat-label">Annual Planned Budget</div><div class="stat-value">${fmtIDRShort(annualPlanned)}</div></div>
      <div class="card stat-card"><div class="stat-label">Annual Actual Spend</div><div class="stat-value">${fmtIDRShort(annualActual)}</div><div class="stat-sub dim">${knownActualRows.length} of ${yearMonths.length} months recorded</div></div>
      <div class="card stat-card"><div class="stat-label">Remaining Budget</div><div class="stat-value" style="color:${remaining>=0?'var(--green)':'var(--brick)'}">${fmtIDRShort(remaining)}</div></div>
      <div class="card stat-card"><div class="stat-label">Budget Utilization</div><div class="stat-value">${utilization.toFixed(0)}%</div></div>
    </div>
    <div class="card stack-section">
      <h3>Monthly Planned vs. Actual — ${State.budgetYear}</h3>
      <p class="hint">Click a point to open that month's Finance Overview.</p>
      <div class="chart-wrap" id="budgetMonthlyChart"></div>
    </div>
    <div class="card stack-section">
      <h3>Category Utilization</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Category</th><th class="num">Planned</th><th class="num">Actual</th><th class="num">% Used</th></tr></thead>
        <tbody>${catUtil.map(c=>`<tr><td>${categoryPill(c.cat)}</td><td class="num">${fmtIDR(c.planned)}</td><td class="num">${c.hasAny?fmtIDR(c.actual):'<span class="faint">—</span>'}</td><td class="num">${c.hasAny?c.pctUsed.toFixed(0)+'%':'—'}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="card stack-section">
      <h3>Months at Risk of Overspending<span class="tag">≥90% of plan used</span></h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Month</th><th class="num">Planned</th><th class="num">Actual</th><th class="num">% Used</th></tr></thead>
        <tbody>${atRisk.map(r=>`<tr><td>${escapeHtml(monthLabel(r.m))}</td><td class="num">${fmtIDR(r.tot.planned)}</td><td class="num">${fmtIDR(r.tot.actual)}</td><td class="num" style="color:var(--brick);">${(r.tot.actual/r.tot.planned*100).toFixed(0)}%</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No months at risk this year</td></tr>'}</tbody>
      </table></div>
    </div>
    <div class="card">
      <h3>Scenario Simulator<span class="tag">simulation only — not saved</span></h3>
      <p class="hint">Projects monthly spending from this year's average monthly actuals by category. Nothing here is written to your data.</p>
      <div class="form-grid" style="grid-template-columns:repeat(3,1fr);">
        <div class="field"><label>Overall Expense Increase %</label><input class="input" id="simExpense" type="number" step="1" value="${sim.expensePct}"></div>
        <div class="field"><label>Payroll Increase %</label><input class="input" id="simPayroll" type="number" step="1" value="${sim.payrollPct}"></div>
        <div class="field"><label>Operational Cost Increase %</label><input class="input" id="simOps" type="number" step="1" value="${sim.opsPct}"></div>
      </div>
      <div class="grid grid-2" style="margin-top:var(--space-4);">
        <div class="card stat-card"><div class="stat-label">Projected Monthly Spending (Simulation)</div><div class="stat-value">${fmtIDRShort(projTotal)}</div></div>
        <div class="card stat-card"><div class="stat-label">Projected Variance vs. Current Average (Simulation)</div><div class="stat-value" style="color:${projVariance>=0?'var(--green)':'var(--brick)'}">${fmtIDRShort(projVariance)}</div></div>
      </div>
    </div>
  `;
  document.getElementById('budgetYear').addEventListener('change', e=>{ State.budgetYear=Number(e.target.value); renderBudgetCenter(main); });
  ['simExpense','simPayroll','simOps'].forEach((id,ix)=>{
    document.getElementById(id).addEventListener('input', e=>{
      const skey = ['expensePct','payrollPct','opsPct'][ix];
      State.budgetSim[skey] = Number(e.target.value)||0;
      renderBudgetCenter(main);
    });
  });
  const bmEl = document.getElementById('budgetMonthlyChart');
  if(bmEl){
    drawLineChart(bmEl, {
      labels: yearMonths.map(m=>m.month.slice(0,3)),
      series: [
        {key:'planned', label:'Planned', color:themeVar('--chart-planned','#96A1BA'), data: yRows.map(r=>r.tot.planned)},
        {key:'actual', label:'Actual', color:themeVar('--chart-actual','#C9A15C'), fill:true, data: yRows.map(r=>r.info.hasData?r.tot.actual:null),
          pointColor: yRows.map(r=>actualPointColor(r)), pointHollow: yRows.map(r=>r.info.hasData && !r.info.complete)},
      ],
      formatY: fmtIDRShort, height:260,
      emptyMessage:'No data for this year.',
      ariaLabel:'Monthly planned versus actual budget',
      tooltipHTML:(i)=>trendTooltip(yRows[i]),
      onIndexClick:(i)=>goToMonthOverview(yRows[i].m.key),
    });
  }
}
