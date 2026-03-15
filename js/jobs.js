// ═══ JOB PLACEMENT SIMULATOR ═══

import { NODES, RACKS, PODS, TOTAL_GPU } from './topology.js';
import { ctx, camS, camX, camY, W, H, rr, getLOD, lv, draw } from './renderer.js';

export const JOB_COLORS = ['#f472b6','#34d399','#fbbf24','#60a5fa','#f87171','#a78bfa','#2dd4bf','#fb923c'];
export let jobs = [];
export let fragMode = false;
export function setFragMode(v){ fragMode=v; }
let jobCounter = 0;

function allSlots() {
  const s=[];
  NODES.forEach((nd,ni)=>{ for(let g=0;g<8;g++) s.push({nodeIdx:ni,gpuIdx:g}); });
  return s;
}
function usedSlots() {
  const set=new Set();
  jobs.forEach(j=>j.slots.forEach(s=>set.add(s.nodeIdx+'_'+s.gpuIdx)));
  return set;
}
export function freeSlots() {
  const used=usedSlots();
  return allSlots().filter(s=>!used.has(s.nodeIdx+'_'+s.gpuIdx));
}

// Placement strategies
export function placeJob(size, strategy) {
  const used = usedSlots();
  const isFree = (ni,g) => !used.has(ni+'_'+g);
  let slots = [];

  if (strategy === 'same-node') {
    for (let ni=0; ni<NODES.length && slots.length<size; ni++) {
      const free = [];
      for(let g=0;g<8;g++) if(isFree(ni,g)) free.push({nodeIdx:ni,gpuIdx:g});
      if(free.length + slots.length >= size) {
        slots = slots.concat(free.slice(0, size-slots.length));
        break;
      }
    }
    if(slots.length < size) {
      slots = [];
      for(let ni=0; ni<NODES.length && slots.length<size; ni++)
        for(let g=0;g<8&&slots.length<size;g++)
          if(isFree(ni,g)) slots.push({nodeIdx:ni,gpuIdx:g});
    }
  } else if (strategy === 'same-rack') {
    for(const rack of RACKS) {
      const rackNodes = NODES.map((nd,ni)=>({nd,ni})).filter(({nd})=>nd.rackId===rack.id);
      const cands = [];
      rackNodes.forEach(({nd,ni})=>{ for(let g=0;g<8;g++) if(isFree(ni,g)) cands.push({nodeIdx:ni,gpuIdx:g}); });
      if(cands.length >= size) { slots = cands.slice(0,size); break; }
    }
    if(slots.length < size) {
      slots=[];
      for(let ni=0;ni<NODES.length&&slots.length<size;ni++)
        for(let g=0;g<8&&slots.length<size;g++)
          if(isFree(ni,g)) slots.push({nodeIdx:ni,gpuIdx:g});
    }
  } else if (strategy === 'same-pod') {
    for(const pod of PODS) {
      const rackIds = new Set(RACKS.filter(r=>r.podId===pod.id).map(r=>r.id));
      const podNodes = NODES.map((nd,ni)=>({nd,ni})).filter(({nd})=>rackIds.has(nd.rackId));
      const cands=[];
      podNodes.forEach(({nd,ni})=>{ for(let g=0;g<8;g++) if(isFree(ni,g)) cands.push({nodeIdx:ni,gpuIdx:g}); });
      if(cands.length >= size) { slots=cands.slice(0,size); break; }
    }
    if(slots.length < size) {
      slots=[];
      for(let ni=0;ni<NODES.length&&slots.length<size;ni++)
        for(let g=0;g<8&&slots.length<size;g++)
          if(isFree(ni,g)) slots.push({nodeIdx:ni,gpuIdx:g});
    }
  } else {
    // best-fit / optimal
    const free = freeSlots();
    const byNode = {};
    free.forEach(s=>{ (byNode[s.nodeIdx]=byNode[s.nodeIdx]||[]).push(s); });
    const nodeGroups = Object.values(byNode).sort((a,b)=>b.length-a.length);
    for(const ng of nodeGroups) {
      if(ng.length >= size) { slots=ng.slice(0,size); break; }
    }
    if(!slots.length) {
      for(const ng of nodeGroups) { slots=slots.concat(ng); if(slots.length>=size)break; }
      slots=slots.slice(0,size);
    }
  }

  return slots.slice(0, size);
}

function allReduceBW(slots) {
  if(!slots.length) return '—';
  const nodeSet = new Set(slots.map(s=>s.nodeIdx));
  if(nodeSet.size===1) return '900 GB/s (NVLink)';
  const rackSet = new Set(slots.map(s=>NODES[s.nodeIdx].rackId));
  if(rackSet.size===1) return '50 GB/s (IB NDR, same rack)';
  const podSet = new Set(slots.map(s=>{const r=RACKS.find(r=>r.id===NODES[s.nodeIdx].rackId);return r.podId;}));
  if(podSet.size===1) return '50 GB/s (IB Fat-Tree, same pod)';
  return '~10 GB/s (IB→Eth Core, cross-pod ⚠️)';
}

function strategyLabel(s){
  return {optimal:'🏆 最优 (自动)', 'same-node':'📦 同节点', 'same-rack':'🗄 同机架', 'same-pod':'🏢 同Pod'}[s]||s;
}

