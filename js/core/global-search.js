/* ============================================================
   GLOBAL SEARCH ENGINE (UX-005D)  —  PURE, SOURCE-AGNOSTIC PRIMITIVE
   ------------------------------------------------------------
   `searchGlobal(query, documents, options)` ranks and groups a supplied array of
   plain search DOCUMENTS. It is deliberately pure:
     - it reads NO application state (State.employees/contracts/txns/payrollPlans/
       settings), NO NAV_GROUPS, NO storage, NO uiExecute, NO network, NO DOM, and
       NOTHING about roles/auth/currentUser/workspace;
     - it performs NO navigation and NO mutation — it returns data only.
   Document collection, authorization/scoping, navigation, and rendering all happen
   UPSTREAM (see js/ui/global-search-ui.js). Frozen rule: **scope first, search
   second** — the engine can only ever surface records present in the array it is
   handed, so UX-006 can pass a self-scoped document set with zero engine changes.

   The only shared helper it uses is normStr() (a pure text normalizer from utils).

   Search document shape (plain data; no callbacks, no functions):
     { key:"employee:e123", type:"employee", label:"Norman",
       meta:"Finance · EMP-001", searchText:"norman emp-001 finance …",
       to:"employeeDetail", context:{ detailEmpId:"e123" } }
   ============================================================ */

const GLOBAL_SEARCH_GROUP_CAP = 5;   // max results shown per type group
const GLOBAL_SEARCH_TOTAL_CAP = 20;  // max results overall
// Canonical display/priority order of type groups. Types not listed are appended
// (deterministically) after these, so the engine never silently drops a type.
const GLOBAL_SEARCH_GROUP_ORDER = ['view', 'employee', 'contract', 'payroll', 'transaction'];

/* Deterministic relevance score for one document against a normalized query.
   Tiers (high → low): exact label/id > label prefix > word-prefix > label
   substring > meta/searchText substring. Returns 0 for no match. */
function globalSearchScore(doc, q){
  if(!doc || !q) return 0;
  const label = normStr(doc.label || '');
  const idPart = normStr(String(doc.key || '').split(':').slice(1).join(':'));
  const meta = normStr(doc.meta || '');
  const text = normStr(doc.searchText || '');
  if(label === q || idPart === q) return 100;                 // exact label / id
  if(label.indexOf(q) === 0) return 80;                       // label prefix
  if(label.split(' ').some(w => w.indexOf(q) === 0)) return 60; // word prefix
  if(label.indexOf(q) > 0) return 40;                         // label substring
  if(text.indexOf(q) >= 0 || meta.indexOf(q) >= 0) return 20; // meta / searchText
  return 0;
}

/* Pure search. Returns { query, groups:[{type, items:[doc,…]}], total }.
   Ranking is stable (score desc, then original index); grouping preserves the
   canonical group order; per-group and overall caps are applied deterministically.
   Never mutates `documents` or any document. */
function searchGlobal(query, documents, options){
  options = options || {};
  const groupCap = options.groupCap || GLOBAL_SEARCH_GROUP_CAP;
  const totalCap = options.totalCap || GLOBAL_SEARCH_TOTAL_CAP;
  const order = options.groupOrder || GLOBAL_SEARCH_GROUP_ORDER;
  const q = normStr(query || '');
  if(!q) return { query: '', groups: [], total: 0 };

  const scored = [];
  (documents || []).forEach((d, i) => {
    const s = globalSearchScore(d, q);
    if(s > 0) scored.push({ doc: d, score: s, i: i });
  });
  scored.sort((a, b) => (b.score - a.score) || (a.i - b.i)); // deterministic + stable

  const byType = {};
  scored.forEach(x => { (byType[x.doc.type] = byType[x.doc.type] || []).push(x.doc); });

  // Canonical groups first, then any unexpected types (deterministic by first-seen).
  const seen = {};
  const typeSequence = order.filter(t => byType[t]).concat(
    scored.map(x => x.doc.type).filter(t => order.indexOf(t) < 0 && !seen[t] && (seen[t] = 1))
  );

  const groups = [];
  let remaining = totalCap;
  typeSequence.forEach(type => {
    if(remaining <= 0) return;
    const items = (byType[type] || []).slice(0, Math.min(groupCap, remaining));
    if(items.length){ groups.push({ type: type, items: items }); remaining -= items.length; }
  });
  return { query: q, groups: groups, total: groups.reduce((s, g) => s + g.items.length, 0) };
}
