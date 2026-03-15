// ═══ LAYER 2: TOPOLOGY BUILDER (positions, layout) ═══

import { CLUSTER_CONFIG, POD_THEMES } from './data.js';

export const LAYOUT = {
  nodeW:        260,   nodeH:     170,   // node bounding box
  gpuW:          54,   gpuH:       26,   // GPU chip
  cpuW:          52,   cpuH:       22,   // CPU chip
  nvsR:          10,                     // NVSwitch circle radius
  nicW:          26,   nicH:       16,   // NIC chip
  // NVSwitch X offsets inside node (for 4 switches)
  nvsCxOffsets: [30, 95, 160, 225],
  nvsCyOffset:   58,
  gpuRows:      [76, 114],               // GPU row Y offsets inside node
  gpuStride:     64,                     // GPU column stride
  nicRowY:      148,   nicRowStride: 20, // NIC row Y offsets
  cpuOffsets:   [4, 60],                // CPU X offsets inside node
  cpuY:          18,

  rackPadX:      8,    rackPadTop:  30,  // rack internal padding
  nodeGap:       14,                     // vertical gap between nodes in rack
  podPadX:       20,   podPadTop:   34,  podPadBottom: 64,
  podGap:        16,                     // gap between racks inside a pod
  interPodGap:   44,                     // gap between pods
};

// Build topology from config.
// Returns flat arrays ready for rendering; all positions in world coordinates.
function buildTopology(config, layout) {
  const pods=[], racks=[], nodes=[], switches=[];
  const cfg = config;
  const L = layout;
  const NW = L.nodeW, NH = L.nodeH;
  const rackW = NW + L.rackPadX * 2;
  const rackH = L.rackPadTop
              + NH * cfg.rack.nodesPerRack
              + L.nodeGap * (cfg.rack.nodesPerRack - 1)
              + 10;
  const podH  = L.podPadTop + rackH + L.podPadBottom;
  const podW  = n => L.podPadX*2 + n*rackW + (n-1)*L.podGap;

  let curX = 0;
  cfg.pods.forEach((podCfg, pi) => {
    const pw = podW(podCfg.racksCount);
    const theme = POD_THEMES[podCfg.theme] || POD_THEMES.purple;
    const pod = {
      id: podCfg.id, type:'pod', name: podCfg.name,
      x: curX, y: 0, w: pw, h: podH,
      fill: theme.fill, stroke: theme.stroke,
      rackIds: [],
    };
    pods.push(pod);

    for (let ri = 0; ri < podCfg.racksCount; ri++) {
      const rx = curX + L.podPadX + ri * (rackW + L.podGap);
      const ry = L.podPadTop;
      const rackId = `${podCfg.id}_r${ri}`;
      const rack = {
        id: rackId, type:'rack', podId: podCfg.id,
        name: `Rack ${String.fromCharCode(65+pi)}-0${ri+1}`,
        x: rx, y: ry, w: rackW, h: rackH, nodeIds: [],
      };
      racks.push(rack);
      pod.rackIds.push(rackId);

      for (let ni = 0; ni < cfg.rack.nodesPerRack; ni++) {
        const nodeId = `${rackId}_n${ni}`;
        const ny = ry + L.rackPadTop + ni*(NH + L.nodeGap);
        nodes.push({
          id: nodeId, type:'node', rackId, podId: podCfg.id,
          name: `Node ${ri+1}-0${ni+1}`,
          x: rx + L.rackPadX, y: ny, w: NW, h: NH,
        });
        rack.nodeIds.push(nodeId);
      }

      // ToR switch — placed below each rack
      switches.push({
        id: `tor_${rackId}`, type:'tor', rackId, podId: podCfg.id,
        cx: rx + rackW/2, cy: ry + rackH + 28, r: 13,
      });
    }

    // Spine switch — placed above each pod
    switches.push({
      id: `spine_${podCfg.id}`, type:'spine', podId: podCfg.id,
      cx: curX + pw/2, cy: -54, w: pw * 0.45, h: 20,
    });

    curX += pw + L.interPodGap;
  });

  const totalW = curX - L.interPodGap;

  // Core router — above all spines
  const spineMinY = Math.min(...switches.filter(s=>s.type==='spine').map(s=>s.cy));
  switches.push({
    id: 'core', type:'core',
    cx: totalW/2, cy: spineMinY - 52, w: 82, h: 22,
  });

  // Center everything around origin
  const ox = -totalW/2, oy = -podH/2 - 30;
  pods.forEach(p    => { p.x += ox;  p.y += oy; });
  racks.forEach(r   => { r.x += ox;  r.y += oy + L.podPadTop; });
  nodes.forEach(n   => { n.x += ox;  n.y += oy + L.podPadTop; });
  switches.forEach(s => {
    s.cx += ox;
    s.cy  = s.type==='core' ? s.cy + oy : s.cy + oy + L.podPadTop;
  });

  const zone = {
    type: 'zone', name: config.zone.name,
    x: ox-70, y: oy-90, w: totalW+140, h: podH+170,
  };

  return { pods, racks, nodes, switches, zone };
}

