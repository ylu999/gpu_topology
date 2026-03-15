# GPU Cluster Topology Visualizer

交互式 GPU 集群拓扑图，纯 HTML/Canvas，无外部依赖，双击 `index.html` 即可在浏览器打开。

## 功能

- **无限缩放 / 平移**：滚轮缩放，拖拽平移
- **5 级 LOD（层级细节）**：Zone → Pod → Rack → Node → Chip
- **链路开关**：NVLink / PCIe / InfiniBand / Ethernet 可独立切换
- **点击组件**：右下角弹出详细参数说明

## 层级结构

```
Availability Zone (35,000+ GPU)
└── Pod A/B/C
    └── Rack (42U, 液冷)
        └── Node (DGX H100)
            ├── CPU0 ──UPI── CPU1
            ├── NVSwitch ×4 (NVLink 4.0 All-to-All Fabric)
            │     └── 每个 SW 通过 PCIe 接受 CPU 管理
            ├── GPU G0–G7 (H100 SXM5 80GB HBM3)
            │     ├── NVLink → 全部 4 个 NVSwitch（无阻塞互联）
            │     └── PCIe Gen5 → CPU（G0-3→CPU0，G4-7→CPU1）
            └── IB NIC ×8 (ConnectX-7, 1 NIC per GPU)
                  ├── PCIe → 对应 GPU（GPUDirect RDMA）
                  └── InfiniBand NDR 400G → ToR Switch
```

## 关键连接说明

| 连接 | 协议 | 带宽 | 用途 |
|------|------|------|------|
| GPU ↔ NVSwitch | NVLink 4.0 | 900 GB/s | 节点内 All-to-All 数据面 |
| GPU → CPU | PCIe Gen5 | 128 GB/s | Kernel 调度、控制面 |
| CPU ↔ CPU | AMD UPI | ~340 GB/s | 双路 CPU 共享内存 |
| CPU → NVSwitch | PCIe (mgmt) | — | 配置/管理，非数据面 |
| NIC → GPU | PCIe Gen5 | 128 GB/s | GPUDirect RDMA，绕过 CPU |
| NIC → ToR | InfiniBand NDR | 400 Gb/s | 跨节点 RDMA |
| ToR → Spine | InfiniBand NDR | 400 Gb/s | Pod 内 Fat-Tree |
| Spine → Core | Ethernet 400GbE | 400 Gb/s | 跨 Pod、存储、外网 |

> **注意**：4 个 NVSwitch 之间**不直接互联**。  
> GPU A→GPU B 的路径是 `GPU A → 任意 NVSwitch → GPU B`，单跳即达，无需 Switch 间通信。

## 文件结构

```
gpu_topology/
├── index.html          — 入口 HTML；加载 CSS + JS 模块，仅含 UI 标记
├── css/
│   └── style.css       — 全部样式
├── js/
│   ├── data.js         — LAYER 1：ENTITY_TYPES, LINK_TYPES, CLUSTER_CONFIG, POD_THEMES, EDGE_META
│   ├── topology.js     — LAYER 2：LAYOUT, buildTopology(), buildInfoPanels()，导出 TOPO/PODS/RACKS/NODES/SWITCHES/ZONE/TOTAL_GPU/INFO
│   ├── renderer.js     — LAYER 3：draw*, canvas 设置，camera，LOD，resize，hit testing
│   ├── interaction.js  — 鼠标/触摸事件，缩放/平移，层级跳转，链路切换（模块入口）
│   ├── jobs.js         — Job Placement Simulator：placeJob, addJob, removeJob, clearJobs, drawJobs, fragScore
│   └── paths.js        — RDMA 路径追踪：computePath, drawPath, togglePathMode, clearPath，路径动画
└── README.md
```

纯 ES 模块，无构建步骤，可直接通过 GitHub Pages 或本地 HTTP 服务器访问。
