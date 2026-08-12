
/* ============================================================
   CHART LIBRARY — self-contained SVG charts, no external deps.
   Responsive: SVG fills its wrapper's exact box (width & height
   set from JS, not "auto"), so a fill/area can never render
   taller than its own card. Legend toggle state persists per
   container id for the current page view.
   ============================================================ */
const SVGNS = 'http://www.w3.org/2000/svg';
const chartLegendState = {}; // containerId -> Set of hidden series keys
function getHiddenSet(containerId){
  if(!chartLegendState[containerId]) chartLegendState[containerId] = new Set();
  return chartLegendState[containerId];
}
function chartTooltip(host){
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  const bg = themeVar('--chart-tip-bg','#1D2740'), bd = themeVar('--chart-tip-border','#2A3550');
  tip.style.cssText = `position:absolute;pointer-events:none;background:${bg};border:1px solid ${bd};border-radius:8px;padding:9px 12px;font-size:12px;line-height:1.65;color:#F3F5F8;box-shadow:0 8px 24px rgba(0,0,0,.45);z-index:6;opacity:0;transition:opacity .1s;white-space:nowrap;`;
  host.style.position = 'relative';
  host.appendChild(tip);
  return tip;
}
function positionTooltip(host, tip, evt){
  const bcr = host.getBoundingClientRect();
  let left = evt.clientX - bcr.left + 14;
  let top = evt.clientY - bcr.top - 12;
  if(left + 190 > bcr.width) left = evt.clientX - bcr.left - 200;
  if(left < 0) left = 4;
  if(top < 0) top = 0;
  tip.style.left = left+'px'; tip.style.top = top+'px';
}
function chartFallback(container, msg){
  container.style.height='auto';
  container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;min-height:200px;color:var(--text-faint);font-size:13px;text-align:center;padding:20px;" role="img" aria-label="${escapeHtml(msg||'Chart unavailable')}">${escapeHtml(msg||'Chart could not render — no data available.')}</div>`;
}
function svgLine(svg, x1,y1,x2,y2, stroke, width, extra){
  const l = document.createElementNS(SVGNS,'line');
  l.setAttribute('x1',x1); l.setAttribute('y1',y1); l.setAttribute('x2',x2); l.setAttribute('y2',y2);
  l.setAttribute('stroke',stroke); l.setAttribute('stroke-width',width||1);
  if(extra) Object.keys(extra).forEach(k=>l.setAttribute(k,extra[k]));
  svg.appendChild(l); return l;
}
function svgText(svg, x,y, str, opts){
  opts = opts||{};
  const t = document.createElementNS(SVGNS,'text');
  t.setAttribute('x',x); t.setAttribute('y',y);
  t.setAttribute('text-anchor', opts.anchor||'middle');
  t.setAttribute('fill', opts.fill||themeVar('--chart-axis','#8592AD'));
  t.setAttribute('font-size', opts.size||'12');
  t.setAttribute('font-family', opts.mono ? "'JetBrains Mono',monospace" : "'Inter',sans-serif");
  t.textContent = str;
  svg.appendChild(t); return t;
}
/** Builds the wrapper (legend + clipped chart area) that every chart draws into.
 *  The chart area's height is set explicitly in px (never "auto"), and both the
 *  outer container and inner area use overflow:hidden, so lines/fills/points can
 *  never render outside their own card regardless of container width. */
