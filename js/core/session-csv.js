/* ============================================================
   SESSION CSV EXPORT (AWP-05, OD-13 = A) — js/core/session-csv.js
   ------------------------------------------------------------
   The one CSV writer of the SESSION workspace: the CEO's Transactions list, Financial dashboard
   and Audit month are exported in the browser from the answers already read and decoded for the
   view (OD-13 = A, Owner 2026-11-21). Nothing is read, fetched, stored or sent here: a document is
   built from the rows a caller hands in and offered as a download. There is no server endpoint, no
   ACTION and no audit row: a download is never recorded anywhere.

     SessionCsv.text(v)          an untrusted text cell: empty for null / undefined; a value whose
                                 first character is a formula prefix (= + - @, their full-width
                                 forms) or a whitespace / control character is neutralised with a
                                 leading apostrophe, so a spreadsheet never evaluates it
     SessionCsv.money(v)         an exact server money string ("N.00", "-N.00" for a net) as is, so
                                 a negative amount stays a number; empty for null / undefined;
                                 anything else is treated as text — never parsed or rounded
     SessionCsv.count(v)         a non-negative safe integer as digits; empty for null / undefined
     SessionCsv.document(h, r)   UTF-8 BOM (Excel), the header row, the rows; RFC 4180: CRLF line
                                 ends, a field holding a quote, comma, CR or LF (or leading /
                                 trailing space) is quoted with doubled quotes
     SessionCsv.filename(parts)  "tam-os-" + lower-case [a-z0-9-] parts + ".csv" — deterministic
     SessionCsv.download(c, f)   a Blob and a same-document link with `download`: no navigation,
                                 no third-party request (CSP unchanged); false when the browser
                                 cannot make one

   Classic shared global scope; top-level `const` bindings, not on window.
   ============================================================ */

const SESSION_CSV_BOM = '\uFEFF';
const SESSION_CSV_EOL = '\r\n';
const SESSION_CSV_MIME = 'text/csv;charset=utf-8';
const SESSION_CSV_MONEY = /^-?(0|[1-9][0-9]*)\.00$/;
// A first character a spreadsheet may read as the start of a formula or strip before reading one:
// = + - @ and their full-width forms, and every whitespace or control character (tab, CR and LF included).
const SESSION_CSV_UNSAFE_START = /^[=+\-@\uff1d\uff0b\uff0d\uff20\s\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202f\u2060\ufeff]/;

const SessionCsv = (function(){
  function quote(s){
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function text(v){
    if(v === null || v === undefined) return '';
    const s = String(v);
    return quote(SESSION_CSV_UNSAFE_START.test(s) ? "'" + s : s);
  }
  return Object.freeze({
    text: text,
    money(v){
      if(v === null || v === undefined) return '';
      return typeof v === 'string' && SESSION_CSV_MONEY.test(v) ? v : text(v);
    },
    count(v){
      if(v === null || v === undefined) return '';
      return Number.isSafeInteger(v) && v >= 0 ? String(v) : text(v);
    },
    // headers: plain strings; rows: arrays of cells already made by text / money / count.
    document(headers, rows){
      const lines = [headers.map(text).join(',')].concat(rows.map(function(r){ return r.join(','); }));
      return SESSION_CSV_BOM + lines.join(SESSION_CSV_EOL) + SESSION_CSV_EOL;
    },
    filename(parts){
      const clean = parts.map(function(p){ return String(p).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }).filter(Boolean);
      return 'tam-os-' + clean.join('-') + '.csv';
    },
    download(content, filename){
      if(typeof Blob !== 'function' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
      const url = URL.createObjectURL(new Blob([content], { type: SESSION_CSV_MIME }));
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(url); }, 2000);
      return true;
    }
  });
})();
