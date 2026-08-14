/* ---- SETTINGS / ABOUT / RELEASE NOTES ---- */
function renderSettings(main){
  const s = State.settings;
  main.innerHTML = `
    <div class="page-head"><div><h1>Settings</h1><p class="desc">Configuration for ${escapeHtml(APP_NAME)}.</p></div></div>
    <div class="card" style="max-width:760px;margin-bottom:var(--space-4);">
      <h3>General</h3>
      <form id="settingsForm">
        <div class="form-grid" style="grid-template-columns:1fr 1fr;">
          <div class="field"><label>Company Name</label><input class="input" name="companyName" value="${escapeHtml(s.companyName)}"></div>
          <div class="field"><label>Product Name</label><input class="input" name="productName" value="${escapeHtml(s.productName)}"></div>
          <div class="field"><label>Currency</label><input class="input" value="IDR — Indonesian Rupiah" disabled></div>
          <div class="field"><label>Opening Cash Balance (Rp)</label><input class="input" name="openingCashBalance" type="number" step="any" value="${s.openingCashBalance??''}" placeholder="Leave blank if unknown"></div>
          <div class="field"><label>Default Trend Range</label>
            <select class="input" name="defaultTrendRange">
              <option value="all" ${s.defaultTrendRange==='all'?'selected':''}>All Time</option>
              <option value="year" ${s.defaultTrendRange==='year'?'selected':''}>Current Year</option>
              <option value="last3" ${s.defaultTrendRange==='last3'?'selected':''}>Last 3 Months</option>
              <option value="last6" ${s.defaultTrendRange==='last6'?'selected':''}>Last 6 Months</option>
              <option value="last12" ${s.defaultTrendRange==='last12'?'selected':''}>Last 12 Months</option>
            </select>
          </div>
          <div class="field"><label>Default Landing Page</label>
            <select class="input" name="defaultLandingPage">
              <option value="execDashboard" ${s.defaultLandingPage==='execDashboard'?'selected':''}>Executive Dashboard</option>
              <option value="financeOverview" ${s.defaultLandingPage==='financeOverview'?'selected':''}>Finance Overview</option>
              <option value="executioncenter" ${s.defaultLandingPage==='executioncenter'?'selected':''}>Execution Center</option>
              <option value="transactions" ${s.defaultLandingPage==='transactions'?'selected':''}>Transactions</option>
              <option value="trends" ${s.defaultLandingPage==='trends'?'selected':''}>Monthly Trends</option>
            </select>
          </div>
          <div class="field"><label>Appearance</label>
            <select class="input" name="appearance">
              <option value="system" ${(s.appearance||'system')==='system'?'selected':''}>Follow System</option>
              <option value="dark" ${s.appearance==='dark'?'selected':''}>Dark</option>
              <option value="light" ${s.appearance==='light'?'selected':''}>Light</option>
            </select>
          </div>
        </div>
        <div class="divider"></div>
        <h3 style="margin-top:0;">Execution Defaults</h3>
        <div class="form-grid" style="grid-template-columns:1fr 1fr;">
          <div class="field"><label>Default Payment Method</label>
            <select class="input" name="defaultPaymentMethod">${PAYMENT_METHODS.map(m=>`<option ${s.defaultPaymentMethod===m?'selected':''}>${m}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Default Bank</label>
            <select class="input" name="defaultBank">${companyAccountOptionsHTML(s.defaultBank)}</select>
          </div>
          <div class="field"><label>Auto-archive completed transactions</label>
            <select class="input" name="autoArchiveCompleted"><option value="no" ${!s.autoArchiveCompleted?'selected':''}>No</option><option value="yes" ${s.autoArchiveCompleted?'selected':''}>Yes</option></select>
          </div>
          <div class="field"><label>Auto-complete when Actual = Planned</label>
            <select class="input" name="autoCompleteWhenEqual"><option value="yes" ${s.autoCompleteWhenEqual?'selected':''}>Yes</option><option value="no" ${!s.autoCompleteWhenEqual?'selected':''}>No</option></select>
          </div>
        </div>
        <div class="divider"></div>
        <h3 style="margin-top:0;">People &amp; Contracts Defaults</h3>
        <div class="form-grid" style="grid-template-columns:1fr 1fr;">
          <div class="field"><label>Contract Expiry Warning (days)</label><input class="input" type="number" min="1" name="contractExpiryWarningDays" value="${s.contractExpiryWarningDays??90}"></div>
          <div class="field"><label>Default Contract Duration (months)</label><input class="input" type="number" min="1" name="defaultContractDuration" value="${s.defaultContractDuration??12}"></div>
          <div class="field"><label>Default Payroll Generation Day</label><input class="input" type="number" min="1" max="31" name="defaultPayrollGenerationDay" value="${s.defaultPayrollGenerationDay??25}"></div>
          <div class="field"><label>Default Payroll Category</label><select class="input" name="defaultPayrollCategory">${KNOWN_CATEGORIES.map(c=>`<option ${s.defaultPayrollCategory===c?'selected':''}>${c}</option>`).join('')}</select></div>
          <div class="field"><label>Include inactive employees in reports</label><select class="input" name="includeInactiveInReports"><option value="no" ${!s.includeInactiveInReports?'selected':''}>No</option><option value="yes" ${s.includeInactiveInReports?'selected':''}>Yes</option></select></div>
          <div class="field"><label>Auto-generate recurring expenses</label><select class="input" name="autoGenerateRecurring"><option value="yes" ${s.autoGenerateRecurring?'selected':''}>Yes</option><option value="no" ${!s.autoGenerateRecurring?'selected':''}>No</option></select></div>
          <div class="field"><label>Auto-calculate contract progress</label><select class="input" name="autoCalcContractProgress"><option value="yes" ${s.autoCalcContractProgress!==false?'selected':''}>Yes</option><option value="no" ${s.autoCalcContractProgress===false?'selected':''}>No</option></select></div>
        </div>
        <div class="divider"></div>
        <h3 style="margin-top:0;">Work Schedule &amp; Overtime</h3>
        <p class="hint" style="margin:-6px 0 12px;">Company defaults used only when an employee or contract has no schedule of its own. ${escapeHtml(s.overtimeMethodLabel||'TAM Internal Overtime Calculation Method')}.</p>
        <div class="form-grid" style="grid-template-columns:1fr 1fr;">
          <div class="field"><label>Company Default Working Hours / Day</label><input class="input" type="number" step="0.5" min="1" name="companyWorkHoursPerDay" value="${s.companyWorkHoursPerDay??8}"></div>
          <div class="field"><label>Company Default Working Days / Week</label><input class="input" type="number" step="1" min="1" name="companyWorkDaysPerWeek" value="${s.companyWorkDaysPerWeek??5}"></div>
          <div class="field"><label>Company Default Weeks / Month</label><input class="input" type="number" step="1" min="1" name="companyWeeksPerMonth" value="${s.companyWeeksPerMonth??4}"></div>
          <div class="field"><label>Overtime Final Rounding</label><select class="input" name="overtimeRounding">${Object.entries(OVERTIME_ROUNDING).map(([k,v])=>`<option value="${k}" ${s.overtimeRounding===k?'selected':''}>${v.label}</option>`).join('')}</select></div>
          <div class="field" style="grid-column:span 2;"><label>Overtime Calculation Method Label</label><input class="input" name="overtimeMethodLabel" value="${escapeHtml(s.overtimeMethodLabel||'TAM Internal Overtime Calculation Method')}"></div>
          <div class="field"><label>Require Overtime Approval Before Payroll</label><select class="input" name="requireOvertimeApproval"><option value="yes" ${s.requireOvertimeApproval?'selected':''}>Yes</option><option value="no" ${!s.requireOvertimeApproval?'selected':''}>No</option></select></div>
          <div class="field"><label>High Overtime Warning (hours / month)</label><input class="input" type="number" min="0" name="highOvertimeWarningHours" value="${s.highOvertimeWarningHours??40}"></div>
          <div class="field"><label>Allow Payroll Commit with Unapproved Overtime</label><select class="input" name="allowPayrollCommitWithUnapprovedOvertime"><option value="no" ${!s.allowPayrollCommitWithUnapprovedOvertime?'selected':''}>No</option><option value="yes" ${s.allowPayrollCommitWithUnapprovedOvertime?'selected':''}>Yes</option></select></div>
        </div>
        <div class="modal-actions" style="justify-content:flex-start;margin-top:16px;">
          <button type="submit" class="btn btn-accent">Save Settings</button>
        </div>
      </form>
    </div>
    <div class="card" style="max-width:760px;margin-bottom:var(--space-4);border-color:var(--accent);">
      <h3>Data Reset &amp; Onboarding</h3>
      <p class="hint" style="margin-bottom:12px;">Manage the data in this browser. Start Fresh downloads a full backup and requires typed confirmation before clearing — it never erases silently.</p>
      <div class="small-btn-row" style="flex-wrap:wrap;gap:8px;">
        <button class="btn btn-accent" id="drExportBackup">Export Complete Backup</button>
        <button class="btn btn-danger" id="drStartFresh"${authzDisabled(ACTIONS.DATA_RESET)}>Start Fresh…</button>
        <button class="btn" id="drDemo"${authzDisabled(ACTIONS.EMPLOYEE_CREATE)}>Load Demo Data (DEMO)</button>
        <button class="btn" id="drImportBackup">Import Existing Backup</button>
        <button class="btn" id="drImportExcel">Import Legacy Excel</button>
        <button class="btn" id="drShowOnb">Show Onboarding Checklist</button>
      </div>
    </div>
    <div class="card" style="max-width:760px;margin-bottom:var(--space-4);">
      <h3>Storage Status</h3>
      <p class="dim" style="font-size:13px;line-height:2;">
        Storage Mode: <b>${escapeHtml(StorageAdapter.modeLabel())}</b><br>
        Persistence Status: <b style="color:${StorageAdapter.status==='active'?'var(--green)':StorageAdapter.status==='error'?'var(--brick)':'var(--accent)'};">${escapeHtml(StorageAdapter.statusLabel())}</b>
      </p>
      ${StorageAdapter.lastError?`<p class="hint">Last storage error: ${escapeHtml(StorageAdapter.lastError)}</p>`:''}
      <p class="hint">${StorageAdapter.mode==='claude'
        ? 'Data is persisted by the Claude Artifact environment.'
        : 'Data is persisted in this browser’s localStorage for this file location. Use Data Portability below to move data to another browser or device.'}</p>
    </div>
    <div class="card" style="max-width:760px;margin-bottom:var(--space-4);">
      <h3>System Diagnostics</h3>
      <div id="diagnosticsBody">${buildDiagnosticsHTML()}</div>
      <div class="small-btn-row" style="margin-top:12px;">
        <button class="btn btn-accent" id="runIntegrity">Run Integrity Check</button>
        <button class="btn" id="openDedupSettings">Employee Duplicate Review${(function(){const g=findEmployeeDuplicateGroups();return g.length?` (${g.length})`:'';})()}</button>
      </div>
      <div id="integrityBody" style="margin-top:12px;">${State.lastIntegrity?buildIntegrityHTML(State.lastIntegrity):''}</div>
    </div>
    <div class="card" style="max-width:760px;margin-bottom:var(--space-4);">
      <h3>Data Portability</h3>
      <p class="hint" style="margin-bottom:12px;">Export or restore your complete dataset — all transactions, settings, and backups — as a single JSON file. Use this to move between browsers, devices, or between the Claude Artifact and the standalone file. A safety backup of current data is created automatically before every restore.</p>
      <div class="small-btn-row">
        <button class="btn btn-accent" id="exportComplete">Export Complete Backup (JSON)</button>
        <button class="btn" id="importCompleteBtn">Import Complete Backup…</button>
        <input type="file" id="importCompleteFile" accept=".json,application/json" style="display:none;">
      </div>
      <div id="portabilityPreview" style="margin-top:12px;"></div>
    </div>
    <div class="card" style="max-width:760px;margin-bottom:var(--space-4);">
      <h3>Data Export</h3>
      <div class="small-btn-row" style="flex-wrap:wrap;gap:6px;">
        <button class="btn" id="exportAllTxns">Export All Transactions (CSV)</button>
        <button class="btn" id="exportSettingsJson">Export Settings (JSON)</button>
        <button class="btn" id="exportEmpCsv">Export Employees (CSV)</button>
        <button class="btn" id="exportCtCsv">Export Contracts (CSV)</button>
      </div>
    </div>
    <div class="card" style="max-width:760px;margin-bottom:var(--space-4);">
      <h3>Backup Management</h3>
      <div id="settingsBackupPanel"></div>
    </div>
    <div class="card" style="max-width:760px;border-color:var(--brick);">
      <h3 style="color:var(--brick);">Reset Application Data</h3>
      <p class="hint">Permanently clears all transactions, backups, and settings stored in this browser. This cannot be undone.</p>
      <button class="btn btn-danger" id="resetAppData"${authzDisabled(ACTIONS.DATA_RESET)}>Reset All Data</button>
    </div>
  `;
  document.getElementById('settingsForm').addEventListener('submit', async e=>{
    e.preventDefault();
    // UX-006C2C-4 (row 27) — settings save is ordinary configuration: settings.manage.
    // Destructive lifecycle (resetAppData / startFresh) stays under data.reset; this gate
    // must never be read as conferring reset authority.
    if(!can(ACTIONS.SETTINGS_MANAGE)){ showWarning('You do not have permission to change settings.'); return; }
    const fd = new FormData(e.target);
    State.settings.companyName = (fd.get('companyName')||'').trim() || COMPANY_NAME_DEFAULT;
    State.settings.productName = (fd.get('productName')||'').trim() || APP_NAME;
    const ocb = fd.get('openingCashBalance');
    State.settings.openingCashBalance = (ocb===''||ocb===null) ? null : Number(ocb);
    State.settings.defaultTrendRange = fd.get('defaultTrendRange');
    State.settings.defaultLandingPage = fd.get('defaultLandingPage');
    State.settings.appearance = ['system','dark','light'].includes(fd.get('appearance')) ? fd.get('appearance') : 'system';
    State.settings.defaultPaymentMethod = fd.get('defaultPaymentMethod');
    State.settings.defaultBank = fd.get('defaultBank');
    State.settings.autoArchiveCompleted = fd.get('autoArchiveCompleted')==='yes';
    State.settings.autoCompleteWhenEqual = fd.get('autoCompleteWhenEqual')==='yes';
    State.settings.contractExpiryWarningDays = Number(fd.get('contractExpiryWarningDays'))||90;
    State.settings.defaultContractDuration = Number(fd.get('defaultContractDuration'))||12;
    State.settings.defaultPayrollGenerationDay = Number(fd.get('defaultPayrollGenerationDay'))||25;
    State.settings.defaultPayrollCategory = fd.get('defaultPayrollCategory')||'Gaji';
    State.settings.includeInactiveInReports = fd.get('includeInactiveInReports')==='yes';
    State.settings.autoGenerateRecurring = fd.get('autoGenerateRecurring')==='yes';
    State.settings.autoCalcContractProgress = fd.get('autoCalcContractProgress')==='yes';
    State.settings.companyWorkHoursPerDay = Number(fd.get('companyWorkHoursPerDay'))||8;
    State.settings.companyWorkDaysPerWeek = Number(fd.get('companyWorkDaysPerWeek'))||5;
    State.settings.companyWeeksPerMonth = Number(fd.get('companyWeeksPerMonth'))||4;
    State.settings.overtimeRounding = OVERTIME_ROUNDING[fd.get('overtimeRounding')]?fd.get('overtimeRounding'):'rupiah';
    State.settings.overtimeMethodLabel = (fd.get('overtimeMethodLabel')||'').trim()||'TAM Internal Overtime Calculation Method';
    State.settings.requireOvertimeApproval = fd.get('requireOvertimeApproval')==='yes';
    State.settings.highOvertimeWarningHours = Number(fd.get('highOvertimeWarningHours'))||0;
    State.settings.allowPayrollCommitWithUnapprovedOvertime = fd.get('allowPayrollCommitWithUnapprovedOvertime')==='yes';
    // v2.7.1 (Section 4) — explicit onboarding completion marker, set only after a successful
    // save. On failure it is reverted so a failed save never completes the step.
    const firstConfig = !State.settings.companySettingsConfiguredAt;
    if(firstConfig) State.settings.companySettingsConfiguredAt = new Date().toISOString();
    const saved = await saveSettings();
    if(!saved){
      if(firstConfig) State.settings.companySettingsConfiguredAt = null;
      showWarning('Settings could not be saved — please try again. Nothing was changed.');
      return;
    }
    applyTheme();               // reflect any Appearance change immediately (charts redraw on render)
    showSuccess('Settings saved — company settings are configured.');
    render();
  });
  document.getElementById('drExportBackup').addEventListener('click', ()=>{ downloadBlob(JSON.stringify(buildCompleteBackup(),null,2), `${FILE_BASE}-complete-backup-${new Date().toISOString().slice(0,10)}.json`, 'application/json'); showSuccess('Complete backup downloaded.'); });
  document.getElementById('drStartFresh').addEventListener('click', startFresh);
  document.getElementById('drDemo').addEventListener('click', loadDemoData);
  document.getElementById('drImportBackup').addEventListener('click', ()=>document.getElementById('importCompleteFile').click());
  document.getElementById('drImportExcel').addEventListener('click', ()=>{ State.view='add'; render(); });
  document.getElementById('drShowOnb').addEventListener('click', async ()=>{
    // UX-006C2C-4 (row 29) — re-showing onboarding writes a setting: settings.manage.
    if(!can(ACTIONS.SETTINGS_MANAGE)){ showWarning('You do not have permission to change settings.'); return; }
    State.settings.onboardingDismissed=false; await saveSettings(); State.view='execDashboard'; render(); });
  document.getElementById('exportComplete').addEventListener('click', ()=>{
    downloadBlob(JSON.stringify(buildCompleteBackup(), null, 2), `${FILE_BASE}-complete-backup-${new Date().toISOString().slice(0,10)}.json`, 'application/json');
    toast('Complete backup downloaded.');
  });
  document.getElementById('importCompleteBtn').addEventListener('click', ()=>document.getElementById('importCompleteFile').click());
  document.getElementById('importCompleteFile').addEventListener('change', async e=>{
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow re-selecting the same file later
    if(!file) return;
    const box = document.getElementById('portabilityPreview');
    let data = null;
    try{ data = JSON.parse(await file.text()); }
    catch(err){
      box.innerHTML = `<div class="insight-item warn" style="display:block;">Cannot read <b>${escapeHtml(file.name)}</b> — not valid JSON: ${escapeHtml(err.message)}</div>`;
      toast('Import failed: file is not valid JSON.', 6000);
      return;
    }
    const v = validateCompleteBackup(data);
    if(!v.ok){
      box.innerHTML = `<div class="insight-item warn" style="display:block;">
        <b>Validation failed — nothing was restored.</b><br>
        ${v.errors.map(er=>escapeHtml(er)).join('<br>')}
      </div>`;
      toast('Import failed validation. No data was changed.', 6000);
      return;
    }
    const i = v.info;
    box.innerHTML = `
      <div class="insight-item" style="display:block;">
        <b>Ready to restore from ${escapeHtml(file.name)}</b><br><br>
        Transactions: <b>${i.txnCount}</b> (across ${i.monthCount} month${i.monthCount===1?'':'s'})<br>
        Settings: <b>${i.hasSettings?('included — company "'+escapeHtml(i.companyName)+'"'):'not included (current settings kept)'}</b><br>
        Backups: <b>${i.backupCount}</b><br>
        Schema Version: <b>${escapeHtml(i.schemaVersion)}</b><br>
        Source: <b>${escapeHtml(i.sourceApp)} v${escapeHtml(i.sourceVersion)}</b>${i.exportedAt?` — exported ${escapeHtml(new Date(i.exportedAt).toLocaleString('id-ID'))}`:''}<br><br>
        Restoring replaces ALL current transactions${i.hasSettings?', settings':''} and backups. A safety backup of current data will be created first.
      </div>
      <div class="small-btn-row" style="margin-top:10px;">
        <button class="btn btn-danger" id="confirmRestore">Restore This Backup</button>
        <button class="btn" id="cancelRestore">Cancel</button>
      </div>`;
    document.getElementById('cancelRestore').addEventListener('click', ()=>{ box.innerHTML=''; });
    document.getElementById('confirmRestore').addEventListener('click', async ()=>{
      if(!confirm(`Replace ALL current data with the contents of ${file.name}?\n\n${i.txnCount} transactions will be restored. A safety backup of your current data will be created first.`)) return;
      const result = await restoreCompleteBackup(data);
      if(!result || result.ok!==true){ toast((result&&result.reason) || 'Restore failed — no changes were applied.', 9000); return; }
      box.innerHTML='';
      toast('Complete backup restored. A pre-restore safety backup was saved.', 6000);
      render();
    });
  });
  document.getElementById('exportAllTxns').addEventListener('click', ()=>exportCsv(State.txns));
  document.getElementById('exportSettingsJson').addEventListener('click', ()=>downloadBlob(JSON.stringify(State.settings,null,2), `${FILE_BASE}-settings.json`, 'application/json'));
  document.getElementById('exportEmpCsv').addEventListener('click', exportEmployeesCsv);
  document.getElementById('exportCtCsv').addEventListener('click', exportContractsCsv);
  document.getElementById('resetAppData').addEventListener('click', async ()=>{
    // UX-006C2C-3 (row 6) — irreversible destruction of every stored collection, with no
    // backup taken. Authorized before the confirmations and before any storage write.
    if(!can(ACTIONS.DATA_RESET)){ toast('You do not have permission to reset application data.', 7000); return; }
    if(!confirm('This will permanently delete ALL transactions, backups, and settings stored in this browser. This cannot be undone. Continue?')) return;
    if(!confirm('Are you absolutely sure? This is your last chance to cancel.')) return;
    try{
      await StorageAdapter.set('tam_txns_v1', JSON.stringify([]));
      await StorageAdapter.set('tam_backups_v1', JSON.stringify([]));
      await StorageAdapter.set('tam_settings_v1', JSON.stringify(DEFAULT_SETTINGS));
      for(const k of Object.values(HR_KEYS)) await StorageAdapter.set(k, JSON.stringify([]));
    }catch(e){ console.error(e); }
    State.txns=[]; State.backups=[]; State.settings={...DEFAULT_SETTINGS}; State.selectedMonth=null;
    State.employees=[]; State.contracts=[]; State.payrollPlans=[]; State.recurringExpenses=[]; State.monthlyPlans=[]; State.overtimeRecords=[]; State.importBatches=[]; State.payrollAdjustments=[]; State.employeeMerges=[];
    toast('All application data has been reset.');
    State.view='execDashboard';
    render();
  });
  renderBackupPanel(document.getElementById('settingsBackupPanel'), main);
  const riBtn = document.getElementById('runIntegrity');
  if(riBtn) riBtn.addEventListener('click', ()=>{
    const res = runIntegrityCheck();
    const body = document.getElementById('integrityBody');
    if(body) body.innerHTML = buildIntegrityHTML(res);
    const diag = document.getElementById('diagnosticsBody');
    if(diag) diag.innerHTML = buildDiagnosticsHTML(); // refresh integrity-status line
    const label = res.counts.critical?`${res.counts.critical} critical`:res.counts.warning?`${res.counts.warning} warning(s)`:'healthy';
    showSuccess('Integrity check complete — '+label+'.');
  });
  const odBtn = document.getElementById('openDedupSettings');
  if(odBtn) odBtn.addEventListener('click', ()=>{ State.view='employeeDedup'; render(); });
}
// System Diagnostics summary block (Phase 14).
function buildDiagnosticsHTML(){
  const li = State.lastIntegrity;
  const integrityStatus = li ? (li.counts.critical?`<span style="color:var(--brick);">${escapeHtml(li.status)}</span>`:li.counts.warning?`<span style="color:var(--accent);">${escapeHtml(li.status)}</span>`:`<span style="color:var(--green);">${escapeHtml(li.status)}</span>`) : '<span class="faint">not yet run</span>';
  const rows = [
    ['App Version', escapeHtml(APP_VERSION+' — '+APP_RELEASE_NAME)],
    ['Schema Version', String(SCHEMA_VERSION)],
    ['Storage Mode', escapeHtml(StorageAdapter.modeLabel())],
    ['Persistence Status', escapeHtml(StorageAdapter.statusLabel())],
    ['Transactions', String(State.txns.length)],
    // Readiness-1 (identity closure) — Settings is Employee-visible; these diagnostics
    // count the employee roster, so they read the scoped set.
    ['Employees', String(((typeof getScopedRecords === 'function') ? getScopedRecords('employee') : State.employees).length)],
    ['Unique Employee Names', (function(){ return String(new Set(((typeof getScopedRecords === 'function') ? getScopedRecords('employee') : State.employees).map(e=>normalizeEmployeeName(e.fullName)).filter(Boolean)).size); })()],
    ['Duplicate Employee Groups', (function(){ const g=findEmployeeDuplicateGroups(); return g.length?`<span style="color:var(--brick);">${g.length}</span>`:'0'; })()],
    ['Duplicate Employee Records', (function(){ const g=findEmployeeDuplicateGroups(); const n=g.reduce((a,x)=>a+x.employees.length,0); return n?`<span style="color:var(--brick);">${n}</span>`:'0'; })()],
    ['Last Employee Merge', (function(){ const m=(State.employeeMerges||[])[0]; return m?escapeHtml(new Date(m.ts).toLocaleString('id-ID'))+' → '+escapeHtml(m.canonicalCode||m.canonicalEmployeeId):'<span class="faint">never</span>'; })()],
    ['Last Smart Import Unique Employees', (function(){ const s=State.lastSmartImportUnique; return s?`${s.uniqueEmployees} of ${s.rows} row(s) (${s.newEmployees} new · ${s.matchedEmployees} matched)`:'<span class="faint">—</span>'; })()],
    ['Contracts', String(State.contracts.length)],
    ['Payroll Plans', String(State.payrollPlans.length)],
    ['Monthly Plans', String(State.monthlyPlans.length)],
    ['Recurring Expenses', String(State.recurringExpenses.length)],
    ['Overtime Records', String(State.overtimeRecords.length)],
    ['Import Batches', String(State.importBatches.length)+(State.importBatches.some(b=>!b.undone)?' ('+State.importBatches.filter(b=>!b.undone).length+' active)':'')],
    ['Payroll Adjustments', String(State.payrollAdjustments.length)],
    ['Backups', String(State.backups.length)],
    ['Last Successful Save', State.lastSaveAt?escapeHtml(new Date(State.lastSaveAt).toLocaleString('id-ID')):'<span class="faint">— (no write yet this session)</span>'],
    ['Last Migration', State.settings.lastMigrationAt?escapeHtml(new Date(State.settings.lastMigrationAt).toLocaleString('id-ID')):'<span class="faint">—</span>'],
    ['Last Data Reset', (()=>{ const r=lastResetAudit(); return r?escapeHtml(new Date(r.ts).toLocaleString('id-ID')):'<span class="faint">never</span>'; })()],
    ['Data Integrity', integrityStatus],
  ];
  return `<div class="table-wrap"><table><tbody>${rows.map(([k,v])=>`<tr><td class="dim" style="width:210px;">${k}</td><td><b>${v}</b></td></tr>`).join('')}</tbody></table></div>`;
}
// Integrity findings block (Phase 14) — read-only, never deletes anything.
function buildIntegrityHTML(res){
  if(!res) return '';
  const head = `<p class="hint" style="margin-bottom:8px;">Ran ${escapeHtml(new Date(res.ranAt).toLocaleString('id-ID'))} · ${res.counts.critical} critical · ${res.counts.warning} warning · ${res.counts.info} info. Findings are reported only — nothing is deleted or changed automatically.</p>`;
  if(!res.findings.length) return head + `<div class="insight-item good" style="display:block;">No integrity issues detected. All records have valid IDs, links, dates, and amounts.</div>`;
  return head + `<div class="insight-list">${res.findings.map(f=>`<div class="insight-item ${f.severity==='critical'?'warn':f.severity==='warning'?'warn':''}">${severityPill(f.severity)} <span style="margin-left:6px;">${escapeHtml(f.message)}</span></div>`).join('')}</div>`;
}
/* ============================================================
   COMPANY BANK ACCOUNTS (v2.6.9) — structured, user-managed accounts.
   Separate from the Bank Master (reference data) and from Employee banking.
   Account numbers are stored in full but ALWAYS masked in lists/tables; the
   full value appears only inside its own edit field. Only Active accounts feed
   transaction/payroll dropdowns. No PIN/OTP/password/token is ever stored.
   ============================================================ */
const COMPANY_ACCOUNT_STATUS_META = {
  'Active':   {pill:'pill-status-completed'},
  'Inactive': {pill:'pill-status-archived'},
  'Archived': {pill:'pill-status-cancelled'},
};
function bankAccountsFiltered(){
  const f = State.bankAccountFilter || {search:'', purpose:'all', status:'all'};
  let rows = (State.companyAccounts||[]).slice();
  if(f.status!=='all') rows = rows.filter(a=>a.status===f.status);
  if(f.purpose!=='all') rows = rows.filter(a=>(a.purpose||'')===f.purpose);
  if(f.search.trim()){ const s=normStr(f.search); rows = rows.filter(a=>[a.label,a.bankName,a.holder,a.purpose].some(x=>normStr(x||'').includes(s))); }
  rows.sort((a,b)=>String(a.label||'').localeCompare(String(b.label||'')));
  return rows;
}
function bankAccountRowsHTML(){
  const rows = bankAccountsFiltered();
  return rows.map(a=>`<tr>
      <td><b>${escapeHtml(a.label||'—')}</b></td>
      <td class="dim">${escapeHtml(a.bankName||'—')}</td>
      <td>${escapeHtml(a.holder||'—')}</td>
      <td class="mono">${escapeHtml(maskAccountNumber(a.accountNumber))}</td>
      <td>${escapeHtml(a.purpose||'—')}</td>
      <td>${hrStatusBadge(a.status||'Active', COMPANY_ACCOUNT_STATUS_META)}</td>
      <td>${hrActionsMenu('cacc', a.id, [
        ['cacc-edit','Edit'],
        a.status!=='Active'?['cacc-activate','Set Active']:null,
        a.status==='Active'?['cacc-deactivate','Deactivate']:null,
        a.status!=='Archived'?['cacc-archive','Archive']:null,
      ])}</td>
    </tr>`).join('') || `<tr><td colspan="7" class="empty">No bank accounts match. Click “+ New Bank Account”.</td></tr>`;
}
function applyBankAccountFilter(main){
  const tb = document.getElementById('caccRows'); if(!tb) return;
  tb.innerHTML = bankAccountRowsHTML();
  const el = document.getElementById('caccShown'); if(el) el.textContent = bankAccountsFiltered().length;
  bindHRActions(main);
}
function renderBankAccounts(main){
  if(!State.bankAccountFilter) State.bankAccountFilter = {search:'', purpose:'all', status:'all'};
  const f = State.bankAccountFilter;
  const all = State.companyAccounts||[];
  const activeN = all.filter(a=>a.status==='Active').length;
  main.innerHTML = pageHeader('Bank Accounts',
      'Company bank accounts used across finance and payroll. Only Active accounts appear in transaction dropdowns. Account numbers are stored masked in lists — never a PIN, OTP, password, or token.',
      `<button class="btn btn-accent" id="caccNew">+ New Bank Account</button>`)
    + `<div class="grid grid-4 stack-section">
        <div class="card stat-card"><div class="stat-label">Accounts</div><div class="stat-value">${all.length}</div><div class="stat-sub dim">${activeN} active</div></div>
        <div class="card stat-card"><div class="stat-label">Shown</div><div class="stat-value" id="caccShown">${bankAccountsFiltered().length}</div></div>
      </div>
      <div class="card">
        <div class="form-grid" style="grid-template-columns:1.6fr 1fr 1fr;margin-bottom:12px;">
          <div class="field"><label>Search (label, bank, holder)</label><input class="input" id="caccSearch" placeholder="Search…" value="${escapeHtml(f.search)}"></div>
          <div class="field"><label>Purpose</label><select class="input" id="caccPurpose"><option value="all">All purposes</option>${COMPANY_ACCOUNT_PURPOSES.map(p=>`<option ${f.purpose===p?'selected':''}>${p}</option>`).join('')}</select></div>
          <div class="field"><label>Status</label><select class="input" id="caccStatus"><option value="all">All statuses</option>${COMPANY_ACCOUNT_STATUSES.map(s=>`<option ${f.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
        </div>
        <div class="table-wrap" style="max-height:560px;overflow:auto;">
          <table>
            <thead><tr><th>Label</th><th>Bank</th><th>Account Holder</th><th>Account Number</th><th>Purpose</th><th>Status</th><th></th></tr></thead>
            <tbody id="caccRows">${bankAccountRowsHTML()}</tbody>
          </table>
        </div>
        <p class="hint" style="margin-top:10px;">Display format is “Label — Bank”. Deactivate to hide an account from new transactions without losing history; Archive to retire it. Existing transactions that referenced an account keep their recorded value.</p>
      </div>`;
  document.getElementById('caccNew').addEventListener('click', ()=>openCompanyAccountModal(null));
  document.getElementById('caccSearch').addEventListener('input', e=>{ State.bankAccountFilter.search=e.target.value; applyBankAccountFilter(main); });
  document.getElementById('caccPurpose').addEventListener('change', e=>{ State.bankAccountFilter.purpose=e.target.value; applyBankAccountFilter(main); });
  document.getElementById('caccStatus').addEventListener('change', e=>{ State.bankAccountFilter.status=e.target.value; applyBankAccountFilter(main); });
  bindHRActions(main);
}
function bankMasterOptionsHTML(selected){
  return BANK_MASTER_GROUPS.map(g=>`<optgroup label="${escapeHtml(g.group)}">${g.banks.map(b=>`<option ${b===selected?'selected':''}>${escapeHtml(b)}</option>`).join('')}</optgroup>`).join('');
}
function openCompanyAccountModal(id){
  const a = id ? companyAccountById(id) : null;
  const isNew = !a;
  const v = a || {label:'', bankName:'', holder:'', accountNumber:'', purpose:'Operational', status:'Active', notes:''};
  openModalHTML(`<h3>${isNew?'New Bank Account':'Edit Bank Account'}</h3>
    <form id="caccForm"><div class="form-grid" style="grid-template-columns:1fr 1fr;">
      <div class="field"><label>Account Label</label><input class="input" name="label" value="${escapeHtml(v.label||'')}" required placeholder="e.g. Mandiri Payroll"></div>
      <div class="field"><label>Bank</label><select class="input" name="bankName"><option value="">— select —</option>${bankMasterOptionsHTML(v.bankName)}</select></div>
      <div class="field"><label>Account Holder</label><input class="input" name="holder" value="${escapeHtml(v.holder||'')}" placeholder="Name on the account"></div>
      <div class="field"><label>Account Number</label><input class="input" name="accountNumber" value="${escapeHtml(v.accountNumber||'')}" placeholder="Full number (masked in lists)" autocomplete="off"></div>
      <div class="field"><label>Purpose</label><select class="input" name="purpose">${COMPANY_ACCOUNT_PURPOSES.map(p=>`<option ${v.purpose===p?'selected':''}>${p}</option>`).join('')}</select></div>
      <div class="field"><label>Status</label><select class="input" name="status">${COMPANY_ACCOUNT_STATUSES.map(s=>`<option ${v.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
      <div class="field" style="grid-column:span 2;"><label>Notes</label><input class="input" name="notes" value="${escapeHtml(v.notes||'')}"></div>
    </div>
    <p class="hint" style="margin-top:6px;">Do not enter a PIN, OTP, password, or access token here — store only the account number. It is masked everywhere except this field.</p>
    <div class="modal-actions"><button type="button" class="btn" id="caccCancel">Cancel</button><button type="submit" class="btn btn-accent">${isNew?'Create':'Save'}</button></div></form>`,
    {width:640, onMount:(root)=>{
      root.querySelector('#caccCancel').addEventListener('click', closeModal);
      root.querySelector('#caccForm').addEventListener('submit', async ev=>{
        ev.preventDefault();
        // UX-006C2C-4 (row 25) — company bank accounts are configuration metadata (no money
        // movement, no banking authority): settings.manage, not finance.*.
        if(!can(ACTIONS.SETTINGS_MANAGE)){ showWarning('You do not have permission to manage company accounts.'); return; }
        const fd=new FormData(ev.target);
        const label=(fd.get('label')||'').trim();
        if(!label){ showWarning('An account label is required.'); return; }
        const now=new Date().toISOString();
        const rec = a || {id:uid('cacc'), createdAt:now};
        rec.label=label; rec.bankName=(fd.get('bankName')||'').trim(); rec.holder=(fd.get('holder')||'').trim();
        rec.accountNumber=(fd.get('accountNumber')||'').trim(); rec.purpose=fd.get('purpose'); rec.status=fd.get('status');
        rec.notes=(fd.get('notes')||'').trim(); rec.updatedAt=now;
        if(isNew) State.companyAccounts.push(rec);
        await persistCompanyAccounts();
        logActivity({type:isNew?'bankaccount.create':'bankaccount.edit', module:'Bank Accounts', entity:rec.label, entityId:rec.id,
          desc:`${isNew?'Created':'Updated'} company account ${rec.label}${rec.bankName?' ('+rec.bankName+')':''}`, refs:{companyAccountId:rec.id}});
        closeModal(); showSuccess('Bank account saved.'); render();
      });
    }});
}
async function setCompanyAccountStatus(id, status){
  // UX-006C2C-4 (row 26) — settings.manage before the status write.
  if(!can(ACTIONS.SETTINGS_MANAGE)){ showWarning('You do not have permission to manage company accounts.'); return; }
  const a = companyAccountById(id); if(!a) return;
  if(status==='Archived' && !confirmAction(`Archive “${a.label}”? It will be hidden from new transactions. Existing history is unchanged.`)) return;
  a.status=status; a.updatedAt=new Date().toISOString();
  await persistCompanyAccounts();
  logActivity({type:'bankaccount.status', module:'Bank Accounts', entity:a.label, entityId:a.id, desc:`Company account ${a.label} → ${status}`, refs:{companyAccountId:a.id}});
  showSuccess(`Account ${status.toLowerCase()}.`); render();
}
function renderAbout(main){
  main.innerHTML = `
    <div class="page-head"><div><h1>About</h1></div></div>
    <div class="card" style="max-width:640px;">
      <h3 style="margin-top:0;">${escapeHtml(APP_NAME)}</h3>
      <p class="dim">Version ${APP_VERSION} — ${escapeHtml(APP_RELEASE_NAME)}</p>
      <p class="dim">${escapeHtml(APP_TAGLINE)}</p>
      <p class="dim">${escapeHtml(State.settings.companyName||COMPANY_NAME_DEFAULT)}</p>
      <div class="divider"></div>
      <p style="font-size:13px;line-height:1.7;">${escapeHtml(APP_POSITIONING)}</p>
      <div class="divider"></div>
      <p class="dim" style="font-size:13px;line-height:2;">
        Storage Mode: <b>${escapeHtml(StorageAdapter.modeLabel())}</b><br>
        Persistence Status: <b style="color:${StorageAdapter.status==='active'?'var(--green)':StorageAdapter.status==='error'?'var(--brick)':'var(--accent)'};">${escapeHtml(StorageAdapter.statusLabel())}</b>
      </p>
      <div class="insight-item" style="margin-top:var(--space-4);display:block;">Data is stored privately on this device (${escapeHtml(StorageAdapter.modeLabel())}). Use Settings → Data Portability to move your complete dataset to another browser or device. Cloud synchronization and multi-user access are not yet enabled.</div>
    </div>
  `;
}
function renderReleaseNotes(main){
  const notes = [
    {v:'2.11.0 — Identity Refresh', items:['Refreshed TAM OS product identity in the persistent application chrome: the sidebar now pairs the existing TAM monogram with a live "TAM OS" wordmark set in Sora SemiBold, the "OS" carrying the TAM Teal brand accent. The expanded lockup reads [monogram] TAM OS; the collapsed rail shows the monogram only','The persistent "PT Total Asset Manajemen" subtitle is removed from the application brand block. The company identity is retained where it is formal or contextual — About, Settings, reports and positioning copy — so nothing about company identification is lost','Typography is now self-contained: Sora (wordmark), Inter (UI), Source Serif 4 and JetBrains Mono (their existing roles) are embedded locally as base64 WOFF2, so the portable artifact renders its intended type offline with no Google Fonts network dependency','Palette strategy P1 — identity/UI separation: the Navy/Blue/Teal identity palette is introduced as tokens for the product identity, while the existing semantic gold accent (planned status, Gaji category, Actual series) is preserved unchanged','Presentation and identity only. No change to authorization, Acting-as semantics, read-scope, payroll, overtime, contract, finance, execution, approval, posting, import or export behaviour; no schema, storage key or migration change; SCHEMA_VERSION unchanged (6) and existing backups remain compatible']},
    {v:'2.10.0 — Governed Workspace', items:['Authorization is complete across every operational mutation. Finance, Payroll, Overtime, Contract, HR, Import and Data-lifecycle actions all resolve through the same frozen capability set (20 actions); a control you may not use is disabled with the reason, and the underlying action refuses it again at its own boundary even if the control is bypassed (UX-006C / C2 / C2C)','Employee principals now read only their own records. The employee roster, pickers, worksheets, duplicate review, settings diagnostics and Global Search are all scoped at the read boundary, so a foreign employee\'s identity, salary and detail records are never disclosed — including via direct deep link. Scoping is a READ concern: the stored data itself is never narrowed (Readiness-1)','Principal and workspace context are presented everywhere the operator needs them: an Acting-as selector with a collapsed-rail chip, an explicit workspace label, and clearer first-boot guidance to choose a principal before expecting data (UX-006D1 / D2 / D3)','The C3 integration surface is frozen: availability is an affordance derived per render from the frozen can(), never cached, never persisted, and never applied to navigation (UX-006C3)','Eight end-to-end user journeys — CEO finance, employee self-service and privacy, payroll lifecycle, Smart Import with undo, backup/restore/reset, principal switching, settings, and supplemental payroll — are accepted against the real production seams and the persisted result, not in-memory state alone (Readiness-2)','Authorization, presentation and read-scope only. No change to payroll, overtime, contract, finance, execution, approval, posting, import or export calculations; no schema, storage key or migration change; SCHEMA_VERSION unchanged (6) and existing backups remain compatible','Acting-as identity is a local application context for a trusted operator, not authentication. It is not a security boundary against someone with local access to the device or the application file']},
    {v:'2.9.0 — Workspace Experience', items:['Executive Dashboard consolidation with a navigation-only Action Center that surfaces the items needing attention; the Finance Overview is recast as the operational finance workspace, and Net Cash Flow has a single owner (UX-005A)','A reusable Data Grid foundation for tabular views — single-column sorting, pagination (20/50/100), debounced search, live result counts, filtered-empty states and declarative feature flags — adopted by Transactions and Employees. Sorting/pagination/search operate on a copy; source records are never reordered or mutated (UX-005B)','Design-system consistency: canonical spacing/rhythm, numeric typography with tabular figures, and navigation glyph disambiguation, all resolving from shared tokens (UX-005C)','Global Search — a navigation-only Ctrl/Cmd+K command palette over a pure, source-agnostic engine, returning Navigation, Employee, Contract and Payroll results and activating them by navigation only; the engine only ever ranks the documents it is handed (UX-005D)','Responsive polish: the shared modal surface stays inside the viewport and scrolls internally on short/mobile screens, with table density preserved (UX-005E)','Accessibility hardening: a Skip to main content link and a real main landmark, modal Tab/Shift+Tab focus containment, dialog semantics on the finance transaction dialogs, decorative-glyph hiding, broader visible-focus coverage, and correct Data Grid aria-sort on column headers (UX-005F)','Repository & branding: official TAM OS branding, a self-contained inline favicon, README product-preview screenshots and a social-preview asset, plus repository/documentation cleanup (MAINT-001)','Presentation, navigation and query-state only. No change to payroll, overtime, contract, finance, execution, approval, posting, import or export behaviour; no schema, storage key or migration change; SCHEMA_VERSION unchanged (6) and existing backups remain compatible']},
    {v:'2.8.6 — Navigation Experience & TAM OS Rebrand', items:['The product is now TAM OS. The sidebar wordmark, browser title, About and Settings all read TAM OS; the GitHub repository is now fanoryu/TAM-OS. Historical releases keep their original TAM Intelligence OS name where that was accurate at the time','Navigation is organised into five business domains — Dashboard, People, Finance, Analytics, System — with hierarchical active state and a single primary-navigation landmark. The persistent shell mounts once and is never rebuilt on navigation','Finance shows four primary items (Overview, Payroll, Transactions, Planning); every other Finance destination lives under a More disclosure. Labels are simplified and the Soon placeholder tag is quieter. No route, view, id or destination changed','Breadcrumbs derive from the canonical navigation architecture (Domain / Item / Context) in their own Breadcrumb landmark, and context-aware Quick Actions provide navigation-only deep links, including a Payroll/Overtime → Execution Center hand-off. Quick Actions never execute, approve or post anything','The sidebar can collapse to an icon rail, be pinned expanded or collapsed for the session, expand on hover, and become an overlay drawer on tablet/mobile with a hamburger, backdrop, Escape-to-close, focus trap and focus restoration','Business numbers use the primary UI font with tabular numerals so figures align in columns — presentation only, with no change to formatting, rounding, currency rules or exports','Fixed a sidebar interaction defect: clicking a group header or the More control while its own section held the active view silently flipped hidden state and armed a surprising later collapse. Those clicks are now clean no-ops; the active section still stays open by design, and every non-active toggle works','Navigation, presentation and naming only. No change to payroll, overtime, contracts, execution, approval, posting, imports, exports or how data is stored; no schema, storage key or migration change; SCHEMA_VERSION unchanged (6) and existing backups remain compatible']},
    {v:'2.8.5 — Workspace & Contract Timeline Integrity', items:['The application shell is now built once and stays mounted. Switching views replaces only the view content, so the sidebar and navigation keep their identity instead of being rebuilt on every navigation','Refreshed the interface chrome: a sans-serif UI typeface, and consistent spacing, corner-radius and type scales applied through shared tokens. Chart colours now come from the theme tokens, and the light-theme chart colours have been corrected','The Executive Dashboard has been reduced from 20 metric containers to 13, and the alert list is capped while every alert remains reachable, so the screen reads as a management summary rather than a wall of figures','Contract timeline figures are now calculated against one coherent reference date. Today-facing results are unchanged; results advised for a historical date are now correct','Contract state and contract expiry are now two separate derived facts. A contract can be Active and at the same time be flagged as ending today, this week, this month or next month. Scheduled is derived from the dates and is never stored','Fixed contract progress wording. On a three-month contract, month 1 reads 1/3 with 2 months remaining, month 2 reads 2/3 with 1 month remaining, and month 3 reads 3/3 as the final month with 0 months remaining. 3/3 no longer implies a month is still left; the month after the end reads Expired','Every contract counter now resolves through one shared helper, so the dashboard counts, the status filters and the badges agree. Active includes active contracts that are ending soon, and excludes Scheduled and Expired contracts','Contract wording follows a fixed priority — Ends Today, then Ends This Week, then Final Month, then Ends Next Month, then Ending Soon — and the exported CSV Status column uses the same words you see on screen','Presentation and calculation only. No change to payroll, committed payroll, finance, or how data is stored; no schema, storage key, or migration change; SCHEMA_VERSION unchanged (6) and existing backups remain compatible','Not included in this release: the redesigned sidebar and navigation, breadcrumbs and quick actions, the collapsed/pinned/hover-expand rail, and the mobile drawer. Those remain future work']},
    {v:'2.8.4 — Monthly Plan Result Integrity', items:['Committing a Monthly Plan now checks whether both of its saves actually succeeded. It previously reported the plan as committed without looking at either result','If a save fails, you now see a clear message that the commit did not complete, instead of a success message. Your preview rows stay on screen so you can see exactly what was involved and review it','The failure message deliberately does not claim your data was rolled back. The commit writes two storage keys one after another and is not an all-or-nothing operation, so some data may already have been saved. Reloading reads whatever was saved — it does not restore a complete earlier state','Run Integrity Check reports a new Critical finding when a planned transaction references a Monthly Plan that does not list it, which is the state a failed commit can leave behind. The check reports it for review; it does not repair it','Rebuilding the preview after a failure still skips rows that already exist, so retrying does not create duplicate planned transactions','No change to how or when data is written, and no schema, storage key, or migration change; SCHEMA_VERSION unchanged (6)']},
    {v:'2.8.3 — Payroll Posting Integrity', items:['Posting payroll now checks whether every save actually succeeded. If any of the four saves fails, you are told the posting did not complete, no success message or activity entry is recorded, and you are asked to run Integrity Check and review Payroll and Finance before posting again','Fixed a path that could pay someone twice. If the payroll save failed but the finance transaction save succeeded, posting again created a SECOND transaction for the same payroll row. Posting now finds the existing transaction, reuses it, and restores the link instead of creating a duplicate','If more than one finance transaction already references the same payroll row, that row is now skipped with a clear reason instead of guessing which one is correct or adding another','Integrity Check now reports a finance transaction that points at a payroll row which is not committed, or which does not point back at it — the state left behind by a failed payroll save. It is reported as Critical with the row, period, transaction and amount so you can review before posting again','Integrity Check now reports payroll that is committed while its linked overtime is still Approved — the state left behind by a failed overtime save. That overtime could otherwise be included in a later month and paid twice','Integrity Check only reports. It never repairs links, changes overtime status, deletes transactions, or edits committed payroll','Saving still writes each dataset separately and is not all-or-nothing, so a failure means the posting did not complete — not that nothing was saved. No schema, storage key, or migration change; SCHEMA_VERSION unchanged (6)']},
    {v:'2.8.2 — Honest Persistence Results', items:['Operations that save several datasets at once — Smart Import commit, Smart Import undo, and employee merge — now check whether every save actually succeeded. Previously they reported success even when the browser rejected one or more writes','If a save fails, you now see a clear message that the operation did not complete, instead of a success message. The import wizard stays on the review step so you can retry, the merge is not reported as done, and no completion or audit entry is recorded','Failure messages deliberately do not claim your data was rolled back. Saving several datasets is not an all-or-nothing operation in the browser, so some data may already have been written. Reloading the page returns you to the last saved state','Pre-operation safety backups are always kept when a save fails, and retrying is safe: duplicate import rows are skipped and a repeated merge produces the same result','No change to how or when data is written, and no schema, storage key, or migration change; SCHEMA_VERSION unchanged (6)']},
    {v:'2.8.1 — Single Payroll Posting Authority', items:['Retired the legacy Payroll Planning screen. It was superseded by the Payroll Workspace in v2.5.0 and has been unreachable ever since — no menu entry and no way to open it. Its leftover "Commit Payroll" code has been removed','That leftover path was a second way to post payroll that did not apply the rules the Payroll Workspace applies: it ignored the period lock, ignored commit blockers, did not require a payroll row to be Approved first, wrote no activity-log entry, and recorded no commit time','It also recorded payroll as committed using a value the rest of the app does not recognise. Any payroll it posted showed as "Draft" in the workspace, was skipped by Integrity Check and HR reports, and could not be cancelled or corrected — even though a real planned Gaji transaction had been created','Committed payroll is now recognised in one shared place used by every screen. Payroll committed through the old path is now correctly recognised as committed everywhere, so it appears in reports, in Integrity Check, and in the contract cancellation warning','The warning shown when cancelling a contract that has committed payroll now fires correctly. It previously only checked the old value, so it did not appear for payroll posted through the Payroll Workspace','Payroll Workspace posting is now the single payroll posting path. No payroll data was changed, no migration was run, and no schema, storage key, or persistence behaviour was altered; SCHEMA_VERSION unchanged (6)']},
    {v:'2.8.0 — Aggregate-Owned Contract Renewal', items:['Contract renewal is no longer authored inside the renewal form. A dedicated business boundary (ContractRenewalAggregate) now decides whether a contract may be renewed and defines the successor contract, the predecessor’s Renewed status, and both history notes; the handler applies them','Renewal now reports success only when the save actually succeeds. Previously a failed write still closed the form, showed “Contract renewed”, and navigated to the new contract while nothing had been stored','If saving fails, the renewal is fully undone in memory — the successor is discarded and the original contract’s status, renewal link, history entry, and timestamp are restored — the form stays open, and a clear “nothing was changed” message is shown','Renew is now offered only for Draft and Active contracts. Renewing an already-Renewed contract previously created a second successor and silently orphaned the first one by overwriting the renewal link','Renewal persists through the existing Contract Repository. Predecessor and successor live in the same contract collection, so both are written together in one save — no new transaction, coordinator, or multi-store persistence mechanism was introduced','No schema, storage-key, or persisted-data change; SCHEMA_VERSION unchanged (6). Contract overlap is still advisory only, and payroll, finance, and supplemental behavior are untouched']},
    {v:'2.7.3 — Supplemental-Aware Payroll History', items:['Payroll History (Employee Detail) now represents months that also have a Supplemental Payment. Columns are Base Payroll · Payroll OT · Supplemental · Total Compensation · Stage, so overtime paid after payroll posting is no longer invisible','New read-only reporting helper (payrollTotalCompensation): Total Compensation = immutable Base Payroll + Payroll Overtime + committed (Posted/Executed) supplementals. The base payroll and its finance transaction are never modified and never redefined','Only Posted/Executed supplementals count toward Total Compensation; Draft/Review/Approved are surfaced as a subtle "Pending" figure and excluded from the total; Cancelled is ignored. The Supplemental cell shows the amount plus a document count (e.g. "2 Supplementals")','Integrity Check wording now distinguishes a legacy (pre-v2.7.1) supplemental with no frozen source snapshot (informational, display-only, payment unaffected) from one approved under v2.7.1+ that is genuinely missing its snapshot (a warning to investigate)','Reporting/presentation only — no persistence, finance, schema, or storage-key change; SCHEMA_VERSION unchanged (6), 15 storage keys; no historical record is rewritten']},
    {v:'2.7.2 — Persistence & Transactional Integrity', items:['Fixed a critical Supplemental Payment posting bug: the shared HR persistence helper did not return its success flag, so posting always took the failure path — it rolled the finance transaction out of storage while the supplemental stayed Posted, leaving an orphaned supplemental linked to a deleted transaction after reload. Persistence helpers now return a strict true/false and posting is coordinated: on success exactly one Planned transaction exists with valid two-way links; on failure nothing is left orphaned, and an unrecoverable rollback surfaces a clear message','Startup recovery: a supplemental left Posted by the old bug (its linked transaction missing, never executed) is safely restored to a re-postable Approved state with an audit entry — no financial amount is fabricated or altered; anything ambiguous is left for Integrity Check','Complete Backup restore is now transaction-safe: the file is validated first, a full pre-restore snapshot is kept, every dataset write is checked, and any failure rolls back in memory and re-persists the original values; the UI only reports success when the restore fully succeeds','Transaction execution now checks that the write succeeded: on a storage failure the transaction is restored exactly, no execution audit is written, and no linked supplemental is marked Executed; a clear failure message is shown','No storage key added or renamed (15); SCHEMA_VERSION unchanged (6); no committed payroll/finance amount or historical record is rewritten']},
    {v:'2.7.1 — Payroll Integrity & Reporting Foundation', items:['Fixed a historical payroll rendering defect: a Posted/Executed payroll could show a plan total (e.g. Rp7,000,000, 0 overtime) that disagreed with its committed finance transaction (e.g. Rp8,750,000). Posted/Executed payroll now renders immutable committed values, never reconstructed from current contract or overtime data','New centralized stage-aware source-of-truth helper (payrollHistoricalSnapshot): Draft/Review/Approved show working-plan values; Posted/Executed derive from the strongest committed evidence in priority order — an explicit committed snapshot, then the immutable linked transaction, then committed plan fields — with a visible "Payroll snapshot mismatch" notice when sources disagree. The posted transaction is never altered','Immutable overtime snapshots: new payroll postings freeze an overtime breakdown (overtimeSnapshot) on the transaction and a committed snapshot on the plan, so historical detail survives later edits or deletion of the source overtime. Unknown legacy hours display "— / unavailable" (distinct from an explicit 0 hrs)','Payroll Detail, worksheet rows, period totals/summary and CSV export are now stage-aware and consistent; Base Payroll Snapshot is shown separately from supplementals','Company settings onboarding: "Configure company settings" now completes via an explicit persisted marker (companySettingsConfiguredAt) set only after a successful Settings save, with a conservative legacy fallback for older settings; opening Settings without saving, or a failed save, does not complete it','Supplemental hardening: Posted supplemental notes are now immutable; an overtime ID cannot be captured by more than one non-cancelled supplemental anywhere in the store (global duplicate guard); Execution Center deep-link focuses the exact linked transaction; empty company-account posting state is clearer; new integrity checks for payroll/supplemental linkage','No storage key added or renamed (15); SCHEMA_VERSION unchanged (6); no historical payroll or finance amount is auto-repaired']},
    {v:'2.7.0 — Supplemental Payroll Engine', items:['Supplemental Payments: a new module that settles overtime approved AFTER the base payroll became immutable (Posted/Executed). It is a separate accounting document — the base payroll total, its finance transaction, and its execution history are never modified','The authoritative amount reuses the existing overtime-drift calculation (no second formula). Duplicate prevention: an overtime record is never paid twice across supplementals, at most one open Draft/Review exists per employee/period, and later overtime after a frozen supplemental forms a new record','Lifecycle: Draft → Review → Approved → Post to Finance → Execute. Amount and source overtime freeze at Approved. Posting creates exactly one Planned finance transaction (linked both ways, with an immutable company-account snapshot); execution runs through the existing Execution Center and records the actual payment','The v2.6.8 overtime-drift warning is now actionable — Generate a supplemental directly from the Payroll Workspace, Payroll Detail, or Overtime page. A Supplemental Payments page lists, filters and manages records; Payroll Detail and Employee Detail show related supplementals separately from base payroll','One new additive storage key (tam_supplemental_payments_v1); SCHEMA_VERSION unchanged (6); backup/restore include supplementals and older backups restore cleanly','Housekeeping: a centralized feature-status registry replaces the hardcoded sidebar badge (Projects / Vendors / Financial Calendar show SOON; Recurring Expenses is stable with no badge); general employee CSV export now masks bank-account numbers (import still accepts full numbers); count-neutral CI/Release verify labels','Source in v2.7.0 is overtime only; other adjustment types (bonuses, reimbursements) are intentionally out of scope']},
    {v:'2.6.9 — Enterprise Banking Foundation', items:['Indonesian Bank Master: a single, reusable reference list of Indonesian banks grouped by type (State, Private, Digital, Islamic, Regional, International) plus “Other Bank”, alphabetically sorted within each group. It is a constant (one source of truth, no duplicated arrays, no storage key) used by both employee banking and company accounts','Company Bank Accounts: a new Settings → Bank Accounts page to create, edit, deactivate, archive, search and filter company accounts. Each account has a Label, Bank (from the Bank Master), Account Holder, Account Number, Purpose (Operational / Payroll / Tax / Savings / Petty Cash / Other) and Status (Active / Inactive / Archived). Account numbers are stored masked in lists (only the last 4 shown) and never a PIN, OTP, password or token. Only Active accounts appear in transaction dropdowns, displayed as “Label — Bank”','Employee banking: the employee Bank is now chosen from the Bank Master, with a new Account Holder field. Existing values map correctly (e.g. Mandiri → Bank Mandiri, BSI → Bank Syariah Indonesia) and any other existing free-text bank is preserved as a “(current)” option — no bulk data migration. Employee account numbers are masked in the profile view','Transaction & execution integration: the Bank Account dropdowns in Add/Execute transactions, the transactions filter, recurring expenses and the default-bank setting now list only Active company accounts. Transactions that stored a legacy bank string keep resolving','Backward compatibility: on installs that already have data, the five legacy bank strings seed structured company accounts once (guarded, non-destructive) so existing references resolve; a fresh install starts empty. Complete Backup / Restore now include company accounts, and older backups without them restore cleanly','Data safety: one new additive storage key (tam_company_accounts_v1); SCHEMA_VERSION is unchanged (6); no storage key was renamed or removed; committed payroll/finance remain untouched','Supplemental Payment remains planned for a future release (v2.7.0). The existing overtime-drift warning and its disabled placeholder are unchanged in this release']},
    {v:'2.6.8 — Payroll Selection and Overtime Drift UX Fixes', items:['Generic payroll selection model: Select All and the header checkbox now select all visible rows, and the selected count is the actual number of selected rows. Each bulk action owns its eligibility and reports eligible / skipped / reason independently — Review applies to Draft, Approve applies to Draft and Review, Post applies to Approved. Adding a future action (Export, Delete, …) just declares its own eligible stages','This fixes the original confusion (previously "16 selected → 0 approved"): Approve now acts only on its eligible rows and clearly reports the rest, e.g. "Approved 3 payroll(s). 2 skipped — 1 already at Posted stage; 1 already at Executed stage"','The header checkbox stays synchronized with the visible rows (checked / indeterminate / unchecked), each action auto-disables when the period has no row eligible for that action, and Post to Finance reports rows skipped because they are not at the Approved stage alongside any commit blockers','Overtime Drift Visibility: approving overtime after payroll already exists now shows an immediate warning — no need to click Generate Payroll first — on the Overtime page, the Payroll Workspace and Payroll Detail. Draft/Review/Approved payroll shows "Overtime approved. Regenerate payroll to include the updated overtime"; Posted/Executed payroll shows that the original payroll is unchanged and a supplemental payment will be required (with a disabled "Supplemental Payment (Coming in a future release)" placeholder)','Posted and Executed payroll stays fully immutable — payroll totals and posted/executed transactions are never modified. The drift warning is derived from existing overtime-comparison logic, so it appears immediately, survives reload and never duplicates','No payroll status rules, committed-payroll immutability, storage key, backup format, migration or SCHEMA_VERSION (still 6) changed; Supplemental Payment itself is intentionally deferred to a future release']},
    {v:'2.6.7 — Enterprise Repository & Delivery Foundation', items:['Engineering & delivery foundation only — no business feature, calculation, payroll, overtime, finance, import, storage key, SCHEMA_VERSION (6), backup format or module-architecture change; the application runtime is byte-identical to v2.6.6 apart from the version identity','Added GitHub Actions CI (build + verify on every push/PR to main) and a tag-triggered release workflow that re-derives the version, checks the tag matches APP_VERSION, and publishes the portable HTML as a release asset','Added repository governance: issue templates (bug report / feature request), pull request template, CODEOWNERS, SECURITY policy, CONTRIBUTING guide, code of conduct, a proprietary LICENSE-NOTICE, release-notes templates, and enterprise QA / release-process / data-safety docs','Hardened repository hygiene (.gitignore / .gitattributes) to keep secrets, local backups, .env files and uploaded evidence out of version control, and documented a sample-data policy','README now carries CI / release / version / proprietary badges']},
    {v:'2.6.6 — Company Settings Checklist Fix', items:['Fixed: the "Configure company settings" onboarding step now becomes completed as soon as you save a meaningful company profile. Previously it only credited a non-default Company Name or a set Opening Cash Balance and ignored the Product Name, so saving Settings often left the step unchecked','Completion is derived purely from your persisted settings (company name, product name, or opening cash balance) — so it is correct immediately after saving and stays correct after navigation and browser reload, without needing a full page reload','Untouched shipped defaults do not count (a fresh install is still "not configured"), a theme-only change does not count as company setup, and optional blank fields never block completion','No company data is reset or modified; no storage key, SCHEMA_VERSION (6), calculation or .css change']},
    {v:'2.6.5 — Smart Import Selection Scroll Preservation', items:['Fixed: in the Smart Import review stage, selecting or unselecting a row checkbox no longer jumps the list back to the top. Row selection is now fully incremental — it updates only the row state and the "N selected" counter and does not re-render the wizard, so the scroll position and keyboard focus stay exactly where they were','Select All Safe and Unselect All are also incremental (they sync the visible checkboxes in place); Skip Conflicts and column-mapping overrides still re-render (they change buckets/counts or rebuild the model) but now preserve the review list scroll position and the focused control across the re-render via requestAnimationFrame with focus({preventScroll:true})','Added a live "N selected" indicator next to the review actions so selection feedback is visible without scrolling','No change to import parsing, employee/contract matching, payroll generation, transaction creation, duplicate prevention, storage keys, SCHEMA_VERSION (6) or audit behavior; no .css files changed']},
    {v:'2.6.4 — Release Automation & Payroll Audit Visibility', items:['Release tooling no longer hardcodes the version: build-single-file.js/.ps1 and verify-build.js/.ps1 derive it from a single source of truth (APP_VERSION in js/core/constants.js) via tools/app-version.js, and the portable dist filename (dist/tam-intelligence-os-v<version>.html) follows APP_VERSION automatically; the tooling fails clearly if the version cannot be parsed or the generated filename would not match','New Activity Log (Management → Activity Log): a read-only, cross-module audit trail (payroll generate/review/approve/return/cancel/post/lock/unlock/override, overtime status changes, transaction execution, Smart Import commit, employee/contract deletes) with search, module/event/period filters, newest-first ordering, an empty state and CSV export — incrementally rendered so the search box keeps focus','Uses the existing tam_audit_log_v1 store (the same key the reset record already used) — no new storage key and no SCHEMA_VERSION change (still 6); the newest 500 events are retained and survive a data reset','Payroll audit visibility: Payroll Detail now shows a read-only Payroll Timeline (Generated → Reviewed → Approved → Posted → Executed, plus period lock/unlock) and the Payroll Workspace shows Period Activity — both derived from existing payroll history, the linked transaction and audit records, showing only events that actually occurred (no fabricated timestamps)','Post to Finance now reports a clear posted-vs-skipped summary: each skipped Approved row shows the employee name and the exact blocker reason, stays Approved, and creates no transaction. Blocker rules are unchanged and no duplicate transactions are created','No business calculation, storage key, migration flag or SCHEMA_VERSION (6) changed; no .css files changed']},
    {v:'2.6.3c — Responsive UI Polish', items:['Sidebar icon consistency: the Execution Center icon now renders as monochrome text like every other menu item (it was a colored emoji that drew attention even when inactive) — only the active row background and text color indicate the current page','Responsive Employee, Contract and Payroll detail pages: the two side-by-side cards (e.g. Profile / Active Contract) size to their own content instead of stretching to equal height, and stack vertically when width is limited (125%/150% browser zoom), avoiding overly tall cards','Tightened vertical spacing in the detail cards for higher information density while staying readable; top action buttons (Back / Edit / New Contract) wrap gracefully on narrow widths','UI/CSS presentation only — no business logic, storage, calculations, verification, SCHEMA_VERSION (6) or styles files changed']},
    {v:'2.6.3b — Floating Actions Menu Fix', items:['Fixed: the row Actions menu is no longer clipped by the scrolling table container. It is now a shared floating layer — portaled out to a top-level #menu-root node and positioned with position:fixed via getBoundingClientRect() — so it always renders fully visible above the table','The floating menu auto-flips up or down based on available space, closes on outside click and on Escape, and repositions on window resize/scroll. One shared implementation (openFloatingMenu/closeFloatingMenu) is reused by Employees, Contracts, Payroll, Overtime, Transactions and Execution Center','UI infrastructure only — no business logic, storage key, SCHEMA_VERSION (6) or calculation change']},
    {v:'2.6.3a — Payroll Workspace Hotfix', items:['Fixed: Approve Selected now moves rows from Review to Approved. Approval is a sign-off and is no longer blocked by commit validation — data checks (missing salary, invalid/duplicate contract) run at Post to Finance instead, where blocked rows are skipped and reported. Post to Finance now succeeds after Approve, with no duplicate payroll created','Fixed: the row Actions dropdown now opens upward automatically when there is not enough room below the row, so menu items are never hidden and no scrolling is needed. Applies to all Actions menus (Employees, Contracts, Overtime, Payroll, Transactions, Execution Center)','UI/action-flow only: the payroll calculation engine, storage keys, SCHEMA_VERSION (6) and lifecycle stages are unchanged']},
    {v:'2.6.3 — Payroll Intelligence Workspace', items:['Rebuilt Payroll as an operational workspace: one active period with a clear current-period banner and period switcher, top KPI cards (Current Period, Employees, Draft, Review, Approved, Posted, Executed, Total Payroll, Total Overtime), and a read-only worksheet instead of an editable spreadsheet','Payroll is Base Salary + Approved Overtime only — no tax, BPJS, loan, transport, meal, or deduction engine. Salary is edited on the Contract, overtime in Overtime; both flow into the read-only Total (single source of truth, no duplicated overtime entry)','Operational lifecycle Draft → Review → Approved → Posted → Executed, mapped over the existing stored status values with Executed derived from the linked finance transaction (no schema, storage-key or migration change)','Bulk operations with confirmation dialogs: Select All, Review Selected, Approve Selected, Post to Finance — only Approved payroll can be posted, and posting creates Planned transactions (never auto-executed; execution stays in the Execution Center)','Payroll period lock: lock a month to freeze generation, edits, its overtime, and finance posting; unlocking requires confirmation','Deterministic Payroll Health cards (no AI): contract expiring within 30 days, payroll up/down more than 20% vs last period, unusually high overtime, and employees missing an active contract','Payroll Summary (total employees, payroll total, total overtime, average, highest, lowest) and a read-only payroll preview showing employee, contract, progress, base, approved overtime, total and the generated finance transaction','Employee Detail is now a timeline: Profile, Active Contract, Contract History, Payroll History, Overtime History and Finance Transactions in one place','Duplicate prevention preserved (one payroll per employee per period — skip or update the existing draft, never duplicate). Smart Import, Employee Dedup, Contract Engine, Execution Center, Monthly Planning, Reports, Node build, verification, Git and the module structure are all unchanged','No business calculation, storage key or SCHEMA_VERSION (still 6) changed; period locks live in existing settings']},
    {v:'2.6.2 — Developer Experience & Module Decomposition', items:['Initialized a Git repository with a practical .gitignore (the portable release HTML in dist/ stays version-controlled)','Decomposed the largest JavaScript modules into a feature-folder tree — js/{core,ui,finance,people,import,analytics} — growing from 20 to 43 focused files and cutting the average module from ~410 to ~190 lines for much easier navigation and maintenance','Node.js is the primary build/verify toolchain; a shared tools/module-order.js manifest is the single source of truth for classic-script load order, mirrored by index.html','Pure code move only: no business logic, calculation, storage key, schema version (still 6), migration flag, backup format or UI behavior changed — the decomposition is verified byte-identical to the previous concatenation, so runtime behavior is unchanged','Still classic ordered <script> tags in one shared global scope — no ES modules, no import/export, no bundler']},
    {v:'2.6.1 — Search Focus & Incremental Rendering Fix', items:['Fixed a UX regression where typing in any search box (Employees, Contracts, Transactions, Payroll Planning, Overtime) lost keyboard focus after every keystroke, forcing a re-click before each character','Search and filter controls now update only the table body (and any filter-dependent totals) instead of rebuilding the whole page — the search input keeps focus, caret position and text selection, so typing feels like a native desktop app','Table scroll position is preserved while filtering; dropdown selections and payroll row-selection checkboxes survive incremental filtering (selection state lives in State and is re-applied)','Purely a rendering-path fix: no business logic, calculation, storage key, schema version (still 6), migration flag, backup format, import, deduplication, payroll/overtime result or export was changed; all row actions, inline edits and Actions menus are preserved']},
    {v:'2.6.0 — Modular Frontend Architecture', items:['Phase 0 of the Modular Frontend Architecture initiative: the single-file application was physically split into ordered CSS and JavaScript source files loaded as classic scripts in the original declaration order, preserving the exact shared global scope and runtime behavior','No business logic, calculation, storage key, schema version (still 6), migration flag, backup format or UI behavior was changed — this is a controlled extraction only, verified against the v2.5.2 golden master','A portable single-file build (dist/tam-intelligence-os-v2.6.0.html) is generated from the modular source and remains behaviorally identical to previous releases, opening directly in any browser with the same external XLSX and font behavior','Smart Import, Employee Deduplication, Payroll Planning, Overtime, Monthly Plan Generator, Execution Center, reports, diagnostics, themes, charts, backup/restore and sidebar behavior are all preserved unchanged']},
    {v:'2.5.2 — Employee Deduplication & Master Data Consolidation', items:['Fixed the core bug where importing a multi-sheet workbook created the same employee once per month (e.g. Achmad Ferdiansyah appearing under many Employee IDs). Employees are master data — one record per real person','Smart Import now builds ONE workbook-wide canonical employee index across all rows, existing Employees, existing Contracts, and existing payroll/transaction links BEFORE creating anything; every monthly row for the same person references one candidate','Shared employee-name normalization (trim, collapse spaces, remove line breaks, normalize apostrophes/hyphens and trailing punctuation, case-insensitive) — the original display name is preserved and genuinely different names are never merged on fuzzy similarity','Matching priority: existing employeeId → existing contract already linked to a person → exact normalized full name → name+bank → name+email → name+salary (supporting evidence only) → manual review. A new contract number for the same person creates a new Contract linked to the existing Employee; salary changes and contract renewals never create a new Employee','Commit uses ONE shared employee-resolution map and a per-employee contract map: each unique person is created once, each contract number is created once per person and reused across months, and payroll plans and transactions all link to the same employeeId','Re-importing the same workbook (or separate monthly workbooks) produces 0 duplicate employees, 0 duplicate contracts, 0 duplicate payroll plans and 0 duplicate transactions — stable matching plus import audit evidence','New Employee Duplicate Review tool: detects groups with the same normalized name, shows every duplicate Employee ID with its linked contracts/payroll/transactions/overtime/adjustments, proposes a canonical record (most links → most complete profile → oldest → lowest sequence), and merges only on confirmation — repointing all linked records, preserving every history entry and financial amount, with a complete automatic backup and an audit record; profile conflicts are shown side-by-side and never overwritten silently','Smart Import review now shows workbook-wide unique counts (payroll rows, unique employees, existing matched, new, possible duplicates, contracts, payroll plans, transactions) and the shared candidate + canonical Employee ID per row','Integrity Check detects duplicate normalized names, one contract number linked to multiple employees, payroll/overtime split across duplicate IDs, orphaned duplicates, conflicting bank/email within a group, and import batches that created multiple employees for one candidate — with navigation to Employee Duplicate Review (never auto-merging)','Diagnostics add unique employee-name count, duplicate groups/records, last merge, and last Smart Import unique-employee count; a new Employee Duplicate Audit report (Normalized Name, Employee IDs, Canonical Employee, Contracts, Payroll Plans, Transactions, Merge Status)','Fresh-install fix: the "Existing data detected" prompt now appears only when a real business dataset has records (transactions, employees, contracts, payroll plans, recurring expenses, monthly plans, overtime, adjustments, or import batches that created records) — empty arrays, default settings, migration flags, schema version, empty backups/audits and UI preferences no longer trigger it, and it lists only datasets with non-zero counts','Safe one-time v2.5.2 migration takes a backup, runs once, preserves all data and storage keys, and never auto-merges existing duplicates — they are only detected and surfaced for your confirmation. Smart Import, Payroll Planning, Overtime, Monthly Plan, Execution Center, themes, charts, backup/restore and sidebar behavior are all preserved']},
    {v:'2.5.1 — Structured Payroll Column Mapping', items:['Smart Import now reads the real TAM "Rencana Penggunaan Dana" layout where each employee is a vertically-merged block in column B — employee name (main row), contract number (sub-row), and contract progress N/M (sub-row) are gathered together instead of the sub-rows being discarded, which is what previously left contracts as "Missing Information"','Sub-row gathering: parseLetterDocSheet now attaches each block\'s contract-number and progress cells to the employee item and derives structured employeeName / contractNumber / progressCurrent / progressTotal / salary fields that survive the plan⇄realisasi merge','Structured column support: parseGenericTable recognizes dedicated Indonesian & English headers — Nama / Nama Karyawan / Employee, No Kontrak / Nomor Kontrak / Contract Number, Progress / Masa Kontrak, Gaji / Salary / Nominal, Jam Kerja, Hari Kerja, Lembur — and preserves employeeName, contractNumber, contractProgress, salary, workingHoursPerDay, workingDaysPerWeek and overtimeHours through every parsing stage','Flexible contract-number parsing accepts arabic or roman month segments, 3–6 segments and "/" or "." separators (e.g. 1/AIMO-DT/1/2026, 01/TAM/01.SDM.IV/2026, 3/AIMO-DT/SPK/VI/2025); progress parsing accepts 8/12, 8 / 12, 8,5/12, "Month 8 of 12" and "8 of 12"','Progress is always converted to currentMonth + durationMonths and start is inferred from the contract number, payroll month and progress — the raw "8/12" is never stored as permanent contract state; when the contract number\'s own month/year disagrees with the progress-derived start, the row is flagged instead of guessed','Employees with no contract number and no progress (e.g. a "bulan Juni" note) are no longer blocked — a default-duration contract starting the payroll month is proposed and clearly flagged "defaults" for review','New Column Mapping page before import shows Source Header, Detected Meaning, Sample Value and Confidence with manual override for structured column tables, plus a Raw Parsed Row Preview so you can inspect exactly what was extracted from each payroll row','Full backward compatibility: the existing letter-document import, generic CSV/XLSX import, Update Existing Month, Legacy Mapping, audit batch and Undo are all preserved; no storage keys, migrations or data changed']},
    {v:'2.5.0 — Native Payroll Operations Engine', items:['Payroll Planning is now the primary monthly payroll operations workspace — run the full cycle (Employee → Contract → Schedule → Overtime → Generate → Review → Commit → Execution → Reports) entirely inside TAM, no Excel required','Persistent monthly payroll worksheet with cycle status (Not Generated / Draft / In Review / Ready to Commit / Committed / Partially/Fully Executed), totals, eligible & excluded employees, and per-row review lifecycle (Draft / Reviewed / Ready / Committed / Cancelled)','Generate Payroll for a month from active contracts, contract progress, work schedules, approved overtime, and recurring adjustments — with exact exclusion reasons for anyone not included','Centralized payroll calculation: Base + Overtime + Allowance + Bonus + Benefits/BPJS + Other Addition − Deduction − Other Deduction, full precision internally, rounded only at the end, with a negative-payroll warning and a component breakdown','Inline editing of additions/deductions/notes; base salary and overtime are read-only (overtime auto-populates from approved records); “Override Salary for This Payroll Only” stores original + overridden + reason and never touches the contract','Overtime integration: only Approved overtime enters a draft, committing flips it to Committed to Payroll (no double inclusion), and changed approved overtime marks the row Changed instead of silently altering committed payroll','Contract progress (e.g. 8/12) is always calculated from start date + duration + payroll month — never typed manually for operations','Commit Ready Payroll to Monthly Plan with a confirmation summary (totals, new/existing/changed transactions, conflicts, skipped); creates one Planned Gaji transaction per employee with structured links (employeeId, contractId, payrollPlanId, overtimeIds, monthlyPlanId), never duplicating or auto-executing','Monthly Plan Generator now consumes committed payroll instead of generating it, with a payroll-source status (Generated / Reviewed / Committed / Missing / Changed) and an Open Payroll Planning button','Payroll execution tracking reflects the Execution Center (planned/scheduled/partial/completed) with actual paid, remaining, date, method, bank and reference — plus Open in Execution Center','Prepare Next Month regenerates payroll from master data and advancing contract progress; actuals, execution status, and salary overrides are never copied forward','Recurring payroll adjustments (fixed additions/deductions with effective windows) applied on generation via snapshots — editing them never changes historical payroll','Payroll detail & history view (components, schedule, overtime breakdown, adjustments, linked plan/transaction, execution, timestamped events); payroll operational KPIs and alerts on the dashboard','New reports (Monthly Payroll Register, by Department, Components, Execution Status, Excluded Employees) and integrity checks (payroll without employee/contract, outside coverage, duplicate month, negative amount, broken overtime, total inconsistent, missing plan/transaction, override without reason)','Smart Import repositioned as a migration & historical tool with import purposes (Initial Company Setup / Historical Payroll Migration / Finance Transactions Only / Review Without Commit) and a Continue to Payroll Planning action — all existing import, Update Existing Month, Legacy Mapping, audit and Undo capabilities preserved','New storage key tam_payroll_adjustments_v1, schema v6 with a one-time backed-up migration that normalizes only missing payroll fields (no historical totals or actual amounts changed); one-line branding, System/Dark/Light themes, chart readability, action menus and sidebar scroll all preserved']},
    {v:'2.4.0 — Smart Import & Chart Readability Engine', items:['Smart Import: payroll Excel/CSV files now auto-detect and synchronize employees, contracts, payroll plans, monthly plans and finance transactions — no more manual re-entry after importing','Import wizard: Upload → Parse → Detect Months/Categories → Detect Employees/Contracts → Match → Review Conflicts → Select Actions → Commit → Results','Extracts employee name, contract number, contract progress (8/12), salary, month and amounts; infers a proposed contract start from payroll month − (current − 1), using XI/2025-style evidence in the contract number','Employee matching (Exact / High Confidence / Needs Review / No Match) and contract matching (Existing / New / Updated / Conflict / Missing Information) with old-vs-imported values shown side by side; nothing is auto-merged or auto-overwritten','Per-row actions and a toolbar (Select All Safe, Unselect All, Skip Conflicts, Review Only, Commit Selected); duplicates are prevented by Employee + Contract + Month','Committed records carry structured IDs (employeeId, contractId, payrollPlanId, importBatchId, importRowId); descriptions stay readable','Data safety: an automatic backup + audit batch before every commit, plus Undo Last Smart Import with a rollback preview that never removes executed, modified, or committed-executed records','Import modes: Finance Only, Smart Payroll & Master Sync (default), Review Only — the existing Finance-transaction import, Update Existing Month, and Legacy Payroll Mapping remain intact','Chart readability: dynamic heights (320/380/420), minimum 44px Y-tick spacing (reduce ticks, never compress), reserved left margin so Rp labels never clip, Rp0 always shown, Indonesian axis formatting (Rp20,1 Jt), single-point centering with a Planned/Actual annotation and no fake trend line, and 12–13px labels','Appearance setting: Follow System (default), Dark, or Light — a professional light theme (off-white background, white cards, navy text, gold accent), applied before first paint, live-updating with the OS while on System, with charts redrawing on theme change','Branding: single-line "TAM Intelligence OS" over "PT TOTAL ASSET MANAJEMEN" in a slightly wider sidebar, collapsing to "TAM OS" on narrow screens','Diagnostics, Integrity Check, Data Portability, Backup/Restore and Reset now cover import batches; integrity detects payroll without employee, duplicate employees, duplicate payroll plans, contract conflicts, broken import links, rollback conflicts and invalid contract evidence — never auto-merging or auto-deleting']},
    {v:'2.3.1 — Execution Center Unscheduled Queue Fix', items:['Fixed a bucket-logic bug where a Planned transaction with no valid date counted toward Pending Execution but appeared in no tab (hidden from every view)','New Unscheduled tab lists Planned/Scheduled transactions that are not fully executed and have no valid scheduled or transaction date','Every pending transaction now belongs to exactly one bucket — priority Partial → Unscheduled → Today’s Planned → Upcoming → Overdue (Partial is never double-counted)','Pending Execution KPI now equals the exact sum of Unscheduled + Today’s Planned + Upcoming + Overdue + Partial','Free-text values such as "Per minggu", "Akhir bulan", or "-" are no longer misread as calendar dates (they no longer mis-sort into Upcoming/Overdue)','Unscheduled rows show a "Missing schedule date" badge and a primary "Schedule" action; empty state reads "No unscheduled transactions."','All existing execution actions and calculations, and the v2.1.2 action-menu behaviour, are preserved']},
    {v:'2.3.0 — Clean Data & Payroll Overtime Engine', items:['Clean production release: no company transactions, employees, contracts, payroll, plans, recurring expenses, or backups are bundled — the file starts empty and you enter or import your own data','Data safety: existing browser data is never erased silently. A first-run choice (Keep / Export & Start Fresh / Cancel) appears when prior-version data is detected','Start Fresh (Settings → Data Reset & Onboarding) downloads a complete backup, requires typing DELETE ALL TAM DATA, clears only TAM keys, writes an audit record, and reloads clean','First-run onboarding checklist (dismissible, non-blocking) and actionable empty states on every page','Structured work schedules on employees and contracts (hours/day, days/week, weeks/month, effective date, notes) with precedence contract → employee → company default — no single global assumption','New Overtime module using the TAM Internal Overtime Calculation Method: Standard Hours = h/day × d/week × wk/month; Hourly Rate = Salary ÷ Standard Hours (full precision); Amount = Hours × Rate, rounding only the final payable','Verified examples: 6h/day, Rp3,500,000, 7.5h → Rp218,750; 8h/day → Rp164,062.50 → Rp164,063 (nearest rupiah). Each employee is calculated independently','Overtime records with Draft / Reviewed / Approved / Rejected / Committed to Payroll, full calculation snapshots, live preview, decimal hours, no negatives, duplicate, CSV export, and a bulk monthly worksheet','Payroll integration: approved overtime auto-fills the payroll Overtime field for the employee and month; committing flips it to Committed to Payroll, links overtime IDs, and prevents committing the same overtime twice','Transactions carry structured overtime links and show an Overtime Breakdown; the description format (name / contract / progress) is unchanged','Overtime settings (company schedule defaults, final rounding, method label, approval requirement, high-overtime warning), reports (Monthly Summary, by Employee/Contract, highest, pending review, payroll-with-overtime), and dashboard KPIs + alerts','New storage key tam_overtime_records_v1, schema v5 with a one-time backed-up migration; Data Portability, Complete Backup, restore validation, reset, diagnostics, and the integrity check all cover overtime','Optional Load Demo Data (clearly labelled DEMO) to try the workflow instantly. Method note: this follows the internal method configured in TAM — verify separately for statutory payroll compliance']},
    {v:'2.2.1 — Architecture Review & Stabilization', items:['Architecture audit across state, storage, rendering, events, and business logic — no working behavior or workflow changed, no storage keys renamed, no data reset','New System Diagnostics panel in Settings: app/schema version, storage mode & persistence status, record counts, last successful save, last migration, and data-integrity status','New Run Integrity Check: detects broken employee/contract/payroll links, duplicate IDs, duplicate payroll rows, overlapping contracts, orphan transactions, invalid dates, negative/invalid amounts, and corrupt monthly-plan references — reported by severity (Info/Warning/Critical) and never auto-deleted','Reusable validators for employees, contracts, payroll plans, recurring expenses, monthly plans, transactions, imported rows, and backup JSON — shared by the integrity checker and available to forms/imports/restore','Centralized user notifications (showSuccess / showWarning / showError / confirmAction): technical detail goes to console, readable messages to the user, no silent failures','Unified StorageAdapter write path records the last successful save; added a saveAllData() persistence coordinator','One-time, non-destructive normalization migration fills any missing id / createdAt / updatedAt on every entity (relationships already use IDs) — a safety backup is taken only if anything is changed; existing values and amounts are never touched','Accessibility: Escape closes any modal, focus moves into the dialog on open and returns to the opener on close, and dialogs are marked role="dialog" aria-modal','Preserved the v2.1.2 action-menu binding fix and all v2.2.0 People & Contracts functionality','Script reorganized into clearly labeled sections with a top-of-file map; the deliverable remains a single HTML file']},
    {v:'2.2.0 — Employee, Contract & Monthly Planning Engine', items:['New People & Contracts module: Employees, Contracts, Payroll Planning, and Monthly Plan Generator — monthly finance plans are now generated inside the app, not from Excel','Employee master data: full CRUD, search/filter, CSV export, deactivate/reactivate, and delete protection when payroll or transactions are linked','Contract management with automatic calendar-month progress (e.g. 8/12) calculated from start date + duration — never entered manually; before start 0/N, after end N/N and Expired','Contract detail with progress bar, linked payroll plans, linked transactions, history, and renewal (old → Renewed, new → Active/Draft, history preserved)','Contract alerts: expiring within 90/60/30 days, expired, no active contract, overlapping contracts','Payroll Planning: generate editable rows for eligible active employees from their covering contract; exclusion warnings; Existing/Changed/New/Skipped duplicate detection','Commit Payroll to Monthly Plan creates Planned Gaji transactions with structured links (employeeId, contractId, payrollPlanId) — appearing in Transactions, Execution Center, Finance Overview, Planned vs Actual, Trends and Reports; never executed automatically','Recurring expense templates (Monthly/Quarterly/Semiannual/Annual) fed into the Monthly Plan Generator','Monthly Plan Generator combining payroll, recurring expenses and copied manual items, with a review preview (totals, duplicates, missing/zero warnings), Draft → Reviewed → Committed status, and Copy Previous Month (actuals never copied; status stays Planned)','Transaction detail shows employee, contract number, contract progress, payroll plan, and source, with navigation to employee/contract/payroll detail','Legacy Payroll Mapping tool to conservatively link historical Gaji transactions to employees and contracts — high-confidence matching, manual confirmation, descriptions preserved, no contracts auto-created','New reports: Employee List, Active/Expiring Contracts, Monthly Payroll Plan, Payroll by Employee/Contract, Contract Cost Summary, Monthly Plan Summary (CSV export)','New storage keys (employees, contracts, payroll plans, recurring expenses, monthly plans) with schema v4 and a one-time safe migration + pre-migration backup — existing transactions and settings are never modified','Dashboard integration: Active Employees, Active Contracts, Contracts Expiring Soon, Payroll Planned, Monthly Plan Status, and payroll/plan alerts; Excel import, backup/restore, and standalone persistence remain fully functional']},
    {v:'2.1.2 — Execution Workflow UX & Action Binding Fix', items:['Transactions is now the financial ledger: browse, search, filter, review, and export — its Actions menu offers only View Detail / History, Edit, and Delete','All operational payment actions (Execute, Schedule, Partial execution, Complete, Cancel, Archive, Duplicate) now live exclusively in the Execution Center','New "Open Execution Center" button and helper text on the Transactions page; navigation preserves the sidebar scroll position','Fixed: Execution Center action menus were double-bound after switching tabs — menus closed instantly and actions could fire twice','Fixed: the same double-binding on the Transactions page after changing any filter or typing in search','Fixed: action menus stopped closing on outside clicks after the first use; the dropdown also now closes when an action is chosen','Transaction history, status, and actual amounts remain fully visible on Transactions; all filters, exports, data, and calculations unchanged']},
    {v:'2.1.1 — Standalone Persistence & Portability', items:['New StorageAdapter: automatically uses Claude Artifact storage when available, otherwise browser localStorage','The application now persists data when opened directly as a standalone HTML file in any modern browser','Load priority on startup: Claude Artifact storage → browser localStorage → built-in seed data (no duplication, no overwriting)','Corrupt stored data is detected, reported, and preserved under a recovery key instead of failing silently','Storage quota and write failures now show clear error notifications','New Data Portability section in Settings: export and restore a Complete Backup (transactions + settings + backups) as JSON','Validation and a full preview (transaction, settings, backup counts, schema version) before any restore','Automatic pre-restore safety backup of current data','Storage Mode and Persistence Status shown in Settings and About','Versioned file naming (tam-intelligence-os-v2.1.1.html) and versioned export/download filenames']},
    {v:'2.1 — Finance Execution Engine', items:['Full transaction lifecycle: Planned → Scheduled → Partial → Completed, plus Cancelled and Archived','Execute modal with actual amount, payment method, bank, reference, and notes','Per-row Actions menu: Execute, Schedule, Edit, Duplicate, Cancel, Archive, Delete','New Execution Center with Today / Upcoming / Overdue / Partial / Completed Today / Recent views','Transaction detail with execution timeline and full history log','Execution KPI cards on Finance Overview (Executed, Remaining, Execution Rate, status counts)','Execution-aware executive alerts (large payments, high variance, cancelled payroll, overdue, partials)','Status, method, and bank filters plus reference/notes search on Transactions','Execution defaults in Settings (payment method, bank, auto-archive, auto-complete)','Automatic one-time migration of existing data with pre-migration backup']},
    {v:'2.0', items:['TAM Intelligence OS branding','Modular navigation','Executive Dashboard','Finance Overview','Cash Flow foundation','Budget Center foundation','Executive Insights','Settings and release information']},
    {v:'1.2', items:['Monthly Trends','Native SVG charts','Chart interactions']},
    {v:'1.1', items:['Improved import workflow','Duplicate handling','Update Existing Month','Backup and restore']},
    {v:'1.0', items:['Finance core','Excel import','Transactions','Planned vs Actual','Reports']},
  ];
  main.innerHTML = `
    <div class="page-head"><div><h1>Release Notes</h1></div></div>
    ${notes.map(n=>`<div class="card stack-section">
      <h3>Version ${n.v}</h3>
      <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.9;color:var(--text-dim);">${n.items.map(i=>`<li>${escapeHtml(i)}</li>`).join('')}</ul>
    </div>`).join('')}
  `;
}
