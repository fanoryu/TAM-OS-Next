/* ---- MONTHLY TRENDS ---- */
function monthActualInfo(key){
  const txns = scopedTxnsForMonth(key).filter(t=>t.type!=='income');
  const known = txns.filter(t=>t.actual!==null && t.actual!==undefined);
  const pending = txns.length - known.length;
  const sum = known.reduce((s,t)=>s+(t.actual||0),0);
  return {hasData: known.length>0, complete: pending===0 && txns.length>0, pending, total: txns.length, sum};
}
function categorySeries(catName, months){
  return months.map(m=>{
    const cb = categoryBreakdown(m.key).find(c=>c.category===catName);
    return {m, planned: cb?cb.planned:0, actual: (cb&&cb.hasActual)?cb.actual:null, hasActual: cb?cb.hasActual:false};
  });
}
function filteredTrendMonths(){
  const months = scopedMonths();
  const f = State.trendsFilter;
  if(f.range==='year'){ const y=new Date().getFullYear(); const r=months.filter(m=>m.year===y); return r.length?r:months; }
  if(f.range==='last3') return months.slice(-3);
  if(f.range==='last6') return months.slice(-6);
  if(f.range==='last12') return months.slice(-12);
  if(f.range==='custom' && f.start && f.end) return months.filter(m=>m.key>=f.start && m.key<=f.end);
  return months;
}
function trendRows(months){
  const allMonths = scopedMonths();
  return months.map(m=>{
    const idx = allMonths.findIndex(x=>x.key===m.key);
    const prev = idx>0 ? allMonths[idx-1] : null;
    const tot = monthTotals(m.key), info = monthActualInfo(m.key);
    const prevTot = prev ? monthTotals(prev.key) : null;
    const prevInfo = prev ? monthActualInfo(prev.key) : null;
    const growthAbs = (prev && info.hasData && prevInfo.hasData) ? tot.actual-prevTot.actual : null;
    const growthPct = (growthAbs!==null && prevTot.actual) ? growthAbs/prevTot.actual : null;
    const varianceChange = (prev && info.hasData && prevInfo.hasData) ? tot.variance-prevTot.variance : null;
    return {m, tot, info, prev, growthAbs, growthPct, varianceChange};
  });
}
function computeTrendInsights(months){
  const insights = [];
  if(!months.length) return insights;
  const allMonths = scopedMonths();
  const rows = trendRows(months);
  const withData = rows.filter(r=>r.info.hasData);
  const lastRow = rows[rows.length-1];
  if(lastRow && lastRow.growthAbs!==null){
    insights.push({type: lastRow.growthAbs>0?'warn':'good', text:`Actual spending ${lastRow.growthAbs>0?'increased':'decreased'} by ${fmtIDR(Math.abs(lastRow.growthAbs))} (${pct(lastRow.growthPct)}) in ${monthLabel(lastRow.m)} versus the prior month.`});
  }
  if(withData.length){
    const highest = withData.reduce((a,b)=>b.tot.actual>a.tot.actual?b:a);
    const lowest = withData.reduce((a,b)=>b.tot.actual<a.tot.actual?b:a);
    insights.push({type:'info', text:`${monthLabel(highest.m)} is the highest-spending month in this period at ${fmtIDR(highest.tot.actual)}; ${monthLabel(lowest.m)} is the lowest at ${fmtIDR(lowest.tot.actual)}.`});
  }
  const gajiSeries = categorySeries('Gaji', months).filter(x=>x.hasActual);
  let payrollStreak=0;
  for(let i=gajiSeries.length-1;i>0;i--){ if(gajiSeries[i].actual>gajiSeries[i-1].actual) payrollStreak++; else break; }
  if(payrollStreak>=2) insights.push({type:'warn', text:`Gaji (payroll) actual spending has risen for ${payrollStreak+1} consecutive months.`});
  const kegVals = categorySeries('Operasional Kegiatan', months).filter(x=>x.hasActual).map(x=>x.actual);
  if(kegVals.length>=3){
    const mean = kegVals.reduce((a,b)=>a+b,0)/kegVals.length;
    const sd = Math.sqrt(kegVals.reduce((a,b)=>a+Math.pow(b-mean,2),0)/kegVals.length);
    const cv = mean ? sd/mean : 0;
    if(cv>0.5) insights.push({type:'warn', text:`Operasional Kegiatan spending shows high month-to-month volatility (~±${Math.round(cv*100)}% relative variation).`});
  }
  let overStreak=0;
  for(let i=withData.length-1;i>=0;i--){ if(withData[i].tot.actual>withData[i].tot.planned) overStreak++; else break; }
  if(overStreak>=2) insights.push({type:'warn', text:`The last ${overStreak} months with recorded actuals each ran over the planned budget.`});
  if(withData.length){
    const avg = withData.reduce((a,x)=>a+x.tot.actual,0)/withData.length;
    insights.push({type:'info', text:`Average actual spending across this period is ${fmtIDR(avg)}/month, based on ${withData.length} month${withData.length!==1?'s':''} with recorded actuals.`});
  }
  return insights;
}
function exportTrendSummaryCsv(rows){
  const headers = ['Month','Year','Planned','Actual','ActualStatus','Variance','MoM Actual Change','MoM Actual %'];
  const lines = [`# ${APP_NAME} v${APP_VERSION} — ${APP_TAGLINE}`, headers.join(',')];
  rows.forEach(r=>{
    const status = !r.info.hasData ? 'missing' : r.info.complete ? 'complete' : 'incomplete';
    lines.push([r.m.month, r.m.year, r.tot.planned, r.info.hasData?r.tot.actual:'', status, r.info.hasData?r.tot.variance:'', r.growthAbs??'', r.growthPct!==null?(r.growthPct*100).toFixed(1)+'%':''].join(','));
  });
  downloadBlob(lines.join('\n'), `${FILE_BASE}-monthly-trend-summary.csv`, 'text/csv');
  toast('Trend summary exported.');
}
function exportCategoryTrendCsv(catName, months){
  const series = categorySeries(catName, months);
  const headers = ['Month','Year','Category','Planned','Actual','ActualStatus'];
  const lines = [`# ${APP_NAME} v${APP_VERSION} — ${APP_TAGLINE}`, headers.join(',')];
  series.forEach(s=>{
    lines.push([s.m.month, s.m.year, catName, s.planned, s.hasActual?s.actual:'', s.hasActual?'recorded':'missing'].join(','));
  });
  downloadBlob(lines.join('\n'), `${FILE_BASE}-category-trend-${catName.replace(/\s+/g,'-')}.csv`, 'text/csv');
  toast('Category trend exported.');
}

