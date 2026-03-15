// ═══ LAYER 3: RENDERING ═══

import { EDGE_META } from './data.js';
import { LAYOUT, PODS, RACKS, NODES, SWITCHES, ZONE } from './topology.js';

// ─── Rendering aliases (shorthand from LAYOUT) ───────────────────────────────
const NW=LAYOUT.nodeW, NH=LAYOUT.nodeH;
const GW=LAYOUT.gpuW,  GH=LAYOUT.gpuH;
const CW=LAYOUT.cpuW,  CH=LAYOUT.cpuH;

// ─── Canvas & Camera ─────────────────────────────────────────────────────────
export const canvas = document.getElementById('cv');
export const ctx = canvas.getContext('2d');
export let W, H;

// Camera state — shared mutable state imported by other modules
export let camX=0, camY=0, camS=1;
let tgtX=0, tgtY=0, tgtS=1;
let animRaf=null;

// Setters for camera state (used by interaction.js)
export function setCam(x, y, s) { camX=x; camY=y; camS=s; }
export function setTgt(x, y, s) { tgtX=x; tgtY=y; tgtS=s; }
export function getTgt() { return { x:tgtX, y:tgtY, s:tgtS }; }

// ─── EDGES array: rebuilt each frame for hit testing ─────────────────────────
export let EDGES = [];

export function pushEdge(x1,y1,x2,y2,type,lod_min=0){
  EDGES.push({x1,y1,x2,y2,type,lod_min});
}

// ─── LOD ─────────────────────────────────────────────────────────────────────
export function getLOD(s){
  if(s<0.12)return 0;
  if(s<0.28)return 1;
  if(s<0.55)return 2;
  if(s<1.6) return 3;
  return 4;
}
const LOD_NAMES=['Zone','Pod','Rack','Node','Chip'];

// ─── Link visibility ──────────────────────────────────────────────────────────
export const lv = {nvlink:true, pcie:true, ib:true, eth:true};

// ─── Coord helpers ───────────────────────────────────────────────────────────
export function s2w(sx,sy){ return {x:(sx-W/2)/camS-camX, y:(sy-H/2)/camS-camY}; }

// ─── Animation ───────────────────────────────────────────────────────────────
function easeInOut(t){ return t<.5?2*t*t:-1+(4-2*t)*t; }

export function animateTo(tx,ty,ts,dur=420){
  const sx=camX,sy=camY,ss=camS;
  tgtX=tx; tgtY=ty; tgtS=ts;
  const t0=performance.now();
  if(animRaf)cancelAnimationFrame(animRaf);
  function step(now){
    const t=Math.min(1,(now-t0)/dur);
    const e=easeInOut(t);
    camX=sx+(tx-sx)*e; camY=sy+(ty-sy)*e; camS=ss+(ts-ss)*e;
    draw(); updateHUD();
    if(t<1)animRaf=requestAnimationFrame(step);
  }
  animRaf=requestAnimationFrame(step);
}

export function fitBox(x,y,w,h,pad=60){
  const sc=Math.min(W/(w+pad*2),H/(h+pad*2));
  animateTo(-(x+w/2),-(y+h/2),sc);
}

export function doZoom(f){
  const ns=Math.max(.04,Math.min(20,tgtS*f));
  animateTo(tgtX,tgtY,ns,200);
}

// ─── HUD ─────────────────────────────────────────────────────────────────────
export function updateHUD(){
  document.getElementById('zlvl').textContent=`缩放: ${Math.round(camS*100)}%`;
  document.getElementById('lodlabel').textContent=LOD_NAMES[getLOD(camS)]+' 视图';
}

