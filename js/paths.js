// ═══ RDMA PATH TRACING ═══

import { NODES, RACKS, SWITCHES } from './topology.js';
import { ctx, camS, camX, camY, W, H, rr, getLOD, draw } from './renderer.js';

export let pathMode=false, pathSrc=null, pathDst=null, pathResult=null;
let pathAnimRaf=null, pathAnimT=0;

export function getGPUWorldPos(nd,g){
  const col=g%4,row=Math.floor(g/4);
  const gx=nd.x+4+col*64, gy=nd.y+[76,114][row];
  return{x:gx+27,y:gy+13,top:gy,bot:gy+26,left:gx,right:gx+54};
}
export function getNICWorldPos(nd,n){
  const col=n%4,row=Math.floor(n/4);
  const nx2=nd.x+4+col*64+(64-26)/2, ny=nd.y+148+row*20;
  return{x:nx2+13,y:ny+8,top:ny,bot:ny+16};
}
export function hitGPUWorld(wx,wy){
  if(getLOD(camS)<4)return null;
  for(let ni=0;ni<NODES.length;ni++){
    const nd=NODES[ni];
    for(let g=0;g<8;g++){
      const col=g%4,row=Math.floor(g/4);
      const gx=nd.x+4+col*64,gy=nd.y+[76,114][row];
      if(wx>=gx&&wx<=gx+54&&wy>=gy&&wy<=gy+26)return{nodeIdx:ni,gpuIdx:g,nd};
    }
  }
  return null;
}

export function computePath(src,dst){
  const snd=src.nd,dnd=dst.nd;
  const sRack=RACKS.find(r=>r.id===snd.rackId);
  const dRack=RACKS.find(r=>r.id===dnd.rackId);
  const sTor=SWITCHES.find(s=>s.type==='tor'&&s.rackId===snd.rackId);
  const dTor=SWITCHES.find(s=>s.type==='tor'&&s.rackId===dnd.rackId);
  const sSpine=SWITCHES.find(s=>s.type==='spine'&&s.podId===sRack.podId);
  const dSpine=SWITCHES.find(s=>s.type==='spine'&&s.podId===dRack.podId);
  const core=SWITCHES.find(s=>s.type==='core');
  const sgp=getGPUWorldPos(snd,src.gpuIdx);
  const dgp=getGPUWorldPos(dnd,dst.gpuIdx);
  const sNic=getNICWorldPos(snd,src.gpuIdx);
  const dNic=getNICWorldPos(dnd,dst.gpuIdx);
  const segs=[]; let scenario,bw,latency,hops,note;

  if(snd.id===dnd.id&&src.gpuIdx===dst.gpuIdx){
    scenario='同一 GPU (无需传输)';bw='—';latency='0';hops=0;note='选了同一个 GPU';
  } else if(snd.id===dnd.id){
    const swCx=snd.x+95,swCy=snd.y+58;
    segs.push({x1:sgp.x,y1:sgp.top,x2:swCx,y2:swCy+10,type:'nvlink'});
    segs.push({x1:swCx,y1:swCy+10,x2:dgp.x,y2:dgp.top,type:'nvlink'});
    scenario='节点内 NVLink (同节点)';bw='900 GB/s';latency='< 1 μs';hops=1;
    note='GPU 数据直接经 NVSwitch All-to-All Fabric 单跳到达，不经 CPU / PCIe / 网络';
  } else if(sRack.id===dRack.id){
    segs.push({x1:sgp.x,y1:sgp.bot,x2:sNic.x,y2:sNic.top,type:'pcie'});
    segs.push({x1:sNic.x,y1:sNic.bot,x2:sTor.cx,y2:sTor.cy,type:'ib'});
    segs.push({x1:sTor.cx,y1:sTor.cy,x2:dNic.x,y2:dNic.bot,type:'ib'});
    segs.push({x1:dNic.x,y1:dNic.top,x2:dgp.x,y2:dgp.bot,type:'pcie'});
    scenario='同机架跨节点 (IB NDR)';bw='50 GB/s';latency='~1 μs';hops=3;
    note='GPUDirect RDMA: GPU显存数据经PCIe→NIC，IB单跳经ToR到达对端NIC，再经PCIe写入目标显存，全程不经CPU';
  } else if(sRack.podId===dRack.podId){
    segs.push({x1:sgp.x,y1:sgp.bot,x2:sNic.x,y2:sNic.top,type:'pcie'});
    segs.push({x1:sNic.x,y1:sNic.bot,x2:sTor.cx,y2:sTor.cy,type:'ib'});
    segs.push({x1:sTor.cx,y1:sTor.cy,x2:sSpine.cx,y2:sSpine.cy,type:'ib'});
    segs.push({x1:sSpine.cx,y1:sSpine.cy,x2:dTor.cx,y2:dTor.cy,type:'ib'});
    segs.push({x1:dTor.cx,y1:dTor.cy,x2:dNic.x,y2:dNic.bot,type:'ib'});
    segs.push({x1:dNic.x,y1:dNic.top,x2:dgp.x,y2:dgp.bot,type:'pcie'});
    scenario='同 Pod 跨机架 (IB Fat-Tree)';bw='50 GB/s';latency='~2 μs';hops=5;
    note='IB Fat-Tree 1:1无阻塞拓扑，ECMP均衡到Spine，AllReduce集合通信的主路径';
  } else {
    segs.push({x1:sgp.x,y1:sgp.bot,x2:sNic.x,y2:sNic.top,type:'pcie'});
    segs.push({x1:sNic.x,y1:sNic.bot,x2:sTor.cx,y2:sTor.cy,type:'ib'});
    segs.push({x1:sTor.cx,y1:sTor.cy,x2:sSpine.cx,y2:sSpine.cy,type:'ib'});
    segs.push({x1:sSpine.cx,y1:sSpine.cy,x2:core.cx,y2:core.cy,type:'eth'});
    segs.push({x1:core.cx,y1:core.cy,x2:dSpine.cx,y2:dSpine.cy,type:'eth'});
    segs.push({x1:dSpine.cx,y1:dSpine.cy,x2:dTor.cx,y2:dTor.cy,type:'ib'});
    segs.push({x1:dTor.cx,y1:dTor.cy,x2:dNic.x,y2:dNic.bot,type:'ib'});
    segs.push({x1:dNic.x,y1:dNic.top,x2:dgp.x,y2:dgp.bot,type:'pcie'});
    scenario='跨 Pod (IB + Ethernet Core)';bw='50 GB/s';latency='~5–10 μs';hops=7;
    note='IB→Ethernet协议切换经Core Router，延迟明显升高。大规模训练通常避免跨Pod，通过gang scheduling保证作业分配在同Pod内';
  }
  return{segs,scenario,bw,latency,hops,note};
}

