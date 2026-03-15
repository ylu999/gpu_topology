// ═══ LAYER 3: RENDERING (SVG + D3 zoom) ═══

import { EDGE_META } from './data.js';
import { LAYOUT, PODS, RACKS, NODES, SWITCHES, ZONE } from './topology.js';

const NW=LAYOUT.nodeW, NH=LAYOUT.nodeH;
const GW=LAYOUT.gpuW,  GH=LAYOUT.gpuH;
const CW=LAYOUT.cpuW,  CH=LAYOUT.cpuH;

// ─── SVG root & layers ───────────────────────────────────────────────────────
const svg = d3.select('#sv');
const root = d3.select('#root');

const lGrid     = d3.select('#l-grid');
const lZone     = d3.select('#l-zone');
const lPods     = d3.select('#l-pods');
const lRacks    = d3.select('#l-racks');
const lSwEth    = d3.select('#l-switches-eth');
const lSwIb     = d3.select('#l-switches-ib');
const lSw       = d3.select('#l-switches');
const lNodes    = d3.select('#l-nodes');
const lChips    = d3.select('#l-chips');
const lNvlink   = d3.select('#l-edges-nvlink');
const lPcie     = d3.select('#l-edges-pcie');

// ─── Camera / zoom state ─────────────────────────────────────────────────────
export let W = window.innerWidth;
export let H = window.innerHeight;
let currentK = 1;
let currentTx = 0, currentTy = 0;
let animRaf = null;

// ─── D3 zoom ─────────────────────────────────────────────────────────────────
export const zoom = d3.zoom()
  .scaleExtent([0.04, 20])
  .on('zoom', e => {
    root.attr('transform', e.transform);
    currentK  = e.transform.k;
    currentTx = e.transform.x;
    currentTy = e.transform.y;
    updateLOD(currentK);
    updateHUD();
    updateTextScale(currentK);
  });

svg.call(zoom);

// Prevent default browser scroll on the SVG (must use addEventListener for passive:false)
document.getElementById('sv').addEventListener('wheel', e => e.preventDefault(), { passive: false });

// ─── Counter-scale text so labels stay readable at all zoom levels ───────────
// Each text element stores its "base" font size in data-fs attribute.
// On zoom, we set font-size = base / k, so text appears at constant screen size.
export function updateTextScale(k) {
  root.selectAll('text[data-fs]').each(function() {
    const base = +d3.select(this).attr('data-fs');
    d3.select(this).attr('font-size', base / k);
  });
}

// ─── LOD ─────────────────────────────────────────────────────────────────────
export function getLOD(k) {
  if (k < 0.12) return 0;
  if (k < 0.28) return 1;
  if (k < 0.55) return 2;
  if (k < 1.6)  return 3;
  return 4;
}
const LOD_NAMES = ['Zone','Pod','Rack','Node','Chip'];

export function updateLOD(k) {
  const lod = getLOD(k);
  // zone always shown; grid always shown
  lZone.style('display', null);
  // zone labels only shown at lod < 2
  lZone.selectAll('.zone-lbl1, .zone-lbl2').style('display', lod < 2 ? null : 'none');
  lPods.style('display',  (lod >= 1) ? null : 'none');
  lRacks.style('display', (lod >= 2 && lod < 4) ? null : 'none');
  lNodes.style('display', (lod === 3) ? null : 'none');
  lChips.style('display', (lod >= 4) ? null : 'none');
  // nvlink/pcie visibility: lod>=4 AND their toggle
  lNvlink.style('display', (lod >= 4 && lv.nvlink) ? null : 'none');
  lPcie.style('display',   (lod >= 4) ? null : 'none');
  // switch sub-layers
  lSwEth.style('display', lv.eth ? null : 'none');     // core↔spine eth
  lSwIb.style('display',  (lod >= 1 && lv.ib) ? null : 'none');
  lSw.style('display',    null);
  // within switches layer, tor circles shown at lod>=2
  lSw.selectAll('.sw-tor').style('display', (lod >= 2) ? null : 'none');
  lSwIb.selectAll('.ib-node-tor').style('display', (k > 0.3) ? null : 'none');
}

// ─── Link visibility ─────────────────────────────────────────────────────────
export const lv = { nvlink: true, pcie: true, ib: true, eth: true };

// ─── Programmatic camera helpers ─────────────────────────────────────────────
function easeInOut(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }

export function animateTo(tx, ty, ts, dur=420) {
  // current transform
  const cur = d3.zoomTransform(svg.node());
  const sx = cur.x, sy = cur.y, ss = cur.k;
  const t0 = performance.now();
  if (animRaf) cancelAnimationFrame(animRaf);
  function step(now) {
    const t  = Math.min(1, (now - t0) / dur);
    const e  = easeInOut(t);
    const nx = sx + (tx - sx) * e;
    const ny = sy + (ty - sy) * e;
    const nk = ss + (ts - ss) * e;
    svg.call(zoom.transform, d3.zoomIdentity.translate(nx, ny).scale(nk));
    if (t < 1) animRaf = requestAnimationFrame(step);
  }
  animRaf = requestAnimationFrame(step);
}