function chartShell(container, id, W, H, legendSeries, hidden, onToggle){
  container.innerHTML = '';
  container.style.overflow = 'hidden';
  container.style.height = 'auto'; // let the wrapper grow to fit legend + plot area exactly, so overflow:hidden never clips the chart itself (this was cutting off the bottom axis/Rp0 label whenever a legend was present)
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  if(legendSeries && legendSeries.length>1){
    const bar = document.createElement('div');
    bar.className = 'chart-legend';
    bar.setAttribute('role','group');
    bar.setAttribute('aria-label','Toggle chart series');
    legendSeries.forEach(s=>{
      const isHidden = hidden.has(s.key);
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('aria-pressed', String(!isHidden));
      item.setAttribute('aria-label', `${isHidden?'Show':'Hide'} ${s.label} series`);
      item.style.cssText = `display:flex;align-items:center;gap:6px;background:transparent;border:1px solid transparent;cursor:pointer;color:${isHidden?'var(--text-faint)':'var(--text)'};padding:3px 8px;border-radius:6px;font-size:12px;`;
      item.innerHTML = `<span style="width:10px;height:10px;border-radius:3px;background:${isHidden?themeVar('--border','#2A3550'):s.color};display:inline-block;"></span>${escapeHtml(s.label)}`;
      item.addEventListener('mouseenter', ()=>{ item.style.borderColor='var(--border)'; });
      item.addEventListener('mouseleave', ()=>{ item.style.borderColor='transparent'; });
      item.addEventListener('click', ()=>onToggle(s.key));
      bar.appendChild(item);
    });
    container.appendChild(bar);
  }
  const area = document.createElement('div');
  area.style.cssText = `position:relative;width:100%;height:${H}px;flex:none;overflow:hidden;`;
  container.appendChild(area);

  const svg = document.createElementNS(SVGNS,'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio','none');
  svg.setAttribute('role','img');
  svg.style.width = '100%'; svg.style.height = '100%'; svg.style.display = 'block';
  area.appendChild(svg);

  const clipId = 'clip_' + id + '_' + Math.random().toString(36).slice(2,8);
  const defs = document.createElementNS(SVGNS,'defs');
  const clip = document.createElementNS(SVGNS,'clipPath');
  clip.setAttribute('id', clipId);
  defs.appendChild(clip);
  svg.appendChild(defs);

  return {area, svg, clipId, clipEl:clip};
}

/* Shared layout constants so every chart in the app uses identical padding/typography.
   v2.4.0 readability: wider left margin so Rp labels (incl. billions) never clip,
   taller bottom band, and a minimum 12px axis font. */
const CHART_PAD = {L:86, R:24, T:28, B:46};
const AXIS_LABEL_SIZE = '12';
const GRID_COLOR = '#26314c';
const GRID_OPACITY = '0.55';
const CHART_TICK_MIN_PX = 44; // minimum vertical spacing between Y ticks
// Chart heights (Part 13): min wrapper 320, standard 380, dense 420.
function chartHeightFor(n){ if(n>=10) return 420; if(n>=5) return 380; return 320; }
// Indonesian short currency for chart axes, e.g. Rp20,1 Jt / Rp40,3 Jt / Rp1,2 M.
function fmtIDRid(v){
  if(v===null||v===undefined||isNaN(v)) return '';
  if(v===0) return 'Rp0';
  const sign = v<0?'-':''; const a = Math.abs(v);
  const id = (x)=>x.toLocaleString('id-ID',{minimumFractionDigits:0, maximumFractionDigits:1});
  if(a>=1e12) return sign+'Rp'+id(a/1e12)+' T';
  if(a>=1e9)  return sign+'Rp'+id(a/1e9)+' M';
  if(a>=1e6)  return sign+'Rp'+id(a/1e6)+' Jt';
  if(a>=1e3)  return sign+'Rp'+id(a/1e3)+' Rb';
  return sign+'Rp'+id(a);
}
// Number of Y ticks that keeps spacing >= CHART_TICK_MIN_PX (reduce, never compress).
function yTickCount(plotH){ return Math.max(2, Math.min(5, Math.floor(plotH / CHART_TICK_MIN_PX))); }

/**
 * Multi-series line chart. Gaps (null/undefined) break the line instead of
 * dropping to zero. Supports a legend, a hover crosshair with a rich tooltip
 * callback, per-point color/hollow overrides (for over/under/incomplete
 * status), and click-to-navigate.
 * opts: {labels, series:[{key,label,color,data,fill,pointColor[],pointHollow[],pointRadius[]}],
 *        formatY, height, legend, tooltipHTML(i), onIndexClick(i), ariaLabel}
 */
