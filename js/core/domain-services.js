/* ---------- Company Bank Accounts + Bank Master helpers (v2.6.9) ----------
   Company accounts are user-managed records (tam_company_accounts_v1). The Bank
   Master (BANK_MASTER_GROUPS / INDONESIAN_BANKS in constants.js) is static
   reference data. Transactions store a company account's label string in the
   existing `bankAccount` field, so legacy string values keep resolving. */
function companyAccountById(id){ return (State.companyAccounts||[]).find(a=>a.id===id) || null; }
function companyAccountByLabel(label){ if(!label) return null; return (State.companyAccounts||[]).find(a=>a.label===label) || null; }
function activeCompanyAccounts(){ return (State.companyAccounts||[]).filter(a=>a.status==='Active'); }
function companyAccountLabel(a){ if(!a) return '—'; return a.bankName ? (a.label+' — '+a.bankName) : a.label; }
// Legacy short bank name -> Bank Master canonical name (display/mapping only; no data rewrite).
const LEGACY_BANK_NAME_MAP = { 'Mandiri':'Bank Mandiri', 'BCA':'BCA', 'BNI':'Bank Negara Indonesia (BNI)', 'BRI':'Bank Rakyat Indonesia (BRI)', 'BSI':'Bank Syariah Indonesia', 'BTN':'Bank Tabungan Negara (BTN)' };
function normalizeBankName(name){ const n=(name||'').trim(); if(!n) return ''; return LEGACY_BANK_NAME_MAP[n] || n; }
// Resolve a transaction's stored bankAccount string (a company-account label, or a
// legacy BANK_ACCOUNTS string) to a friendly display. Unknown/legacy values pass through.
function resolveBankAccountDisplay(value){ if(!value) return '—'; const a=companyAccountByLabel(value); return a ? companyAccountLabel(a) : value; }
// v2.6.9 — <option> list of ACTIVE company accounts for transaction / payroll / recurring
// dropdowns. Option value = the account label (a string, backward-compatible with the
// legacy stored value). A `selected` value not among the active accounts is preserved as a
// leading "(current)" option so existing rows never lose their recorded account.
// opts: { allOption:true (filters), blankOption:true (optional field) }.
function companyAccountOptionsHTML(selected, opts){
  opts = opts||{};
  const sel = (selected==null)?'':String(selected);
  const active = activeCompanyAccounts();
  const labels = active.map(a=>a.label);
  let html = '';
  if(opts.allOption) html += `<option value="all" ${sel==='all'?'selected':''}>All accounts</option>`;
  if(opts.blankOption) html += `<option value="" ${sel===''?'selected':''}>—</option>`;
  if(sel && sel!=='all' && sel!=='' && !labels.includes(sel)) html += `<option value="${escapeHtml(sel)}" selected>${escapeHtml(sel)} (current)</option>`;
  html += active.map(a=>`<option value="${escapeHtml(a.label)}" ${a.label===sel?'selected':''}>${escapeHtml(companyAccountLabel(a))}</option>`).join('');
  if(!html) html = `<option value="">— no active accounts (add in Bank Accounts) —</option>`;
  return html;
}

/* ---------- derived data ---------- */
function getMonths(){
  const map = {};
  State.txns.forEach(t=>{
    if(!map[t.monthKey]) map[t.monthKey] = {key:t.monthKey, month:t.month, year:t.year, monthNum:t.monthNum};
  });
  return Object.values(map).sort(monthKeySort);
}
function txnsForMonth(key){ return State.txns.filter(t=>t.monthKey===key); }

/* ---------- Readiness-1 — principal-scoped FINANCE READ ----------
   getMonths()/txnsForMonth() above stay CANONICAL and unscoped on purpose: import,
   parsing, persistence and migration must always see the complete ledger, and they
   are not principal-facing reads. The helpers below are the READ counterparts that
   Finance and Analytics renderers use instead.

   Atlas ruling (§9): navigation stays visible+normal for every principal, but an
   Employee may receive only records with an EXISTING, explicit, unambiguous
   relationship to them. Finance rows carry an optional `employeeId` — payroll
   postings set it, ordinary company expenses do not — so an Employee's scoped ledger
   is their own payroll-linked rows and nothing else. Where that yields nothing, the
   surface renders the existing D3 no-data state; that is "no scoped data available",
   NOT "permission denied", and no ownership model was invented to manufacture rows.
   CEO reads the complete ledger, exactly as before. */
