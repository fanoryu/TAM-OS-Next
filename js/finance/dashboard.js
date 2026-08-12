/* ---- DASHBOARD ---- */
function renderDashboard(main){
  const months = scopedMonths();
  if(!months.length){ main.innerHTML = emptyState('No financial data yet','Upload a monthly Excel/CSV file or add a transaction to get started.'); return; }
  if(!State.selectedMonth) State.selectedMonth = months[months.length-1].key;
  const key = State.selectedMonth;
  const tot = monthTotals(key);
  const cats = categoryBreakdown(key);
  const {over, under} = overUnderItems(key);
  const insights = computeInsights(key);
  const m = months.find(mm=>mm.key===key);
  const maxCat = Math.max(1, ...cats.map(c=>Math.max(c.planned,c.actual)));

  main.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Finance Overview</h1>
        <p class="desc">Monthly summary of planned vs. actual fund usage.</p>
      </div>
      <div class="head-controls">${monthSelectHTML('dashMonth', key, false)}</div>
    </div>

    <!-- UX-005A: Net Cash Flow is now owned exclusively by the Executive Dashboard
         (canonical company-level signal). Finance Overview keeps the operational
         finance figures. Budget Variance stays here because its "% of plan"
         framing is operational and materially distinct from the Executive
         Dashboard's absolute variance signal. No calculation changed —
         monthTotals() is untouched; only the Net Cash Flow tile is removed. -->
    <div class="grid grid-3">
      <div class="card stat-card">
        <div class="stat-label">Planned (${escapeHtml(m.month)})</div>
        <div class="stat-value">${fmtIDRShort(tot.planned)}</div>
        <div class="stat-sub dim">${fmtIDR(tot.planned)}</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">Actual Spent</div>
        <div class="stat-value">${fmtIDRShort(tot.actual)}</div>
        <div class="stat-sub ${tot.actual<=tot.planned?'pos':'neg'}">${tot.actual<=tot.planned?'under':'over'} plan by ${fmtIDR(Math.abs(tot.planned-tot.actual))}</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">Budget Variance</div>
        <div class="stat-value" style="color:${tot.variance>=0?'var(--green)':'var(--brick)'}">${fmtIDRShort(tot.variance)}</div>
        <div class="stat-sub dim">${pct(tot.planned?tot.variance/tot.planned:0)} of plan</div>
      </div>
    </div>

    ${(()=>{ const es=execStats(key); return `<div class="grid grid-4" style="margin-top:var(--space-4);">
      <div class="card stat-card"><div class="stat-label">Executed</div><div class="stat-value">${fmtIDRShort(es.executed)}</div><div class="stat-sub dim">of ${fmtIDR(es.planned)} planned</div></div>
      <div class="card stat-card"><div class="stat-label">Remaining</div><div class="stat-value" style="color:${es.remaining>=0?'var(--green)':'var(--brick)'}">${fmtIDRShort(es.remaining)}</div><div class="stat-sub dim">planned − executed</div></div>
      <div class="card stat-card"><div class="stat-label">Execution Rate</div><div class="stat-value">${es.rate.toFixed(0)}%</div><div class="bar-track" style="margin-top:8px;"><div class="bar-fill" style="width:${Math.min(100,es.rate)}%;background:var(--accent);"></div></div></div>
      <div class="card stat-card"><div class="stat-label">Transaction Status</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">
          <span class="pill pill-status-completed">${es.completed} done</span>
          <span class="pill pill-status-partial">${es.partial} partial</span>
          <span class="pill pill-status-planned">${es.pending} pending</span>
          ${es.cancelled?`<span class="pill pill-status-cancelled">${es.cancelled} cancelled</span>`:''}
        </div>
      </div>
    </div>`; })()}

    <div class="grid grid-2" style="margin-top:var(--space-4);">
      <div class="card">
        <h3>Planned vs. Actual by Category</h3>
        <div class="chart-wrap" id="catChart"></div>
      </div>
      <div class="card">
        <h3>Insights<span class="tag">auto-generated</span></h3>
        <div class="insight-list">
          ${insights.length ? insights.map(i=>`<div class="insight-item ${i.type==='warn'?'warn':i.type==='good'?'good':''}">${i.text}</div>`).join('') : '<div class="empty">No insights yet for this month.</div>'}
        </div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:var(--space-4);">
      <div class="card">
        <h3>Largest Expense Categories</h3>
        <div style="display:flex;flex-direction:column;gap:12px;">
          ${cats.map(c=>`
            <div>
              <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px;">
                <span>${categoryPill(c.category)}</span>
                <span class="mono dim">${fmtIDR(c.hasActual?c.actual:c.planned)}</span>
              </div>
              <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100,100*(c.hasActual?c.actual:c.planned)/maxCat)}%;background:${CATEGORY_COLOR[c.category]||'var(--accent)'}"></div></div>
            </div>`).join('') || '<div class="empty">No categories</div>'}
        </div>
      </div>
      <div class="card">
        <h3>Over / Under Budget Items</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Item</th><th class="num">Planned</th><th class="num">Actual</th><th class="num">Diff</th></tr></thead>
            <tbody>
              ${over.slice(0,4).map(t=>rowOverUnder(t,true)).join('')}
              ${under.slice(0,4).map(t=>rowOverUnder(t,false)).join('')}
              ${(!over.length && !under.length) ? '<tr><td colspan="4" class="empty">No actuals recorded yet</td></tr>':''}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:var(--space-4);">
      <div class="card">
        <h3>Unplanned Expenses<span class="tag">no matching plan line</span></h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Item</th><th>Category</th><th class="num">Actual</th></tr></thead>
            <tbody>${scopedTxnsForMonth(key).filter(t=>t.unplanned && t.actual).map(t=>`<tr><td>${escapeHtml(t.uraian)}</td><td>${categoryPill(t.category)}</td><td class="num">${fmtIDR(t.actual)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">None this month</td></tr>'}</tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <h3>Missing Realization Items<span class="tag">planned, not yet recorded</span></h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Item</th><th>Category</th><th class="num">Planned</th></tr></thead>
            <tbody>${scopedTxnsForMonth(key).filter(t=>t.type!=='income' && (t.actual===null||t.actual===undefined)).slice(0,8).map(t=>`<tr><td>${escapeHtml(t.uraian)}</td><td>${categoryPill(t.category)}</td><td class="num">${fmtIDR(t.planned)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">All items have recorded actuals</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;
  document.getElementById('dashMonth').addEventListener('change', e=>{ State.selectedMonth=e.target.value; render(); });

  const catChartEl = document.getElementById('catChart');
  if(catChartEl){
    drawBarChart(catChartEl, {
      labels: cats.map(c=>c.category),
      series: [
        {key:'planned', label:'Planned', color:themeVar('--chart-planned','#96A1BA'), data:cats.map(c=>c.planned)},
        {key:'actual', label:'Actual', color:themeVar('--chart-actual','#C9A15C'), data:cats.map(c=>c.hasActual?c.actual:null), colors:cats.map(c=>CATEGORY_COLOR[c.category]||themeVar('--chart-actual','#C9A15C'))},
      ],
      formatY: fmtIDRShort, height:260,
      emptyMessage:'No category data for this month yet.',
      ariaLabel:'Planned versus actual spending by category',
      tooltipHTML:(i)=>{
        const c = cats[i];
        const v = c.hasActual ? c.planned-c.actual : null;
        const status = !c.hasActual?'Incomplete':v>=0?'Under Budget':'Over Budget';
        return `<div style="font-weight:600;margin-bottom:4px;">${escapeHtml(c.category)}</div>
          <div>Planned: <b class="mono">${fmtIDR(c.planned)}</b></div>
          <div>Actual: <b class="mono">${c.hasActual?fmtIDR(c.actual):'no data'}</b></div>
          ${c.hasActual?`<div>Variance: <b class="mono">${fmtIDR(v)}</b> (${pct(c.planned?v/c.planned:0)})</div>`:''}
          <div style="margin-top:3px;color:${!c.hasActual?themeVar('--chart-planned','#96A1BA'):v>=0?themeVar('--chart-positive','#4FAE7C'):themeVar('--chart-negative','#C1543F')};">${status}</div>`;
      },
    });
  }
}
function rowOverUnder(t,isOver){
  const diff = (t.actual||0)-(t.planned||0);
  return `<tr>
    <td>${escapeHtml(t.uraian)}<div class="faint" style="font-size:10.5px;">${categoryPill(t.category)}</div></td>
    <td class="num">${fmtIDR(t.planned)}</td>
    <td class="num">${fmtIDR(t.actual)}</td>
    <td class="num" style="color:${isOver?'var(--brick)':'var(--green)'}">${diff>0?'+':''}${fmtIDR(diff)}</td>
  </tr>`;
}
function categoryPill(cat){
  const cls = CATEGORY_CLASS[cat] || 'pill-other';
  return `<span class="pill ${cls}">${escapeHtml(cat)}</span>`;
}
/* UX-006D3 — the shared no-data card. It previously replaced the ENTIRE page, so nine
   sidebar views (Overview, Insights, Cash Flow, Budget, Execution Center, Plan vs
   Actual, Compare, Trends, Reports) lost their `<h1>` the moment they had no data:
   the operator landed on an untitled card while the other eighteen views kept their
   heading and showed an in-table empty row instead. That also removed the `.page-head`
   slot Quick Actions mount into, so a frozen UX-006C3 navigation surface silently
   never rendered in the empty state.

   The heading is DERIVED from `PAGE_TITLES`, which is itself derived from the one
   `NAV_GROUPS` manifest — no title is duplicated here. Context-only detail views
   (employeeDetail, contractDetail, payrollDetail, supplementalDetail) are deliberately
   absent from that manifest, so a "record not found" state correctly renders no
   heading, exactly as before. Presentation only: no view, route, availability or
   authorization decision is touched. */
function emptyState(title, sub){
  const view = (typeof State !== 'undefined' && State) ? State.view : null;
  const label = (view && typeof PAGE_TITLES !== 'undefined') ? PAGE_TITLES[view] : null;
  const head = label ? `<div class="page-head"><div><h1>${escapeHtml(label)}</h1></div></div>` : '';
  // Without a heading the card carries its own top offset; with one, the page-head
  // rhythm already provides the separation.
  const gap = label ? '' : ' style="margin-top:var(--space-6);"';
  return `${head}<div class="card"${gap}><div class="empty"><div class="big">◆</div><div style="color:var(--text);font-weight:600;margin-bottom:4px;">${title}</div><div>${sub}</div></div></div>`;
}