// Build the topology once at startup.
const TOPO = buildTopology(CLUSTER_CONFIG, LAYOUT);
export const { pods:PODS, racks:RACKS, nodes:NODES, switches:SWITCHES, zone:ZONE } = TOPO;
export const TOTAL_GPU = NODES.length * CLUSTER_CONFIG.node.gpuCount;

// ─── Info panel content — generated from CLUSTER_CONFIG ──────────────────────
function buildInfoPanels(C) {
  return {
    gpu: {
      title: `GPU — NVIDIA ${C.gpu.model}`,
      rows: [
        ['型号',    C.gpu.model],
        ['显存',    `${C.gpu.vramGB} GB ${C.gpu.vramType}`],
        ['显存带宽',`${C.gpu.vramBWTBs} TB/s`],
        ['FP16算力',`${C.gpu.fp16TFLOPS} TFLOPS`],
        ['NVLink',  `${C.gpu.nvlinkBWGBs} GB/s 双向`],
        ['PCIe',    C.gpu.pcieLanes],
        ['TDP',     `${C.gpu.tdpW} W`],
      ],
      desc:'GPU是集群核心，负责矩阵乘法和张量运算。8块H100通过NVSwitch以NVLink全互联，Any-to-Any带宽均为900GB/s，等效为单台640GB显存的超级GPU。',
    },
    cpu: {
      title: `CPU — ${C.cpu.model} × ${C.node.cpuCount}`,
      rows: [
        ['核心数',  `${C.cpu.cores}核/${C.cpu.threads}线程 per socket`],
        ['系统内存',`${C.node.ramTB} TB DDR5`],
        ['PCIe',    `${C.cpu.pcieGen} Gen`],
        ['作用',    C.cpu.role],
      ],
      desc:'CPU负责控制面：数据加载、CUDA Kernel调度、NCCL初始化。计算密集部分完全由GPU承担，CPU主要用于编排和DMA缓冲。',
    },
    nvswitch: {
      title: 'NVSwitch — 节点内 GPU 互联',
      rows: [
        ['协议',   C.nvswitch.protocol],
        ['带宽',   `${C.nvswitch.bwGBs} GB/s 全双工`],
        ['延迟',   C.nvswitch.latency],
        ['拓扑',   C.nvswitch.topology],
        ['数量',   `${C.nvswitch.countPerNode}片 / ${C.node.model}`],
      ],
      desc:'将节点内8块GPU连成全互联Fabric，AllReduce不经CPU/PCIe直接完成，速度接近显存带宽上限，是节点内通信的核心。',
    },
    hbm: {
      title: `${C.gpu.vramType} — 高带宽显存`,
      rows: [
        ['类型',   C.gpu.vramType],
        ['容量',   `${C.gpu.vramGB} GB per GPU`],
        ['带宽',   `${C.gpu.vramBWTBs} TB/s`],
        ['堆叠',   '8层 Die Stack'],
        ['位宽',   '5120-bit'],
      ],
      desc:'HBM采用3D堆叠封装集成在GPU基板，比GDDR6带宽高5倍。显存带宽是大模型Attention计算的关键瓶颈，直接决定序列长度和批大小上限。',
    },
    nic: {
      title: `IB NIC — ${C.nic.model}`,
      rows: [
        ['型号',     C.nic.model],
        ['协议',     C.nic.protocol],
        ['带宽',     `${C.nic.bwGbps} Gb/s 双向`],
        ['延迟',     `< ${C.nic.latencyNs} ns`],
        ['数量',     `${C.nic.countPerNode}块/节点 = ${C.nic.totalTbps} Tb/s`],
      ],
      desc:'每GPU配一块400G NIC，支持GPUDirect RDMA——GPU显存数据无需经CPU直接通过NIC传输。8块NIC并联形成3.2Tb/s总带宽，保证AllReduce不成瓶颈。',
    },
    tor: {
      title: 'ToR Switch — 机顶交换机',
      rows: [
        ['位置',   '每Rack顶部'],
        ['协议',   C.tor.protocol],
        ['端口',   `${C.tor.ports}口 QSFP-DD`],
        ['延迟',   C.tor.latency],
        ['上联',   `${C.tor.uplinkCount}×400G ECMP → Spine`],
      ],
      desc:'汇聚机架内节点的RDMA流量，GPUDirect RDMA让GPU显存数据不经CPU直达网络。下行连所有节点NIC，上行ECMP多路并联接Spine。',
    },
    spine: {
      title: 'Spine Switch — 汇聚层',
      rows: [
        ['协议',   C.spine.protocol],
        ['拓扑',   C.spine.topology],
        ['收敛比', C.spine.ratio],
        ['型号',   C.spine.model],
      ],
      desc:'Pod内无阻塞全带宽Fat-Tree交换，保证跨机架AllReduce不产生热点拥塞，是大规模训练通信质量的核心保障。',
    },
    core: {
      title: 'Core Router — 核心路由层',
      rows: [
        ['协议',   C.core.protocol],
        ['功能',   C.core.role],
        ['连接',   'FSx/Lustre · S3 · 外网'],
        ['延迟',   C.core.latency],
      ],
      desc:'Zone级别跨Pod路由和南北向流量，协议从高性能IB切换为标准TCP/IP。连接Lustre/FSx文件系统和S3——训练数据流入，Checkpoint写出。',
    },
    node: {
      title: `Compute Node — ${C.node.model}`,
      rows: [
        ['GPU',     `${C.node.gpuCount}× ${C.gpu.model} ${C.gpu.vramGB}GB`],
        ['CPU',     `${C.node.cpuCount}× ${C.cpu.model}`],
        ['系统内存',`${C.node.ramTB} TB DDR5`],
        ['NIC',     `${C.node.nicCount}× CX-7 ${C.nic.bwGbps}Gb/s`],
        ['NVSwitch',`${C.node.nvswitchCount}片全互联`],
        ['峰值算力', C.node.peakFlops],
      ],
      desc:`${C.node.model}是最小训练单元：${C.node.gpuCount}GPU通过NVSwitch全互联，每GPU独享${C.nic.bwGbps}G NIC。单节点总显存${C.node.gpuCount*C.gpu.vramGB}GB，IB总带宽${C.nic.totalTbps}Tb/s。`,
    },
    rack: {
      title: 'Rack — 机架',
      rows: [
        ['高度',   `${C.rack.heightU}U 标准机架`],
        ['节点数', `${C.rack.nodesPerRack} 台`],
        ['GPU密度',`${C.rack.nodesPerRack * C.node.gpuCount} GPU/架`],
        ['供电',   C.rack.powerKW],
        ['散热',   C.rack.cooling],
      ],
      desc:'机架承载节点和ToR交换机。液冷管路直接对GPU散热，功率密度从风冷15kW提升至60kW+，是支撑H100高TDP的基础设施关键。',
    },
    pod: {
      title: 'Pod — 集群组',
      rows: [
        ['规模',   `${C.pods[0].racksCount} Rack，${C.pods[0].racksCount * C.rack.nodesPerRack * C.node.gpuCount} GPU`],
        ['内部网络','InfiniBand Fat-Tree'],
        ['收敛比', '1:1 全带宽无阻塞'],
        ['用途',   '单个大型训练作业域'],
      ],
      desc:'Pod是资源调度和网络隔离的基本域，同Pod内GPU通过IB Fat-Tree超低延迟通信，适合运行单个大规模分布式训练作业（如LLM预训练）。',
    },
    zone: {
      title: `Availability Zone — 可用区`,
      rows: [
        ['GPU规模', C.zone.totalGPU + ' GPU'],
        ['网络架构',C.zone.network],
        ['存储',    C.zone.storage],
        ['冗余',    C.zone.redundancy],
      ],
      desc:'可用区是物理数据中心独立分区，拥有独立供电和制冷系统。大型云厂商在单AZ内部署万卡级别集群。跨AZ通过DCI互联，延迟较高，通常仅用于灾备。',
    },
  };
}
export const INFO = buildInfoPanels(CLUSTER_CONFIG);
