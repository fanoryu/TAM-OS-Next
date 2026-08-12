/* ============================================================
   PARSERS — mirror TAM's real Excel "Rencana Penggunaan Dana"
   letter-document structure (category A/B/C rows, SubJumlah,
   Total rows) plus a generic tabular CSV fallback.
   ============================================================ */

function excelDateToISO(v){
  if(v instanceof Date && !isNaN(v)) return v.toISOString().slice(0,10);
  if(typeof v === 'number'){
    const d = XLSX.SSF.parse_date_code(v);
    if(d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  if(typeof v === 'string'){
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(m) return m[0];
  }
  return null;
}

/* ---------- Structured payroll field parsers (v2.5.1) ----------
   The real TAM "Rencana Penggunaan Dana" stores each employee as a
   vertically-merged block in column B: name (main row), then a
   contract-number sub-row, then a progress sub-row (e.g. 8/12). Other
   workbooks may instead use dedicated columns (Nama, No Kontrak,
   Progress, Gaji …). These helpers recognize BOTH shapes and are used
   by parseLetterDocSheet, parseGenericTable, and Smart Import. */

// Accepts 8/12, 8 / 12, 8,5/12, "Month 8 of 12", "8 of 12", "bulan ke-8 dari 12".
// Returns {current, total} (current may be fractional) or null.
function parseProgressFlexible(text){
  const s = String(text==null?'':text).trim();
  if(!s) return null;
  // English / Indonesian phrasing "8 of 12" / "8 dari 12" / "bulan ke 8 dari 12"
  let m = /(\d{1,2}(?:[.,]\d)?)\s*(?:of|dari|from)\s*(\d{1,2})/i.exec(s);
  if(!m) m = /(?:^|[^\d])(\d{1,2}(?:[.,]\d)?)\s*\/\s*(\d{1,2})(?:[^\d]|$)/.exec(s);
  if(!m) return null;
  const cur = parseFloat(String(m[1]).replace(',','.'));
  const tot = parseInt(m[2],10);
  if(!(tot>=1 && tot<=60)) return null;           // duration sanity
  if(!(cur>=0 && cur<=tot+0.5)) return null;       // progress sanity
  return {current:cur, total:tot};
}

// True when a string looks like a TAM contract number (multi-segment id ending in a 4-digit year).
function looksLikeContractNumber(text){
  const s = String(text==null?'':text).trim();
  if(!s || /@/.test(s)) return false;              // emails are not contract numbers
  if(parseProgressFlexible(s) && /^\s*\d{1,2}(?:[.,]\d)?\s*\/\s*\d{1,2}\s*$/.test(s)) return false; // bare progress
  const slashParts = s.split(/[\/.]/).filter(Boolean);
  return /\b(19|20)\d{2}\b/.test(s) && (s.match(/\//g)||[]).length>=2 && slashParts.length>=3 && /[A-Za-z]/.test(s);
}

// Extract a normalized contract-number token. Permissive: arabic OR roman month
// segment, 3–6 segments, "/" or "." separators. Returns string or null.
function parseContractNumberFlexible(text){
  const s = String(text==null?'':text).trim();
  if(!s) return null;
  // Prefer the original strict TAM pattern (num/alnum/ROMAN/year) when present.
  let m = /(\d+\s*\/\s*[A-Za-z0-9.\-]+\s*\/\s*[IVXLCDM]+\s*\/\s*\d{4})/.exec(s);
  if(m) return m[1].replace(/\s+/g,'');
  // Otherwise accept a broader multi-segment id that ends in a 4-digit year.
  m = /(\d[A-Za-z0-9.\-]*(?:\s*[\/.]\s*[A-Za-z0-9.\-]+){1,4}\s*[\/.]\s*(?:19|20)\d{2})/.exec(s);
  if(m && looksLikeContractNumber(m[1])) return m[1].replace(/\s+/g,'');
  return null;
}

// Roman OR arabic month + year embedded at the tail of a contract number — supporting evidence only.
function contractNumberMonthYearFlex(cn){
  const s = String(cn||'');
  let m = /[\/.]([IVXLCDM]+)[\/.](\d{4})\s*$/i.exec(s);
  if(m){
    const rom={I:1,II:2,III:3,IV:4,V:5,VI:6,VII:7,VIII:8,IX:9,X:10,XI:11,XII:12};
    const mn=rom[m[1].toUpperCase()]; if(mn) return {monthNum:mn, year:+m[2]};
  }
  m = /[\/.](\d{1,2})[\/.](\d{4})\s*$/.exec(s);
  if(m){ const mn=+m[1]; if(mn>=1 && mn<=12) return {monthNum:mn, year:+m[2]}; }
  return null;
}

// From an employee item's collected text lines, derive structured payroll fields.
// lines = [nameCell, ...subLineCells]. Returns {employeeName, contractNumber, progressCurrent, progressTotal}.
function deriveBlockPayrollFields(lines){
  // Flatten embedded newlines so BOTH the sub-row block layout and the legacy
  // single multi-line "Name / Contract / 8/12" cell are handled.
  const clean = (lines||[]).flatMap(x=>String(x==null?'':x).split(/[\n\r]+/)).map(s=>s.trim()).filter(Boolean);
  let employeeName=null, contractNumber=null, progress=null;
  for(const ln of clean){
    if(!contractNumber){ const cn=parseContractNumberFlexible(ln); if(cn){ contractNumber=cn; continue; } }
    if(!progress){ const pg=parseProgressFlexible(ln); if(pg && /\d\s*(?:\/|of|dari)\s*\d/i.test(ln)){ progress=pg; continue; } }
    if(!employeeName && !looksLikeContractNumber(ln) && !parseContractNumberFlexible(ln) && !(parseProgressFlexible(ln)&&/^\s*\d/.test(ln)) && !/^rp\b|^\d[\d.,]*$/i.test(ln)) employeeName=ln;
  }
  if(!employeeName && clean.length) employeeName = clean[0];
  return {employeeName, contractNumber, progressCurrent: progress?progress.current:null, progressTotal: progress?progress.total:null};
}

function parseLetterDocSheet(rows, sheetName, isRealisasi){
  // find header row: col0==='No' and col1 startsWith 'Uraian'
  let headerIdx = -1;
  for(let i=0;i<rows.length;i++){
    const r = rows[i];
    if(r && String(r[0]||'').trim()==='No' && String(r[1]||'').trim().toLowerCase().startsWith('uraian')){
      headerIdx = i; break;
    }
  }
  if(headerIdx===-1) return null;

  const categories = [];
  let curCat = null;
  let curItem = null;   // v2.5.1 — last numbered item, so sub-rows can attach to it
  let extraCtr = 0;
  const dateVotes = {};

  for(let i=headerIdx+1;i<rows.length;i++){
    const r = rows[i] || [];
    const no = r[0], uraian = r[1], vol = r[2], satuan = r[3], harga = r[4], jumlah = r[5], rencanaTgl = r[6];
    const col7 = r[7]; // Pendukung/Link (plan) or Jumlah Realisasi (realisasi)
    const col9 = r[9]; // Selisih (realisasi only)

    if(typeof no==='string' && KNOWN_CATEGORIES_CODE[no.trim()]){
      curCat = {code:no.trim(), name:KNOWN_CATEGORIES_CODE[no.trim()], items:[]};
      categories.push(curCat); curItem = null;
      continue;
    }
    if(typeof uraian==='string' && uraian.trim().toLowerCase().startsWith('subjumlah')){ curItem=null; continue; }
    if(typeof uraian==='string' && uraian.trim().toLowerCase().startsWith('total rencana')) break;
    if(typeof uraian==='string' && uraian.trim().toLowerCase().startsWith('saldo kas')) continue;
    if(typeof uraian==='string' && uraian.trim().toLowerCase().startsWith('rencana transfer')) continue;

    if(isRealisasi && (no===null||no===undefined||no==='') && typeof uraian==='string' && uraian.trim() && col7 && curCat){
      // orphan realized-only line
      extraCtr++;
      curCat.items.push({
        no:'extra_'+extraCtr, uraian:uraian.trim(), vol:vol||null, satuan:satuan||null, hargaSatuan:harga||null,
        jumlahRencana:null, jumlahRealisasi: Number(col7)||null, rencanaTransaksi:excelDateToISO(rencanaTgl)
      });
      continue;
    }

    if(typeof no==='number' && curCat && uraian){
      const item = {
        no, uraian:String(uraian).trim(), vol:vol||null, satuan:satuan||null, hargaSatuan: (typeof harga==='number'?harga:null),
        jumlahRencana: (typeof jumlah==='number'?jumlah:0),
        rencanaTransaksi: excelDateToISO(rencanaTgl),
        subLines: [],   // v2.5.1 — sub-row cells (contract number, progress, notes)
      };
      if(isRealisasi){
        item.jumlahRealisasi = (typeof col7==='number') ? col7 : null;
      } else {
        // v2.5.2 — plan sheet carries Bank / Nomor Rekening / Email (cols I/J/K) for employee matching
        const bank=r[8], acct=r[9], email=r[10];
        if(bank!=null && String(bank).trim()) item.bankName = String(bank).trim();
        if(acct!=null && String(acct).trim()) item.bankAccount = String(acct).trim();
        if(email!=null && /@/.test(String(email))) item.email = String(email).trim();
      }
      curCat.items.push(item);
      curItem = item;
      const iso = excelDateToISO(rencanaTgl);
      if(iso){ const y=iso.slice(0,4); dateVotes[y]=(dateVotes[y]||0)+1; }
      continue;
    }

    // v2.5.1 — sub-row of the current employee/item block: col A (No) is empty but
    // column B carries evidence (contract number, progress N/M, or a note). Attach
    // it to the current item instead of discarding it, so structured fields survive.
    if(curItem && (no===null||no===undefined||no==='') && typeof uraian==='string' && uraian.trim()){
      curItem.subLines.push(uraian.trim());
    }
  }
  if(!categories.some(c=>c.items.length)) return null;

  // v2.5.1 — derive structured payroll fields for Gaji items from the block's cells.
  categories.forEach(cat=>{
    const isGaji = cat.code==='A' || /gaji|salary|payroll/i.test(cat.name||'');
    cat.items.forEach(it=>{
      const derived = deriveBlockPayrollFields([it.uraian, ...(it.subLines||[])]);
      if(isGaji){
        it.employeeName   = derived.employeeName || it.uraian;
        it.contractNumber = derived.contractNumber || null;
        it.progressCurrent= derived.progressCurrent;
        it.progressTotal  = derived.progressTotal;
        it.salary         = (typeof it.hargaSatuan==='number' && it.hargaSatuan) ? it.hargaSatuan : (it.jumlahRencana||null);
      }
    });
  });

  // detect year from votes, else null (caller resolves)
  let year = null, best=0;
  Object.keys(dateVotes).forEach(y=>{ if(dateVotes[y]>best){best=dateVotes[y]; year=Number(y);} });

  return {categories, detectedYear: year};
}
const KNOWN_CATEGORIES_CODE = {'A':'Gaji','B':'Operasional Rutin','C':'Operasional Kegiatan'};

function sheetToRows(ws){
  return XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:null, blankrows:true});
}

// v2.5.1 — recognized column synonyms, including dedicated structured payroll columns.
const GENERIC_COL_SYNONYMS = {
  month:['month','bulan'], category:['category','kategori'], uraian:['uraian','uraian kebutuhan','description','deskripsi','keterangan','item'],
  vol:['vol','volume','qty','quantity'], satuan:['satuan','unit'], harga:['harga satuan','unit price','harga'],
  planned:['jumlah','planned','rencana','budget','anggaran'], actual:['actual','realisasi','jumlah realisasi'],
  date:['tanggal','date','rencana transaksi'], type:['type','tipe','jenis'],
  // structured payroll columns (v2.5.1)
  employeeName:['nama','nama karyawan','employee','employee name','karyawan','nama pegawai'],
  contractNumber:['no kontrak','nomor kontrak','contract number','contract no','no. kontrak','kontrak'],
  contractProgress:['progress','progress kontrak','masa kontrak','contract progress','termin','progres'],
  salary:['gaji','salary','gaji bulanan','nominal','monthly salary','gaji pokok'],
  workingHoursPerDay:['jam kerja','jam kerja per hari','working hours','working hours per day','hours per day','jam kerja/hari'],
  workingDaysPerWeek:['hari kerja','hari kerja per minggu','working days','working days per week','days per week','hari kerja/minggu'],
  overtimeHours:['lembur','jam lembur','overtime','overtime hours','jam lembur per bulan'],
};
const GENERIC_MEANING_LABEL = {
  month:'Month', category:'Category', uraian:'Description', vol:'Volume', satuan:'Unit', harga:'Unit Price',
  planned:'Planned Amount', actual:'Actual Amount', date:'Transaction Date', type:'Type',
  employeeName:'Employee Name', contractNumber:'Contract Number', contractProgress:'Contract Progress',
  salary:'Salary', workingHoursPerDay:'Working Hours/Day', workingDaysPerWeek:'Working Days/Week', overtimeHours:'Overtime Hours',
};
// Populated on each parse so the Smart Import UI can show a Column Mapping page.
let LAST_COLUMN_MAPPING = null;

function parseGenericTable(rows){
  const wanted = GENERIC_COL_SYNONYMS;
  let headerIdx=-1, colMap={};
  for(let i=0;i<Math.min(rows.length,15);i++){
    const r = (rows[i]||[]).map(c=>normStr(c));
    let hits=0; const map={};
    Object.keys(wanted).forEach(key=>{
      const ci = r.findIndex(cell=>wanted[key].includes(cell));
      if(ci>-1 && map[key]===undefined){ map[key]=ci; hits++; }
    });
    if(hits>=3){ headerIdx=i; colMap=map; break; }
  }
  if(headerIdx===-1){ LAST_COLUMN_MAPPING=null; return null; }

  // Build a mapping report (Source Header / Detected Meaning / Sample Value / Confidence).
  const headerRow = rows[headerIdx]||[];
  const sampleRow = (function(){ for(let i=headerIdx+1;i<rows.length;i++){ if((rows[i]||[]).some(c=>c!==null&&c!==undefined&&String(c).trim())) return rows[i]; } return []; })();
  const recognized = [], unrecognized = [];
  headerRow.forEach((h,ci)=>{
    const hs = normStr(h); if(!hs) return;
    const meaning = Object.keys(colMap).find(k=>colMap[k]===ci);
    if(meaning){ recognized.push({header:String(h).trim(), meaning, meaningLabel:GENERIC_MEANING_LABEL[meaning]||meaning, sample:sampleRow[ci]!=null?String(sampleRow[ci]).trim():'', confidence:'High', colIndex:ci}); }
    else{ unrecognized.push({header:String(h).trim(), colIndex:ci, sample:sampleRow[ci]!=null?String(sampleRow[ci]).trim():''}); }
  });
  LAST_COLUMN_MAPPING = {source:'generic', headerIdx, colMap:Object.assign({},colMap), recognized, unrecognized};

  const items = buildGenericItems(rows, headerIdx, colMap);
  return items && items.length ? items : null;
}

// Extracted so a manual column-mapping override can rebuild items with a new colMap.
function buildGenericItems(rows, headerIdx, colMap){
  const items = [];
  const get = (r,key)=> colMap[key]!==undefined ? r[colMap[key]] : undefined;
  for(let i=headerIdx+1;i<rows.length;i++){
    const r = rows[i]; if(!r) continue;
    const employeeName = get(r,'employeeName');
    const uraianCell = get(r,'uraian');
    const desc = (uraianCell!=null && String(uraianCell).trim()) ? String(uraianCell).trim()
               : (employeeName!=null && String(employeeName).trim()) ? String(employeeName).trim() : null;
    if(!desc) continue;
    const salaryCell = get(r,'salary');
    const salary = (salaryCell!==undefined && salaryCell!==null && salaryCell!=='') ? Number(String(salaryCell).replace(/[.,\s]/g,''))||Number(salaryCell)||null : null;
    const plannedCell = get(r,'planned');
    const planned = (plannedCell!==undefined) ? (Number(plannedCell)||0) : (salary||0);
    const actualRaw = get(r,'actual');
    const prog = parseProgressFlexible(get(r,'contractProgress'));
    const cnCell = get(r,'contractNumber');
    items.push({
      month: get(r,'month')!==undefined ? get(r,'month') : null,
      category: get(r,'category')!==undefined ? (get(r,'category')||'Lainnya') : (salary!=null||employeeName!=null?'Gaji':'Lainnya'),
      uraian: desc,
      vol: get(r,'vol')!==undefined ? get(r,'vol') : null,
      satuan: get(r,'satuan')!==undefined ? get(r,'satuan') : null,
      hargaSatuan: get(r,'harga')!==undefined ? (Number(get(r,'harga'))||null) : (salary||null),
      jumlahRencana: planned,
      jumlahRealisasi: (actualRaw===null||actualRaw===undefined||actualRaw==='') ? null : Number(actualRaw)||0,
      rencanaTransaksi: get(r,'date')!==undefined ? excelDateToISO(get(r,'date')) : null,
      type: get(r,'type')!==undefined && normStr(get(r,'type')).startsWith('inc') ? 'income' : 'expense',
      // structured payroll fields (v2.5.1)
      employeeName: employeeName!=null && String(employeeName).trim() ? String(employeeName).trim() : null,
      contractNumber: cnCell!=null && String(cnCell).trim() ? (parseContractNumberFlexible(cnCell)||String(cnCell).trim()) : null,
      progressCurrent: prog?prog.current:null, progressTotal: prog?prog.total:null,
      salary,
      workingHoursPerDay: numOrNull(get(r,'workingHoursPerDay')),
      workingDaysPerWeek: numOrNull(get(r,'workingDaysPerWeek')),
      overtimeHours: numOrNull(get(r,'overtimeHours')),
      subLines: [],
    });
  }
  return items;
}
function numOrNull(v){ if(v===undefined||v===null||v==='') return null; const n=Number(String(v).replace(',','.')); return isFinite(n)?n:null; }

async function parseUploadedFile(file){
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, {type:'array', cellDates:true});
  const batches = []; // {monthName, monthNum, year, key, categories:[{name,items}], source:'letterdoc'|'generic'}
  const planSheets = {};
  const realSheets = {};

  wb.SheetNames.forEach(name=>{
    const trimmed = name.trim();
    if(/^realisasi\s+/i.test(trimmed)){
      const mn = trimmed.replace(/^realisasi\s+/i,'').trim();
      if(MONTH_NUM[mn]) realSheets[mn] = name;
    } else if(MONTH_NUM[trimmed]){
      planSheets[trimmed] = name;
    }
  });

  const monthNamesFound = new Set([...Object.keys(planSheets), ...Object.keys(realSheets)]);

  if(monthNamesFound.size){
    // v2.5.1 — letterdoc field-source map for the Column Mapping page (fields live in
    // column B row-blocks, not dedicated columns).
    LAST_COLUMN_MAPPING = {source:'letterdoc', recognized:[
      {header:'Uraian Kebutuhan (main row)', meaningLabel:'Employee Name', confidence:'High'},
      {header:'Uraian Kebutuhan (sub-row)', meaningLabel:'Contract Number', confidence:'Medium'},
      {header:'Uraian Kebutuhan (sub-row)', meaningLabel:'Contract Progress (N/M)', confidence:'Medium'},
      {header:'Harga Satuan / Jumlah', meaningLabel:'Salary', confidence:'High'},
      {header:'Rencana Transaksi', meaningLabel:'Transaction Date', confidence:'High'},
      {header:'Bank / Nomor Rekening / Email', meaningLabel:'Payment Details', confidence:'High'},
    ], unrecognized:[]};
    monthNamesFound.forEach(mn=>{
      const rowsPlan = planSheets[mn] ? sheetToRows(wb.Sheets[planSheets[mn]]) : null;
      const rowsReal = realSheets[mn] ? sheetToRows(wb.Sheets[realSheets[mn]]) : null;
      const planParsed = rowsPlan ? parseLetterDocSheet(rowsPlan, planSheets[mn], false) : null;
      const realParsed = rowsReal ? parseLetterDocSheet(rowsReal, realSheets[mn], true) : null;
      if(!planParsed && !realParsed) return;

      const year = (planParsed && planParsed.detectedYear) || (realParsed && realParsed.detectedYear) || new Date().getFullYear();
      const merged = {};
      (planParsed ? planParsed.categories : []).forEach(c=>{
        merged[c.code] = merged[c.code] || {code:c.code, name:c.name, planItems:{}, realItems:{}};
        c.items.forEach(it=>{ merged[c.code].planItems[it.no]=it; });
      });
      (realParsed ? realParsed.categories : []).forEach(c=>{
        merged[c.code] = merged[c.code] || {code:c.code, name:c.name, planItems:{}, realItems:{}};
        c.items.forEach(it=>{ merged[c.code].realItems[it.no]=it; });
      });
      const categories = Object.values(merged).map(c=>{
        const allNo = new Set([...Object.keys(c.planItems), ...Object.keys(c.realItems)]);
        const items = [...allNo].map(no=>{
          const p = c.planItems[no], a = c.realItems[no];
          const base = p||a;
          const struct = p||a; // prefer plan for structured fields, fall back to realisasi
          return {
            no, uraian: base.uraian, vol: base.vol, satuan: base.satuan, hargaSatuan: base.hargaSatuan,
            jumlahRencana: p ? (p.jumlahRencana||0) : 0,
            jumlahRealisasi: a ? a.jumlahRealisasi : null,
            rencanaTransaksi: (p && p.rencanaTransaksi) || (a && a.rencanaTransaksi) || null,
            unplanned: !p,
            // v2.5.1 — carry structured payroll fields through the plan/realisasi merge
            subLines: struct.subLines || [],
            employeeName: struct.employeeName, contractNumber: struct.contractNumber,
            progressCurrent: struct.progressCurrent, progressTotal: struct.progressTotal,
            salary: struct.salary,
            // v2.5.2 — carry bank/email evidence (plan sheet only) for employee matching
            bankName: (p&&p.bankName)||(a&&a.bankName)||null, bankAccount: (p&&p.bankAccount)||(a&&a.bankAccount)||null, email: (p&&p.email)||(a&&a.email)||null,
          };
        });
        return {name:c.name, code:c.code, items};
      });
      batches.push({monthName:mn, monthNum:MONTH_NUM[mn], year, key:`${year}-${String(MONTH_NUM[mn]).padStart(2,'0')}`, categories, source:'letterdoc'});
    });
  } else {
    // try generic tabular parse on first non-empty sheet
    for(const name of wb.SheetNames){
      const rows = sheetToRows(wb.Sheets[name]);
      const items = parseGenericTable(rows);
      if(items){
        // v2.5.1 — stash raw rows so the Column Mapping page can re-parse on manual override
        if(LAST_COLUMN_MAPPING){ LAST_COLUMN_MAPPING.rows = rows; LAST_COLUMN_MAPPING.sheetName = name; }
        groupGenericBatches(items).forEach(g=>batches.push(g));
        break;
      }
    }
  }
  return batches;
}

// v2.5.1 — group generic-table items into month batches (extracted so a manual
// column-mapping override can rebuild batches without re-reading the file).
function groupGenericBatches(items){
  const groups = {};
  (items||[]).forEach(it=>{
    let mn = it.month, year=null, mnum=null;
    if(mn){
      const s = String(mn).trim();
      if(MONTH_NUM[s]){ mnum=MONTH_NUM[s]; year=new Date().getFullYear(); mn=s; }
      else{ const d = new Date(s); if(!isNaN(d)){ mnum=d.getMonth()+1; year=d.getFullYear(); mn=NUM_MONTH[mnum]; } }
    }
    if(!mnum && it.rencanaTransaksi){ const d=new Date(it.rencanaTransaksi); if(!isNaN(d)){ mnum=d.getMonth()+1; year=d.getFullYear(); mn=NUM_MONTH[mnum]; } }
    const key = mnum ? `${year}-${String(mnum).padStart(2,'0')}` : 'unknown';
    if(!groups[key]) groups[key] = {monthName:mn||'Unknown', monthNum:mnum, year, key, categories:{}, source:'generic'};
    const catName = it.category || 'Lainnya';
    if(!groups[key].categories[catName]) groups[key].categories[catName] = {name:catName, code:catName[0]||'X', items:[]};
    groups[key].categories[catName].items.push({
      no: groups[key].categories[catName].items.length+1, uraian:it.uraian, vol:it.vol, satuan:it.satuan,
      hargaSatuan:it.hargaSatuan, jumlahRencana:it.jumlahRencana, jumlahRealisasi:it.jumlahRealisasi,
      rencanaTransaksi:it.rencanaTransaksi, unplanned:false, type: it.type,
      employeeName: it.employeeName, contractNumber: it.contractNumber,
      progressCurrent: it.progressCurrent, progressTotal: it.progressTotal, salary: it.salary,
      workingHoursPerDay: it.workingHoursPerDay, workingDaysPerWeek: it.workingDaysPerWeek,
      overtimeHours: it.overtimeHours, subLines: it.subLines||[],
    });
  });
  return Object.values(groups).map(g=>{ g.categories = Object.values(g.categories); return g; });
}

/* ---------- duplicate detection ---------- */
function detectDuplicates(batch){
  const existingInMonth = txnsForMonth(batch.key);
  const monthAlreadyExists = existingInMonth.length>0;
  const flagged = [];
  batch.categories.forEach(cat=>{
    cat.items.forEach(item=>{
      let dup=null;
      if(monthAlreadyExists){
        dup = existingInMonth.find(t=>t.category===cat.name && similarText(t.uraian, item.uraian)>0.86 &&
          Math.abs((t.planned||0)-(item.jumlahRencana||0)) < Math.max(1000,(t.planned||0)*0.01));
      }
      flagged.push({...item, category:cat.name, isDuplicate: !!dup, dupOf: dup?dup.id:null});
    });
  });
  return {monthAlreadyExists, items:flagged};
}
