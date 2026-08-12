/* ---- ADD / UPLOAD ---- */
let addTab = 'manual';
function renderAdd(main){
  main.innerHTML = `
    <div class="page-head"><div><h1>Add / Upload</h1><p class="desc">Add a single transaction, or upload a monthly Excel/CSV file to import.</p></div></div>
    <div class="tabs">
      <button class="tab ${addTab==='manual'?'active':''}" data-tab="manual">Manual Entry</button>
      <button class="tab ${addTab==='upload'?'active':''}" data-tab="upload">Upload File</button>
    </div>
    <div id="addBody"></div>
  `;
  main.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click', ()=>{ addTab=b.dataset.tab; State.pendingImport=null; renderAdd(main); }));
  if(addTab==='manual') renderManualEntry(document.getElementById('addBody'));
  else renderUpload(document.getElementById('addBody'), main);
}

function renderManualEntry(el){
  const months = getMonths();
  const cats = [...new Set([...KNOWN_CATEGORIES, ...State.txns.map(t=>t.category)])];
  el.innerHTML = `
    <div class="card" style="max-width:760px;">
      <h3>New Transaction</h3>
      <form id="manForm">
        <div class="form-grid">
          <div class="field"><label>Type</label>
            <select class="input" name="type"><option value="expense">Expense</option><option value="income">Income</option></select>
          </div>
          <div class="field"><label>Month</label>
            <select class="input" name="monthKey">
              ${months.map(m=>`<option value="${m.key}">${monthLabel(m)}</option>`).join('')}
              <option value="__new__">+ New month…</option>
            </select>
          </div>
          <div class="field" id="newMonthWrap" style="display:none;"><label>New month (name &amp; year)</label>
            <input class="input" name="newMonthName" placeholder="e.g. Agustus 2026">
          </div>
          <div class="field"><label>Category</label>
            <select class="input" name="category">
              ${cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
              <option value="__new__">+ New category…</option>
            </select>
          </div>
          <div class="field" id="newCatWrap" style="display:none;"><label>New category name</label><input class="input" name="newCategory"></div>
          <div class="field" style="grid-column:span 2;"><label>Description</label><input class="input" name="uraian" required placeholder="e.g. Biaya Tagihan Listrik"></div>
          <div class="field"><label>Volume</label><input class="input" name="vol" type="number" step="any" value="1"></div>
          <div class="field"><label>Unit</label><input class="input" name="satuan" placeholder="bulan / buah / paket"></div>
          <div class="field"><label>Unit Price (Rp)</label><input class="input" name="hargaSatuan" type="number" step="any"></div>
          <div class="field"><label>Planned Amount (Rp)</label><input class="input" name="planned" type="number" step="any" placeholder="auto = vol × unit price"></div>
          <div class="field"><label>Actual Amount (Rp)</label><input class="input" name="actual" type="number" step="any" placeholder="leave blank if not yet realized"></div>
          <div class="field"><label>Transaction Date</label><input class="input" name="txnDate" type="date"></div>
        </div>
        <div class="modal-actions" style="justify-content:flex-start;margin-top:18px;">
          <button type="submit" class="btn btn-accent">Add Transaction</button>
        </div>
      </form>
    </div>
  `;
  const form = document.getElementById('manForm');
  form.monthKey.addEventListener('change', ()=>{ document.getElementById('newMonthWrap').style.display = form.monthKey.value==='__new__'?'block':'none'; });
  form.category.addEventListener('change', ()=>{ document.getElementById('newCatWrap').style.display = form.category.value==='__new__'?'block':'none'; });
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    // UX-006C2C-2 — manual transaction creation is a standalone Finance mutation
    // (finance.manage, CEO-only). Authorized here, before any State.txns write.
    if(!can(ACTIONS.FINANCE_MANAGE)){ toast('You do not have permission to perform this action.', 7000); return; }
    const fd = new FormData(form);
    let monthKey = fd.get('monthKey'), monthName, year, monthNum;
    if(monthKey==='__new__'){
      const raw = (fd.get('newMonthName')||'').trim();
      const parts = raw.split(/\s+/);
      const mn = parts.find(p=>MONTH_NUM[p]);
      const yr = parts.find(p=>/^\d{4}$/.test(p));
      if(!mn || !yr){ toast('Enter new month as "MonthName YYYY", e.g. Agustus 2026'); return; }
      monthName = mn; year = Number(yr); monthNum = MONTH_NUM[mn];
      monthKey = `${year}-${String(monthNum).padStart(2,'0')}`;
    } else {
      const m = months.find(m=>m.key===monthKey);
      monthName = m.month; year = m.year; monthNum = m.monthNum;
    }
    let category = fd.get('category');
    if(category==='__new__') category = (fd.get('newCategory')||'Lainnya').trim() || 'Lainnya';
    const vol = fd.get('vol')?Number(fd.get('vol')):null;
    const harga = fd.get('hargaSatuan')?Number(fd.get('hargaSatuan')):null;
    let planned = fd.get('planned')?Number(fd.get('planned')):null;
    if(planned===null) planned = (vol&&harga) ? vol*harga : 0;
    const actualRaw = fd.get('actual');
    const actual = actualRaw ? Number(actualRaw) : null;

    const txn = {
      id: uid('manual'), monthKey, month: monthName, year, monthNum,
      category, categoryCode: category[0]||'X', no: null,
      uraian: fd.get('uraian').trim(), vol, satuan: fd.get('satuan')||null, hargaSatuan: harga,
      planned, actual, type: fd.get('type'), txnDate: fd.get('txnDate')||null,
      source:'manual', unplanned:false,
      execution: null,
      history: [{event:'created', ts:new Date().toISOString(), note:'Created manually'}],
    };
    txn.status = computeStatus(txn);
    State.txns.push(txn);
    await persist();
    toast('Transaction added.');
    form.reset();
    renderAdd(document.getElementById('main'));
  });
}