function scopedTxns(){
  return (typeof getScopedRecords === 'function') ? getScopedRecords('transaction') : State.txns.slice();
}
function scopedTxnsForMonth(key){ return scopedTxns().filter(t=>t.monthKey===key); }
function scopedMonths(){
  const map = {};
  scopedTxns().forEach(t=>{
    if(!map[t.monthKey]) map[t.monthKey] = {key:t.monthKey, month:t.month, year:t.year, monthNum:t.monthNum};
  });
  return Object.values(map).sort(monthKeySort);
}
// Cancelled transactions are excluded from all planned/actual analytics (they
// represent plans that will not happen). Archived transactions remain counted —
// they are completed history. Everything else keys off t.actual, which execution
// keeps in sync, so dashboards/trends/cash-flow update the instant a payment is executed.
/* Readiness-1 — the DERIVED ANALYTICS aggregates below (monthTotals, categoryBreakdown,
   execStats and friends) feed dashboards, charts and reports only; no import, parser or
   persistence path consumes them. They therefore read through scopedTxnsForMonth(), so a
   figure can never summarise records the principal may not read (§10: an aggregate must
   come from the same scoped dataset as its rows). The canonical txnsForMonth() above is
   left untouched for the paths that legitimately need the whole ledger. */
function isCounted(t){ return statusOf(t)!=='cancelled'; }
function monthTotals(key){
  const txns = scopedTxnsForMonth(key).filter(isCounted);
  let planned=0, actual=0, actualKnown=0, income=0, incomeActual=0;
  txns.forEach(t=>{
    if(t.type==='income'){
      income += t.planned||0;
      if(t.actual!==null && t.actual!==undefined) incomeActual += t.actual;
    } else {
      planned += t.planned||0;
      if(t.actual!==null && t.actual!==undefined){ actual += t.actual; actualKnown++; }
    }
  });
  return {planned, actual, income, incomeActual, variance: planned-actual, netCashFlow: incomeActual - actual, count: txns.length};
}
function categoryBreakdown(key){
  const txns = scopedTxnsForMonth(key).filter(t=>t.type!=='income' && isCounted(t));
  const map = {};
  txns.forEach(t=>{
    if(!map[t.category]) map[t.category] = {category:t.category, planned:0, actual:0, hasActual:false};
    map[t.category].planned += t.planned||0;
    if(t.actual!==null && t.actual!==undefined){ map[t.category].actual += t.actual; map[t.category].hasActual = true; }
  });
  return Object.values(map).sort((a,b)=>b.planned-a.planned);
}
// Execution KPIs for a month: how much of the planned budget has actually been executed,
// and a count of transactions by lifecycle status.
function execStats(key){
  const txns = scopedTxnsForMonth(key).filter(t=>t.type!=='income');
  let planned=0, executed=0, completed=0, partial=0, pending=0, cancelled=0, archived=0, scheduled=0;
  txns.forEach(t=>{
    const st = statusOf(t);
    if(st==='cancelled'){ cancelled++; return; }
    planned += t.planned||0;
    if(t.actual!==null && t.actual!==undefined) executed += t.actual;
    if(st==='completed') completed++;
    else if(st==='archived'){ completed++; archived++; }
    else if(st==='partial') partial++;
    else if(st==='scheduled'){ pending++; scheduled++; }
    else pending++;
  });
  const remaining = planned-executed;
  const rate = planned? (executed/planned*100) : 0;
  return {planned, executed, remaining, rate, completed, partial, pending, cancelled, archived, scheduled, total:txns.length};
}
function overUnderItems(key){
  const txns = scopedTxnsForMonth(key).filter(t=>t.type!=='income' && t.actual!==null && t.actual!==undefined);
  const over = txns.filter(t=>t.actual > (t.planned||0)).sort((a,b)=>(b.actual-b.planned)-(a.actual-a.planned));
  const under = txns.filter(t=>t.actual < (t.planned||0) && (t.planned||0)>0).sort((a,b)=>(a.actual-a.planned)-(b.actual-b.planned));
  return {over, under};
}
function normalizedItemKey(t){ return t.category + '|' + normStr(t.uraian); }
function recurringItems(){
  const byKey = {};
  State.txns.filter(t=>t.type!=='income').forEach(t=>{
    const k = normalizedItemKey(t);
    if(!byKey[k]) byKey[k] = {label:t.uraian, category:t.category, months:new Set(), totalActual:0, totalPlanned:0, txns:[]};
    byKey[k].months.add(t.monthKey);
    byKey[k].totalActual += t.actual||0;
    byKey[k].totalPlanned += t.planned||0;
    byKey[k].txns.push(t);
  });
  const totalMonths = getMonths().length || 1;
  return Object.values(byKey)
    .map(x=>({...x, monthCount:x.months.size, freq:x.months.size/totalMonths}))
    .filter(x=>x.monthCount>=3)
    .sort((a,b)=>b.monthCount-a.monthCount);
}