export function fitBox(x, y, w, h, pad=60) {
  const sc = Math.min(W / (w + pad*2), H / (h + pad*2));
  const tx = W/2 - (x + w/2) * sc;
  const ty = H/2 - (y + h/2) * sc;
  animateTo(tx, ty, sc);
}

export function doZoom(f) {
  const cur = d3.zoomTransform(svg.node());
  const ns = Math.max(0.04, Math.min(20, cur.k * f));
  // zoom toward center
  const tx = W/2 - (W/2 - cur.x) * (ns / cur.k);
  const ty = H/2 - (H/2 - cur.y) * (ns / cur.k);
  animateTo(tx, ty, ns, 200);
}

// ─── Coordinate helpers ───────────────────────────────────────────────────────
// screen → world (SVG world coordinates)
export function s2w(sx, sy) {
  const t = d3.zoomTransform(svg.node());
  return { x: (sx - t.x) / t.k, y: (sy - t.y) / t.k };
}

// ─── HUD ─────────────────────────────────────────────────────────────────────
export function updateHUD() {
  const k = d3.zoomTransform(svg.node()).k;
  document.getElementById('zlvl').textContent = `缩放: ${Math.round(k * 100)}%`;
  document.getElementById('lodlabel').textContent = LOD_NAMES[getLOD(k)] + ' 视图';
}

// ─── Edge tooltip ─────────────────────────────────────────────────────────────
export function showEdgeTip(type, sx, sy) {
  const m = EDGE_META[type];
  if (!m) return;
  const el   = document.getElementById('etip');
  const head = document.getElementById('et-head');
  const rows = document.getElementById('et-rows');
  const use  = document.getElementById('et-use');

  head.textContent = m.protocol;
  head.style.color = m.color.replace(/[\d.]+\)$/, '1)');

  const skip = new Set(['protocol','use','color']);
  const labels = { bw:'带宽', total_bw:'总带宽', node_total:'节点总带宽', latency:'延迟', encoding:'编码', rdma:'RDMA', topo:'拓扑' };
  rows.innerHTML = Object.entries(m)
    .filter(([k]) => !skip.has(k))
    .map(([k,v]) => `<div class="erow"><span class="ekey">${labels[k]||k}</span><span class="eval">${v}</span></div>`)
    .join('');
  use.textContent = m.use;

  const PAD = 14, W_TIP = 230;
  let lx = sx + PAD, ly = sy - 20;
  if (lx + W_TIP > window.innerWidth) lx = sx - W_TIP - PAD;
  if (ly < 0) ly = sy + PAD;
  el.style.left = lx + 'px';
  el.style.top  = ly + 'px';
  el.style.display = 'block';
}

export function hideEdgeTip() {
  document.getElementById('etip').style.display = 'none';
}

// ─── SVG element builders ─────────────────────────────────────────────────────
// Helper: append text with counter-scale support
// Pass data-fs to opt into counter-scaling
function svgText(parent, x, y, txt, opts={}) {
  const t = parent.append('text')
    .attr('x', x).attr('y', y)
    .attr('font-family', '"SF Mono",Consolas,monospace')
    .attr('fill', opts.fill || '#e2e8f0')
    .attr('font-size', opts.fs || 11)
    .attr('text-anchor', opts.anchor || 'middle')
    .attr('dominant-baseline', opts.base || 'middle')
    .attr('pointer-events', 'none')
    .text(txt);
  if (opts.bold) t.attr('font-weight', 600);
  if (opts.scale !== false) t.attr('data-fs', opts.fs || 11); // counter-scale by default
  return t;
}

// All elements are created ONCE; LOD show/hide is done by updateLOD()

function buildGrid() {
  lGrid.selectAll('*').remove();
  const step = 200;
  // Use a large grid extent
  const ext = 8000;
  const x0 = Math.floor(-ext / step) * step;
  for (let x = x0; x <= ext; x += step) {
    lGrid.append('line')
      .attr('x1', x).attr('y1', -ext).attr('x2', x).attr('y2', ext)
      .attr('stroke', 'rgba(255,255,255,0.018)').attr('stroke-width', 1);
  }
  for (let y = x0; y <= ext; y += step) {
    lGrid.append('line')
      .attr('x1', -ext).attr('y1', y).attr('x2', ext).attr('y2', y)
      .attr('stroke', 'rgba(255,255,255,0.018)').attr('stroke-width', 1);
  }
}

function buildZone() {
  lZone.selectAll('*').remove();
  const z = ZONE;
  lZone.append('rect')
    .attr('x', z.x).attr('y', z.y).attr('width', z.w).attr('height', z.h)
    .attr('rx', 18)
    .attr('fill', 'rgba(59,130,246,0.022)')
    .attr('stroke', 'rgba(59,130,246,0.2)')
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '8 5')
    .attr('class', 'hit-zone')
    .style('cursor', 'pointer');

  lZone.append('text')
    .attr('x', z.x + 16).attr('y', z.y + 18)
    .attr('fill', 'rgba(147,197,253,0.55)')
    .attr('font-size', 32).attr('font-weight', 600)
    .attr('font-family', '"SF Mono",Consolas,monospace')
    .attr('dominant-baseline', 'hanging')
    .attr('class', 'zone-lbl1 lod-hide-2')
    .attr('pointer-events', 'none')
    .text('Availability Zone');

  lZone.append('text')
    .attr('x', z.x + 16).attr('y', z.y + 56)
    .attr('fill', 'rgba(147,197,253,0.25)')
    .attr('font-size', 14)
    .attr('font-family', '"SF Mono",Consolas,monospace')
    .attr('dominant-baseline', 'hanging')
    .attr('class', 'zone-lbl2 lod-hide-2')
    .attr('pointer-events', 'none')
    .text('35,000+ GPU · 3 Pods · InfiniBand Fat-Tree + Ethernet Core');
}

