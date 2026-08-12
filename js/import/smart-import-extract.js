/* ============================================================
   SMART IMPORT & MASTER DATA SYNC ENGINE (v2.4.0, Parts 1-12)
   Extracts employees / contracts / payroll from a payroll workbook,
   matches them against master data, lets the user review conflicts,
   then commits with structured IDs, an audit batch, and undo.
   Nothing is written to storage during parsing/review — only on Commit.
   ============================================================ */

/* ---------- extraction (Parts 3, 4) ---------- */
function parseProgressText(text){
  const m = /(?:^|[^\d])(\d{1,2})\s*\/\s*(\d{1,2})(?:[^\d]|$)/.exec(String(text||''));
  if(m){ const cur=+m[1], tot=+m[2]; if(tot>=1 && tot<=60 && cur>=0 && cur<=tot) return {current:cur, total:tot}; }
  return null;
}
function parseContractNumber(text){
  const m = /(\d+\s*\/\s*[A-Za-z0-9.\-]+\s*\/\s*[IVXLCDM]+\s*\/\s*\d{4})/.exec(String(text||''));
  return m ? m[1].replace(/\s+/g,'') : null;
}
// Roman month/year embedded in a contract number (e.g. XI/2025) — supporting evidence only.
function contractNumberMonthYear(cn){
  const m = /\/([IVXLCDM]+)\/(\d{4})\s*$/.exec(cn||'');
  if(!m) return null;
  const rom={I:1,II:2,III:3,IV:4,V:5,VI:6,VII:7,VIII:8,IX:9,X:10,XI:11,XII:12};
  const mn = rom[m[1].toUpperCase()]; if(!mn) return null;
  return {monthNum:mn, year:+m[2]};
}
function parseRpValue(text){
  const m = /Rp\s*([\d.,]+)/i.exec(String(text||''));
  if(!m) return null;
  const v = Number(m[1].replace(/[.,]/g,''));
  return isFinite(v) ? v : null;
}
function extractEmployeeName(text){
  const lines = String(text||'').split(/[\n\r]+/).map(s=>s.trim()).filter(Boolean);
  for(const ln of lines){
    if(parseContractNumberFlexible(ln) || looksLikeContractNumber(ln)) continue;  // v2.5.1 flexible
    if(/^\d{1,2}(?:[.,]\d)?\s*\/\s*\d{1,2}$/.test(ln)) continue;                    // bare progress
    if(/^rp\b|^\d[\d.,]*$/i.test(ln)) continue;
    if(/^bulan\b/i.test(ln)) continue;                                             // "bulan Juni" note
    return ln;
  }
  return (lines[0]||'').trim();
}
// Infer the proposed contract start: Payroll Month − (current − 1), first of month.
// v2.5.1 — current may be fractional (e.g. 8,5/12); round to the nearest whole month.
function inferContractStart(monthKey, current){
  if(current==null || current<1) return null;
  const cur = Math.round(current);
  const abs = keyAbs(monthKey) - (cur-1);
  const y = Math.floor(abs/12), m = (abs%12)+1;
  return mkKey(y,m)+'-01';
}
// Extract payroll rows from the parsed workbook's salary (Gaji / code A) items.
function smartExtractRows(rawBatches){
  const rows = [];
  (rawBatches||[]).forEach(batch=>{
    (batch.categories||[]).forEach(cat=>{
      const isGaji = cat.code==='A' || /gaji|salary|payroll/i.test(cat.name||'');
      if(!isGaji) return;
      (cat.items||[]).forEach(it=>{
        const text = it.uraian || '';
        // v2.5.1 — full evidence text = name cell + sub-rows (letterdoc) for regex fallback.
        const evidence = [text, ...((it.subLines||[]))].filter(Boolean).join('\n');
        const planned = it.jumlahRencana||0;
        const actual = (it.jumlahRealisasi===undefined) ? null : it.jumlahRealisasi;
        // Prefer structured fields carried from the parser; fall back to regex on the evidence text.
        const hasStructProgress = (it.progressCurrent!=null || it.progressTotal!=null);
        const prog = hasStructProgress ? {current:it.progressCurrent, total:it.progressTotal} : parseProgressFlexible(evidence);
        const employeeName = (it.employeeName && String(it.employeeName).trim()) || extractEmployeeName(evidence);
        const contractNumber = (it.contractNumber && String(it.contractNumber).trim()) || parseContractNumberFlexible(evidence);
        const salary = (it.salary!=null && it.salary!=='') ? Number(it.salary)||0 : (planned || parseRpValue(evidence) || 0);
        rows.push({
          importRowId: uid('irow'), monthKey: batch.key, month: batch.monthName, year: batch.year, monthNum: batch.monthNum,
          rawText: text, evidenceText: evidence, subLines: it.subLines||[], originalPlanned: planned, originalActual: actual,
          employeeName, contractNumber,
          progressCurrent: prog?prog.current:null, progressTotal: prog?prog.total:null,
          progressRaw: prog ? (prog.current+'/'+prog.total) : null,
          salary, planned, actual, overtime:0, allowance:0, deduction:0,
          workingHoursPerDay: it.workingHoursPerDay!=null?it.workingHoursPerDay:null,
          workingDaysPerWeek: it.workingDaysPerWeek!=null?it.workingDaysPerWeek:null,
          overtimeHours: it.overtimeHours!=null?it.overtimeHours:null,
          // v2.5.2 — supporting identity evidence for cross-month employee grouping
          bankAccount: it.bankAccount||null, bankName: it.bankName||null, email: it.email||null,
        });
      });
    });
  });
  return rows;
}

