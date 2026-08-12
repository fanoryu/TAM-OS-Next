function monthSortVal(b){ return b.year*12 + b.monthNum; }

async function handleFile(file, main){
  try{
    toast('Reading ' + file.name + '…');
    const rawBatches = await parseUploadedFile(file);
    if(!rawBatches || !rawBatches.length){
      toast('Could not recognize the file structure. Check the column headers and try again.');
      return;
    }
    // Import Mode (Part 12): Smart / Review use the Smart Import wizard; Finance
    // Only keeps the existing finance-transaction preview flow unchanged.
    if(State.importMode==='smart' || State.importMode==='review'){
      const model = buildSmartImport(rawBatches, file.name);
      if(!model.items.length){
        showWarning('No payroll (Gaji) rows detected. Use "Finance Transactions Only" mode for non-payroll files.');
        State.pendingImport = buildPendingImport(file.name, rawBatches); renderAdd(main); return;
      }
      State.smartImport = model; State.smartStep = 7; State.smartTab='all'; State.view='smartImport'; render();
      return;
    }
    State.pendingImport = buildPendingImport(file.name, rawBatches);
    renderAdd(main);
  }catch(err){
    console.error(err);
    showError('Error reading file: ' + err.message, err);
  }
}

function buildPendingImport(fileName, rawBatches){
  const batches = rawBatches.map(batch=>{
    const monthExists = getMonths().some(m=>m.key===batch.key);
    const existingInMonth = txnsForMonth(batch.key);
    const items = [];
    batch.categories.forEach((cat,ci)=>{
      cat.items.forEach((it,ii)=>{
        const planned = it.jumlahRencana||0;
        const actual = (it.jumlahRealisasi===undefined) ? null : it.jumlahRealisasi;
        const isDuplicate = existingInMonth.some(t=>t.category===cat.name && similarText(t.uraian, it.uraian)>0.86 &&
          Math.abs((t.planned||0)-planned) < Math.max(1000,(t.planned||0)*0.01));
        items.push({
          key:`${batch.key}__${ci}__${ii}`, category:cat.name, categoryCode:cat.code, no:it.no,
          uraian:it.uraian, vol:it.vol, satuan:it.satuan, hargaSatuan:it.hargaSatuan,
          planned, actual, unplanned: !!it.unplanned, txnDate: it.rencanaTransaksi||null,
          type: it.type||'expense', isDuplicate,
        });
      });
    });
    return {batch, monthExists, items};
  });
  const hasAnyNewData = batches.some(b=> !b.monthExists || b.items.some(it=>!it.isDuplicate));
  const sortedByNewest = batches.slice().sort((a,b)=>monthSortVal(b.batch)-monthSortVal(a.batch));
  const pending = {
    fileName, batches, mode:'add',
    activeMonthKey: sortedByNewest.length ? sortedByNewest[0].batch.key : null,
    selected: new Set(), hasAnyNewData,
  };
  applyDefaultSelection(pending);
  return pending;
}
function applyDefaultSelection(pending){
  pending.selected = new Set();
  pending.batches.forEach(b=>{
    if(!b.monthExists){ b.items.forEach(it=>{ if(!it.isDuplicate) pending.selected.add(it.key); }); }
  });
}
function importCounts(pending){
  let totalRows=0;
  pending.batches.forEach(b=>totalRows+=b.items.length);
  const existingMonths = pending.batches.filter(b=>b.monthExists).length;
  const newMonths = pending.batches.length - existingMonths;
  const selectedRows = pending.selected.size;
  return {totalRows, existingMonths, newMonths, selectedRows, skippedRows: totalRows-selectedRows};
}