function buildPods() {
  lPods.selectAll('*').remove();
  PODS.forEach(p => {
    const g = lPods.append('g').attr('class', 'hit-pod').style('cursor', 'pointer')
      .attr('data-type', 'pod');
    g.append('rect')
      .attr('x', p.x).attr('y', p.y).attr('width', p.w).attr('height', p.h)
      .attr('rx', 10)
      .attr('fill', p.fill)
      .attr('stroke', p.stroke)
      .attr('stroke-width', 0.9);
    g.append('text')
      .attr('x', p.x + 12).attr('y', p.y + 18)
      .attr('fill', 'rgba(196,181,253,0.85)')
      .attr('font-size', 26).attr('font-weight', 600)
      .attr('font-family', '"SF Mono",Consolas,monospace')
      .attr('dominant-baseline', 'hanging')
      .attr('pointer-events', 'none')
      .text(p.name);
  });
}

function buildRacks() {
  lRacks.selectAll('*').remove();
  RACKS.forEach(r => {
    const g = lRacks.append('g').attr('class', 'hit-rack').style('cursor', 'pointer')
      .attr('data-type', 'rack');
    g.append('rect')
      .attr('x', r.x).attr('y', r.y).attr('width', r.w).attr('height', r.h)
      .attr('rx', 5)
      .attr('fill', 'rgba(6,182,212,0.05)')
      .attr('stroke', 'rgba(6,182,212,0.22)')
      .attr('stroke-width', 0.7);
    g.append('text')
      .attr('x', r.x + r.w/2).attr('y', r.y + 14)
      .attr('fill', 'rgba(103,232,249,0.8)')
      .attr('font-size', 13)
      .attr('font-family', '"SF Mono",Consolas,monospace')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'hanging')
      .attr('pointer-events', 'none')
      .text(r.name);
  });
}

function buildSwitches() {
  lSwEth.selectAll('*').remove();
  lSwIb.selectAll('*').remove();
  lSw.selectAll('*').remove();

  const spines = SWITCHES.filter(s => s.type === 'spine');
  const core   = SWITCHES.find(s => s.type === 'core');
  const tors   = SWITCHES.filter(s => s.type === 'tor');

  // Eth edges: spine ↔ core
  if (core) {
    spines.forEach(sp => {
      lSwEth.append('line')
        .attr('class', 'edge-eth')
        .attr('x1', sp.cx).attr('y1', sp.cy)
        .attr('x2', core.cx).attr('y2', core.cy)
        .attr('stroke', 'rgba(34,197,94,0.3)')
        .attr('stroke-width', 1.2)
        .attr('stroke-dasharray', '6 3')
        .style('cursor', 'pointer')
        .attr('data-etype', 'eth');
    });
  }

  // IB: tor ↔ spine
  tors.forEach(tor => {
    const rack = RACKS.find(r => r.id === tor.rackId);
    if (!rack) return;
    const sp = spines.find(s => s.podId === rack.podId);
    if (sp) {
      lSwIb.append('line')
        .attr('class', 'edge-ib')
        .attr('x1', tor.cx).attr('y1', tor.cy)
        .attr('x2', sp.cx).attr('y2', sp.cy)
        .attr('stroke', 'rgba(6,182,212,0.32)')
        .attr('stroke-width', 1)
        .style('cursor', 'pointer')
        .attr('data-etype', 'ib_tor_spine');
    }
  });

  // IB: node ↔ tor (shown when k > 0.3)
  tors.forEach(tor => {
    const rack = RACKS.find(r => r.id === tor.rackId);
    if (!rack) return;
    NODES.filter(n => n.rackId === rack.id).forEach(nd => {
      lSwIb.append('line')
        .attr('class', 'edge-ib ib-node-tor')
        .attr('x1', nd.x + nd.w/2).attr('y1', nd.y + nd.h)
        .attr('x2', tor.cx).attr('y2', tor.cy)
        .attr('stroke', 'rgba(6,182,212,0.16)')
        .attr('stroke-width', 0.6)
        .style('cursor', 'pointer')
        .attr('data-etype', 'ib_node_tor');
    });
  });

  // Core router shape
  if (core) {
    const cg = lSw.append('g').attr('class', 'hit-core').style('cursor', 'pointer')
      .attr('data-type', 'core');
    cg.append('rect')
      .attr('x', core.cx - core.w/2).attr('y', core.cy - core.h/2)
      .attr('width', core.w).attr('height', core.h).attr('rx', 4)
      .attr('fill', 'rgba(34,197,94,0.22)').attr('stroke', 'rgba(34,197,94,0.7)')
      .attr('stroke-width', 1);
    cg.append('text')
      .attr('x', core.cx).attr('y', core.cy)
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
      .attr('fill', '#86efac').attr('font-size', 13)
      .attr('font-family', '"SF Mono",Consolas,monospace')
      .attr('pointer-events', 'none')
      .text('Core Router');
  }

  // Spine shapes
  spines.forEach(sp => {
    const sg = lSw.append('g').attr('class', 'hit-spine').style('cursor', 'pointer')
      .attr('data-type', 'spine');
    sg.append('rect')
      .attr('x', sp.cx - sp.w/2).attr('y', sp.cy - sp.h/2)
      .attr('width', sp.w).attr('height', sp.h).attr('rx', 4)
      .attr('fill', 'rgba(34,197,94,0.14)').attr('stroke', 'rgba(34,197,94,0.45)')
      .attr('stroke-width', 0.9);
    sg.append('text')
      .attr('x', sp.cx).attr('y', sp.cy)
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
      .attr('fill', 'rgba(134,239,172,0.85)').attr('font-size', 11)
      .attr('font-family', '"SF Mono",Consolas,monospace')
      .attr('pointer-events', 'none')
      .text(sp.podId.replace('pod', 'Pod '));
  });

  // ToR circles
  tors.forEach(tor => {
    const r = 13;
    const tg = lSw.append('g').attr('class', 'hit-tor sw-tor').style('cursor', 'pointer')
      .attr('data-type', 'tor');
    tg.append('circle')
      .attr('cx', tor.cx).attr('cy', tor.cy).attr('r', r)
      .attr('fill', 'rgba(6,182,212,0.16)').attr('stroke', 'rgba(6,182,212,0.65)')
      .attr('stroke-width', 0.9);
    tg.append('text')
      .attr('x', tor.cx).attr('y', tor.cy)
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
      .attr('fill', '#67e8f9').attr('font-size', 12)
      .attr('font-family', '"SF Mono",Consolas,monospace')
      .attr('pointer-events', 'none')
      .text('ToR');
  });
}