/* ---------- matching (Parts 5, 6) ---------- */
function smartMatchEmployee(row){
  const nn = normStr(row.employeeName);
  if(!nn) return {status:'No Match', employee:null, confidence:0};
  const exact = State.employees.find(e=>normStr(e.fullName)===nn);
  if(exact) return {status:'Exact', employee:exact, confidence:1};
  let best=null, score=0;
  State.employees.forEach(e=>{ const s=similarText(e.fullName, row.employeeName); if(s>score){ score=s; best=e; } });
  if(best && score>=0.9) return {status:'High Confidence', employee:best, confidence:score};
  if(best && score>=0.72) return {status:'Needs Review', employee:best, confidence:score};
  return {status:'No Match', employee:null, confidence:score};
}
function smartMatchContract(row, empMatch){
  const emp = empMatch.employee;
  // Start inference: progress relative to the payroll month is primary (most precise); the
  // contract number's own month/year is only supporting evidence used when progress is absent.
  const cnMY = row.contractNumber ? contractNumberMonthYearFlex(row.contractNumber) : null;
  const startFromCN = cnMY ? (mkKey(cnMY.year, cnMY.monthNum)+'-01') : null;
  const startFromProgress = inferContractStart(row.monthKey, row.progressCurrent);
  const inferredStart = startFromProgress || startFromCN;
  if(row.contractNumber){
    const byNum = State.contracts.find(c=>normStr(c.contractNumber)===normStr(row.contractNumber));
    if(byNum){
      // Conflicts are only raised against EXISTING master data — never overwritten automatically.
      const conflicts=[];
      if(row.progressTotal && byNum.durationMonths && +byNum.durationMonths!==row.progressTotal) conflicts.push({field:'Duration', existing:byNum.durationMonths, imported:row.progressTotal});
      if(startFromProgress && byNum.startDate && byNum.startDate.slice(0,7)!==startFromProgress.slice(0,7)) conflicts.push({field:'Start', existing:byNum.startDate, imported:startFromProgress});
      if(row.salary && byNum.monthlySalary && Math.abs(byNum.monthlySalary-row.salary)>1) conflicts.push({field:'Salary', existing:byNum.monthlySalary, imported:row.salary});
      return {status: conflicts.length?'Conflict':'Existing', contract:byNum, conflicts, inferredStart};
    }
  }
  if(emp && row.progressTotal && startFromProgress){
    const match = State.contracts.find(c=>c.employeeId===emp.id && +c.durationMonths===row.progressTotal && c.startDate && c.startDate.slice(0,7)===startFromProgress.slice(0,7));
    if(match) return {status:'Existing', contract:match, conflicts:[], inferredStart};
  }
  // v2.5.1 — no contract number AND no progress: infer a default contract from the payroll month
  // instead of blocking. Still flagged (missingInfo) so it is reviewed, not silently guessed.
  if(!row.contractNumber && row.progressTotal==null){
    return {status:'New', contract:null, conflicts:[], inferredStart:(row.monthKey+'-01'), missingInfo:true};
  }
  return {status:'New', contract:null, conflicts:[], inferredStart};
}