function drawLineChart(container, opts){
  try{
    const id = container.id || 'lc_'+Math.random().toString(36).slice(2,8);
    const {labels, series, formatY=(v=>v), height=260, legend=true} = opts;
    if(!labels || !labels.length || !series || !series.length || !series.some(s=>s.data.some(v=>v!==null&&v!==undefined))){
      return chartFallback(container, opts.emptyMessage);
    }
    const hidden = getHiddenSet(id);
    const n=labels.length;
    const gridColor = themeVar('--chart-grid', GRID_COLOR);
    const W=780, H=Math.max(320, height || chartHeightFor(n)), padL=CHART_PAD.L, padR=CHART_PAD.R, padT=CHART_PAD.T, padB=CHART_PAD.B;
    const plotW=W-padL-padR, plotH=H-padT-padB;
    const visible = series.filter(s=>!hidden.has(s.key));
    const activeSeries = visible.length ? visible : series; // never hide every series into a blank chart
    const allVals = activeSeries.flatMap(s=>s.data.filter(v=>v!==null&&v!==undefined));
    let maxV=Math.max(0,...allVals), minV=Math.min(0,...allVals);
    if(maxV===minV) maxV = maxV + Math.max(1,Math.abs(maxV)*0.1) || 1;
    const single = n===1;
    const xStep = n>1 ? plotW/(n-1) : 0;
    const yScale = v => padT + plotH - ((v-minV)/(maxV-minV))*plotH;
    // Single-point charts center the marker/label instead of pinning to the left.
    const xScale = i => single ? padL + plotW/2 : padL + i*xStep;

    const {svg, clipId, clipEl} = chartShell(container, id, W, H, legend?series:null, hidden, key=>{
      if(hidden.has(key)) hidden.delete(key); else hidden.add(key);
      drawLineChart(container, opts);
    });
    if(opts.ariaLabel) svg.setAttribute('aria-label', opts.ariaLabel);

    const rect = document.createElementNS(SVGNS,'rect');
    rect.setAttribute('x',padL); rect.setAttribute('y',padT); rect.setAttribute('width',plotW); rect.setAttribute('height',plotH);
    clipEl.appendChild(rect);

    // Dynamic Y ticks — reduce the count rather than compress labels below 44px.
    const ticks = yTickCount(plotH);
    for(let g=0; g<=ticks; g++){
      const v = minV + (maxV-minV)*g/ticks, y = yScale(v);
      svgLine(svg, padL, y, W-padR, y, gridColor, 1, {'stroke-opacity':GRID_OPACITY});
      svgText(svg, padL-12, y+4, fmtIDRid(v), {anchor:'end', mono:true, size:AXIS_LABEL_SIZE});
    }
    if(minV<0 && maxV>0) svgLine(svg, padL, yScale(0), W-padR, yScale(0), gridColor, 1.4);
    const labelEvery = Math.max(1, Math.ceil(n/10));
    labels.forEach((lab,i)=>{
      if(!single && i%labelEvery!==0 && i!==n-1) return;
      svgText(svg, xScale(i), H-12, lab, {size:AXIS_LABEL_SIZE});
    });

    const dataG = document.createElementNS(SVGNS,'g');
    dataG.setAttribute('clip-path', `url(#${clipId})`);
    svg.appendChild(dataG);

    activeSeries.forEach(s=>{
      const segments=[]; let cur=[];
      s.data.forEach((v,i)=>{
        if(v===null||v===undefined){ if(cur.length) segments.push(cur); cur=[]; }
        else cur.push([i,v]);
      });
      if(cur.length) segments.push(cur);
      segments.forEach(seg=>{
        const d = seg.map(([i,v],idx)=>`${idx===0?'M':'L'} ${xScale(i).toFixed(1)} ${yScale(v).toFixed(1)}`).join(' ');
        if(s.fill && seg.length){
          const baseY = yScale(Math.max(minV,0));
          const areaD = d + ` L ${xScale(seg[seg.length-1][0]).toFixed(1)} ${baseY.toFixed(1)} L ${xScale(seg[0][0]).toFixed(1)} ${baseY.toFixed(1)} Z`;
          const area = document.createElementNS(SVGNS,'path');
          area.setAttribute('d', areaD); area.setAttribute('fill', s.color); area.setAttribute('opacity','0.10'); area.setAttribute('stroke','none');
          dataG.appendChild(area);
        }
        const path = document.createElementNS(SVGNS,'path');
        path.setAttribute('d', d); path.setAttribute('fill','none'); path.setAttribute('stroke', s.color);
        path.setAttribute('stroke-width','2.2'); path.setAttribute('stroke-linejoin','round'); path.setAttribute('stroke-linecap','round');
        dataG.appendChild(path);
      });
      s.data.forEach((v,i)=>{
        if(v===null||v===undefined) return;
        const rad = Array.isArray(s.pointRadius) ? s.pointRadius[i] : (s.pointRadius!==undefined ? s.pointRadius : 3);
        if(rad===0) return;
        const isHollow = Array.isArray(s.pointHollow) ? !!s.pointHollow[i] : !!s.pointHollow;
        const pc = Array.isArray(s.pointColor) ? (s.pointColor[i]||s.color) : (s.pointColor||s.color);
        const c = document.createElementNS(SVGNS,'circle');
        c.setAttribute('cx', xScale(i)); c.setAttribute('cy', yScale(v)); c.setAttribute('r', single?5:rad);
        c.setAttribute('fill', isHollow ? themeVar('--chart-hollow','#161D2C') : pc);
        c.setAttribute('stroke', pc); c.setAttribute('stroke-width', isHollow?'2':'1.3');
        dataG.appendChild(c);
      });
    });
    // Single-point annotation (Part 13): show each series' value beside the
    // centered marker — no fake trend line is drawn (a lone point has no line).
    if(single){
      let ann = padT + 16;
      activeSeries.forEach(s=>{
        const v = s.data[0]; if(v===null||v===undefined) return;
        svgText(svg, xScale(0), ann, `${s.label}: ${formatY(v)}`, {size:AXIS_LABEL_SIZE, fill:s.color, mono:true});
        ann += 18;
      });
    }

    // hover crosshair + click-to-navigate over the full plot area
    const tip = chartTooltip(container.querySelector('div'));
    const guide = svgLine(svg, 0,padT, 0,padT+plotH, themeVar('--chart-muted','#5E6A87'), 1, {'stroke-dasharray':'3,3', opacity:'0'});
    const hitRect = document.createElementNS(SVGNS,'rect');
    hitRect.setAttribute('x',padL); hitRect.setAttribute('y',padT); hitRect.setAttribute('width',plotW); hitRect.setAttribute('height',plotH);
    hitRect.setAttribute('fill','transparent');
    hitRect.style.cursor = opts.onIndexClick ? 'pointer' : 'crosshair';
    if(opts.onIndexClick) hitRect.setAttribute('role','button');
    let lastIdx = -1;
    function nearestIndex(evt){
      const bcr = svg.getBoundingClientRect();
      const relX = (evt.clientX-bcr.left) * (W/bcr.width);
      let idx = n>1 ? Math.round((relX-padL)/xStep) : 0;
      return Math.max(0, Math.min(n-1, idx));
    }
    hitRect.addEventListener('mousemove', evt=>{
      const i = nearestIndex(evt);
      if(i!==lastIdx){
        lastIdx = i;
        guide.setAttribute('x1', xScale(i)); guide.setAttribute('x2', xScale(i)); guide.setAttribute('opacity','1');
        if(opts.tooltipHTML){ tip.innerHTML = opts.tooltipHTML(i); }
        else{
          const rows = activeSeries.map(s=>{
            const v = s.data[i];
            return `<div style="display:flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:50%;background:${s.color};display:inline-block;"></span>${escapeHtml(s.label)}: <b style="font-family:monospace;">${v===null||v===undefined?'no data':formatY(v)}</b></div>`;
          }).join('');
          tip.innerHTML = `<div style="font-weight:600;margin-bottom:4px;">${escapeHtml(labels[i])}</div>${rows}`;
        }
        tip.style.opacity='1';
      }
      positionTooltip(container.querySelector('div'), tip, evt);
    });
    hitRect.addEventListener('mouseleave', ()=>{ tip.style.opacity='0'; guide.setAttribute('opacity','0'); lastIdx=-1; });
    if(opts.onIndexClick) hitRect.addEventListener('click', evt=>opts.onIndexClick(nearestIndex(evt)));
    svg.appendChild(hitRect);
  }catch(err){
    console.error('drawLineChart error', err);
    chartFallback(container, 'Chart could not render (' + err.message + ').');
  }
}