// ─── Edge tooltip ─────────────────────────────────────────────────────────────
export function showEdgeTip(type, sx, sy){
  const m=EDGE_META[type];
  if(!m)return;
  const el=document.getElementById('etip');
  const head=document.getElementById('et-head');
  const rows=document.getElementById('et-rows');
  const use=document.getElementById('et-use');

  head.textContent=m.protocol;
  head.style.color=m.color.replace(/[\d.]+\)$/,'1)');

  const skip=new Set(['protocol','use','color']);
  const labels={bw:'带宽',total_bw:'总带宽',node_total:'节点总带宽',latency:'延迟',encoding:'编码',rdma:'RDMA',topo:'拓扑'};
  rows.innerHTML=Object.entries(m)
    .filter(([k])=>!skip.has(k))
    .map(([k,v])=>`<div class="erow"><span class="ekey">${labels[k]||k}</span><span class="eval">${v}</span></div>`)
    .join('');
  use.textContent=m.use;

  const PAD=14, W_TIP=230;
  let lx=sx+PAD, ly=sy-20;
  if(lx+W_TIP>window.innerWidth) lx=sx-W_TIP-PAD;
  if(ly<0) ly=sy+PAD;
  el.style.left=lx+'px';
  el.style.top=ly+'px';
  el.style.display='block';
}

export function hideEdgeTip(){
  document.getElementById('etip').style.display='none';
}

// ─── Edge hit testing ─────────────────────────────────────────────────────────
function ptSegDist(px,py, x1,y1,x2,y2){
  const dx=x2-x1,dy=y2-y1;
  const len2=dx*dx+dy*dy;
  if(len2===0)return Math.hypot(px-x1,py-y1);
  let t=((px-x1)*dx+(py-y1)*dy)/len2;
  t=Math.max(0,Math.min(1,t));
  return Math.hypot(px-(x1+t*dx),py-(y1+t*dy));
}

export function hitEdge(sx,sy){
  const THR=7;
  for(let i=EDGES.length-1;i>=0;i--){
    const e=EDGES[i];
    if(getLOD(camS)<e.lod_min)continue;
    const ex1=(e.x1+camX)*camS+W/2, ey1=(e.y1+camY)*camS+H/2;
    const ex2=(e.x2+camX)*camS+W/2, ey2=(e.y2+camY)*camS+H/2;
    if(ptSegDist(sx,sy,ex1,ey1,ex2,ey2)<THR)return e.type;
  }
  return null;
}

// ─── Draw primitives ─────────────────────────────────────────────────────────
export function rr(x,y,w,h,r=4){
  ctx.beginPath();
  ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}
export function fillStroke(fill,stroke,lw=1){ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle=stroke;ctx.lineWidth=lw;ctx.stroke()}
export function txt(s,x,y,sz,col,align='center',base='middle',bold=false){
  const dpr = window.devicePixelRatio || 1;
  const sx=((x+camX)*camS+W/2)*dpr, sy=((y+camY)*camS+H/2)*dpr;
  ctx.save();
  ctx.resetTransform();
  ctx.font=`${bold?'600 ':''}${sz*dpr}px "SF Mono",Consolas,monospace`;
  ctx.fillStyle=col;ctx.textAlign=align;ctx.textBaseline=base;
  ctx.fillText(s,sx,sy);
  ctx.restore();
}
export function line(x1,y1,x2,y2,col,w,dash=[]){
  ctx.save();ctx.strokeStyle=col;ctx.lineWidth=w;ctx.setLineDash(dash);
  ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
  ctx.setLineDash([]);ctx.restore();
}

// ─── Draw sections ───────────────────────────────────────────────────────────
function drawGrid(){
  const step=200,lw=1/camS;
  const tl=s2w(0,0),br=s2w(W,H);
  ctx.strokeStyle='rgba(255,255,255,0.018)';ctx.lineWidth=lw;
  const x0=Math.floor(tl.x/step)*step,y0=Math.floor(tl.y/step)*step;
  for(let x=x0;x<br.x;x+=step){ctx.beginPath();ctx.moveTo(x,tl.y);ctx.lineTo(x,br.y);ctx.stroke()}
  for(let y=y0;y<br.y;y+=step){ctx.beginPath();ctx.moveTo(tl.x,y);ctx.lineTo(br.x,y);ctx.stroke()}
}

