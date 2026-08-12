/* ============================================================
   DATA GRID FOUNDATION (UX-005B)  —  SHARED PLATFORM FOUNDATION (FROZEN)
   ------------------------------------------------------------
   FOUNDATION FREEZE (UX-005B finalization): this module is a shared PLATFORM
   foundation consumed by multiple pages. Keep it small and generic:
     - New GENERIC grid capabilities (e.g. selection, column visibility, saved
       views, server pagination, virtualization) require EXPLICIT roadmap approval
       before they are added here — do not add them casually.
     - PAGE-SPECIFIC behaviour belongs in the owning page module, never here. This
       module must stay data-source / role / storage / business agnostic.
     - Resist turning data-grid.js into a "god object": prefer small composable
       helpers plus per-page column/feature configuration.
   See docs/01-roadmap/UX-005-Executive-Personal-Workspace-Architecture.md.
   ------------------------------------------------------------
   A reusable, DECLARATIVE grid layer for TAM OS tables. It is deliberately:
     - data-source agnostic  — it receives an array of ROWS and nothing else. It
       never reads State.txns / State.employees, never calls uiExecute, never
       touches storage. The owning page produces the rows (from a State array, a
       Domain query, or any future source) and passes them in.
     - role agnostic         — it knows nothing about CEO/Employee, Executive or
       Personal Workspace, permissions, currentUser or authentication. Feature
       flags gate UI CAPABILITY only; authorization lives upstream (UX-006).
     - storage agnostic      — it persists nothing; all grid state is session-only,
       owned by the page under State.grid[<key>].
     - business agnostic     — it never mutates the rows it is given; every sort
       runs on a COPY.

   Frozen contracts (see docs/01-roadmap/UX-005-Executive-Personal-Workspace-Architecture.md):
     R1 column definitions · R2 comparator registry · R4 default-sort registry ·
     R5 rows-only pipeline · R7 page sizes 20/50/100 (default 20) · R9 feature flags.
   ============================================================ */

/* R7 — pagination sizes (frozen). */
const GRID_PAGE_SIZES = [20, 50, 100];
const GRID_DEFAULT_PAGE_SIZE = 20;

/* R9 — the exact set of feature flags supported in UX-005B v1. A grid config MUST
   declare a features block; a MISSING flag evaluates to DISABLED (never guessed on).
   These gate UI capability only — never authorization. */
const GRID_FEATURE_FLAGS = ['pagination', 'sorting', 'search', 'export', 'rowActions', 'resultCount'];
function gridFeatureEnabled(features, name){ return !!(features && features[name] === true); }

/* R4 — canonical default sort per grid. Only transactions & employees are wired in
   UX-005B; the rest are pre-registered so future adoption inherits consistent
   defaults without new logic. */
const GRID_DEFAULT_SORT = {
  transactions: { col: 'month',   dir: 'desc' },
  employees:    { col: 'name',    dir: 'asc'  },
  contracts:    { col: 'endDate', dir: 'asc'  },
  overtime:     { col: 'date',    dir: 'desc' },
  execution:    { col: 'date',    dir: 'desc' },
};

/* R2 — comparator registry. Chosen via columnDef.type. Each returns a<b => <0.
   Numeric/currency compare NUMERICALLY (never lexically); date expects the getter
   to yield a comparable sortable value (epoch/number), never display text; text
   uses locale-aware, normalized comparison. Null/blank handling and stable
   tie-breaking are applied uniformly by gridSort (not per comparator). */
const GRID_COMPARATORS = {
  text(a, b){ return normStr(String(a)).localeCompare(normStr(String(b))); },
  number(a, b){ return Number(a) - Number(b); },
  currency(a, b){ return Number(a) - Number(b); },
  date(a, b){ return Number(a) - Number(b); },
};
// A value counts as "blank" (sorted last, in BOTH directions) when it is null,
// undefined, an empty/whitespace string, or a non-finite number.
function gridIsBlank(v){
  if(v === null || v === undefined) return true;
  if(typeof v === 'number') return !isFinite(v);
  if(typeof v === 'string') return v.trim() === '';
  return false;
}

