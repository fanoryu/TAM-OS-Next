/* ---- EXECUTIVE INSIGHTS ---- */
function renderExecutiveInsights(main){
  const months = scopedMonths();
  if(!months.length){ main.innerHTML = emptyState('No data yet','Add or upload monthly data first.'); return; }
  const rows = trendRows(months);
  const withData = rows.filter(r=>r.info.hasData);
  const insights = [];

  const growthRows = rows.filter(r=>r.growthAbs!==null);
  if(growthRows.length){
    const biggestIncrease = growthRows.reduce((a,b)=>b.growthAbs>a.growthAbs?b:a);
    const biggestDecrease = growthRows.reduce((a,b)=>b.growthAbs<a.growthAbs?b:a);
    if(biggestIncrease.growthAbs>0) insights.push({text:`Largest expense growth: ${fmtIDR(biggestIncrease.growthAbs)} increase in ${monthLabel(biggestIncrease.m)} (${pct(biggestIncrease.growthPct)}).`, basis:'Actual data', type:'warn'});
    if(biggestDecrease.growthAbs<0) insights.push({text:`Largest saving: ${fmtIDR(Math.abs(biggestDecrease.growthAbs))} decrease in ${monthLabel(biggestDecrease.m)} (${pct(biggestDecrease.growthPct)}).`, basis:'Actual data', type:'good'});
  }
  const catTotals = {};
  // Readiness-1 — insight aggregates are scoped reads.
  ((typeof scopedTxns === 'function') ? scopedTxns() : State.txns).filter(t=>t.type!=='income' && t.actual!=null).forEach(t=>{ catTotals[t.category]=(catTotals[t.category]||0)+t.actual; });
  const catEntries = Object.entries(catTotals).sort((a,b)=>b[1]-a[1]);
  if(catEntries.length) insights.push({text:`Highest-spending category overall: ${catEntries[0][0]} at ${fmtIDR(catEntries[0][1])}.`, basis: withData.length===months.length?'Complete data':'Partial data', type:'info'});

  [...new Set([...KNOWN_CATEGORIES, ...((typeof scopedTxns === 'function') ? scopedTxns() : State.txns).map(t=>t.category)])].forEach(cat=>{
    const series = categorySeries(cat, months).filter(x=>x.hasActual);
    let streak=0;
    for(let i=series.length-1;i>0;i--){ if(series[i].actual>series[i-1].actual) streak++; else break; }
    if(streak>=2) insights.push({text:`${cat} spending has increased for ${streak+1} consecutive months.`, basis:'Actual data', type:'warn'});
  });
  const unplanned = ((typeof scopedTxns === 'function') ? scopedTxns() : State.txns).filter(t=>t.unplanned && t.actual);
  if(unplanned.length) insights.push({text:`${unplanned.length} unplanned expense${unplanned.length>1?'s':''} recorded across all history, totaling ${fmtIDR(unplanned.reduce((s,t)=>s+t.actual,0))}.`, basis:'Actual data', type:'warn'});
  const incompleteMonths = rows.filter(r=>r.info.hasData && !r.info.complete);
  if(incompleteMonths.length) insights.push({text:`${incompleteMonths.length} month${incompleteMonths.length>1?'s have':' has'} partially recorded actuals: ${incompleteMonths.map(r=>monthLabel(r.m)).join(', ')}.`, basis:'Partial data', type:'info'});
  const missingMonths = rows.filter(r=>!r.info.hasData);
  if(missingMonths.length) insights.push({text:`${missingMonths.length} month${missingMonths.length>1?'s have':' has'} no realization data at all: ${missingMonths.map(r=>monthLabel(r.m)).join(', ')}.`, basis:'Planned data only', type:'info'});
  let overStreak=0;
  for(let i=withData.length-1;i>=0;i--){ if(withData[i].tot.actual>withData[i].tot.planned) overStreak++; else break; }
  if(overStreak>=2) insights.push({text:`The last ${overStreak} months with recorded actuals each ran over budget — elevated over-budget risk going forward.`, basis:'Actual data', type:'warn'});
  const recurring = recurringItems();
  if(recurring.length) insights.push({text:`${recurring.length} line items recur across 3 or more months — the largest is "${recurring[0].label}" at an average of ${fmtIDR(recurring[0].monthCount?recurring[0].totalActual/recurring[0].monthCount:0)}/month.`, basis:'Actual data', type:'info'});
  if(withData.length) insights.push({text:`Historical average actual spending is ${fmtIDR(withData.reduce((s,r)=>s+r.tot.actual,0)/withData.length)}/month across ${withData.length} recorded months.`, basis: withData.length===months.length?'Complete data':'Partial data', type:'info'});
  const lastRow = rows[rows.length-1];
  if(lastRow && lastRow.growthAbs!==null) insights.push({text:`Most recent month-over-month change: ${lastRow.growthAbs>0?'+':''}${fmtIDR(lastRow.growthAbs)} (${pct(lastRow.growthPct)}) in ${monthLabel(lastRow.m)}.`, basis:'Actual data', type: lastRow.growthAbs>0?'warn':'good'});

  main.innerHTML = `
    <div class="page-head"><div><h1>Executive Insights</h1><p class="desc">Observations generated only from recorded data — each labeled with how complete that data is.</p></div></div>
    <div class="card">
      <div class="insight-list">
        ${insights.map(i=>`<div class="insight-item ${i.type}" style="display:block;">
          <div>${i.text}</div>
          <div class="faint" style="font-size:10.5px;margin-top:4px;text-transform:uppercase;letter-spacing:.4px;">Based on: ${escapeHtml(i.basis)}</div>
        </div>`).join('') || '<div class="empty">Not enough data yet for insights.</div>'}
      </div>
    </div>
  `;
}
