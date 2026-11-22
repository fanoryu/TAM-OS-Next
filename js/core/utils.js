/* ---------- utils ---------- */
// Local record id: prefix + '_' + 8 random base-36 characters + the last 4 base-36 characters of the
// clock — the shape ids have always had, so stored ids stay valid (no consumer parses them). The random
// part comes from Web Crypto (bytes >= 252 are rejected so every character is uniform), never from
// Math.random: without crypto.getRandomValues no id is made and the calling action stops with a clear
// error before it writes anything.
const UID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
function uid(prefix){
  const c = (typeof crypto !== 'undefined') ? crypto : null;
  if(!c || typeof c.getRandomValues !== 'function') throw new Error('Cannot create a record id: this browser does not provide secure random numbers (Web Crypto).');
  let rand = '';
  for(let round = 0; round < 8 && rand.length < 8; round++){
    const bytes = c.getRandomValues(new Uint8Array(16));
    for(let i = 0; i < bytes.length && rand.length < 8; i++){ if(bytes[i] < 252) rand += UID_ALPHABET.charAt(bytes[i] % 36); }
  }
  if(rand.length < 8) throw new Error('Cannot create a record id: secure random numbers were not usable.');
  return (prefix||'txn') + '_' + rand + Date.now().toString(36).slice(-4);
}
function fmtIDR(n){
  if(n===null || n===undefined || isNaN(n)) return '—';
  const neg = n<0; n = Math.abs(Math.round(n));
  let s = n.toLocaleString('id-ID');
  return (neg?'-':'') + 'Rp' + s;
}
function fmtIDRShort(n){
  if(n===null||n===undefined||isNaN(n)) return '—';
  const neg = n<0; n = Math.abs(n);
  if(n>=1000000000) return (neg?'-':'')+'Rp'+(n/1000000000).toFixed(2)+'M';
  if(n>=1000000) return (neg?'-':'')+'Rp'+(n/1000000).toFixed(1)+'jt';
  if(n>=1000) return (neg?'-':'')+'Rp'+(n/1000).toFixed(0)+'rb';
  return fmtIDR(n*(neg?-1:1));
}
function pct(n){ if(n===null||n===undefined||!isFinite(n)) return '—'; return (n>0?'+':'') + (n*100).toFixed(1)+'%'; }
function normStr(s){ return (s||'').toString().trim().toLowerCase().replace(/\s+/g,' '); }
function monthLabel(m){ return m.month + ' ' + m.year; }
function monthKeySort(a,b){ return a.year-b.year || a.monthNum-b.monthNum; }
function escapeHtml(s){ return (s===null||s===undefined)?'':String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
// v2.6.9 — mask a bank account number for display (keeps last 4 digits/chars).
// The full value is only ever shown inside its own edit field, never in lists,
// tables, tooltips, or exports.
function maskAccountNumber(n){
  const s = (n===null||n===undefined) ? '' : String(n).trim();
  if(!s) return '—';
  if(s.length<=4) return '••'+s;
  return '•••• '+s.slice(-4);
}
function toast(msg, ms){
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className='toast'; el.textContent = msg;
  root.appendChild(el);
  setTimeout(()=>{ el.style.transition='opacity .3s'; el.style.opacity='0'; setTimeout(()=>el.remove(),300); }, ms||2600);
}
/* ---------- centralized user-facing notifications (v2.2.1) ----------
   Single funnel for success / warning / error messages and confirmations.
   Technical detail goes to console; users see a short readable message. No
   important error is silently swallowed. These wrap the existing toast/confirm
   so behaviour is unchanged — they standardize call sites going forward. */
function showSuccess(msg, ms){ toast(msg, ms||2600); }
function showWarning(msg, ms){ toast(msg, ms||5000); }
function showError(msg, err, ms){
  if(err) console.error('[TAM]', msg, err); else console.error('[TAM]', msg);
  toast(msg, ms||6000);
}
// Confirmation dialog wrapper. Kept synchronous (window.confirm) to preserve the
// exact blocking behaviour every current call site relies on.
function confirmAction(message){ return window.confirm(message); }
function levenshtein(a,b){
  a=a||''; b=b||'';
  const m=a.length, n=b.length;
  if(m===0) return n; if(n===0) return m;
  const dp = Array.from({length:m+1},()=>new Array(n+1).fill(0));
  for(let i=0;i<=m;i++) dp[i][0]=i;
  for(let j=0;j<=n;j++) dp[0][j]=j;
  for(let i=1;i<=m;i++){
    for(let j=1;j<=n;j++){
      dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}
function similarText(a,b){
  a=normStr(a); b=normStr(b);
  if(!a || !b) return 0;
  if(a===b) return 1;
  const dist = levenshtein(a,b);
  return 1 - dist/Math.max(a.length,b.length);
}
/* UX-005B — generic trailing debounce. Returns a wrapper that delays fn until `wait`
   ms after the last call; `flush()` invokes immediately with the latest args (used so
   pressing Enter in a debounced search bypasses the delay). Presentation-only. */
function debounce(fn, wait){
  let t = null, lastArgs = null;
  const wrapped = function(){ lastArgs = arguments; clearTimeout(t); t = setTimeout(()=>{ t=null; fn.apply(this, lastArgs); }, wait); };
  wrapped.flush = function(){ if(t){ clearTimeout(t); t=null; fn.apply(this, lastArgs||[]); } };
  wrapped.cancel = function(){ clearTimeout(t); t=null; };
  return wrapped;
}
// UX-1 (Owner UX-OD-07, 2026-11-17): DISPLAY-ONLY grouping of an exact decimal money string from
// the server, as a pure string transform — no number parsing, no rounding, no recalculation.
// Indonesian convention: "." groups thousands, "," marks decimals ('12500000.00' -> '12.500.000,00').
// Anything that is not a plain decimal string is returned unchanged, so nothing is reinterpreted.
// moneyHTML keeps the exact server string in the <data value> attribute and never truncates.
const MONEY_DISPLAY_PATTERN = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
function moneyDisplay(v){
  if(v === null || v === undefined) return '';
  const s = String(v);
  const m = MONEY_DISPLAY_PATTERN.exec(s);
  if(!m) return s;
  let int = m[2], grouped = '';
  while(int.length > 3){ grouped = '.' + int.slice(-3) + grouped; int = int.slice(0, -3); }
  return m[1] + int + grouped + (m[3] === undefined ? '' : ',' + m[3]);
}
function moneyHTML(v){
  const exact = (v === null || v === undefined) ? '' : String(v);
  if(exact === '') return '—';
  return '<data class="ux-money" value="' + escapeHtml(exact) + '">' + escapeHtml(moneyDisplay(exact)) + '</data>';
}

// UX-1: a status badge — text + shape + colour, never colour alone (WCAG 1.4.1). `text` is the
// caller's fixed status wording; `tone` one of UX_TONES (anything else is neutral).
const UX_TONES = Object.freeze({ neutral: '○', info: '◐', attention: '◆', final: '■', planned: '▲', done: '✓', stop: '✕' });
function statusBadgeHTML(text, tone){
  const t = Object.prototype.hasOwnProperty.call(UX_TONES, tone) ? tone : 'neutral';
  return '<span class="ux-badge ux-tone-' + t + '"><span class="ux-badge-mark" aria-hidden="true">' + UX_TONES[t] + '</span>' + escapeHtml(text) + '</span>';
}
