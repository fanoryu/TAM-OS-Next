/* ---- COMPARE MONTHS ---- */
function renderCompare(main){
  const months = scopedMonths();
  if(!months.length){ main.innerHTML = emptyState('No data yet','Add or upload monthly data first.'); return; }
  if(!State.compareMonths.length) State.compareMonths = months.slice(-3).map(m=>m.key);
  if(!State.compareTrendRange) State.compareTrendRange = 'all';

  const rangeOpts = [['all','All Time'],['last3','Last 3 Months'],['last6','Last 6 Months'],['last12','Last 12 Months'],['year','Current Year']];
  const trendMonths = applyQuickRange(months, State.compareTrendRange);

  main.innerHTML = `
    <div class="page-head"><div><h1>Compare Months</h1><p class="desc">Select months to compare totals, categories, and trend.</p></div></div>
    <div class="card stack-section">
      <h3>Select Months</h3>
      <div class="month-strip">
        ${months.map(m=>`<div class="month-chip ${State.compareMonths.includes(m.key)?'active':''}" data-m="${m.key}">${monthLabel(m)}</div>`).join('')}
      </div>
    </div>
    <div class="card stack-section">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <h3 style="margin:0;">Total Spend Trend</h3>
        <div class="chart-range-chips" style="margin-bottom:0;" role="group" aria-label="Trend date range">
          ${rangeOpts.map(([k,l])=>`<button type="button" class="btn btn-sm ${State.compareTrendRange===k?'btn-accent':''}" data-range="${k}">${l}</button>`).join('')}
        </div>
      </div>
      <p class="hint">Click a point to open that month in Finance Overview.</p>
      <div class="chart-wrap tall" id="trendChart"></div>
    </div>
    <div class="card">
      <h3>Selected Months Side-by-Side</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Metric</th>${State.compareMonths.map(k=>{const m=months.find(mm=>mm.key===k);return `<th class="num">${m?monthLabel(m):k}</th>`}).join('')}</tr></thead>
        <tbody>
          <tr><td>Total Planned</td>${State.compareMonths.map(k=>`<td class="num">${fmtIDR(monthTotals(k).planned)}</td>`).join('')}</tr>
          <tr><td>Total Actual</td>${State.compareMonths.map(k=>`<td class="num">${fmtIDR(monthTotals(k).actual)}</td>`).join('')}</tr>
          <tr><td>Variance</td>${State.compareMonths.map(k=>{const v=monthTotals(k).variance; return `<td class="num" style="color:${v>=0?'var(--green)':'var(--brick)'}">${fmtIDR(v)}</td>`}).join('')}</tr>
          ${KNOWN_CATEGORIES.map(cat=>`<tr><td>${categoryPill(cat)} actual</td>${State.compareMonths.map(k=>{
            const cb = categoryBreakdown(k).find(c=>c.category===cat);
            return `<td class="num">${cb&&cb.hasActual?fmtIDR(cb.actual):'<span class="faint">—</span>'}</td>`;
          }).join('')}</tr>`).join('')}
        </tbody>
      </table></div>
    </div>
    <div class="section-title">Recurring Expenses</div>
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Item</th><th>Category</th><th class="num">Months Seen</th><th class="num">Avg Actual</th><th class="num">Total (all time)</th></tr></thead>
        <tbody>${recurringItems().slice(0,20).map(r=>`<tr>
          <td>${escapeHtml(r.label)}</td><td>${categoryPill(r.category)}</td>
          <td class="num">${r.monthCount} / ${months.length}</td>
          <td class="num">${fmtIDR(r.monthCount?r.totalActual/r.monthCount:0)}</td>
          <td class="num">${fmtIDR(r.totalActual)}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="empty">No recurring items detected yet</td></tr>'}</tbody>
      </table></div>
    </div>
  `;
  main.querySelectorAll('[data-m]').forEach(chip=>chip.addEventListener('click', ()=>{
    const k = chip.dataset.m;
    const i = State.compareMonths.indexOf(k);
    if(i>-1) State.compareMonths.splice(i,1); else State.compareMonths.push(k);
    renderCompare(main);
  }));
  main.querySelectorAll('[data-range]').forEach(b=>b.addEventListener('click', ()=>{ State.compareTrendRange=b.dataset.range; renderCompare(main); }));

  const trendChartEl = document.getElementById('trendChart');
  if(trendChartEl){
    const tRows = trendRows(trendMonths);
    drawLineChart(trendChartEl, {
      labels: trendMonths.map(m=>m.month.slice(0,3)+" '"+String(m.year).slice(2)),
      series: [
        {key:'planned', label:'Planned', color:themeVar('--chart-planned','#96A1BA'), data: tRows.map(r=>r.tot.planned)},
        {key:'actual', label:'Actual', color:themeVar('--chart-actual','#C9A15C'), fill:true, data: tRows.map(r=>r.info.hasData?r.tot.actual:null),
          pointColor: tRows.map(r=>actualPointColor(r)), pointHollow: tRows.map(r=>r.info.hasData && !r.info.complete)},
      ],
      formatY: fmtIDRShort, height:320,
      emptyMessage:'No monthly data yet.',
      ariaLabel:'Total planned versus actual spending trend',
      tooltipHTML:(i)=>trendTooltip(tRows[i]),
      onIndexClick:(i)=>{ State.selectedMonth = tRows[i].m.key; State.view='financeOverview'; render(); },
    });
  }
}
function applyQuickRange(months, range){
  if(range==='last3') return months.slice(-3);
  if(range==='last6') return months.slice(-6);
  if(range==='last12') return months.slice(-12);
  if(range==='year'){ const y=new Date().getFullYear(); const r=months.filter(m=>m.year===y); return r.length?r:months; }
  return months;
}
function actualPointColor(row){
  if(!row.info.hasData) return themeVar('--chart-muted','#5E6A87');
  if(!row.info.complete) return themeVar('--chart-muted','#5E6A87');
  if(row.tot.actual>row.tot.planned) return themeVar('--chart-negative','#C1543F');
  if(row.tot.actual<row.tot.planned) return themeVar('--chart-positive','#4FAE7C');
  return themeVar('--chart-actual','#C9A15C');
}
function budgetStatusLabel(row){
  if(!row.info.hasData) return 'No Actual Recorded';
  if(!row.info.complete) return 'Incomplete';
  if(row.tot.actual>row.tot.planned) return 'Over Budget';
  if(row.tot.actual<row.tot.planned) return 'Under Budget';
  return 'On Budget';
}
function trendTooltip(row){
  const status = budgetStatusLabel(row);
  const statusColor = status==='Over Budget'?themeVar('--chart-negative','#C1543F'):status==='Under Budget'?themeVar('--chart-positive','#4FAE7C'):status==='On Budget'?themeVar('--chart-actual','#C9A15C'):themeVar('--chart-planned','#96A1BA');
  const v = row.info.hasData ? row.tot.planned-row.tot.actual : null;
  const vp = (v!==null && row.tot.planned) ? v/row.tot.planned : null;
  let mom = '';
  if(row.growthAbs!==null && row.growthAbs!==undefined){
    mom = `<div>MoM Change: <b class="mono" style="color:${row.growthAbs>0?themeVar('--chart-negative','#C1543F'):themeVar('--chart-positive','#4FAE7C')}">${row.growthAbs>0?'+':''}${fmtIDR(row.growthAbs)}</b> (${pct(row.growthPct)})</div>`;
  }
  return `<div style="font-weight:600;margin-bottom:4px;">${escapeHtml(monthLabel(row.m))}</div>
    <div>Planned: <b class="mono">${fmtIDR(row.tot.planned)}</b></div>
    <div>Actual: <b class="mono">${row.info.hasData?fmtIDR(row.tot.actual):'no data'}</b></div>
    ${v!==null?`<div>Variance: <b class="mono">${fmtIDR(v)}</b> (${pct(vp)})</div>`:''}
    ${mom}
    <div style="margin-top:3px;color:${statusColor};">${status}</div>`;
}