function drawZone(){
  const z=ZONE;
  rr(z.x,z.y,z.w,z.h,18);
  fillStroke('rgba(59,130,246,0.022)','rgba(59,130,246,0.2)',1.5/camS);
  ctx.save();rr(z.x,z.y,z.w,z.h,18);ctx.strokeStyle='rgba(59,130,246,0.2)';ctx.lineWidth=1.5/camS;ctx.setLineDash([8/camS,5/camS]);ctx.stroke();ctx.setLineDash([]);ctx.restore();
}

function drawZoneLabel(){
  const z=ZONE,lod=getLOD(camS);
  if(lod<2){
    txt('Availability Zone',z.x+16,z.y+18,32,'rgba(147,197,253,0.55)','left',undefined,true);
    txt('35,000+ GPU · 3 Pods · InfiniBand Fat-Tree + Ethernet Core',z.x+16,z.y+42,14,'rgba(147,197,253,0.25)','left');
  }
}

function drawPods(){
  PODS.forEach(p=>{
    rr(p.x,p.y,p.w,p.h,10);
    fillStroke(p.fill,p.stroke,0.9/camS);
    txt(p.name,p.x+12,p.y+18,26,'rgba(196,181,253,0.85)','left',undefined,true);
  });
}

function drawRacks(){
  RACKS.forEach(r=>{
    rr(r.x,r.y,r.w,r.h,5);
    fillStroke('rgba(6,182,212,0.05)','rgba(6,182,212,0.22)',0.7/camS);
    txt(r.name,r.x+r.w/2,r.y+14,22,'rgba(103,232,249,0.8)');
  });
}

function drawSwitches(){
  const spines=SWITCHES.filter(s=>s.type==='spine');
  const core=SWITCHES.find(s=>s.type==='core');
  const tors=SWITCHES.filter(s=>s.type==='tor');

  if(lv.eth&&core) spines.forEach(sp=>{
    line(sp.cx,sp.cy,core.cx,core.cy,'rgba(34,197,94,0.3)',1.2/camS,[6/camS,3/camS]);
    pushEdge(sp.cx,sp.cy,core.cx,core.cy,'eth');
  });
  if(lv.ib) tors.forEach(tor=>{
    const rack=RACKS.find(r=>r.id===tor.rackId);
    if(!rack)return;
    const sp=spines.find(s=>s.podId===rack.podId);
    if(sp){
      line(tor.cx,tor.cy,sp.cx,sp.cy,'rgba(6,182,212,0.32)',1/camS);
      pushEdge(tor.cx,tor.cy,sp.cx,sp.cy,'ib_tor_spine');
    }
  });
  if(lv.ib&&camS>0.3) tors.forEach(tor=>{
    const rack=RACKS.find(r=>r.id===tor.rackId);
    if(!rack)return;
    NODES.filter(n=>n.rackId===rack.id).forEach(nd=>{
      line(nd.x+nd.w/2,nd.y+nd.h,tor.cx,tor.cy,'rgba(6,182,212,0.16)',0.6/camS);
      pushEdge(nd.x+nd.w/2,nd.y+nd.h,tor.cx,tor.cy,'ib_node_tor',2);
    });
  });

  if(core){
    rr(core.cx-core.w/2,core.cy-core.h/2,core.w,core.h,4);
    fillStroke('rgba(34,197,94,0.22)','rgba(34,197,94,0.7)',1/camS);
    txt('Core Router',core.cx,core.cy,13,'#86efac');
  }
  spines.forEach(sp=>{
    rr(sp.cx-sp.w/2,sp.cy-sp.h/2,sp.w,sp.h,4);
    fillStroke('rgba(34,197,94,0.14)','rgba(34,197,94,0.45)',0.9/camS);
    txt(sp.podId.replace('pod','Pod '),sp.cx,sp.cy,11,'rgba(134,239,172,0.85)');
  });
  if(camS>0.2) tors.forEach(tor=>{
    const r=13/camS;
    ctx.beginPath();ctx.arc(tor.cx,tor.cy,r,0,Math.PI*2);
    fillStroke('rgba(6,182,212,0.16)','rgba(6,182,212,0.65)',0.9/camS);
    if(camS>0.2)txt('ToR',tor.cx,tor.cy,12,'#67e8f9');
  });
}