/* R1/R2 — sort a COPY of rows by a column definition. Never mutates the input.
   Blanks always sink to the bottom; equal values keep their original relative order
   (stable) via an original-index tie-break that is NOT reversed by direction. */
function gridSort(rows, sort, columnDefs){
  const list = (rows || []).slice();
  if(!sort || !sort.col) return list;
  const def = (columnDefs || []).find(c => c.id === sort.col);
  if(!def || !def.sortable || typeof def.getter !== 'function') return list;
  const cmp = GRID_COMPARATORS[def.type] || GRID_COMPARATORS.text;
  const desc = sort.dir === 'desc';
  return list
    .map((row, i) => ({ row, i }))
    .sort((x, y) => {
      const va = def.getter(x.row), vb = def.getter(y.row);
      const ba = gridIsBlank(va), bb = gridIsBlank(vb);
      if(ba && bb) return x.i - y.i;      // both blank -> stable
      if(ba) return 1;                    // blanks last, regardless of direction
      if(bb) return -1;
      let base = cmp(va, vb);
      if(desc) base = -base;
      return base !== 0 ? base : x.i - y.i; // stable tie-break (never flipped)
    })
    .map(o => o.row);
}

/* Pagination helper. Clamps page into [1, pageCount]; never yields a page beyond
   the data. An empty set is one page (page 1 of 1), so no "Page 1 of 0" ever shows. */
function gridPage(rows, page, pageSize){
  const size = GRID_PAGE_SIZES.indexOf(pageSize) >= 0 ? pageSize : GRID_DEFAULT_PAGE_SIZE;
  const total = (rows || []).length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const cur = Math.min(Math.max(1, page || 1), pageCount);
  const start = (cur - 1) * size;
  return { pageRows: (rows || []).slice(start, start + size), page: cur, pageCount: pageCount, total: total, pageSize: size };
}

/* The whole pipeline over a FILTERED row set: sort (if enabled) then paginate (if
   enabled). `total` is the filtered count captured BEFORE pagination. Rows are never
   mutated. When pagination is disabled the full (sorted) set is returned as one page. */
function gridApply(rows, state, columnDefs, features){
  const src = rows || [];
  const sorted = gridFeatureEnabled(features, 'sorting') ? gridSort(src, state && state.sort, columnDefs) : src.slice();
  if(!gridFeatureEnabled(features, 'pagination')){
    return { pageRows: sorted, page: 1, pageCount: 1, total: src.length, pageSize: sorted.length || GRID_DEFAULT_PAGE_SIZE };
  }
  const paged = gridPage(sorted, state ? state.page : 1, state ? state.pageSize : GRID_DEFAULT_PAGE_SIZE);
  paged.total = src.length; // count is the FILTERED total, independent of the current page
  return paged;
}

/* R4 — three-click cycle: none/other-column -> the column's configured direction;
   same column at configured direction -> reversed; same column reversed -> the
   grid's canonical default sort. Returns a new {col,dir}; pure. */
function gridCycleSort(current, colId, columnDefs, gridKey){
  const def = (columnDefs || []).find(c => c.id === colId);
  if(!def || !def.sortable) return current;
  const configured = def.dir || 'asc';
  if(current && current.col === colId){
    if(current.dir === configured) return { col: colId, dir: configured === 'asc' ? 'desc' : 'asc' };
    return Object.assign({}, GRID_DEFAULT_SORT[gridKey]); // third click -> canonical default
  }
  return { col: colId, dir: configured };
}