export function addJob(size, strategy='optimal') {
  if(size > freeSlots().length) {
    alert(`资源不足：仅剩 ${freeSlots().length} 个空闲 GPU`); return;
  }
  const slots = placeJob(size, strategy);
  if(slots.length < size) { alert('无法分配足够 GPU'); return; }
  const job = { id: ++jobCounter, size, strategy, color: JOB_COLORS[(jobCounter-1)%JOB_COLORS.length], slots };
  jobs.push(job);
  updateJobPanel();
  draw();
}

export function removeJob(id) {
  jobs = jobs.filter(j=>j.id!==id);
  updateJobPanel();
  draw();
}

export function clearJobs() {
  jobs=[]; jobCounter=0;
  updateJobPanel();
  draw();
}

export function fragScore() {
  const byNode = {};
  NODES.forEach((_,ni)=>{ byNode[ni]=8; });
  jobs.forEach(j=>j.slots.forEach(s=>{ byNode[s.nodeIdx]--; }));
  const free = Object.values(byNode);
  const totalFree = free.reduce((a,b)=>a+b,0);
  const blockable = free.filter(f=>f>=8).reduce((a,b)=>a+b,0);
  if(totalFree===0) return 100;
  return Math.round((1 - blockable/totalFree)*100);
}

export function updateJobPanel() {
  const frag = fragScore();
  document.getElementById('job-frag').textContent = frag+'%';
  document.getElementById('job-frag').style.color = frag<30?'#4ade80':frag<60?'#fbbf24':'#f87171';
  document.getElementById('job-free').textContent = freeSlots().length+'/'+TOTAL_GPU;
  const list = document.getElementById('job-list');
  list.innerHTML = jobs.map(j=>{
    const bw = allReduceBW(j.slots);
    const nodeCount = new Set(j.slots.map(s=>s.nodeIdx)).size;
    return `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
      <div style="width:10px;height:10px;border-radius:2px;background:${j.color};flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:10px;color:#e2e8f0">Job ${j.id} · ${j.size} GPU · ${nodeCount} node${nodeCount>1?'s':''}</div>
        <div style="font-size:9px;color:#475569">${strategyLabel(j.strategy)}</div>
        <div style="font-size:9px;color:#22d3ee">${bw}</div>
      </div>
      <button onclick="window._removeJob(${j.id})" style="background:none;border:none;color:#475569;cursor:pointer;font-size:12px">✕</button>
    </div>`;
  }).join('') || '<div style="font-size:10px;color:#334155;padding:4px 0">暂无 Job</div>';
}

export function drawJobs() {
  if(!jobs.length && !fragMode) return;
  const lod = getLOD(camS);
  if(lod < 3) return;

  const nodeUsed = {};
  NODES.forEach((_,ni)=>{ nodeUsed[ni]=0; });
  jobs.forEach(j=>j.slots.forEach(s=>{ nodeUsed[s.nodeIdx]++; }));

  jobs.forEach(job=>{
    job.slots.forEach(({nodeIdx, gpuIdx})=>{
      const nd=NODES[nodeIdx];
      if(lod===3){
        const gw=Math.floor((nd.w-16)/4)-4, gh=Math.floor((nd.h-40)/2)-5;
        const gx=nd.x+6+gpuIdx%4*(gw+4), gy=nd.y+34+Math.floor(gpuIdx/4)*(gh+5);
        ctx.save();
        rr(gx,gy,gw,gh,2);
        ctx.fillStyle=job.color+'cc'; ctx.fill();
        ctx.restore();
      } else {
        const col=gpuIdx%4, row=Math.floor(gpuIdx/4);
        const gx=nd.x+4+col*64, gy=nd.y+[76,114][row];
        ctx.save();
        rr(gx,gy,54,26,3);
        ctx.fillStyle=job.color+'99'; ctx.fill();
        ctx.strokeStyle=job.color; ctx.lineWidth=2/camS;
        ctx.shadowColor=job.color; ctx.shadowBlur=8/camS;
        ctx.stroke();
        ctx.restore();
        ctx.save();
        const sx=(nd.x+4+col*64+27+camX)*camS+W/2;
        const sy=(nd.y+[76,114][row]+6+camY)*camS+H/2;
        ctx.resetTransform();
        ctx.font=`600 8px "SF Mono",monospace`;
        ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText('J'+job.id, sx, sy);
        ctx.restore();
      }
    });
  });

  if(fragMode) {
    NODES.forEach((nd,ni)=>{
      const used=nodeUsed[ni]||0, free=8-used;
      const col = used===0?'rgba(74,222,128,0.6)' : free===0?'rgba(248,113,113,0.7)' : 'rgba(251,191,36,0.6)';
      ctx.save();
      rr(nd.x-2,nd.y-2,nd.w+4,nd.h+4,6);
      ctx.strokeStyle=col; ctx.lineWidth=3/camS;
      ctx.shadowColor=col; ctx.shadowBlur=12/camS;
      ctx.stroke();
      const sx=(nd.x+nd.w-6+camX)*camS+W/2;
      const sy=(nd.y+nd.h-8+camY)*camS+H/2;
      ctx.resetTransform();
      ctx.font=`10px "SF Mono",monospace`;
      ctx.fillStyle=col.replace(/[\d.]+\)$/,'1)'); ctx.textAlign='right'; ctx.textBaseline='middle';
      ctx.fillText(`${free}/8 free`, sx, sy);
      ctx.restore();
    });
  }
}