function renderUpload(el, main){
  if(State.pendingImport){ return renderImportPreview(el, main); }
  // Import purpose (Part 1). Default: Initial Company Setup on an empty install;
  // Historical Payroll Migration once employees + contracts exist.
  const hasMaster = State.employees.length && State.contracts.length;
  if(!State.importPurpose) State.importPurpose = hasMaster ? 'historical' : 'setup';
  el.innerHTML = `
    <div class="card" style="max-width:820px;">
      <h3>Upload File — Migration &amp; Historical Data</h3>
      <div class="insight-item" style="display:block;margin-bottom:12px;">Smart Import is intended for initial setup and historical migration. Monthly payroll operations should be performed through <b>Payroll Planning</b>.</div>
      <p class="hint" style="margin-bottom:10px;">Accepts TAM's standard "Rencana Penggunaan Dana" / "Realisasi" Excel workbook (auto-detected by sheet name), or a plain CSV/XLSX table with columns like Uraian, Kategori, Vol, Satuan, Harga Satuan, Jumlah, Realisasi.</p>
      <div class="field" style="max-width:420px;margin-bottom:var(--space-4);"><label>Import Purpose</label>
        <select class="input" id="importModeSel">
          <option value="setup" ${State.importPurpose==='setup'?'selected':''}>Initial Company Setup</option>
          <option value="historical" ${State.importPurpose==='historical'?'selected':''}>Historical Payroll Migration</option>
          <option value="finance" ${State.importPurpose==='finance'?'selected':''}>Finance Transactions Only</option>
          <option value="review" ${State.importPurpose==='review'?'selected':''}>Review Without Commit</option>
        </select>
        <div class="hint">Setup &amp; Historical use Smart Import (employees, contracts, payroll). Finance Only imports transactions. Review parses without committing.</div>
      </div>
      <div class="dropzone" id="dz">
        <div class="big">⇪</div>
        <div>Drop a .xlsx or .csv file here, or click to browse</div>
        <div class="faint" style="margin-top:6px;">Historical months already in the system stay untouched — new data is reviewed before it's added.</div>
      </div>
      <input type="file" id="fileInput" accept=".xlsx,.xls,.csv" style="display:none;">
    </div>
    <div class="section-title">Backup History</div>
    <div class="card" id="backupPanel"></div>
  `;
  const dz = document.getElementById('dz'), fi = document.getElementById('fileInput');
  const modeSel = document.getElementById('importModeSel');
  if(modeSel) modeSel.addEventListener('change', e=>{ const p=e.target.value; State.importPurpose=p; State.importMode = p==='finance'?'finance':p==='review'?'review':'smart'; });
  // reconcile importMode with the current purpose on first render
  State.importMode = State.importPurpose==='finance'?'finance':State.importPurpose==='review'?'review':'smart';
  dz.addEventListener('click', ()=>fi.click());
  ['dragover','dragenter'].forEach(ev=>dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e=>{ const f=e.dataTransfer.files[0]; if(f) handleFile(f, main); });
  fi.addEventListener('change', e=>{ const f=e.target.files[0]; if(f) handleFile(f, main); });
  renderBackupPanel(document.getElementById('backupPanel'), main);
}