function drawNodesMini(){
  NODES.forEach(nd=>{
    rr(nd.x,nd.y,nd.w,nd.h,4);
    fillStroke('rgba(12,18,36,0.97)','rgba(34,197,94,0.32)',0.7/camS);
    txt(nd.name,nd.x+5,nd.y+6,20,'rgba(134,239,172,0.8)','left',undefined,true);
    txt('8× H100',nd.x+nd.w-4,nd.y+6,20,'rgba(251,146,60,0.65)','right');

    [0,1].forEach(c=>{
      rr(nd.x+4+c*50,nd.y+7,42,20,2);
      fillStroke('rgba(59,130,246,0.55)','rgba(59,130,246,0.4)',0.35/camS);
    });

    const gw=Math.floor((nd.w-16)/4)-4;
    const gh=Math.floor((nd.h-40)/2)-5;
    for(let g=0;g<8;g++){
      const col=g%4,row=Math.floor(g/4);
      const gx=nd.x+6+col*(gw+4),gy=nd.y+34+row*(gh+5);
      rr(gx,gy,gw,gh,2);
      fillStroke('rgba(249,115,22,0.62)','rgba(249,115,22,0.45)',0.4/camS);
      txt(`GPU ${g}`,gx+gw/2,gy+gh/2,10,'rgba(255,255,255,0.85)');
    }

    if(lv.nvlink){
      const gw2=Math.floor((nd.w-16)/4)-4,gh2=Math.floor((nd.h-40)/2)-5;
      ctx.strokeStyle='rgba(249,115,22,0.3)';ctx.lineWidth=0.7/camS;
      for(let row=0;row<2;row++){
        for(let col=0;col<3;col++){
          const x1=nd.x+6+(col+1)*(gw2+4),y1=nd.y+34+row*(gh2+5)+gh2/2;
          ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x1+4,y1);ctx.stroke();
        }
      }
    }
  });
}

