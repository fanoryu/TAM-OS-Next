
async function loadState(){
  await StorageAdapter.selfTest();
  try{
    // Load priority: Claude Artifact storage → browser localStorage → seed
    // data. StorageAdapter.get already implements the claude→local fallback,
    // so stored user data is never overwritten and seed is loaded exactly once.
    // v2.3.0 clean build: no data is bundled. A returning user's stored data is
    // loaded and never erased; a genuinely fresh browser starts empty (0 records).
    const res = await StorageAdapter.get('tam_txns_v1');
    let loaded = (res && res.value) ? safeParse(res.value, 'transactions') : null;
    if(Array.isArray(loaded)){
      State.txns = loaded;
      // v2.5.2 — an EMPTY stored array is not "existing data". _hadStoredData is
      // computed from meaningful business datasets below (see hasMeaningfulBusinessData).
    } else {
      State.txns = [];        // clean empty state — the seed element is intentionally []
      await persist();
    }
  }catch(e){
    console.error('loadState error', e);
    State.txns = [];
  }
  await loadSettings();
  await loadBackups();
  await loadHRData();
  await migrateToExecutionSchema();
  await migrateToHRSchema();
  await migrateNormalizeEntities();
  await migrateToOvertimeSchema();
  await migrateToPayrollOpsSchema();
  await migrateToDedupSchema();
  await migrateSeedCompanyAccounts();
  // v2.7.2 — repair any pre-2.7.2 failed-post orphan supplementals (Posted but linked
  // transaction never persisted). Conservative, idempotent, non-destructive; see the engine.
  if(typeof recoverSupplementalOrphans==='function') await recoverSupplementalOrphans();
  // v2.5.2 — treat the app as carrying data ONLY when a meaningful business
  // dataset has real records. Empty arrays, settings, migration flags, schema
  // version, empty backups/audits and UI prefs never count (fresh-install fix).
  State._hadStoredData = hasMeaningfulBusinessData();
  const months = getMonths();
  if(months.length){ State.selectedMonth = months[months.length-1].key; }
  State.view = ['execDashboard','financeOverview','transactions','add','planvsactual','compare','trends','executioncenter'].includes(State.settings.defaultLandingPage) ? State.settings.defaultLandingPage : 'execDashboard';
  if(State.settings.defaultTrendRange) State.trendsFilter.range = State.settings.defaultTrendRange;
  State.storageReady = true;
}

// One-time migration to the v2.1 execution schema. Runs at most once (guarded
// by a persisted flag). Backs up the pre-migration transaction set first, then
// assigns every transaction a lifecycle status derived from its existing
// amounts — so old records with recorded actuals become Completed/Partial and
// records with no actual become Planned. No data is invented or discarded.
async function migrateToExecutionSchema(){
  try{
    const flagRes = await StorageAdapter.get('tam_migrated_exec_v21');
    if(flagRes && flagRes.value==='done') {
      // Still ensure any transaction lacking a status gets one (defensive, no-op for migrated data).
      let touched=false;
      State.txns.forEach(t=>{ if(!t.status){ t.status = computeStatus(t); t.history = t.history||[{event:'created', ts:t._importedAt||null}]; touched=true; } });
      if(touched) await persist();
      return;
    }
    // pre-migration backup (skip on a clean/empty install so a fresh file keeps 0 backups)
    if(State.txns.length){
      State.backups.unshift({
        id: uid('backup'), monthKey:'__all__', monthLabel:'Pre-2.1 migration (all months)',
        timestamp: new Date().toISOString(), txns: JSON.parse(JSON.stringify(State.txns)), migration:true,
      });
      await saveBackups();
    }
    // assign lifecycle fields
    const nowIso = new Date().toISOString();
    State.txns.forEach(t=>{
      if(!t.status) t.status = computeStatus(t);
      if(!t.history){
        const hist = [{event:'created', ts:null, note:'Imported / created before execution tracking'}];
        if(t.actual!==null && t.actual!==undefined){
          hist.push({event:'executed', ts:null, note:'Actual recorded from source data', amount:t.actual});
        }
        t.history = hist;
      }
      if(t.execution===undefined) t.execution = (t.actual!==null && t.actual!==undefined)
        ? {executionDate:t.txnDate||null, actualAmount:t.actual, method:null, bank:null, reference:null, notes:'Migrated from realization data', executedBy:'—', executionId:uid('exec'), ts:nowIso}
        : null;
    });
    await persist();
    await StorageAdapter.set('tam_migrated_exec_v21', 'done');
    toast('Data upgraded to Finance Execution Engine (v2.1).');
  }catch(e){
    console.error('migration error', e);
  }
}
async function loadSettings(){
  try{
    const res = await StorageAdapter.get('tam_settings_v1');
    const parsed = (res && res.value) ? safeParse(res.value, 'settings') : null;
    if(parsed && typeof parsed==='object' && !Array.isArray(parsed)){
      // Existing settings found — merge onto defaults so new fields always have safe values (no destructive overwrite of user values).
      State.settings = {...DEFAULT_SETTINGS, ...parsed, schemaVersion: SCHEMA_VERSION};
    } else {
      // First run on this browser under the v2 schema — safe defaults, no data invented.
      State.settings = {...DEFAULT_SETTINGS};
      await saveSettings();
    }
  }catch(e){
    State.settings = {...DEFAULT_SETTINGS};
  }
}
async function saveSettings(){
  // StorageAdapter.set reports failures (toast + status) itself — no silent failures.
  const ok = await StorageAdapter.set('tam_settings_v1', JSON.stringify(State.settings));
  if(!ok) console.error('saveSettings: settings were not persisted');
  return ok === true;
}

async function persist(){
  const ok = await StorageAdapter.set('tam_txns_v1', JSON.stringify(State.txns));
  if(!ok) console.error('persist: transactions were not persisted');
  return ok === true;
}