function renderImportPreview(el, main){
  const imp = State.pendingImport;
  const counts = importCounts(imp);
  const tabsSorted = imp.batches.slice().sort((a,b)=>monthSortVal(b.batch)-monthSortVal(a.batch));
  const active = imp.batches.find(b=>b.batch.key===imp.activeMonthKey) || tabsSorted[0];

  el.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;margin-bottom:var(--space-4);">
        <h3 style="margin:0;">Review Import <span class="tag">${escapeHtml(imp.fileName)}</span></h3>
        <div class="tabs" style="border:none;margin:0;">
          <button class="tab ${imp.mode==='add'?'active':''}" data-mode="add">Add New Data Only</button>
          <button class="tab ${imp.mode==='update'?'active':''}" data-mode="update">Update Existing Month</button>
        </div>
      </div>

      ${!imp.hasAnyNewData ? `<div class="insight-item warn" style="margin-bottom:16px;">No new financial data found. All detected transactions already exist. Switch to <b>Update Existing Month</b> above if you want to overwrite a month with this file's figures.</div>` : ''}

      <div class="grid grid-4" style="margin-bottom:16px;">
        <div class="card stat-card"><div class="stat-label">Existing Months Detected</div><div class="stat-value">${counts.existingMonths}</div></div>
        <div class="card stat-card"><div class="stat-label">New Months Detected</div><div class="stat-value">${counts.newMonths}</div></div>
        <div class="card stat-card"><div class="stat-label">Duplicate/Skipped Rows</div><div class="stat-value" style="color:var(--text-dim)">${counts.skippedRows}</div></div>
        <div class="card stat-card"><div class="stat-label">New Rows Ready</div><div class="stat-value" style="color:var(--green)">${counts.selectedRows}</div></div>
      </div>

      ${imp.mode==='add' ? `<div class="small-btn-row stack-section">
        <button class="btn btn-sm" id="selAllNew">Select All New Rows</button>
        <button class="btn btn-sm" id="selNone">Unselect All</button>
        <button class="btn btn-sm" id="selSkipExisting">Skip Existing Months</button>
      </div>` : ''}

      <div class="month-strip" style="margin-bottom:16px;">
        ${tabsSorted.map(b=>`<div class="month-chip ${b.batch.key===active.batch.key?'active':''}" data-tab-month="${b.batch.key}">
          ${escapeHtml(b.batch.monthName)} ${b.batch.year}
          ${b.monthExists ? '<span class="faint">· existing</span>' : '<span style="color:var(--green)">· new</span>'}
        </div>`).join('')}
      </div>

      <div id="importTabBody"></div>

      <div class="modal-actions" style="justify-content:flex-start;margin-top:18px;">
        <button class="btn btn-accent" id="confirmImport">Confirm &amp; Add Selected (${counts.selectedRows})</button>
        <button class="btn" id="cancelImport">Cancel Import</button>
      </div>
    </div>
  `;

  document.getElementById('cancelImport').addEventListener('click', ()=>{ State.pendingImport=null; renderAdd(main); });
  el.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click', ()=>{ imp.mode=b.dataset.mode; renderImportPreview(el, main); }));
  el.querySelectorAll('[data-tab-month]').forEach(b=>b.addEventListener('click', ()=>{ imp.activeMonthKey=b.dataset.tabMonth; renderImportPreview(el, main); }));

  if(imp.mode==='add'){
    document.getElementById('selAllNew').addEventListener('click', ()=>{ applyDefaultSelection(imp); renderImportPreview(el, main); });
    document.getElementById('selNone').addEventListener('click', ()=>{ imp.selected.clear(); renderImportPreview(el, main); });
    document.getElementById('selSkipExisting').addEventListener('click', ()=>{
      imp.batches.forEach(b=>{ if(b.monthExists) b.items.forEach(it=>imp.selected.delete(it.key)); });
      renderImportPreview(el, main);
    });
  }

  document.getElementById('confirmImport').addEventListener('click', async ()=>{
    // UX-006C2C-3 (row 2) — the legacy preview commits parsed rows: same capability as the
    // Smart Import commit, narrower scope. Authorized before any State.txns write.
    if(!can(ACTIONS.IMPORT_COMMIT)){ toast('You do not have permission to commit an import.', 7000); return; }
    if(!imp.selected.size){ toast('No rows selected — nothing to import.'); return; }
    let added=0;
    imp.batches.forEach(b=>{
      b.items.forEach(it=>{
        if(!imp.selected.has(it.key)) return;
        State.txns.push(buildImportedTxn(it, b.batch));
        added++;
      });
    });
    await persist();
    State.pendingImport=null;
    toast(`${added} transaction${added!==1?'s':''} added.`);
    renderAdd(main);
  });

  const tabBody = document.getElementById('importTabBody');
  if(imp.mode==='update' && active.monthExists) renderUpdateDiff(tabBody, imp, active, el, main);
  else renderAddTabItems(tabBody, imp, active, el, main);
}

function renderAddTabItems(tabBody, imp, active, el, main){
  const byCat = {};
  active.items.forEach(it=>{ (byCat[it.category] = byCat[it.category]||[]).push(it); });
  tabBody.innerHTML = Object.keys(byCat).map(catName=>{
    const rows = byCat[catName].map(it=>`<tr>
      <td><input type="checkbox" data-item-key="${it.key}" ${imp.selected.has(it.key)?'checked':''}></td>
      <td>${escapeHtml(it.uraian)}</td>
      <td class="num">${it.planned!=null?fmtIDR(it.planned):'—'}</td>
      <td class="num">${it.actual!=null?fmtIDR(it.actual):'—'}</td>
      <td>${it.unplanned?'<span class="pill pill-dup">unplanned</span>':''} ${it.isDuplicate?'<span class="pill pill-dup">possible duplicate</span>':''}</td>
    </tr>`).join('');
    return `<div class="upload-preview-cat"><h4>${escapeHtml(catName)} — ${byCat[catName].length} item(s)</h4>
      <div class="table-wrap"><table><thead><tr><th></th><th>Description</th><th class="num">Planned</th><th class="num">Actual</th><th>Flags</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  }).join('') || '<div class="empty">No items in this month</div>';
  tabBody.querySelectorAll('[data-item-key]').forEach(cb=>cb.addEventListener('change', ()=>{
    if(cb.checked) imp.selected.add(cb.dataset.itemKey); else imp.selected.delete(cb.dataset.itemKey);
    renderImportPreview(el, main);
  }));
}

