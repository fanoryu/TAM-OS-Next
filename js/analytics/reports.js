/* ---- REPORTS ---- */
function renderReports(main){
  const months = scopedMonths();
  if(!months.length){ main.innerHTML = emptyState('No data yet','Add or upload monthly data first.'); return; }
  if(!State.selectedMonth) State.selectedMonth = months[months.length-1].key;
  const key = State.selectedMonth;
  const m = months.find(mm=>mm.key===key);
  main.innerHTML = `
    <div class="page-head">
      <div><h1>Reports</h1><p class="desc">Generate a management summary for a given month.</p></div>
      <div class="head-controls">${monthSelectHTML('repMonth', key, false)}<button class="btn btn-accent" id="dlReport">Download Report (.md)</button></div>
    </div>
    <div class="card" id="reportBody"></div>
    <div class="card" style="margin-top:var(--space-4);">
      <h3>People &amp; Contracts Reports</h3>
      <div class="head-controls" style="margin-bottom:12px;">
        <select class="input" id="hrRepSel">${hrReportDefs().map(d=>`<option value="${d.id}" ${State.hrReportSel===d.id?'selected':''}>${d.label}</option>`).join('')}</select>
        <button class="btn" id="hrRepCsv">Export CSV</button>
      </div>
      <div id="hrRepBody"></div>
    </div>
    <div class="card" style="margin-top:var(--space-4);">
      <h3>Monthly Plan Summary — ${escapeHtml(monthLabel(m))}</h3>
      <div id="planSummaryBody"></div>
    </div>
  `;
  document.getElementById('repMonth').addEventListener('change', e=>{ State.selectedMonth=e.target.value; renderReports(main); });
  document.getElementById('dlReport').addEventListener('click', ()=>{
    downloadBlob(buildReportMarkdown(State.selectedMonth), `${FILE_BASE}-report-${State.selectedMonth}.md`, 'text/markdown');
    toast('Report downloaded.');
  });
  document.getElementById('reportBody').innerHTML = buildReportHTML(key);
  if(!State.hrReportSel) State.hrReportSel='employees';
  const renderHRRep = ()=>{
    const {headers, rows} = hrReportRows(State.hrReportSel, key);
    document.getElementById('hrRepBody').innerHTML = `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((c,ci)=>`<td class="${ci>=headers.length-1||/^Rp|^\d/.test(String(c))?'':''}">${escapeHtml(String(c==null?'—':c))}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${headers.length||1}" class="empty">No data for this report.</td></tr>`}</tbody></table></div>`;
  };
  document.getElementById('hrRepSel').addEventListener('change', e=>{ State.hrReportSel=e.target.value; renderHRRep(); });
  document.getElementById('hrRepCsv').addEventListener('click', ()=>exportHRReportCsv(State.hrReportSel, key));
  renderHRRep();
  document.getElementById('planSummaryBody').innerHTML = buildPlanSummaryHTML(key);
}
function buildPlanSummaryHTML(key){
  const plan = monthlyPlanFor(key);
  const st = hrDashboardStats(key);
  // Readiness-1 — report rows are scoped reads.
  const payroll = ((typeof scopedTxns === 'function') ? scopedTxns() : State.txns).filter(t=>t.source==='payroll' && t.monthKey===key);
  const recurring = ((typeof scopedTxns === 'function') ? scopedTxns() : State.txns).filter(t=>t.recurringId && t.monthKey===key);
  const payrollSum = payroll.reduce((s,t)=>s+(t.planned||0),0);
  const recurringSum = recurring.reduce((s,t)=>s+(t.planned||0),0);
  const opsSum = monthTotals(key).planned - payrollSum - recurringSum;
  return `<div class="grid grid-4" style="margin-bottom:8px;">
      <div class="chart-mini-stat"><div class="lbl">Plan Status</div><div class="val" style="font-size:12px;">${plan?plan.status:'Not started'}</div></div>
      <div class="chart-mini-stat"><div class="lbl">Payroll Planned</div><div class="val">${fmtIDRShort(payrollSum)}</div></div>
      <div class="chart-mini-stat"><div class="lbl">Recurring Planned</div><div class="val">${fmtIDRShort(recurringSum)}</div></div>
      <div class="chart-mini-stat"><div class="lbl">Total Planned</div><div class="val">${fmtIDRShort(monthTotals(key).planned)}</div></div>
    </div>
    <p class="dim" style="font-size:13px;">Payroll transactions: <b>${payroll.length}</b> · Recurring: <b>${recurring.length}</b> · Other operational (planned): <b class="mono">${fmtIDR(opsSum)}</b>. Active employees: <b>${st.activeEmployees}</b>; active contracts: <b>${st.activeContracts}</b>, of which <b>${st.expiringSoon}</b> ending soon.</p>`;
}
function buildReportHTML(key){
  const tot = monthTotals(key); const cats = categoryBreakdown(key); const insights = computeInsights(key);
  const es = execStats(key);
  const m = scopedMonths().find(mm=>mm.key===key);
  return `
    <h3 style="margin-top:0;">Financial Summary — ${escapeHtml(monthLabel(m))}</h3>
    <p class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.4px;margin:-6px 0 10px;">${escapeHtml(APP_NAME)} v${APP_VERSION} · ${escapeHtml(APP_TAGLINE)}</p>
    <p class="dim" style="font-size:13px;">Total planned: <b class="mono">${fmtIDR(tot.planned)}</b> · Total actual (executed): <b class="mono">${fmtIDR(tot.actual)}</b> · Variance: <b class="mono" style="color:${tot.variance>=0?'var(--green)':'var(--brick)'}">${fmtIDR(tot.variance)}</b></p>
    <div class="divider"></div>
    <h4>Execution Summary</h4>
    <p class="dim" style="font-size:13px;">Executed <b class="mono">${fmtIDR(es.executed)}</b> of <b class="mono">${fmtIDR(es.planned)}</b> planned (${es.rate.toFixed(0)}%). Remaining <b class="mono">${fmtIDR(es.remaining)}</b>. ${es.completed} completed · ${es.partial} partial · ${es.pending} pending · ${es.cancelled} cancelled.</p>
    <div class="divider"></div>
    <h4>Category Breakdown</h4>
    <div class="table-wrap"><table><thead><tr><th>Category</th><th class="num">Planned</th><th class="num">Actual</th><th class="num">Variance</th></tr></thead>
    <tbody>${cats.map(c=>`<tr><td>${categoryPill(c.category)}</td><td class="num">${fmtIDR(c.planned)}</td><td class="num">${c.hasActual?fmtIDR(c.actual):'—'}</td><td class="num">${fmtIDR(c.planned-c.actual)}</td></tr>`).join('')}</tbody></table></div>
    <div class="divider"></div>
    <h4>Key Insights</h4>
    <div class="insight-list">${insights.map(i=>`<div class="insight-item ${i.type}">${i.text}</div>`).join('') || '<div class="empty">No insights</div>'}</div>
  `;
}
function buildReportMarkdown(key){
  const tot = monthTotals(key); const cats = categoryBreakdown(key); const insights = computeInsights(key);
  const es = execStats(key);
  const m = scopedMonths().find(mm=>mm.key===key);
  let md = `# ${APP_NAME} v${APP_VERSION} — ${APP_TAGLINE}\n\n## Monthly Finance Report — ${monthLabel(m)}\n\n`;
  md += `- **Total Planned:** ${fmtIDR(tot.planned)}\n- **Total Actual (Executed):** ${fmtIDR(tot.actual)}\n- **Variance:** ${fmtIDR(tot.variance)}\n- **Net Cash Flow:** ${fmtIDR(tot.netCashFlow)}\n\n`;
  md += `## Execution Summary\n\n- **Executed:** ${fmtIDR(es.executed)} of ${fmtIDR(es.planned)} planned (${es.rate.toFixed(0)}% execution rate)\n- **Remaining:** ${fmtIDR(es.remaining)}\n- **Completed:** ${es.completed} · **Partial:** ${es.partial} · **Pending:** ${es.pending} · **Cancelled:** ${es.cancelled}\n\n`;
  md += `## Category Breakdown\n\n| Category | Planned | Actual | Variance |\n|---|---:|---:|---:|\n`;
  cats.forEach(c=>{ md += `| ${c.category} | ${fmtIDR(c.planned)} | ${c.hasActual?fmtIDR(c.actual):'—'} | ${fmtIDR(c.planned-c.actual)} |\n`; });
  md += `\n## Key Insights\n\n`;
  insights.forEach(i=>{ md += `- ${i.text.replace(/<[^>]+>/g,'')}\n`; });
  md += `\n---\n_Generated by ${APP_NAME} v${APP_VERSION} (${APP_TAGLINE})._\n`;
  return md;
}
