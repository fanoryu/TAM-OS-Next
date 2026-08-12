
/* ============================================================
   STORAGE ADAPTER (v2.1.1) — single persistence gateway.
   Priority: Claude Artifact storage (window.storage) when the
   host provides it; otherwise browser localStorage. The rest of
   the app must ONLY call StorageAdapter.get / .set / .remove —
   never window.storage or localStorage directly.
   get() returns {value: string} or null, matching the previous
   window.storage.get call-site shape.
   ============================================================ */
const StorageAdapter = {
  mode: (typeof window!=='undefined' && window.storage && typeof window.storage.get==='function' && typeof window.storage.set==='function') ? 'claude' : 'local',
  status: 'unknown', // 'active' | 'unavailable' | 'error' | 'unknown'
  lastError: null,
  modeLabel(){ return this.mode==='claude' ? 'Claude Artifact Storage' : 'Browser Local Storage'; },
  statusLabel(){ return this.status==='active' ? 'Active' : this.status==='unavailable' ? 'Unavailable' : this.status==='error' ? 'Error' : 'Unknown'; },
  _fail(e){
    this.status = 'error';
    this.lastError = e && (e.message || String(e));
    console.error('StorageAdapter error', e);
  },
  _isQuotaError(e){
    return !!e && (e.name==='QuotaExceededError' || e.name==='NS_ERROR_DOM_QUOTA_REACHED' || e.code===22 || e.code===1014);
  },
  _localGet(key){
    try{
      const v = window.localStorage.getItem(key);
      return v===null ? null : {value: v};
    }catch(e){ this._fail(e); return null; }
  },
  _localSet(key, value){
    try{
      window.localStorage.setItem(key, value);
      return true;
    }catch(e){
      this._fail(e);
      if(this._isQuotaError(e)){
        toast('Browser storage quota exceeded — data was NOT saved. Export a Complete Backup from Settings, then clear old data.', 8000);
      }else{
        toast('Could not save to browser storage — your changes may not persist.', 6000);
      }
      return false;
    }
  },
  async get(key){
    if(this.mode==='claude'){
      try{
        const res = await window.storage.get(key, false);
        if(res && res.value!==null && res.value!==undefined && res.value!=='') return res;
      }catch(e){ console.warn('Claude storage read failed for '+key+', trying localStorage fallback.', e); }
      // Claude storage has nothing for this key — fall back to any data a
      // standalone session left in localStorage (read-only migration path).
      return this._localGet(key);
    }
    return this._localGet(key);
  },
  async set(key, value){
    // Unified write path (v2.2.1): both storage modes flow through one place so
    // success/failure is surfaced consistently and the last-successful-save
    // timestamp used by System Diagnostics is recorded in exactly one spot.
    let ok;
    if(this.mode==='claude'){
      try{ await window.storage.set(key, value, false); ok = true; }
      catch(e){ this._fail(e); toast('Could not save to Claude storage — your changes may not persist.', 6000); ok = false; }
    } else {
      ok = this._localSet(key, value);
    }
    if(ok && typeof State!=='undefined' && State){ State.lastSaveAt = Date.now(); }
    return ok;
  },
  async remove(key){
    let ok = true;
    if(this.mode==='claude'){
      try{
        if(typeof window.storage.delete==='function'){ await window.storage.delete(key, false); }
        else { await window.storage.set(key, '', false); }
      }catch(e){ this._fail(e); ok = false; }
    }
    try{ window.localStorage.removeItem(key); }catch(e){ /* localStorage may be unavailable; claude removal above already handled */ }
    return ok;
  },
  // Round-trip probe: writes, reads back, and removes a throwaway key to
  // establish whether persistence actually works in this environment.
  async selfTest(){
    const probe = 'tam_storage_probe';
    try{
      const token = 'ok_' + Date.now();
      const wrote = await this.set(probe, token);
      const back = await this.get(probe);
      await this.remove(probe);
      if(wrote && back && back.value===token){ this.status = 'active'; }
      else if(this.status!=='error'){ this.status = 'unavailable'; }
    }catch(e){ this._fail(e); }
    return this.status;
  },
};

// Parse persisted JSON defensively. On corruption: notify the user, preserve
// the raw corrupt payload under a recovery key (never silently discarded),
// and return null so the caller can fall back to safe defaults.
function safeParse(raw, label){
  try{ return JSON.parse(raw); }
  catch(e){
    console.error('Corrupt stored JSON for "'+label+'"', e);
    try{ window.localStorage.setItem('tam_corrupt_'+label+'_'+Date.now(), raw); }catch(_e){}
    toast('Stored '+label+' data was corrupted and could not be read. Falling back to defaults — a copy of the corrupt data was preserved for recovery.', 8000);
    return null;
  }
}