function buildNodesMini() {
  lNodes.selectAll('*').remove();
  NODES.forEach((nd, ni) => {
    const g = lNodes.append('g')
      .attr('class', 'hit-node')
      .attr('data-type', 'node')
      .attr('data-node-id', nd.id)
      .style('cursor', 'pointer');

    g.append('rect')
      .attr('x', nd.x).attr('y', nd.y).attr('width', nd.w).attr('height', nd.h)
      .attr('rx', 4)
      .attr('fill', 'rgba(12,18,36,0.97)').attr('stroke', 'rgba(34,197,94,0.32)')
      .attr('stroke-width', 0.7);

    g.append('text')
      .attr('x', nd.x + 5).attr('y', nd.y + 6)
      .attr('fill', 'rgba(134,239,172,0.8)').attr('font-size', 11).attr('font-weight', 600)
      .attr('font-family', '"SF Mono",Consolas,monospace')
      .attr('dominant-baseline', 'hanging')
      .attr('data-fs', 11)
      .attr('pointer-events', 'none')
      .text(nd.name);

    g.append('text')
      .attr('x', nd.x + nd.w - 4).attr('y', nd.y + 6)
      .attr('fill', 'rgba(251,146,60,0.65)').attr('font-size', 10)
      .attr('font-family', '"SF Mono",Consolas,monospace')
      .attr('text-anchor', 'end').attr('dominant-baseline', 'hanging')
      .attr('data-fs', 10)
      .attr('pointer-events', 'none')
      .text('8× H100');

    // mini CPUs
    [0,1].forEach(c => {
      g.append('rect')
        .attr('x', nd.x + 4 + c*50).attr('y', nd.y + 7)
        .attr('width', 42).attr('height', 20).attr('rx', 2)
        .attr('fill', 'rgba(59,130,246,0.55)').attr('stroke', 'rgba(59,130,246,0.4)')
        .attr('stroke-width', 0.35);
    });

    // mini GPUs
    const gw = Math.floor((nd.w - 16) / 4) - 4;
    const gh = Math.floor((nd.h - 40) / 2) - 5;
    for (let gi = 0; gi < 8; gi++) {
      const col = gi % 4, row = Math.floor(gi / 4);
      const gx = nd.x + 6 + col * (gw + 4);
      const gy = nd.y + 34 + row * (gh + 5);
      g.append('rect')
        .attr('x', gx).attr('y', gy).attr('width', gw).attr('height', gh).attr('rx', 2)
        .attr('fill', 'rgba(249,115,22,0.62)').attr('stroke', 'rgba(249,115,22,0.45)')
        .attr('stroke-width', 0.4)
        .attr('class', `mini-gpu-${ni}-${gi}`);
      g.append('text')
        .attr('x', gx + gw/2).attr('y', gy + gh/2)
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
        .attr('fill', 'rgba(255,255,255,0.85)').attr('font-size', 10)
        .attr('font-family', '"SF Mono",Consolas,monospace')
        .attr('pointer-events', 'none')
        .text(`GPU ${gi}`);
    }

    // mini nvlink connectors
    const nvlinkG = g.append('g').attr('class', 'nvlink-mini');
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        const x1 = nd.x + 6 + (col+1) * (gw+4);
        const y1 = nd.y + 34 + row * (gh+5) + gh/2;
        nvlinkG.append('line')
          .attr('x1', x1).attr('y1', y1).attr('x2', x1 + 4).attr('y2', y1)
          .attr('stroke', 'rgba(249,115,22,0.3)').attr('stroke-width', 0.7);
      }
    }
  });
}

