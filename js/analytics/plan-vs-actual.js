/* ---- PLANNED VS ACTUAL ---- */
function renderPlanVsActual(main){
  const months = scopedMonths();
  if(!months.length){ main.innerHTML = emptyState('No data yet','Add or upload monthly data first.'); return; }
  if(!State.selectedMonth) State.selectedMonth = months[months.length-1].key;
  const key = State.selectedMonth;
  const cats = categoryBreakdown(key);
  const txns = scopedTxnsForMonth(key).filter(t=>t.type!=='income').sort((a,b)=>{
    const av = (a.actual||0)-(a.planned||0), bv=(b.actual||0)-(b.planned||0);
    return Math.abs(bv)-Math.abs(av);
  });
  const tot = monthTotals(key);
  main.innerHTML = `
    <div class="page-head">
      <div><h1>Planned vs. Actual</h1><p class="desc">Category and line-item level budget comparison.</p></div>
      <div class="head-controls">${monthSelectHTML('pvaMonth', key, false)}</div>
    </div>
    <div class="grid grid-3 stack-section">
      <div class="card stat-card"><div class="stat-label">Total Planned</div><div class="stat-value">${fmtIDRShort(tot.planned)}</div></div>
      <div class="card stat-card"><div class="stat-label">Total Actual</div><div class="stat-value">${fmtIDRShort(tot.actual)}</div></div>
      <div class="card stat-card"><div class="stat-label">Variance</div><div class="stat-value" style="color:${tot.variance>=0?'var(--green)':'var(--brick)'}">${fmtIDRShort(tot.variance)}</div></div>
    </div>
    <div class="card stack-section">
      <h3>By Category</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Category</th><th class="num">Planned</th><th class="num">Actual</th><th class="num">Variance</th><th class="num">% of Plan Used</th></tr></thead>
        <tbody>${cats.map(c=>{
          const v = c.planned-c.actual;
          const usedPct = c.planned ? (c.actual/c.planned*100) : 0;
          return `<tr>
            <td>${categoryPill(c.category)}</td>
            <td class="num">${fmtIDR(c.planned)}</td>
            <td class="num">${c.hasActual?fmtIDR(c.actual):'<span class="faint">—</span>'}</td>
            <td class="num" style="color:${v>=0?'var(--green)':'var(--brick)'}">${fmtIDR(v)}</td>
            <td class="num">${c.hasActual?usedPct.toFixed(0)+'%':'—'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>
    <div class="card">
      <h3>Line Items — Ranked by Variance</h3>
      <div class="table-wrap" style="max-height:520px;overflow-y:auto;"><table>
        <thead><tr><th>Description</th><th>Category</th><th class="num">Planned</th><th class="num">Actual</th><th class="num">Variance</th><th class="num">%</th></tr></thead>
        <tbody>${txns.map(t=>{
          const hasA = t.actual!==null&&t.actual!==undefined;
          const v = hasA ? t.actual-t.planned : null;
          const vp = hasA && t.planned ? v/t.planned : null;
          return `<tr>
            <td>${escapeHtml(t.uraian)}</td>
            <td>${categoryPill(t.category)}</td>
            <td class="num">${fmtIDR(t.planned)}</td>
            <td class="num">${hasA?fmtIDR(t.actual):'<span class="faint">pending</span>'}</td>
            <td class="num" style="color:${v===null?'inherit':v>0?'var(--brick)':'var(--green)'}">${v===null?'—':(v>0?'+':'')+fmtIDR(v)}</td>
            <td class="num">${vp===null?'—':pct(vp)}</td>
          </tr>`;
        }).join('') || '<tr><td colspan="6" class="empty">No line items</td></tr>'}</tbody>
      </table></div>
    </div>
  `;
  document.getElementById('pvaMonth').addEventListener('change', e=>{ State.selectedMonth=e.target.value; render(); });
}