function drawNodesChip(){
  const NVS_CX=[30,95,160,225];
  const NVS_CY=58, NVS_R=10;
  const GPU_Y=[76,114];
  const GPU_STRIDE=64;
  const NIC_Y=148, NIC_W=26, NIC_H=16;

  NODES.forEach(nd=>{
    rr(nd.x,nd.y,nd.w,nd.h,5);
    fillStroke('rgba(10,16,32,0.97)','rgba(34,197,94,0.35)',0.6/camS);

    txt(nd.name,   nd.x+5,      nd.y+10,20,'rgba(134,239,172,0.85)','left',undefined,true);
    txt('DGX H100',nd.x+nd.w-5, nd.y+10,18,'rgba(134,239,172,0.3)','right');

    const cpuY=nd.y+18;
    const cpu=[[nd.x+4,cpuY],[nd.x+60,cpuY]];
    cpu.forEach(([cpx,cpy],c)=>{
      rr(cpx,cpy,CW,CH,2);
      fillStroke('rgba(59,130,246,0.78)','#60a5fa',0.8/camS);
      txt(`CPU${c}`,cpx+CW/2,cpy+CH/2,11,'#fff');
    });

    if(lv.pcie){
      line(cpu[0][0]+CW, cpuY+CH/2, cpu[1][0], cpuY+CH/2,
           'rgba(147,197,253,0.55)', 1.2/camS);
      pushEdge(cpu[0][0]+CW, cpuY+CH/2, cpu[1][0], cpuY+CH/2, 'upi', 4);
      txt('UPI Link',nd.x+58,cpuY+CH/2,10,'rgba(147,197,253,0.5)');
    }

    const nvSW=NVS_CX.map(dx=>({cx:nd.x+dx,cy:nd.y+NVS_CY}));
    nvSW.forEach((sw,si)=>{
      ctx.beginPath();ctx.arc(sw.cx,sw.cy,NVS_R+3,0,Math.PI*2);
      fillStroke('rgba(139,92,246,0.1)','rgba(139,92,246,0.3)',0.4/camS);
      ctx.beginPath();ctx.arc(sw.cx,sw.cy,NVS_R,0,Math.PI*2);
      fillStroke('rgba(139,92,246,0.88)','#a78bfa',0.9/camS);
      txt(`NVSwitch ${si}`,sw.cx,sw.cy,9,'#fff');

      if(lv.pcie){
        const ci=si<2?0:1;
        const [cpx,cpy]=cpu[ci];
        line(sw.cx, sw.cy-NVS_R, cpx+CW/2, cpy+CH,
             'rgba(139,92,246,0.15)', 0.4/camS,[2/camS,3/camS]);
        pushEdge(sw.cx, sw.cy-NVS_R, cpx+CW/2, cpy+CH, 'pcie', 4);
      }
    });
    txt('NVSwitch ×4  —  NVLink 4.0 All-to-All Fabric',nd.x+NW/2,nd.y+47,10,'rgba(167,139,250,0.45)');

    for(let g=0;g<8;g++){
      const col=g%4,row=Math.floor(g/4);
      const gx=nd.x+4+col*GPU_STRIDE;
      const gy=nd.y+GPU_Y[row];

      if(lv.nvlink){
        nvSW.forEach((sw,si)=>{
          const op=0.22+si*0.07;
          line(gx+GW/2, gy, sw.cx, sw.cy+NVS_R, `rgba(249,115,22,${op})`, 0.65/camS);
          pushEdge(gx+GW/2, gy, sw.cx, sw.cy+NVS_R, 'nvlink', 4);
        });
      }

      if(lv.pcie){
        const ci=g<4?0:1;
        const [cpx,cpy]=cpu[ci];
        line(gx+GW/2, gy, cpx+CW*(ci===0?0.25:0.75), cpy+CH,
             'rgba(139,92,246,0.25)', 0.5/camS,[2.5/camS,2/camS]);
        pushEdge(gx+GW/2, gy, cpx+CW*(ci===0?0.25:0.75), cpy+CH, 'pcie', 4);
      }

      rr(gx,gy,GW,GH,3);
      fillStroke('rgba(249,115,22,0.82)','#fb923c',0.9/camS);
      txt(`GPU ${g}`,gx+GW/2,gy+10,11,'#fff',undefined,undefined,true);

      rr(gx+2,gy+GH-9,GW-4,7,1);
      fillStroke('rgba(14,116,144,0.7)','#06b6d4',0.4/camS);
      txt('HBM3 80GB',gx+GW/2,gy+GH-5.5,8,'#67e8f9');
    }

    txt('IB NIC ×8 — ConnectX-7 (1 NIC per GPU, GPUDirect RDMA)',nd.x+NW/2,nd.y+NIC_Y-6,11,'rgba(134,239,172,0.35)');
    for(let n=0;n<8;n++){
      const col=n%4,row=Math.floor(n/4);
      const nx2=nd.x+4+col*GPU_STRIDE+(GPU_STRIDE-NIC_W)/2;
      const ny=nd.y+NIC_Y+row*20;

      rr(nx2,ny,NIC_W,NIC_H,2);
      fillStroke('rgba(6,78,59,0.78)','#22c55e',0.7/camS);
      txt(`NIC ${n}`,nx2+NIC_W/2,ny+NIC_H/2,9,'#86efac');

      if(lv.pcie){
        const gx=nd.x+4+col*GPU_STRIDE;
        const gy=nd.y+GPU_Y[row];
        line(nx2+NIC_W/2, ny, gx+GW/2, gy+GH,
             'rgba(34,197,94,0.3)', 0.5/camS,[1.5/camS,2/camS]);
        pushEdge(nx2+NIC_W/2, ny, gx+GW/2, gy+GH, 'ib', 4);
      }
    }
  });
}

// ─── Master draw ─────────────────────────────────────────────────────────────
// draw() is the main render function; jobs/paths modules extend it via callbacks
let _drawJobsCb = null;
let _drawPathCb = null;

export function registerDrawCallbacks(jobsCb, pathCb) {
  _drawJobsCb = jobsCb;
  _drawPathCb = pathCb;
}