const PATH_COL={nvlink:'#fb923c',pcie:'#a78bfa',ib:'#22d3ee',eth:'#4ade80'};

export function drawPath(){
  if(!pathMode)return;
  [pathSrc,pathDst].forEach((p,i)=>{
    if(!p)return;
    const col=i===0?'#fbbf24':'#f472b6';
    const gx=p.nd.x+4+p.gpuIdx%4*64, gy=p.nd.y+[76,114][Math.floor(p.gpuIdx/4)];
    ctx.save();ctx.strokeStyle=col;ctx.lineWidth=2.5/camS;
    ctx.shadowColor=col;ctx.shadowBlur=14/camS;
    rr(gx-3,gy-3,60,32,5);ctx.stroke();
    ctx.restore();
  });
  if(!pathResult||!pathResult.segs.length)return;
  const t=pathAnimT*0.001;
  ctx.save();
  pathResult.segs.forEach(seg=>{
    const col=PATH_COL[seg.type]||'#fff';
    const dashLen=18/camS,gap=9/camS;
    ctx.strokeStyle=col;ctx.lineWidth=2.8/camS;
    ctx.shadowColor=col;ctx.shadowBlur=10/camS;
    ctx.setLineDash([dashLen,gap]);
    ctx.lineDashOffset=-(t*55/camS);
    ctx.beginPath();ctx.moveTo(seg.x1,seg.y1);ctx.lineTo(seg.x2,seg.y2);ctx.stroke();
    ctx.setLineDash([]);ctx.shadowBlur=0;
    const mx=(seg.x1+seg.x2)/2,my=(seg.y1+seg.y2)/2;
    const dx=seg.x2-seg.x1,dy=seg.y2-seg.y1,len=Math.hypot(dx,dy)||1;
    const ux=dx/len,uy=dy/len,al=10/camS,aw=5/camS;
    ctx.fillStyle=col;ctx.shadowBlur=6/camS;
    ctx.beginPath();
    ctx.moveTo(mx+ux*al,my+uy*al);
    ctx.lineTo(mx-ux*al+uy*aw,my-uy*al-ux*aw);
    ctx.lineTo(mx-ux*al-uy*aw,my-uy*al+ux*aw);
    ctx.closePath();ctx.fill();ctx.shadowBlur=0;
  });
  ctx.restore();
}

export function startPathAnim(){
  if(pathAnimRaf)return;
  function tick(ts){pathAnimT=ts;draw();pathAnimRaf=requestAnimationFrame(tick);}
  pathAnimRaf=requestAnimationFrame(tick);
}
export function stopPathAnim(){
  if(pathAnimRaf){cancelAnimationFrame(pathAnimRaf);pathAnimRaf=null;}
}
export function clearPath(){
  pathSrc=null;pathDst=null;pathResult=null;
  document.getElementById('path-result').style.display='none';
  updatePathHint('点击起点 GPU (黄色)');
}
export function togglePathMode(){
  pathMode=!pathMode;
  clearPath();
  document.getElementById('path-btn').classList.toggle('on',pathMode);
  document.getElementById('path-panel').style.display=pathMode?'flex':'none';
  if(pathMode)startPathAnim();
  else{stopPathAnim();draw();}
}
export function updatePathHint(t){document.getElementById('path-hint').textContent=t;}
export function showPathResult(r){
  document.getElementById('path-scenario').textContent=r.scenario;
  document.getElementById('path-bw').textContent=r.bw;
  document.getElementById('path-lat').textContent=r.latency;
  document.getElementById('path-hops').textContent=r.hops+(r.hops>1?' hops':' hop');
  document.getElementById('path-note').textContent=r.note||'';
  document.getElementById('path-result').style.display='block';
}

// Export mutable state setters for interaction.js
export function setPathSrc(v){ pathSrc=v; }
export function setPathDst(v){ pathDst=v; }
export function setPathResult(v){ pathResult=v; }