function buildNodesChip() {
  lChips.selectAll('*').remove();
  lNvlink.selectAll('*').remove();
  lPcie.selectAll('*').remove();

  const NVS_CX = [30, 95, 160, 225];
  const NVS_CY = 58, NVS_R = 10;
  const GPU_Y  = [76, 114];
  const GPU_STRIDE = 64;
  const NIC_Y = 148, NIC_W = 26, NIC_H = 16;

  NODES.forEach((nd, ni) => {
    // Node background
    const ng = lChips.append('g')
      .attr('class', 'hit-node')
      .attr('data-type', 'node')
      .attr('data-node-id', nd.id)
      .style('cursor', 'pointer');

    ng.append('rect')
      .attr('x', nd.x).attr('y', nd.y).attr('width', nd.w).attr('height', nd.h)
      .attr('rx', 5)
      .attr('fill', 'rgba(10,16,32,0.97)').attr('stroke', 'rgba(34,197,94,0.35)')
      .attr('stroke-width', 0.6);

    // Node label (counter-scaled)
    svgText(ng, nd.x + 5, nd.y + 16, nd.name,
      {fs:11, fill:'rgba(134,239,172,0.85)', anchor:'start', base:'middle', bold:true});
    svgText(ng, nd.x + NW - 5, nd.y + 16, 'DGX H100',
      {fs:9, fill:'rgba(134,239,172,0.3)', anchor:'end', base:'middle'});

    // CPUs
    const cpuPositions = [[nd.x + 4, nd.y + 18], [nd.x + 60, nd.y + 18]];
    cpuPositions.forEach(([cpx, cpy], c) => {
      const cg = lChips.append('g')
        .attr('class', 'hit-cpu')
        .attr('data-type', 'cpu')
        .attr('data-node-id', nd.id)
        .style('cursor', 'pointer');
      cg.append('rect')
        .attr('x', cpx).attr('y', cpy).attr('width', CW).attr('height', CH).attr('rx', 2)
        .attr('fill', 'rgba(59,130,246,0.78)').attr('stroke', '#60a5fa').attr('stroke-width', 0.8);
      svgText(cg, cpx + CW/2, cpy + CH/2, `CPU${c}`,
        {fs:10, fill:'#fff'});
    });

    // CPU–CPU UPI (PCIe group)
    lPcie.append('line')
      .attr('class', 'edge-upi')
      .attr('x1', cpuPositions[0][0] + CW).attr('y1', cpuPositions[0][1] + CH/2)
      .attr('x2', cpuPositions[1][0]).attr('y2', cpuPositions[1][1] + CH/2)
      .attr('stroke', 'rgba(147,197,253,0.55)').attr('stroke-width', 1.2)
      .style('cursor', 'pointer')
      .attr('data-etype', 'upi');

    lPcie.append('text')
      .attr('x', nd.x + 58).attr('y', cpuPositions[0][1] + CH/2)
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
      .attr('fill', 'rgba(147,197,253,0.5)').attr('font-size', 9)
      .attr('font-family', '"SF Mono",Consolas,monospace')
      .attr('pointer-events', 'none')
      .attr('data-fs', 9)
      .text('UPI');

    // NVSwitches
    const nvSW = NVS_CX.map(dx => ({ cx: nd.x + dx, cy: nd.y + NVS_CY }));
    nvSW.forEach((sw, si) => {
      // halo
      lChips.append('circle')
        .attr('cx', sw.cx).attr('cy', sw.cy).attr('r', NVS_R + 3)
        .attr('fill', 'rgba(139,92,246,0.1)').attr('stroke', 'rgba(139,92,246,0.3)')
        .attr('stroke-width', 0.4)
        .attr('pointer-events', 'none');

      const swg = lChips.append('g')
        .attr('class', 'hit-nvswitch')
        .attr('data-type', 'nvswitch')
        .attr('data-node-id', nd.id)
        .style('cursor', 'pointer');
      swg.append('circle')
        .attr('cx', sw.cx).attr('cy', sw.cy).attr('r', NVS_R)
        .attr('fill', 'rgba(139,92,246,0.88)').attr('stroke', '#a78bfa').attr('stroke-width', 0.9);
      svgText(swg, sw.cx, sw.cy, `NVS${si}`,
        {fs:8, fill:'#fff'});

      // NVSwitch → CPU (pcie)
      const ci = si < 2 ? 0 : 1;
      const [cpx, cpy] = cpuPositions[ci];
      lPcie.append('line')
        .attr('class', 'edge-pcie')
        .attr('x1', sw.cx).attr('y1', sw.cy - NVS_R)
        .attr('x2', cpx + CW/2).attr('y2', cpy + CH)
        .attr('stroke', 'rgba(139,92,246,0.15)').attr('stroke-width', 0.4)
        .attr('stroke-dasharray', '2 3')
        .style('cursor', 'pointer')
        .attr('data-etype', 'pcie');
    });

    // NVSwitch fabric label — small, centered, counter-scaled
    svgText(lChips, nd.x + NW/2, nd.y + 50, 'NVLink 4.0 All-to-All Fabric',
      {fs:8, fill:'rgba(167,139,250,0.4)'});

    // ── NVLink Fabric Bus Bars ──────────────────────────────────────────────
    // Two horizontal bus bars (one per GPU row), NVSwitches tap off vertically.
    // Much cleaner than 32 crossing lines.
    const BUS_Y = [GPU_Y[0] - 10, GPU_Y[1] + GH + 10]; // above row0, below row1
    const BUS_X1 = nd.x + 4 + GW/2;                    // left edge of GPU col 0 center
    const BUS_X2 = nd.x + 4 + 3*GPU_STRIDE + GW/2;     // right edge of GPU col 3 center

    BUS_Y.forEach((by, row) => {
      // horizontal bus bar
      lNvlink.append('line')
        .attr('class', 'edge-nvlink nvlink-bus')
        .attr('x1', BUS_X1).attr('y1', by)
        .attr('x2', BUS_X2).attr('y2', by)
        .attr('stroke', 'rgba(249,115,22,0.55)').attr('stroke-width', 2)
        .style('cursor', 'pointer')
        .attr('data-etype', 'nvlink');
    });

    // NVSwitch vertical taps — only tap to UPPER bus bar (no lower tap to avoid crossing GPUs)
    nvSW.forEach((sw, si) => {
      lNvlink.append('line')
        .attr('class', 'edge-nvlink nvlink-tap')
        .attr('x1', sw.cx).attr('y1', sw.cy + NVS_R)
        .attr('x2', sw.cx).attr('y2', BUS_Y[0])
        .attr('stroke', 'rgba(249,115,22,0.4)').attr('stroke-width', 1.2)
        .style('cursor', 'pointer')
        .attr('data-etype', 'nvlink');
    });

    // PCIe Bus Bars: one bar per CPU, GPUs tap up, NICs tap down
    const PCIE_BUS_Y = nd.y + 18 + CH + 5; // just below CPUs
    // horizontal PCIe bar
    lPcie.append('line')
      .attr('class', 'edge-pcie pcie-bus')
      .attr('x1', nd.x + 4).attr('y1', PCIE_BUS_Y)
      .attr('x2', nd.x + NW - 4).attr('y2', PCIE_BUS_Y)
      .attr('stroke', 'rgba(139,92,246,0.35)').attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4 2')
      .style('cursor', 'pointer')
      .attr('data-etype', 'pcie');
    // CPU taps down to bar
    cpuPositions.forEach(([cpx, cpy]) => {
      lPcie.append('line')
        .attr('class', 'edge-pcie pcie-tap')
        .attr('x1', cpx + CW/2).attr('y1', cpy + CH)
        .attr('x2', cpx + CW/2).attr('y2', PCIE_BUS_Y)
        .attr('stroke', 'rgba(139,92,246,0.35)').attr('stroke-width', 1)
        .style('cursor', 'pointer')
        .attr('data-etype', 'pcie');
    });

    // GPUs, HBM, NVLink stubs, PCIe stubs, NICs
    for (let gi = 0; gi < 8; gi++) {
      const col = gi % 4, row = Math.floor(gi / 4);
      const gx = nd.x + 4 + col * GPU_STRIDE;
      const gy = nd.y + GPU_Y[row];

      // NVLink stub: GPU → bus bar (short vertical line)
      const busY = BUS_Y[row];
      lNvlink.append('line')
        .attr('class', 'edge-nvlink nvlink-stub')
        .attr('x1', gx + GW/2).attr('y1', row === 0 ? gy : gy + GH)
        .attr('x2', gx + GW/2).attr('y2', busY)
        .attr('stroke', 'rgba(249,115,22,0.5)').attr('stroke-width', 1)
        .style('cursor', 'pointer')
        .attr('data-etype', 'nvlink');

      // PCIe stub: only show for row 0 GPUs (row 1 stubs would cross row 0 GPUs)
      if (row === 0) {
        lPcie.append('line')
          .attr('class', 'edge-pcie pcie-stub')
          .attr('x1', gx + GW/2).attr('y1', gy)
          .attr('x2', gx + GW/2).attr('y2', PCIE_BUS_Y)
          .attr('stroke', 'rgba(139,92,246,0.2)').attr('stroke-width', 0.5)
          .attr('stroke-dasharray', '2 2')
          .style('cursor', 'pointer')
          .attr('data-etype', 'pcie');
      }
      const gg = lChips.append('g')
        .attr('class', 'hit-gpu')
        .attr('data-type', 'gpu')
        .attr('data-node-idx', ni)
        .attr('data-gpu-idx', gi)
        .style('cursor', 'pointer');
      gg.append('rect')
        .attr('x', gx).attr('y', gy).attr('width', GW).attr('height', GH).attr('rx', 3)
        .attr('fill', 'rgba(249,115,22,0.82)').attr('stroke', '#fb923c').attr('stroke-width', 0.9);
      svgText(gg, gx + GW/2, gy + 10, `GPU ${gi}`,
        {fs:10, fill:'#fff', bold:true});

      // HBM
      const hg = lChips.append('g')
        .attr('class', 'hit-hbm')
        .attr('data-type', 'hbm')
        .attr('data-node-id', nd.id)
        .style('cursor', 'pointer');
      hg.append('rect')
        .attr('x', gx + 2).attr('y', gy + GH - 9).attr('width', GW - 4).attr('height', 7).attr('rx', 1)
        .attr('fill', 'rgba(14,116,144,0.7)').attr('stroke', '#06b6d4').attr('stroke-width', 0.4);
      svgText(hg, gx + GW/2, gy + GH - 5, 'HBM3 80G',
        {fs:7, fill:'#67e8f9'});
    }

    // NIC section label
    svgText(lChips, nd.x + NW/2, nd.y + NIC_Y - 7, 'IB NIC ×8 — ConnectX-7  GPUDirect RDMA',
      {fs:8, fill:'rgba(134,239,172,0.3)'});

    // NICs
    for (let n = 0; n < 8; n++) {
      const col = n % 4, row = Math.floor(n / 4);
      const nx2 = nd.x + 4 + col * GPU_STRIDE + (GPU_STRIDE - NIC_W) / 2;
      const ny  = nd.y + NIC_Y + row * 20;

      const nicg = lChips.append('g')
        .attr('class', 'hit-nic')
        .attr('data-type', 'nic')
        .attr('data-node-id', nd.id)
        .style('cursor', 'pointer');
      nicg.append('rect')
        .attr('x', nx2).attr('y', ny).attr('width', NIC_W).attr('height', NIC_H).attr('rx', 2)
        .attr('fill', 'rgba(6,78,59,0.78)').attr('stroke', '#22c55e').attr('stroke-width', 0.7);
      svgText(nicg, nx2 + NIC_W/2, ny + NIC_H/2, `NIC ${n}  IB/RoCE`,
        {fs:8, fill:'#86efac'});

      // NIC → matching GPU: short direct line, same column, no crossing
      // NIC row 0 (n<4) → GPU row 0, NIC row 1 (n>=4) → GPU row 1
      // Line goes straight up from NIC top to GPU bottom — no crossing since same column
      const nicGpuX = nd.x + 4 + col * GPU_STRIDE + GW/2;
      const nicGpuBotY = nd.y + GPU_Y[row] + GH;
      lPcie.append('line')
        .attr('class', 'edge-nic-gpu')
        .attr('x1', nicGpuX).attr('y1', ny)
        .attr('x2', nicGpuX).attr('y2', nicGpuBotY)
        .attr('stroke', 'rgba(34,197,94,0.5)').attr('stroke-width', 0.8)
        .attr('stroke-dasharray', '2 2')
        .style('cursor', 'pointer')
        .attr('data-etype', 'ib');
    }
  });
}