/* ---- shared HTML builders (presentation only) ---- */
// One <thead><tr> of <th>s from column defs. Sortable columns render a <th> that
// carries aria-sort, wrapping an accessible button with a direction glyph; non-sortable
// columns are plain.
function gridTheadHTML(columnDefs, state){
  const cells = (columnDefs || []).map(c => {
    const cls = c.align === 'num' ? ' class="num"' : '';
    if(!c.sortable){ return `<th${cls}>${escapeHtml(c.label || '')}</th>`; }
    const active = state && state.col === c.id;
    const ariaSort = active ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none';
    const glyph = active ? (state.dir === 'asc' ? ' ▲' : ' ▼') : '';
    // UX-005F (A6) — aria-sort belongs on the column header cell (implicit columnheader),
    // not on the button (role=button, where aria-sort is not a valid state). The button
    // keeps its accessible name + click/keyboard behavior; only the ARIA state moves.
    return `<th${cls} aria-sort="${ariaSort}"><button type="button" class="grid-sort${active ? ' active' : ''}" data-grid-sort="${escapeHtml(c.id)}" aria-label="Sort by ${escapeHtml(c.label || c.id)}">${escapeHtml(c.label || '')}<span class="grid-sort-ind" aria-hidden="true">${glyph}</span></button></th>`;
  }).join('');
  return `<thead><tr>${cells}</tr></thead>`;
}
// "N of M" — filtered (pre-pagination) N over the unfiltered source total M.
function gridResultCountHTML(filteredTotal, sourceTotal){
  return `<span class="grid-count" aria-live="polite">${Number(filteredTotal).toLocaleString('id-ID')} of ${Number(sourceTotal).toLocaleString('id-ID')}</span>`;
}
// Pager: page-size select + Prev/Next + "Page X of Y". Bounds disable Prev/Next.
function gridPagerHTML(paged){
  const opts = GRID_PAGE_SIZES.map(s => `<option value="${s}" ${s === paged.pageSize ? 'selected' : ''}>${s} / page</option>`).join('');
  const prevDis = paged.page <= 1 ? ' disabled' : '';
  const nextDis = paged.page >= paged.pageCount ? ' disabled' : '';
  return `<div class="grid-pager">
    <select class="input btn-sm grid-page-size" data-grid-page-size aria-label="Rows per page">${opts}</select>
    <button type="button" class="btn btn-sm" data-grid-page-prev aria-label="Previous page"${prevDis}>‹ Prev</button>
    <span class="grid-page-ind">Page ${paged.page} of ${paged.pageCount}</span>
    <button type="button" class="btn btn-sm" data-grid-page-next aria-label="Next page"${nextDis}>Next ›</button>
  </div>`;
}

/* Bind the shared grid controls (sort headers + pager) inside `container`. The page
   supplies `state` (State.grid[key]), the grid key, its columnDefs, and a `refresh`
   callback that re-runs the page's own filter->render. Navigation/query state only;
   never mutates data, never persists. */
function bindGridControls(container, gridKey, state, columnDefs, refresh){
  container.querySelectorAll('[data-grid-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.sort = gridCycleSort(state.sort, btn.dataset.gridSort, columnDefs, gridKey);
      state.page = 1;
      refresh();
    });
  });
  const prev = container.querySelector('[data-grid-page-prev]');
  if(prev) prev.addEventListener('click', () => { if(state.page > 1){ state.page--; refresh(); } });
  const next = container.querySelector('[data-grid-page-next]');
  if(next) next.addEventListener('click', () => { state.page++; refresh(); }); // gridApply clamps
  const size = container.querySelector('[data-grid-page-size]');
  if(size) size.addEventListener('change', (e) => {
    const v = parseInt(e.target.value, 10);
    state.pageSize = GRID_PAGE_SIZES.indexOf(v) >= 0 ? v : GRID_DEFAULT_PAGE_SIZE;
    state.page = 1;
    refresh();
  });
}

/* Initialize a session-only grid state object for a key, applying the canonical
   default sort and default page size. Session-only: lives on State.grid, never in
   State.settings, never persisted. */
function gridInitState(gridKey){
  return { sort: Object.assign({}, GRID_DEFAULT_SORT[gridKey] || null), page: 1, pageSize: GRID_DEFAULT_PAGE_SIZE };
}