function renderBackupPanel(el, main){
  if(!State.backups.length){ el.innerHTML = '<div class="empty">No backups yet. Backups are created automatically whenever you replace an existing month in "Update Existing Month" mode.</div>'; return; }
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Month</th><th>Created</th><th class="num">Items</th><th></th></tr></thead>
    <tbody>${State.backups.map(bk=>`<tr>
      <td>${escapeHtml(bk.monthLabel)}</td>
      <td class="dim">${new Date(bk.timestamp).toLocaleString('id-ID')}</td>
      <td class="num">${bk.txns.length}</td>
      <td><div class="small-btn-row">
        <button class="btn btn-sm" data-dl-backup="${bk.id}">Download JSON</button>
        <button class="btn btn-sm btn-danger" data-restore-backup="${bk.id}"${authzDisabled(ACTIONS.DATA_RESTORE)}>Restore</button>
      </div></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
  el.querySelectorAll('[data-dl-backup]').forEach(b=>b.addEventListener('click', ()=>{
    const bk = State.backups.find(x=>x.id===b.dataset.dlBackup);
    downloadBlob(JSON.stringify(bk, null, 2), `${FILE_BASE}-backup-${bk.monthKey}-${bk.timestamp.slice(0,10)}.json`, 'application/json');
  }));
  el.querySelectorAll('[data-restore-backup]').forEach(b=>b.addEventListener('click', async ()=>{
    // UX-006C2C-3 (row 4) — restoring a month replaces every stored transaction for it.
    // Authorized before the confirm and before the replacement; existing restore semantics
    // are otherwise unchanged (this assignment enforces authorization, not restore redesign).
    if(!can(ACTIONS.DATA_RESTORE)){ toast('You do not have permission to restore data.', 7000); return; }
    const bk = State.backups.find(x=>x.id===b.dataset.restoreBackup);
    if(!confirm(`Restore ${bk.monthLabel} to the backed-up version from ${new Date(bk.timestamp).toLocaleString('id-ID')}? This replaces whatever is currently stored for that month.`)) return;
    State.txns = State.txns.filter(t=>t.monthKey!==bk.monthKey).concat(JSON.parse(JSON.stringify(bk.txns)));
    await persist();
    toast(`${bk.monthLabel} restored from backup.`);
    render();
  }));
}

async function loadBackups(){
  try{
    const res = await StorageAdapter.get('tam_backups_v1');
    const parsed = (res && res.value) ? safeParse(res.value, 'backups') : null;
    State.backups = Array.isArray(parsed) ? parsed : [];
  }catch(e){ console.error('loadBackups error', e); State.backups = []; }
}
async function saveBackups(){
  const ok = await StorageAdapter.set('tam_backups_v1', JSON.stringify(State.backups.slice(0,25)));
  if(!ok) console.error('saveBackups: backups were not persisted');
  return ok === true;
}
