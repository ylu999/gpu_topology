// ═══ INTERACTION (SVG + D3 zoom edition) ═══
// D3 handles all zoom/pan/touch. This file handles:
//   - Info panel show/hide
//   - Layer navigation (goLayer)
//   - Link toggles (togLink)
//   - Path mode GPU clicks
//   - Job panel toggle
//   - Global window exports for HTML onclick

import { INFO, PODS, RACKS, NODES, ZONE } from './topology.js';
import {
  draw, resize, lv,
  doZoom, fitBox, buildScene,
  registerDrawCallbacks, registerShowInfo, registerPathClick,
  applyLinkVisibility,
} from './renderer.js';
import {
  jobs, fragMode, setFragMode, addJob, removeJob, clearJobs, updateJobPanel, drawJobs,
} from './jobs.js';
import {
  pathMode, pathSrc, pathDst,
  hitGPUWorld, computePath, drawPath,
  togglePathMode, clearPath, showPathResult, updatePathHint,
  setPathSrc, setPathDst, setPathResult,
} from './paths.js';

// Register draw callbacks
registerDrawCallbacks(drawJobs, drawPath);

// ─── Info panel ───────────────────────────────────────────────────────────────
function showInfo(type) {
  const p = document.getElementById('info'), info = INFO[type];
  if (!info) { p.style.display = 'none'; return; }
  p.style.display = 'block';
  document.getElementById('i-title').textContent = info.title;
  document.getElementById('i-rows').innerHTML = info.rows
    .map(([k,v]) => `<div class="irow"><span class="ikey">${k}</span><span class="ival">${v}</span></div>`)
    .join('');
  document.getElementById('i-desc').textContent = info.desc;
}

registerShowInfo(showInfo);

// ─── Path mode GPU click ───────────────────────────────────────────────────────
registerPathClick((nodeIdx, gpuIdx, event) => {
  if (!pathMode) {
    // Not in path mode — show info panel normally
    showInfo('gpu');
    return;
  }
  const nd = NODES[nodeIdx];
  const gpuHit = { nodeIdx, gpuIdx, nd };
  if (!pathSrc) {
    setPathSrc(gpuHit);
    updatePathHint(`✓ 起点: Node ${nd.name} G${gpuIdx} — 再点击目标 GPU (粉色)`);
  } else if (!pathDst || !(pathDst.nd.id === gpuHit.nd.id && pathDst.gpuIdx === gpuHit.gpuIdx)) {
    setPathDst(gpuHit);
    const result = computePath(pathSrc, gpuHit);
    setPathResult(result);
    showPathResult(result);
    updatePathHint('路径已高亮 — 再点击新起点 / ✕ 清除');
  } else {
    clearPath();
  }
  draw();
});

// ─── Layer navigation ─────────────────────────────────────────────────────────
function goLayer(l) {
  document.querySelectorAll('.lbtn').forEach(b => b.classList.remove('on'));
  const btn = document.getElementById('lb-' + l);
  if (btn) btn.classList.add('on');

  if (l === 'zone') {
    fitBox(ZONE.x, ZONE.y, ZONE.w, ZONE.h, 40);
  } else if (l === 'pod') {
    const xs = PODS.map(p => p.x), ys = PODS.map(p => p.y);
    fitBox(Math.min(...xs), Math.min(...ys),
      Math.max(...PODS.map(p => p.x+p.w)) - Math.min(...xs),
      Math.max(...PODS.map(p => p.y+p.h)) - Math.min(...ys), 25);
  } else if (l === 'rack') {
    const xs = RACKS.map(r => r.x), ys = RACKS.map(r => r.y);
    fitBox(Math.min(...xs), Math.min(...ys),
      Math.max(...RACKS.map(r => r.x+r.w)) - Math.min(...xs),
      Math.max(...RACKS.map(r => r.y+r.h)) - Math.min(...ys), 16);
  } else if (l === 'node') {
    const xs = NODES.map(n => n.x), ys = NODES.map(n => n.y);
    fitBox(Math.min(...xs), Math.min(...ys),
      Math.max(...NODES.map(n => n.x+n.w)) - Math.min(...xs),
      Math.max(...NODES.map(n => n.y+n.h)) - Math.min(...ys), 12);
  } else if (l === 'chip') {
    const ns = NODES.filter(n => n.rackId === RACKS[0].id);
    const xs = ns.map(n => n.x), ys = ns.map(n => n.y);
    fitBox(Math.min(...xs) - 10, Math.min(...ys) - 10,
      Math.max(...ns.map(n => n.x+n.w)) - Math.min(...xs) + 20,
      Math.max(...ns.map(n => n.y+n.h)) - Math.min(...ys) + 20, 30);
  }
}

// ─── Link toggles ─────────────────────────────────────────────────────────────
function togLink(t) {
  lv[t] = !lv[t];
  document.getElementById('lk-' + t).classList.toggle('on', lv[t]);
  applyLinkVisibility();
}

// ─── Expose globals for HTML onclick ──────────────────────────────────────────
window.doZoom        = doZoom;
window.goLayer       = goLayer;
window.togLink       = togLink;
window.togglePathMode = togglePathMode;
window.clearPath     = clearPath;
window.addJob        = addJob;
window.clearJobs     = clearJobs;
window.updateJobPanel = updateJobPanel;
window._removeJob    = removeJob;
window.toggleFragMode = function(btn) {
  setFragMode(!fragMode);
  btn.classList.toggle('on', fragMode);
  draw();
};

// ─── Init ─────────────────────────────────────────────────────────────────────
resize();
buildScene();
updateJobPanel();
setTimeout(() => goLayer('zone'), 60);
