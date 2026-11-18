'use strict';
/* ============================================================
   UX-1 — MONEY DISPLAY ORACLE (test-only) — tools/ux-money-oracle.js
   ------------------------------------------------------------
   UX-OD-07 (Owner GO 2026-11-17): SESSION lists show a server money string with display-only
   Indonesian grouping, as <data class="ux-money" value="EXACT">GROUPED</data>. This oracle is an
   independent implementation (a regular expression, not the production loop) so a harness can:

     groupId(v)        '12500000.00' -> '12.500.000,00'; anything that is not a plain decimal
                       string is returned unchanged.
     unmoney(html)     -> { html, ok, count }: every ux-money element replaced by its exact
                       value attribute (so the harness's exact-string checks still read the
                       server string), ok false when any shown text is not groupId(value).

   Used only by tools/verify-*-runtime.js. Never in module-order.js or the package.
   ============================================================ */

function groupId(v){
  const m = /^(-?)([0-9]+)(?:\.([0-9]+))?$/.exec(String(v));
  if(!m) return String(v);
  return m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (m[3] === undefined ? '' : ',' + m[3]);
}

const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function unmoney(html){
  let ok = true, count = 0;
  const out = String(html).replace(/<data class="ux-money" value="([^"]*)">([^<]*)<\/data>/g, (all, value, shown) => {
    count++;
    if(unescape(shown) !== groupId(unescape(value))) ok = false;
    return value;
  });
  return { html: out, ok: ok, count: count };
}

module.exports = { groupId, unmoney, escape };
