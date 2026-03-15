// ═══ INTERACTION: mouse/touch events, hit testing, zoom/pan, UI controls ═══

import { INFO, PODS, RACKS, NODES, ZONE } from './topology.js';
import {
  canvas, W, H, camX, camY, camS, setCam, setTgt, getTgt,
  s2w, draw, resize, updateHUD, lv,
  hitTest, hitEdge, showEdgeTip, hideEdgeTip,
  doZoom, animateTo, fitBox,
  registerDrawCallbacks,
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

// Register draw callbacks so renderer.js can call jobs/paths draw functions
registerDrawCallbacks(drawJobs, drawPath);

// ─── Info panel ───────────────────────────────────────────────────────────────
function showInfo(type){
  const p=document.getElementById('info'), info=INFO[type];
  if(!info){p.style.display='none';return;}
  p.style.display='block';
  document.getElementById('i-title').textContent=info.title;
  document.getElementById('i-rows').innerHTML=info.rows
    .map(([k,v])=>`<div class="irow"><span class="ikey">${k}</span><span class="ival">${v}</span></div>`)
    .join('');
  document.getElementById('i-desc').textContent=info.desc;
}

// ─── Layer navigation ─────────────────────────────────────────────────────────
function goLayer(l){
  document.querySelectorAll('.lbtn').forEach(b=>b.classList.remove('on'));
  document.getElementById('lb-'+l).classList.add('on');
  if(l==='zone')fitBox(ZONE.x,ZONE.y,ZONE.w,ZONE.h,40);
  else if(l==='pod'){const xs=PODS.map(p=>p.x),ys=PODS.map(p=>p.y);fitBox(Math.min(...xs),Math.min(...ys),Math.max(...PODS.map(p=>p.x+p.w))-Math.min(...xs),Math.max(...PODS.map(p=>p.y+p.h))-Math.min(...ys),25)}
  else if(l==='rack'){const xs=RACKS.map(r=>r.x),ys=RACKS.map(r=>r.y);fitBox(Math.min(...xs),Math.min(...ys),Math.max(...RACKS.map(r=>r.x+r.w))-Math.min(...xs),Math.max(...RACKS.map(r=>r.y+r.h))-Math.min(...ys),16)}
  else if(l==='node'){const xs=NODES.map(n=>n.x),ys=NODES.map(n=>n.y);fitBox(Math.min(...xs),Math.min(...ys),Math.max(...NODES.map(n=>n.x+n.w))-Math.min(...xs),Math.max(...NODES.map(n=>n.y+n.h))-Math.min(...ys),12)}
  else if(l==='chip'){
    const ns=NODES.filter(n=>n.rackId===RACKS[0].id);
    const xs=ns.map(n=>n.x),ys=ns.map(n=>n.y);
    fitBox(Math.min(...xs)-10,Math.min(...ys)-10,Math.max(...ns.map(n=>n.x+n.w))-Math.min(...xs)+20,Math.max(...ns.map(n=>n.y+n.h))-Math.min(...ys)+20,30);
  }
}

// ─── Link toggles ─────────────────────────────────────────────────────────────
function togLink(t){
  lv[t]=!lv[t];
  document.getElementById('lk-'+t).classList.toggle('on',lv[t]);
  draw();
}

// ─── Mouse events ─────────────────────────────────────────────────────────────
let dragging=false, dragStart={x:0,y:0}, camStart={x:0,y:0};

canvas.addEventListener('mousedown',e=>{
  dragging=true;
  dragStart={x:e.clientX,y:e.clientY};
  camStart={x:camX,y:camY};
  canvas.classList.add('dragging');
  hideEdgeTip();
});

canvas.addEventListener('mousemove',e=>{
  if(dragging){
    setCam(camStart.x+(e.clientX-dragStart.x)/camS, camStart.y+(e.clientY-dragStart.y)/camS, camS);
    setTgt(camX, camY, camS);
    draw(); updateHUD();
    return;
  }
  const w=s2w(e.clientX,e.clientY);
  const edgeType = hitEdge(e.clientX,e.clientY);
  const nodeHit = !edgeType ? hitTest(w.x,w.y) : null;

  if(edgeType){
    canvas.className='pointer';
    showEdgeTip(edgeType, e.clientX, e.clientY);
  } else {
    hideEdgeTip();
    canvas.className=nodeHit?'pointer':'';
  }
});

canvas.addEventListener('mouseup',e=>{
  if(!dragging)return;
  const moved=Math.hypot(e.clientX-dragStart.x,e.clientY-dragStart.y);
  dragging=false; canvas.classList.remove('dragging');
  if(moved<4){
    const w=s2w(e.clientX,e.clientY);

    if(pathMode){
      const gpuHit=hitGPUWorld(w.x,w.y);
      if(gpuHit){
        if(!pathSrc){
          setPathSrc(gpuHit);
          updatePathHint(`✓ 起点: Node ${gpuHit.nd.name} G${gpuHit.gpuIdx} — 再点击目标 GPU (粉色)`);
        } else if(!pathDst||!(pathDst.nd.id===gpuHit.nd.id&&pathDst.gpuIdx===gpuHit.gpuIdx)){
          setPathDst(gpuHit);
          const result=computePath(pathSrc,gpuHit);
          setPathResult(result);
          showPathResult(result);
          updatePathHint('路径已高亮 — 再点击新起点 / ✕ 清除');
        } else {
          clearPath();
        }
        draw();
      }
      return;
    }

    const hit=hitTest(w.x,w.y);
    if(hit)showInfo(hit);
    else document.getElementById('info').style.display='none';
  }
});

canvas.addEventListener('wheel',e=>{
  e.preventDefault();
  const f=e.deltaY<0?1.04:1/1.04;
  const ns=Math.max(.04,Math.min(20,camS*f));
  const wx=(e.clientX-W/2)/camS-camX, wy=(e.clientY-H/2)/camS-camY;
  setCam(camX-wx*(ns-camS)/ns, camY-wy*(ns-camS)/ns, ns);
  setTgt(camX, camY, ns);
  draw(); updateHUD();
},{passive:false});

// ─── Touch events ─────────────────────────────────────────────────────────────
let td=0;
canvas.addEventListener('touchstart',e=>{
  if(e.touches.length===1){dragging=true;dragStart={x:e.touches[0].clientX,y:e.touches[0].clientY};camStart={x:camX,y:camY};}
  else if(e.touches.length===2)td=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
  e.preventDefault();
},{passive:false});
canvas.addEventListener('touchmove',e=>{
  if(e.touches.length===1&&dragging){
    setCam(camStart.x+(e.touches[0].clientX-dragStart.x)/camS, camStart.y+(e.touches[0].clientY-dragStart.y)/camS, camS);
    setTgt(camX, camY, camS);
    draw(); updateHUD();
  } else if(e.touches.length===2){
    const nd2=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
    if(td>0){const ns=Math.max(.04,Math.min(20,camS*nd2/td));setCam(camX,camY,ns);setTgt(camX,camY,ns);draw();updateHUD();}
    td=nd2;
  }
  e.preventDefault();
},{passive:false});
canvas.addEventListener('touchend',()=>{dragging=false;});

// ─── Expose globals for inline HTML onclick handlers ──────────────────────────
// HTML buttons use onclick="goLayer(...)" etc — expose via window
window.doZoom = doZoom;
window.goLayer = goLayer;
window.togLink = togLink;
window.togglePathMode = togglePathMode;
window.clearPath = clearPath;
window.addJob = addJob;
window.clearJobs = clearJobs;
window.updateJobPanel = updateJobPanel;
window._removeJob = removeJob;
// fragMode toggle — the frag-btn calls window.toggleFragMode()
window.toggleFragMode = function(btn) {
  setFragMode(!fragMode);
  btn.classList.toggle('on', fragMode);
  draw();
};

// ─── Init ─────────────────────────────────────────────────────────────────────
resize();
updateJobPanel();
setTimeout(()=>goLayer('zone'),60);