// ─── Build all layers ─────────────────────────────────────────────────────────
export function buildScene() {
  buildGrid();
  buildZone();
  buildPods();
  buildRacks();
  buildSwitches();
  buildNodesMini();
  buildNodesChip();
  attachEvents();
  updateLOD(currentK);
  updateTextScale(currentK);
}

// ─── Event delegation ─────────────────────────────────────────────────────────
let _showInfoCb = null;
export function registerShowInfo(cb) { _showInfoCb = cb; }

let _pathClickCb = null;
export function registerPathClick(cb) { _pathClickCb = cb; }

function attachEvents() {
  // Edge tooltip: mouseover/out on edge lines
  svg.selectAll('[data-etype]')
    .on('mouseover', function(event) {
      const type = d3.select(this).attr('data-etype');
      showEdgeTip(type, event.clientX, event.clientY);
    })
    .on('mousemove', function(event) {
      const el = document.getElementById('etip');
      if (el.style.display === 'none') return;
      const PAD = 14, W_TIP = 230;
      let lx = event.clientX + PAD, ly = event.clientY - 20;
      if (lx + W_TIP > window.innerWidth) lx = event.clientX - W_TIP - PAD;
      if (ly < 0) ly = event.clientY + PAD;
      el.style.left = lx + 'px';
      el.style.top  = ly + 'px';
    })
    .on('mouseout', () => hideEdgeTip());

  // Node/component click: info panel
  // Use separate handlers for each hit group
  const hitTypes = ['zone','pod','rack','node','gpu','cpu','nvswitch','hbm','nic','tor','spine','core'];
  hitTypes.forEach(type => {
    svg.selectAll(`[data-type="${type}"]`)
      .on('click', function(event) {
        event.stopPropagation();
        if (type === 'gpu' && _pathClickCb) {
          const ni = +d3.select(this).attr('data-node-idx');
          const gi = +d3.select(this).attr('data-gpu-idx');
          _pathClickCb(ni, gi, event);
          return;
        }
        if (_showInfoCb) _showInfoCb(type);
      });
  });

  // Click on SVG background → hide info
  svg.on('click', function(event) {
    if (event.target === svg.node() || event.target.id === 'sv') {
      document.getElementById('info').style.display = 'none';
    }
  });

  // D3 drag cursor class
  svg.on('mousedown.cursor', () => svg.classed('dragging', true));
  svg.on('mouseup.cursor',   () => svg.classed('dragging', false));
}