export function draw(){
  const _dpr=window.devicePixelRatio||1; ctx.clearRect(0,0,W*_dpr,H*_dpr);
  EDGES=[];
  ctx.save();
  ctx.translate(W/2,H/2);
  ctx.scale(camS,camS);
  ctx.translate(camX,camY);

  const lod=getLOD(camS);

  drawGrid();
  drawZone();
  drawZoneLabel();

  if(lod<=1){
    if(lod===1) drawPods();
    drawSwitches();
  } else if(lod===2){
    drawPods();
    drawRacks();
    drawSwitches();
  } else if(lod===3){
    drawPods();
    drawRacks();
    drawSwitches();
    drawNodesMini();
  } else {
    drawRacks();
    drawSwitches();
    drawNodesChip();
  }

  if(_drawJobsCb) _drawJobsCb();
  if(_drawPathCb) _drawPathCb();
  ctx.restore();
}

// ─── Resize ───────────────────────────────────────────────────────────────────
export function resize(){
  const dpr = window.devicePixelRatio || 1;
  W = innerWidth;
  H = innerHeight;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  draw();
}
window.addEventListener('resize', resize);

// ─── Hit testing ─────────────────────────────────────────────────────────────
export function hitTest(wx,wy){
  const lod=getLOD(camS);

  if(lod>=4){
    for(const nd of NODES){
      const nvsCx=[nd.x+30,nd.x+95,nd.x+160,nd.x+225],nvsCy=nd.y+58;
      if(nvsCx.some(cx=>Math.hypot(wx-cx,wy-nvsCy)<14))return'nvswitch';
      for(let g=0;g<8;g++){
        const col=g%4,row=Math.floor(g/4);
        const gx=nd.x+4+col*64,gy=nd.y+[76,114][row];
        if(wx>=gx&&wx<=gx+GW&&wy>=gy&&wy<=gy+GH)return'gpu';
      }
      if([0,1].some(c=>{const cpx=nd.x+4+c*56,cpy=nd.y+18;return wx>=cpx&&wx<=cpx+CW&&wy>=cpy&&wy<=cpy+CH;}))return'cpu';
      for(let n=0;n<8;n++){const col=n%4,row=Math.floor(n/4),nx2=nd.x+4+col*64+(64-26)/2,ny=nd.y+148+row*20;if(wx>=nx2&&wx<=nx2+26&&wy>=ny&&wy<=ny+16)return'nic';}
      for(let g=0;g<8;g++){const col=g%4,row=Math.floor(g/4),gx=nd.x+4+col*64,gy=nd.y+[76,114][row];if(wx>=gx+2&&wx<=gx+GW-2&&wy>=gy+GH-9&&wy<=gy+GH)return'hbm';}
      if(wx>=nd.x&&wx<=nd.x+nd.w&&wy>=nd.y&&wy<=nd.y+nd.h)return'node';
    }
  }

  if(lod>=3){
    for(const nd of NODES)if(wx>=nd.x&&wx<=nd.x+nd.w&&wy>=nd.y&&wy<=nd.y+nd.h)return'node';
  }

  for(const sw of SWITCHES){
    if(sw.type==='tor'&&Math.hypot(wx-sw.cx,wy-sw.cy)<18/camS)return'tor';
    if((sw.type==='spine'||sw.type==='core')&&sw.w){
      if(wx>=sw.cx-sw.w/2&&wx<=sw.cx+sw.w/2&&wy>=sw.cy-sw.h/2&&wy<=sw.cy+sw.h/2)return sw.type;
    }
  }

  if(lod>=2){for(const r of RACKS)if(wx>=r.x&&wx<=r.x+r.w&&wy>=r.y&&wy<=r.y+r.h)return'rack';}
  for(const p of PODS)if(wx>=p.x&&wx<=p.x+p.w&&wy>=p.y&&wy<=p.y+p.h)return'pod';
  const z=ZONE;if(wx>=z.x&&wx<=z.x+z.w&&wy>=z.y&&wy<=z.y+z.h)return'zone';
  return null;
}