/**
 * Grouped or single-series bar chart. Supports signed values (green/red),
 * a legend, a rich tooltip callback, muted "no data" ticks for null values
 * (never rendered as zero), and click-to-navigate.
 * opts: {labels, series:[{key,label,color,data,colors?}], formatY, height, signed, legend, tooltipHTML(i,seriesIndex), onBarClick(i,seriesIndex)}
 */
function drawBarChart(container, opts){
  try{
    const id = container.id || 'bc_'+Math.random().toString(36).slice(2,8);
    const {labels, series, formatY=(v=>v), height=260, signed=false, legend=true} = opts;
    if(!labels || !labels.length || !series || !series.length){ return chartFallback(container, opts.emptyMessage); }
    const hidden = getHiddenSet(id);
    const visible = series.filter(s=>!hidden.has(s.key));
    const activeSeries = visible.length ? visible : series;
    const allVals = activeSeries.flatMap(s=>s.data.filter(v=>v!==null&&v!==undefined));
    if(!allVals.length){ return chartFallback(container, opts.emptyMessage); }
    const n=labels.length;
    const gridColor = themeVar('--chart-grid', GRID_COLOR);
    const W=780, H=Math.max(320, height || chartHeightFor(n)), padL=CHART_PAD.L, padR=CHART_PAD.R, padT=CHART_PAD.T, padB=CHART_PAD.B;
    const plotW=W-padL-padR, plotH=H-padT-padB;
    let maxV=Math.max(0,...allVals), minV=Math.min(0,...allVals);
    if(maxV===minV) maxV = maxV + Math.max(1,Math.abs(maxV)*0.1) || 1;
    const groupW = plotW/n;
    const barW = Math.min(30, (groupW*0.68)/activeSeries.length);
    const yScale = v => padT + plotH - ((v-minV)/(maxV-minV))*plotH;
    const zeroY = yScale(0);

    const {svg, clipId, clipEl} = chartShell(container, id, W, H, legend&&series.length>1?series:null, hidden, key=>{
      if(hidden.has(key)) hidden.delete(key); else hidden.add(key);
      drawBarChart(container, opts);
    });
    if(opts.ariaLabel) svg.setAttribute('aria-label', opts.ariaLabel);
    const clipRect = document.createElementNS(SVGNS,'rect');
    clipRect.setAttribute('x',padL); clipRect.setAttribute('y',padT); clipRect.setAttribute('width',plotW); clipRect.setAttribute('height',plotH);
    clipEl.appendChild(clipRect);

    const ticks = yTickCount(plotH);
    for(let g=0; g<=ticks; g++){
      const v = minV + (maxV-minV)*g/ticks, y = yScale(v);
      svgLine(svg, padL, y, W-padR, y, gridColor, 1, {'stroke-opacity':GRID_OPACITY});
      svgText(svg, padL-12, y+4, fmtIDRid(v), {anchor:'end', mono:true, size:AXIS_LABEL_SIZE});
    }
    const labelEvery = Math.max(1, Math.ceil(n/12));
    const tip = chartTooltip(container.querySelector('div'));

    const dataG = document.createElementNS(SVGNS,'g');
    dataG.setAttribute('clip-path', `url(#${clipId})`);
    svg.appendChild(dataG);

    labels.forEach((lab,i)=>{
      const gx = padL + i*groupW;
      if(i%labelEvery===0 || i===n-1) svgText(svg, gx+groupW/2, H-12, lab, {size:AXIS_LABEL_SIZE});
      activeSeries.forEach((s,si)=>{
        const v = s.data[i];
        const bx = gx + groupW/2 - (activeSeries.length*barW)/2 + si*barW;
        const g2 = document.createElementNS(SVGNS,'g');
        g2.style.cursor = 'pointer';
        if(v===null||v===undefined){
          const tick = document.createElementNS(SVGNS,'rect');
          tick.setAttribute('x',bx); tick.setAttribute('y',zeroY-1); tick.setAttribute('width',Math.max(barW-4,4)); tick.setAttribute('height',2);
          tick.setAttribute('fill', themeVar('--chart-axis','#5E6A87')); tick.setAttribute('opacity','0.5');
          g2.appendChild(tick);
        } else {
          const barY = v>=0 ? yScale(v) : zeroY;
          const barH = Math.max(Math.abs(zeroY-yScale(v)),1);
          const barRect = document.createElementNS(SVGNS,'rect');
          barRect.setAttribute('x',bx); barRect.setAttribute('y',barY); barRect.setAttribute('width',Math.max(barW-4,4)); barRect.setAttribute('height',barH); barRect.setAttribute('rx','2');
          const fill = signed ? (v>=0?themeVar('--chart-positive','#4FAE7C'):themeVar('--chart-negative','#C1543F')) : ((s.colors && s.colors[i]) || s.color);
          barRect.setAttribute('fill', fill);
          g2.appendChild(barRect);
        }
        g2.addEventListener('mouseenter', ()=>{
          tip.innerHTML = opts.tooltipHTML ? opts.tooltipHTML(i, si) :
            `<div style="font-weight:600;margin-bottom:4px;">${escapeHtml(lab)}</div><div>${escapeHtml(s.label)}: <b style="font-family:monospace;">${v===null||v===undefined?'no data':formatY(v)}</b></div>`;
          tip.style.opacity='1';
        });
        g2.addEventListener('mousemove', e=>positionTooltip(container.querySelector('div'), tip, e));
        g2.addEventListener('mouseleave', ()=>{ tip.style.opacity='0'; });
        if(opts.onBarClick) g2.addEventListener('click', ()=>opts.onBarClick(i, si));
        dataG.appendChild(g2);
      });
    });
    svgLine(svg, padL, zeroY, W-padR, zeroY, gridColor, 1.4);
  }catch(err){
    console.error('drawBarChart error', err);
    chartFallback(container, 'Chart could not render (' + err.message + ').');
  }
}