// ─── Link visibility toggles ─────────────────────────────────────────────────
export function applyLinkVisibility() {
  // updateLOD handles all visibility including link toggles
  updateLOD(currentK);
  // pcie sub-elements (individual lines in pcie layer)
  if (getLOD(currentK) >= 4) {
    lPcie.selectAll('.edge-pcie, .edge-upi')
      .style('display', lv.pcie ? null : 'none');
    lPcie.selectAll('text').style('display', lv.pcie ? null : 'none');
    // NIC-GPU lines: these are "ib" logically (GPUDirect), toggle with pcie as they're PCIe physical
    lPcie.selectAll('.edge-nic-gpu').style('display', lv.pcie ? null : 'none');
  }
  // Trigger jobs/path re-render since lod may affect them
  draw();
}

// ─── draw() — no-op in SVG world (scene is live) ─────────────────────────────
export function draw() {
  // SVG is live; call sub-renderers that still need refresh
  if (_drawJobsCb) _drawJobsCb();
  if (_drawPathCb) _drawPathCb();
}

// ─── draw callbacks (jobs / paths) ───────────────────────────────────────────
let _drawJobsCb = null;
let _drawPathCb = null;
export function registerDrawCallbacks(jobsCb, pathCb) {
  _drawJobsCb = jobsCb;
  _drawPathCb = pathCb;
}

