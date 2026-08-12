/* ---- CASH FLOW ---- */
function monthIncomeInfo(key){
  const txns = scopedTxnsForMonth(key).filter(t=>t.type==='income');
  if(!txns.length) return {status:'none', sum:0, hasAny:false};
  const known = txns.filter(t=>t.actual!==null && t.actual!==undefined);
  const sum = known.reduce((s,t)=>s+(t.actual||0),0);
  if(known.length < txns.length) return {status:'partial', sum, hasAny:true, pending:txns.length-known.length};
  return {status: sum===0?'zero':'recorded', sum, hasAny:true};
}
function renderCashFlow(main){
  const months = scopedMonths();
  if(!months.length){ main.innerHTML = emptyState('No data yet','Add or upload monthly data first.'); return; }
  const hasAnyIncome = ((typeof scopedTxns === 'function') ? scopedTxns() : State.txns).some(t=>t.type==='income');
  const rows = months.map(m=>{
    const ii = monthIncomeInfo(m.key);
    const ei = monthActualInfo(m.key);
    const net = (ii.hasAny && ei.hasData) ? ii.sum-monthTotals(m.key).actual : null;
    return {m, ii, ei, net, expenseActual: ei.hasData?monthTotals(m.key).actual:null};
  });
  let running = (State.settings.openingCashBalance===null||State.settings.openingCashBalance===undefined) ? null : State.settings.openingCashBalance;
  const runningRows = rows.map(r=>{
    if(running===null || r.net===null){ running = null; return {...r, running:null}; }
    running = running + r.net;
    return {...r, running};
  });
  main.innerHTML = `
    <div class="page-head"><div><h1>Cash Flow</h1><p class="desc">Recorded income versus actual expenses, month by month.</p></div></div>
    ${!hasAnyIncome ? `<div class="insight-item warn stack-section">No income transactions have been recorded in the system yet, so cash-flow analysis is incomplete — figures below reflect expenses only. Add income transactions (Add / Upload → Manual Entry → Type: Income) to see net cash flow.</div>` : ''}
    ${(State.settings.openingCashBalance===null||State.settings.openingCashBalance===undefined) ? `<div class="insight-item stack-section">No opening cash balance is set, so this page shows net movement only, not a cash position. Add one in Settings to see a running cash position.</div>` : ''}
    <div class="card">
      <h3>Monthly Cash Flow</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Month</th><th class="num">Income</th><th class="num">Actual Expense</th><th class="num">Net Cash Flow</th><th class="num">${State.settings.openingCashBalance!=null?'Running Cash Position':'Running Net Movement'}</th></tr></thead>
        <tbody>${runningRows.map(r=>`<tr>
          <td>${escapeHtml(monthLabel(r.m))}</td>
          <td class="num">${r.ii.status==='none'?'<span class="faint">no income recorded</span>':r.ii.status==='partial'?fmtIDR(r.ii.sum)+' (partial)':fmtIDR(r.ii.sum)}</td>
          <td class="num">${r.ei.hasData?fmtIDR(r.expenseActual):'<span class="faint">missing</span>'}</td>
          <td class="num" style="color:${r.net==null?'inherit':r.net>=0?'var(--green)':'var(--brick)'}">${r.net==null?'<span class="faint">incomplete</span>':fmtIDR(r.net)}</td>
          <td class="num">${r.running==null?'<span class="faint">—</span>':fmtIDR(r.running)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="card" style="margin-top:var(--space-4);">
      <h3>Net Cash Flow Trend</h3>
      <div class="chart-wrap" id="cashFlowChart"></div>
    </div>
  `;
  const el = document.getElementById('cashFlowChart');
  if(el){
    drawBarChart(el, {
      labels: months.map(m=>m.month.slice(0,3)+" '"+String(m.year).slice(2)),
      series: [{key:'net', label:'Net Cash Flow', color:themeVar('--chart-positive','#4FAE7C'), data: rows.map(r=>r.net)}],
      formatY: fmtIDRShort, height:260, signed:true, legend:false,
      emptyMessage:'Not enough income and expense data recorded yet.',
      ariaLabel:'Net cash flow by month',
      tooltipHTML:(i)=>{
        const r = rows[i];
        return `<div style="font-weight:600;margin-bottom:4px;">${escapeHtml(monthLabel(r.m))}</div>
          <div>Income: <b class="mono">${r.ii.status==='none'?'no data':fmtIDR(r.ii.sum)}</b></div>
          <div>Actual Expense: <b class="mono">${r.ei.hasData?fmtIDR(r.expenseActual):'no data'}</b></div>
          <div>Net: <b class="mono">${r.net==null?'incomplete':fmtIDR(r.net)}</b></div>`;
      },
      onBarClick:(i)=>goToMonthOverview(rows[i].m.key),
    });
  }
}