function renderTrends(main){
  const allMonths = scopedMonths();
  if(!allMonths.length){ main.innerHTML = emptyState('No data yet','Add or upload monthly data first.'); return; }
  const f = State.trendsFilter;
  const months = filteredTrendMonths();
  const rows = trendRows(months);
  const withData = rows.filter(r=>r.info.hasData);
  const allCats = [...new Set([...KNOWN_CATEGORIES, ...((typeof scopedTxns === 'function') ? scopedTxns() : State.txns).map(t=>t.category)])];
  if(!allCats.includes(f.category)) f.category = allCats[0];

  const avgPlanned = months.length ? months.reduce((s,m)=>s+monthTotals(m.key).planned,0)/months.length : 0;
  const avgActual = withData.length ? withData.reduce((s,r)=>s+r.tot.actual,0)/withData.length : null;
  const highest = withData.length ? withData.reduce((a,b)=>b.tot.actual>a.tot.actual?b:a) : null;
  const lowest = withData.length ? withData.reduce((a,b)=>b.tot.actual<a.tot.actual?b:a) : null;
  const largestOver = withData.length ? withData.reduce((a,b)=>(b.tot.variance<a.tot.variance)?b:a) : null; // most negative variance
  const largestSaving = withData.length ? withData.reduce((a,b)=>(b.tot.variance>a.tot.variance)?b:a) : null; // most positive variance
  const totalSpending = withData.reduce((s,r)=>s+r.tot.actual,0);

  main.innerHTML = `
    <div class="page-head"><div><h1>Monthly Trends</h1><p class="desc">Chronological view from ${escapeHtml(monthLabel(allMonths[0]))} to ${escapeHtml(monthLabel(allMonths[allMonths.length-1]))}.</p></div></div>

    <div class="card stack-section">
      <div class="form-grid" style="grid-template-columns:1.2fr 1fr 1fr 1fr;align-items:end;">
        <div class="field"><label>Date Range</label>
          <select class="input" id="trRange">
            <option value="all" ${f.range==='all'?'selected':''}>All Time</option>
            <option value="year" ${f.range==='year'?'selected':''}>Current Year</option>
            <option value="last3" ${f.range==='last3'?'selected':''}>Last 3 Months</option>
            <option value="last6" ${f.range==='last6'?'selected':''}>Last 6 Months</option>
            <option value="last12" ${f.range==='last12'?'selected':''}>Last 12 Months</option>
            <option value="custom" ${f.range==='custom'?'selected':''}>Custom Range</option>
          </select>
        </div>
        ${f.range==='custom' ? `
        <div class="field"><label>Start Month</label>${monthSelectHTML('trStart', f.start||allMonths[0].key, false)}</div>
        <div class="field"><label>End Month</label>${monthSelectHTML('trEnd', f.end||allMonths[allMonths.length-1].key, false)}</div>
        ` : '<div></div><div></div>'}
        <div class="field"><label>Category (for category trend)</label>
          <select class="input" id="trCategory">${allCats.map(c=>`<option value="${escapeHtml(c)}" ${f.category===c?'selected':''}>${escapeHtml(c)}</option>`).join('')}</select>
        </div>
      </div>
    </div>

    <div class="grid grid-4 stack-section">
      <div class="card stat-card"><div class="stat-label">Avg Monthly Planned</div><div class="stat-value">${fmtIDRShort(avgPlanned)}</div></div>
      <div class="card stat-card"><div class="stat-label">Avg Monthly Actual</div><div class="stat-value">${avgActual!==null?fmtIDRShort(avgActual):'<span class="faint">no data</span>'}</div></div>
      <div class="card stat-card"><div class="stat-label">Highest-Spending Month</div><div class="stat-value" style="font-size:15px;">${highest?escapeHtml(monthLabel(highest.m)):'—'}</div><div class="stat-sub dim">${highest?fmtIDR(highest.tot.actual):''}</div></div>
      <div class="card stat-card"><div class="stat-label">Lowest-Spending Month</div><div class="stat-value" style="font-size:15px;">${lowest?escapeHtml(monthLabel(lowest.m)):'—'}</div><div class="stat-sub dim">${lowest?fmtIDR(lowest.tot.actual):''}</div></div>
    </div>
    <div class="grid grid-3 stack-section">
      <div class="card stat-card"><div class="stat-label">Largest Over-Budget Month</div><div class="stat-value" style="font-size:15px;color:var(--brick);">${largestOver&&largestOver.tot.variance<0?escapeHtml(monthLabel(largestOver.m)):'—'}</div><div class="stat-sub dim">${largestOver&&largestOver.tot.variance<0?fmtIDR(largestOver.tot.variance):'none over budget'}</div></div>
      <div class="card stat-card"><div class="stat-label">Largest Saving Month</div><div class="stat-value" style="font-size:15px;color:var(--green);">${largestSaving&&largestSaving.tot.variance>0?escapeHtml(monthLabel(largestSaving.m)):'—'}</div><div class="stat-sub dim">${largestSaving&&largestSaving.tot.variance>0?fmtIDR(largestSaving.tot.variance):'none under budget'}</div></div>
      <div class="card stat-card"><div class="stat-label">Total Actual Spending (recorded)</div><div class="stat-value">${fmtIDRShort(totalSpending)}</div><div class="stat-sub dim">${withData.length} of ${months.length} months have recorded actuals</div></div>
    </div>

    <div class="card stack-section">
      <div style="display:flex;justify-content:space-between;align-items:center;"><h3 style="margin:0;">Planned vs. Actual Trend</h3><button class="btn btn-sm" id="exportTrendCsv">Export Summary CSV</button></div>
      <p class="hint">Gaps in the actual line mean no actual data was recorded for that month — not zero spending. Click a point to open that month in Finance Overview.</p>
      <div class="chart-wrap tall" id="trPlanActual"></div>
    </div>

    <div class="grid grid-2 stack-section">
      <div class="card">
        <h3>Budget Variance Trend</h3>
        <p class="hint">Positive = under budget. Negative = over budget.</p>
        <div class="chart-wrap" id="trVariance"></div>
      </div>
      <div class="card">
        <h3>Month-over-Month Actual Growth</h3>
        <div class="chart-wrap" id="trGrowthChart"></div>
        <div class="table-wrap" style="max-height:220px;overflow-y:auto;margin-top:10px;">
          <table><thead><tr><th>Month</th><th class="num">Actual</th><th class="num">MoM Change</th><th class="num">MoM %</th></tr></thead>
          <tbody>${rows.map(r=>`<tr>
            <td>${escapeHtml(monthLabel(r.m))}</td>
            <td class="num">${r.info.hasData?fmtIDR(r.tot.actual):'<span class="faint">missing</span>'}</td>
            <td class="num" style="color:${r.growthAbs==null?'inherit':r.growthAbs>0?'var(--brick)':'var(--green)'}">${r.growthAbs==null?'—':(r.growthAbs>0?'+':'')+fmtIDR(r.growthAbs)}</td>
            <td class="num">${r.growthPct==null?'—':pct(r.growthPct)}</td>
          </tr>`).join('')}</tbody></table>
        </div>
      </div>
    </div>

    <div class="card stack-section">
      <div style="display:flex;justify-content:space-between;align-items:center;"><h3 style="margin:0;">Category Trend — ${escapeHtml(f.category)}</h3><button class="btn btn-sm" id="exportCatCsv">Export Category CSV</button></div>
      <div class="chart-wrap" id="trCategoryChart"></div>
      <div id="catTrendStats"></div>
    </div>

    <div class="card">
      <h3>Automatic Trend Insights</h3>
      <div class="insight-list">${computeTrendInsights(months).map(i=>`<div class="insight-item ${i.type}">${i.text}</div>`).join('') || '<div class="empty">Not enough data for insights yet.</div>'}</div>
    </div>
  `;

  document.getElementById('trRange').addEventListener('change', e=>{ State.trendsFilter.range=e.target.value; render(); });
  if(f.range==='custom'){
    document.getElementById('trStart').addEventListener('change', e=>{ State.trendsFilter.start=e.target.value; render(); });
    document.getElementById('trEnd').addEventListener('change', e=>{ State.trendsFilter.end=e.target.value; render(); });
  }
  document.getElementById('trCategory').addEventListener('change', e=>{ State.trendsFilter.category=e.target.value; render(); });
  document.getElementById('exportTrendCsv').addEventListener('click', ()=>exportTrendSummaryCsv(rows));
  document.getElementById('exportCatCsv').addEventListener('click', ()=>exportCategoryTrendCsv(f.category, months));

  const labels = months.map(m=>m.month.slice(0,3)+" '"+String(m.year).slice(2));
  const goToMonth = (i)=>{ State.selectedMonth = rows[i].m.key; State.view='financeOverview'; render(); };

  const paEl = document.getElementById('trPlanActual');
  if(paEl){
    drawLineChart(paEl, {
      labels,
      series: [
        {key:'planned', label:'Planned', color:themeVar('--chart-planned','#96A1BA'), data: rows.map(r=>r.tot.planned)},
        {key:'actual', label:'Actual', color:themeVar('--chart-actual','#C9A15C'), fill:true, data: rows.map(r=>r.info.hasData?r.tot.actual:null),
          pointColor: rows.map(r=>actualPointColor(r)), pointHollow: rows.map(r=>r.info.hasData && !r.info.complete)},
      ],
      formatY: fmtIDRShort, height:320,
      emptyMessage:'No data in the selected date range.',
      ariaLabel:'Planned versus actual spending trend over time',
      tooltipHTML:(i)=>trendTooltip(rows[i]),
      onIndexClick: goToMonth,
    });
  }
  const vcEl = document.getElementById('trVariance');
  if(vcEl){
    drawBarChart(vcEl, {
      labels,
      series: [{key:'variance', label:'Variance', color:themeVar('--chart-positive','#4FAE7C'), data: rows.map(r=>r.info.hasData?r.tot.variance:null)}],
      formatY: fmtIDRShort, height:260, signed:true, legend:false,
      emptyMessage:'No data in the selected date range.',
      ariaLabel:'Budget variance by month',
      tooltipHTML:(i)=>{
        const r = rows[i];
        return `<div style="font-weight:600;margin-bottom:4px;">${escapeHtml(monthLabel(r.m))}</div>
          <div>Planned: <b class="mono">${fmtIDR(r.tot.planned)}</b></div>
          <div>Actual: <b class="mono">${r.info.hasData?fmtIDR(r.tot.actual):'no data'}</b></div>
          ${r.info.hasData?`<div>Variance: <b class="mono">${fmtIDR(r.tot.variance)}</b></div>`:''}
          <div style="margin-top:3px;color:${actualPointColor(r)};">${budgetStatusLabel(r)}</div>`;
      },
      onBarClick: goToMonth,
    });
  }
  const gcEl = document.getElementById('trGrowthChart');
  if(gcEl){
    drawBarChart(gcEl, {
      labels,
      series: [{key:'growth', label:'MoM Actual Change', color:themeVar('--chart-neutral','#6FA3D8'), data: rows.map(r=>r.growthAbs)}],
      formatY: fmtIDRShort, height:200, signed:true, legend:false,
      emptyMessage:'Not enough consecutive months with actuals yet.',
      ariaLabel:'Month over month actual spending change',
      tooltipHTML:(i)=>{
        const r = rows[i];
        if(r.growthAbs===null||r.growthAbs===undefined){
          return `<div style="font-weight:600;margin-bottom:4px;">${escapeHtml(monthLabel(r.m))}</div><div>No comparison available (missing or incomplete data).</div>`;
        }
        return `<div style="font-weight:600;margin-bottom:4px;">${escapeHtml(monthLabel(r.m))}</div>
          <div>Current Actual: <b class="mono">${fmtIDR(r.tot.actual)}</b></div>
          <div>Previous Actual: <b class="mono">${fmtIDR(r.tot.actual-r.growthAbs)}</b></div>
          <div>Change: <b class="mono">${r.growthAbs>0?'+':''}${fmtIDR(r.growthAbs)}</b> (${pct(r.growthPct)})</div>`;
      },
      onBarClick: goToMonth,
    });
  }
  const ccEl = document.getElementById('trCategoryChart');
  if(ccEl){
    const series = categorySeries(f.category, months);
    drawLineChart(ccEl, {
      labels,
      series: [
        {key:'planned', label:'Planned', color:themeVar('--chart-planned','#96A1BA'), data: series.map(s=>s.planned)},
        {key:'actual', label:'Actual', color: CATEGORY_COLOR[f.category]||themeVar('--chart-actual','#C9A15C'), fill:true, data: series.map(s=>s.hasActual?s.actual:null)},
      ],
      formatY: fmtIDRShort, height:260,
      emptyMessage:`No ${f.category} data in the selected date range.`,
      ariaLabel:`${f.category} planned versus actual trend`,
      tooltipHTML:(i)=>{
        const s = series[i];
        const v = s.hasActual ? s.planned-s.actual : null;
        return `<div style="font-weight:600;margin-bottom:4px;">${escapeHtml(monthLabel(s.m))} — ${escapeHtml(f.category)}</div>
          <div>Planned: <b class="mono">${fmtIDR(s.planned)}</b></div>
          <div>Actual: <b class="mono">${s.hasActual?fmtIDR(s.actual):'no data'}</b></div>
          ${v!==null?`<div>Variance: <b class="mono">${fmtIDR(v)}</b></div>`:''}`;
      },
      onIndexClick:(i)=>{ State.selectedMonth = series[i].m.key; State.view='financeOverview'; render(); },
    });
    const catKnown = series.filter(s=>s.hasActual);
    const catStatsEl = document.getElementById('catTrendStats');
    if(catStatsEl){
      if(catKnown.length){
        const avgCat = catKnown.reduce((a,s)=>a+s.actual,0)/catKnown.length;
        const hiCat = catKnown.reduce((a,b)=>b.actual>a.actual?b:a);
        const loCat = catKnown.reduce((a,b)=>b.actual<a.actual?b:a);
        const lastKnown = catKnown[catKnown.length-1];
        const idxInSeries = series.indexOf(lastKnown);
        const prevKnown = idxInSeries>0 ? [...series.slice(0,idxInSeries)].reverse().find(s=>s.hasActual) : null;
        const latestChange = prevKnown ? lastKnown.actual - prevKnown.actual : null;
        catStatsEl.innerHTML = `<div class="chart-mini-stats">
          <div class="chart-mini-stat"><div class="lbl">Avg Monthly Actual</div><div class="val">${fmtIDRShort(avgCat)}</div></div>
          <div class="chart-mini-stat"><div class="lbl">Highest Month</div><div class="val" style="font-size:12px;">${escapeHtml(monthLabel(hiCat.m))}</div></div>
          <div class="chart-mini-stat"><div class="lbl">Lowest Month</div><div class="val" style="font-size:12px;">${escapeHtml(monthLabel(loCat.m))}</div></div>
          <div class="chart-mini-stat"><div class="lbl">Latest Change</div><div class="val" style="color:${latestChange==null?'inherit':latestChange>0?'var(--brick)':'var(--green)'}">${latestChange==null?'—':(latestChange>0?'+':'')+fmtIDRShort(latestChange)}</div></div>
        </div>`;
      } else {
        catStatsEl.innerHTML = `<div class="empty" style="padding:var(--space-4) 0;">No recorded actuals for ${escapeHtml(f.category)} in this range.</div>`;
      }
    }
  }
}