function buildDiff(batchWrap){
  const oldTxns = txnsForMonth(batchWrap.batch.key);
  const usedOldIds = new Set();
  const rows = batchWrap.items.map(it=>{
    let match = null;
    if(it.no!==null && it.no!==undefined && !String(it.no).startsWith('extra_')){
      match = oldTxns.find(t=>t.category===it.category && String(t.no)===String(it.no) && !usedOldIds.has(t.id));
    }
    if(!match) match = oldTxns.find(t=>t.category===it.category && similarText(t.uraian, it.uraian)>0.86 && !usedOldIds.has(t.id));
    if(match) usedOldIds.add(match.id);
    const plannedChanged = match && Math.round(match.planned||0)!==Math.round(it.planned||0);
    const actualChanged = match && Math.round(match.actual||0)!==Math.round(it.actual||0) && !(match.actual==null && it.actual==null);
    const status = !match ? 'new' : (plannedChanged||actualChanged) ? 'changed' : 'unchanged';
    return {...it, old: match, plannedChanged, actualChanged, status};
  });
  const removed = oldTxns.filter(t=>!usedOldIds.has(t.id));
  return {rows, removed, oldTxns};
}

function renderUpdateDiff(tabBody, imp, active, el, main){
  const diff = buildDiff(active);
  const changed = diff.rows.filter(r=>r.status==='changed').length;
  const added = diff.rows.filter(r=>r.status==='new').length;
  const unchanged = diff.rows.filter(r=>r.status==='unchanged').length;
  tabBody.innerHTML = `
    <div class="insight-item stack-section">
      Comparing uploaded data to the version currently stored for ${escapeHtml(active.batch.monthName)} ${active.batch.year}:
      <b>${changed}</b> changed, <b>${added}</b> new, <b>${unchanged}</b> unchanged, <b>${diff.removed.length}</b> would be removed.
    </div>
    <div class="table-wrap" style="max-height:440px;overflow-y:auto;">
      <table>
        <thead><tr><th>Description</th><th>Category</th><th class="num">Old Planned</th><th class="num">New Planned</th><th class="num">Old Actual</th><th class="num">New Actual</th><th>Status</th></tr></thead>
        <tbody>
          ${diff.rows.map(r=>`<tr>
            <td>${escapeHtml(r.uraian)}</td>
            <td>${categoryPill(r.category)}</td>
            <td class="num ${r.plannedChanged?'dim':''}">${r.old?fmtIDR(r.old.planned):'—'}</td>
            <td class="num" style="${r.plannedChanged?'color:var(--accent);font-weight:700;':''}">${fmtIDR(r.planned)}</td>
            <td class="num ${r.actualChanged?'dim':''}">${r.old && r.old.actual!=null?fmtIDR(r.old.actual):'—'}</td>
            <td class="num" style="${r.actualChanged?'color:var(--accent);font-weight:700;':''}">${r.actual!=null?fmtIDR(r.actual):'—'}</td>
            <td><span class="pill ${r.status==='changed'?'pill-over':r.status==='new'?'pill-under':'pill-onbudget'}">${r.status}</span></td>
          </tr>`).join('')}
          ${diff.removed.map(t=>`<tr>
            <td>${escapeHtml(t.uraian)}</td><td>${categoryPill(t.category)}</td>
            <td class="num">${fmtIDR(t.planned)}</td><td class="num faint">—</td>
            <td class="num">${t.actual!=null?fmtIDR(t.actual):'—'}</td><td class="num faint">—</td>
            <td><span class="pill pill-dup">removed</span></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="modal-actions" style="justify-content:flex-start;">
      <button class="btn btn-accent" id="applyUpdateBtn">Apply Update to ${escapeHtml(active.batch.monthName)} ${active.batch.year}</button>
    </div>
  `;
  document.getElementById('applyUpdateBtn').addEventListener('click', ()=>applyMonthUpdate(active, diff, imp, el, main));
}

async function applyMonthUpdate(batchWrap, diff, imp, el, main){
  // UX-006C2C-3 (row 3) — replacement-style import: it destroys the month's existing rows
  // and re-adds them from the file. Frozen to `import.commit` (ruling R2) because it is
  // initiated from a parsed-file import and takes its own safety backup; the destructive
  // caveat is recorded in the freeze. Authorized before the confirm, the backup and the
  // replacement.
  if(!can(ACTIONS.IMPORT_COMMIT)){ toast('You do not have permission to commit an import.', 7000); return; }
  const label = `${batchWrap.batch.monthName} ${batchWrap.batch.year}`;
  if(!confirm(`Replace all data for ${label} with the uploaded version?\n\n${diff.rows.filter(r=>r.status==='changed').length} changed, ${diff.rows.filter(r=>r.status==='new').length} new, ${diff.removed.length} removed.\n\nA backup of the current data will be created first.`)) return;
  const backup = {
    id: uid('backup'), monthKey: batchWrap.batch.key, monthLabel: label,
    timestamp: new Date().toISOString(), txns: JSON.parse(JSON.stringify(diff.oldTxns)),
  };
  State.backups.unshift(backup);
  await saveBackups();
  State.txns = State.txns.filter(t=>t.monthKey!==batchWrap.batch.key);
  batchWrap.items.forEach(it=>{
    State.txns.push(buildImportedTxn(it, batchWrap.batch));
  });
  await persist();
  toast(`${label} updated. Backup of ${diff.oldTxns.length} items saved to Backup History.`);
  imp.batches = imp.batches.filter(b=>b!==batchWrap);
  if(!imp.batches.length){ State.pendingImport=null; renderAdd(main); return; }
  const sortedByNewest = imp.batches.slice().sort((a,b)=>monthSortVal(b.batch)-monthSortVal(a.batch));
  imp.activeMonthKey = sortedByNewest[0].batch.key;
  renderImportPreview(el, main);
}