// ─── Resize ───────────────────────────────────────────────────────────────────
export function resize() {
  W = window.innerWidth;
  H = window.innerHeight;
  svg.attr('width', W).attr('height', H);
}
window.addEventListener('resize', resize);

// ─── Hit test (world coords) — for paths.js compatibility ────────────────────
export function hitTest(wx, wy) {
  const k = d3.zoomTransform(svg.node()).k;
  const lod = getLOD(k);

  if (lod >= 4) {
    for (const nd of NODES) {
      const nvsCx = [nd.x+30, nd.x+95, nd.x+160, nd.x+225], nvsCy = nd.y+58;
      if (nvsCx.some(cx => Math.hypot(wx-cx, wy-nvsCy) < 14)) return 'nvswitch';
      for (let g = 0; g < 8; g++) {
        const col = g%4, row = Math.floor(g/4);
        const gx = nd.x+4+col*64, gy = nd.y+[76,114][row];
        if (wx >= gx && wx <= gx+GW && wy >= gy && wy <= gy+GH) return 'gpu';
      }
      if ([0,1].some(c => { const cpx=nd.x+4+c*56, cpy=nd.y+18; return wx>=cpx&&wx<=cpx+CW&&wy>=cpy&&wy<=cpy+CH; })) return 'cpu';
      for (let n = 0; n < 8; n++) {
        const col=n%4, row=Math.floor(n/4), nx2=nd.x+4+col*64+(64-26)/2, ny=nd.y+148+row*20;
        if (wx>=nx2&&wx<=nx2+26&&wy>=ny&&wy<=ny+16) return 'nic';
      }
      for (let g = 0; g < 8; g++) {
        const col=g%4, row=Math.floor(g/4), gx=nd.x+4+col*64, gy=nd.y+[76,114][row];
        if (wx>=gx+2&&wx<=gx+GW-2&&wy>=gy+GH-9&&wy<=gy+GH) return 'hbm';
      }
      if (wx>=nd.x&&wx<=nd.x+nd.w&&wy>=nd.y&&wy<=nd.y+nd.h) return 'node';
    }
  }

  if (lod >= 3) {
    for (const nd of NODES)
      if (wx>=nd.x&&wx<=nd.x+nd.w&&wy>=nd.y&&wy<=nd.y+nd.h) return 'node';
  }

  for (const sw of SWITCHES) {
    if (sw.type === 'tor' && Math.hypot(wx-sw.cx, wy-sw.cy) < 18) return 'tor';
    if ((sw.type === 'spine' || sw.type === 'core') && sw.w) {
      if (wx>=sw.cx-sw.w/2&&wx<=sw.cx+sw.w/2&&wy>=sw.cy-sw.h/2&&wy<=sw.cy+sw.h/2) return sw.type;
    }
  }

  if (lod >= 2) { for (const r of RACKS) if (wx>=r.x&&wx<=r.x+r.w&&wy>=r.y&&wy<=r.y+r.h) return 'rack'; }
  for (const p of PODS) if (wx>=p.x&&wx<=p.x+p.w&&wy>=p.y&&wy<=p.y+p.h) return 'pod';
  const z = ZONE; if (wx>=z.x&&wx<=z.x+z.w&&wy>=z.y&&wy<=z.y+z.h) return 'zone';
  return null;
}

// Initial resize
resize();