/* ---------- insights engine ---------- */
function computeInsights(key){
  const insights = [];
  const months = getMonths();
  const idx = months.findIndex(m=>m.key===key);
  const tot = monthTotals(key);
  const cats = categoryBreakdown(key);
  const {over, under} = overUnderItems(key);
  const m = months[idx];
  if(!m) return insights;

  if(cats.length){
    const top = cats[0];
    insights.push({type:'info', text:`${escapeHtml(top.category)} is the largest spending category this month at ${fmtIDR(top.actual||top.planned)}, ${pct((top.actual||top.planned)/(tot.actual||tot.planned||1)-0)==='—'?'':''}${Math.round(100*(top.actual||top.planned)/(tot.actual||tot.planned||1))}% of total.`});
  }
  if(tot.actual > tot.planned){
    insights.push({type:'warn', text:`Actual spending exceeded plan by ${fmtIDR(tot.actual-tot.planned)} (${pct((tot.actual-tot.planned)/(tot.planned||1))}) this month.`});
  } else if(tot.actual>0){
    insights.push({type:'good', text:`Spending came in under plan by ${fmtIDR(tot.planned-tot.actual)} (${pct((tot.planned-tot.actual)/(tot.planned||1))}) this month.`});
  }
  if(over.length){
    const worst = over[0];
    insights.push({type:'warn', text:`Largest overrun: "${escapeHtml(worst.uraian)}" ran ${fmtIDR(worst.actual-worst.planned)} over its ${fmtIDR(worst.planned)} plan.`});
  }
  if(under.length){
    const best = under[0];
    insights.push({type:'good', text:`Largest saving: "${escapeHtml(best.uraian)}" came in ${fmtIDR(best.planned-best.actual)} under its ${fmtIDR(best.planned)} plan.`});
  }
  if(idx>0){
    const prev = months[idx-1];
    const prevTot = monthTotals(prev.key);
    if(prevTot.actual>0 && tot.actual>0){
      const delta = tot.actual - prevTot.actual;
      const dpct = delta/prevTot.actual;
      insights.push({type: delta>0?'warn':'good', text:`Actual spending is ${delta>0?'up':'down'} ${pct(Math.abs(dpct))<'—'?'':''}${Math.abs(Math.round(dpct*100))}% vs ${monthLabel(prev)} (${fmtIDR(Math.abs(delta))}).`});
    }
  }
  const unplanned = scopedTxnsForMonth(key).filter(t=>t.unplanned && t.actual);
  if(unplanned.length){
    const sum = unplanned.reduce((s,t)=>s+(t.actual||0),0);
    insights.push({type:'warn', text:`${unplanned.length} unplanned expense${unplanned.length>1?'s':''} this month totaling ${fmtIDR(sum)} — spending with no matching planned line item.`});
  }
  const pendingCount = scopedTxnsForMonth(key).filter(t=>t.type!=='income' && (t.actual===null||t.actual===undefined)).length;
  if(pendingCount){
    insights.push({type:'info', text:`${pendingCount} line item${pendingCount>1?'s':''} still ${pendingCount>1?'have':'has'} no recorded actual amount.`});
  }
  return insights;
}
