import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  fetchKgEntityChunks,
  type KgEdge,
  type KgEvidence,
  type KgGraph,
  type KgNode,
  type KgEntityType,
} from '../../api'

/**
 * 知识图谱画布。
 *
 * 布局手写：先按「权重分层」撒点，再用斥力 + 边弹簧 + 径向约束迭代。
 * 权重要看提及次数和关系数量 —— 提及多、连接多的实体压在内圈，边缘实体
 * 自然落在外圈，图就有了中心密、外围疏的层次，而不是均匀摊平。
 *
 * 逐帧直接改 DOM 的 transform，不走 React state —— 否则每帧协调几十个
 * 节点，拖动会明显掉帧。
 */

const TYPE_META: Record<KgEntityType, { label: string; color: string }> = {
  org: { label: '机构', color: '#4d6bfe' },
  product: { label: '产品', color: '#7c5cff' },
  technology: { label: '技术', color: '#0ea5a4' },
  concept: { label: '概念', color: '#f59e0b' },
  metric: { label: '指标', color: '#16a34a' },
  event: { label: '事件', color: '#ef4444' },
  location: { label: '地点', color: '#0ea5e9' },
  person: { label: '人物', color: '#db2777' },
  other: { label: '其他', color: '#94a3b8' },
}

/**
 * 簇视图配色：按社区编号轮转。色相刻意拉开（相邻社区不会撞色），
 * 孤立点固定灰——它不属于任何业务板块，给彩色会误导。
 */
const COMMUNITY_COLORS = [
  '#4d6bfe',
  '#0ea5a4',
  '#f59e0b',
  '#db2777',
  '#7c5cff',
  '#16a34a',
  '#ef4444',
  '#0ea5e9',
  '#a16207',
  '#64748b',
]
const ISOLATED_COLOR = '#94a3b8'

function communityColor(community: number | undefined): string {
  if (!community) return ISOLATED_COLOR
  return COMMUNITY_COLORS[(community - 1) % COMMUNITY_COLORS.length]
}

const NODE_MIN_R = 6.5
const NODE_MAX_R = 11.5
const LINK_LENGTH = 104
const REPULSION = 14000
const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * 径向收缩比例：每步把节点往「它该在的那一圈」拽回多少。
 * 用位置收缩而不是加弹簧力 —— 力会跟斥力打架，收缩不会，层次始终压得住。
 */
const LANE_SNAP = 0.34
/** 预热步数：开屏前先静默迭代这么多步，页面一出现就基本成形，不用盯着它抖半分钟 */
const WARMUP_STEPS = 150

type SimNode = {
  id: string
  name: string
  type: KgEntityType
  mentions: number
  r: number
  /** 社区编号（P4 簇视图）：0 = 孤立点 */
  community: number
  x: number
  y: number
  vx: number
  vy: number
  fixed: boolean
  /** 该节点应当待的半径（相对画布中心），由权重分层算出来 */
  laneR: number
}

type SimLink = {
  id: string
  source: number
  target: number
  relation: string
  el?: SVGLineElement
  labelEl?: SVGTextElement
}

function radiusOf(mentions: number): number {
  const m = Math.max(1, Math.min(mentions || 1, 8))
  return NODE_MIN_R + ((m - 1) / 7) * (NODE_MAX_R - NODE_MIN_R)
}

type Sim = {
  nodes: SimNode[]
  links: SimLink[]
  alpha: number
  width: number
  height: number
  /** 分层用的椭圆半径：画布是横向的，正圆会左右留一大片空 */
  rx: number
  ry: number
}

// 画布底部要留出图例/提示的高度，否则节点会被压在图例下面或被画布边缘切掉
const BOTTOM_PAD = 34

/**
 * 节点分量：提及次数是显式权重，关系条数代表它在图里的枢纽程度 ——
 * 后者更稀缺（多数实体关系很少），所以给更高系数。
 */
function weightOf(node: KgNode, degree: number): number {
  return (node.mentions || 1) + 2.2 * degree
}

function buildSim(
  nodes: KgNode[],
  edges: KgEdge[],
  width: number,
  height: number,
  /** 上一轮布局：id 相同的节点原样继承位置，下钻展开时整图不重新洗牌 */
  carry?: Map<string, { x: number; y: number; laneR: number }>,
): Sim {
  const usableH = height - BOTTOM_PAD
  const cx = width / 2
  const cy = usableH / 2
  // 实体少的时候把整体收一收：十几个节点摊在同一张大椭圆上会空得发慌
  const density = Math.min(1, Math.sqrt(nodes.length / 40))
  const rx = width * 0.34 * density
  const ry = usableH * 0.36 * density

  const degree = new Map<string, number>()
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
  }

  // 权重降序：排名决定它落在第几圈，t=0 贴中心、t=1 最外圈
  const ranked = nodes
    .map((node, i) => ({ i, w: weightOf(node, degree.get(node.id) ?? 0) }))
    .sort((a, b) => b.w - a.w || nodes[a.i].id.localeCompare(nodes[b.i].id))

  const golden = Math.PI * (3 - Math.sqrt(5))
  const simNodes: SimNode[] = new Array(nodes.length)
  // 第一遍落位：老节点（carry 命中）原地不动；新节点先记下，等第二遍
  // 锚着已落位的老节点出生 —— 直接撒金螺线的话，新邻居可能落在画布另一头，
  // 弹簧会把刚点中的枢纽节点拽得满图跑（「点一个节点，节点自己跑了」）
  const anchor = new Map<string, { x: number; y: number }>()
  const pending: { idx: number; k: number; laneT: number }[] = []
  ranked.forEach((item, k) => {
    const node = nodes[item.i]
    const t = ranked.length > 1 ? k / (ranked.length - 1) : 0
    // 指数大于 1：靠前的排名挤在很小的半径里，中心自然比外围密
    const laneT = 0.1 + 0.9 * t ** 1.5
    const angle = k * golden - Math.PI / 2
    const carried = carry?.get(node.id)
    simNodes[item.i] = {
      id: node.id,
      name: node.name,
      type: node.type,
      mentions: node.mentions,
      community: node.community ?? 0,
      r: radiusOf(node.mentions),
      x: carried ? carried.x : cx + Math.cos(angle) * laneT * rx,
      y: carried ? carried.y : cy + Math.sin(angle) * laneT * ry,
      vx: 0,
      vy: 0,
      fixed: false,
      laneR: carried ? carried.laneR : laneT,
    }
    if (carried) anchor.set(node.id, { x: carried.x, y: carried.y })
    else pending.push({ idx: item.i, k, laneT })
  })

  // 第二遍：新节点出生在它连着的已有节点旁边，距离取弹簧自然长度 ——
  // 展开瞬间弹簧几乎不吃劲，枢纽节点原地不动，邻居围着它长出来；
  // 没有任何已落位邻居的（罕见）才退回金螺线兜底
  let spawnSeq = 0
  for (const p of pending) {
    const sn = simNodes[p.idx]
    const linked = edges.find(
      (e) =>
        (e.source === sn.id && anchor.has(e.target)) ||
        (e.target === sn.id && anchor.has(e.source)),
    )
    let x: number
    let y: number
    if (linked) {
      const base = anchor.get(linked.source === sn.id ? linked.target : linked.source)
      const ang = spawnSeq * golden - Math.PI / 2
      spawnSeq += 1
      x = (base?.x ?? cx) + Math.cos(ang) * LINK_LENGTH
      y = (base?.y ?? cy) + Math.sin(ang) * LINK_LENGTH
      // 出生点夹回画布内，别落在边界外被硬夹出一段瞬移。
      // 半径取 SimNode 的 r —— KgNode 上没有这个字段，取错会得到 NaN，
      // 再经斥力传染全图，画布就一片空白了
      x = Math.max(sn.r + 4, Math.min(width - sn.r - 4, x))
      y = Math.max(sn.r + 4, Math.min(height - BOTTOM_PAD - sn.r, y))
    } else {
      const angle = p.k * golden - Math.PI / 2
      x = cx + Math.cos(angle) * p.laneT * rx
      y = cy + Math.sin(angle) * p.laneT * ry
    }
    sn.x = x
    sn.y = y
    // 也记为锚点：链式展开（新节点连着新节点）能接着往外长
    anchor.set(sn.id, { x, y })
  }

  const indexById = new Map(simNodes.map((n, i) => [n.id, i]))
  const simLinks: SimLink[] = []
  for (const edge of edges) {
    const s = indexById.get(edge.source)
    const t = indexById.get(edge.target)
    if (s === undefined || t === undefined || s === t) continue
    simLinks.push({ id: edge.id, source: s, target: t, relation: edge.relation })
  }

  const sim: Sim = { nodes: simNodes, links: simLinks, alpha: 1, width, height, rx, ry }
  // 带旧布局复用（下钻展开 / 轮询刷新）：老节点位置原样保留，只让新邻居归位，
  // 不能按冷启动全量迭代 —— 那等于整张图重新洗牌，看起来就是「闪一下」
  const reused = nodes.length > 0 && (carry?.size ?? 0) >= Math.floor(nodes.length * 0.5)
  if (reused) sim.alpha = 0.5
  // 预热按「斥力配对次数」封顶，而不是按步数。每步 naive 是 O(n²)，
  // 400 个点跑 150 步 ≈ 1200 万次计算，开屏会卡死主线程。
  // 20 万次 ≈ 60 点 × 110 步，或 400 点只跑几步，首屏先出来，余下交给动画。
  const pairs = Math.max(1, (nodes.length * Math.max(0, nodes.length - 1)) / 2)
  const warmup = reused
    ? Math.min(40, Math.max(4, Math.round(80_000 / pairs)))
    : Math.min(WARMUP_STEPS, Math.max(8, Math.round(200_000 / pairs)))
  for (let i = 0; i < warmup; i += 1) stepSim(sim)
  return sim
}

/** 一对节点的斥力。完全重合时用下标错开，避免随机数让每次布局都不一样。 */
function pushApart(a: SimNode, b: SimNode, i: number, j: number, alpha: number) {
  let dx = b.x - a.x
  let dy = b.y - a.y
  let d2 = dx * dx + dy * dy
  if (d2 < 0.01) {
    dx = 0.3 + ((i * 7 + j * 13) % 10) / 40
    dy = 0.3 + ((i * 5 + j * 11) % 10) / 40
    d2 = dx * dx + dy * dy
  }
  const dist = Math.sqrt(d2)
  const force = (REPULSION / d2) * alpha
  const fx = (dx / dist) * force
  const fy = (dy / dist) * force
  a.vx -= fx
  a.vy -= fy
  b.vx += fx
  b.vy += fy
}

/**
 * 斥力：点数少时暴力两两算更快；超过阈值改走网格，只和邻近格子相互作用。
 * 斥力随距离平方衰减，96px 格子、±2 圈 ≈ 480px，更远的力已经可以忽略。
 */
const NAIVE_REPULSION_LIMIT = 72
const GRID_CELL = 96
const GRID_RANGE = 2

function applyRepulsion(nodes: SimNode[], alpha: number) {
  const n = nodes.length
  if (n <= NAIVE_REPULSION_LIMIT) {
    for (let i = 0; i < n; i += 1) {
      const a = nodes[i]
      for (let j = i + 1; j < n; j += 1) {
        pushApart(a, nodes[j], i, j, alpha)
      }
    }
    return
  }
  const buckets = new Map<number, number[]>()
  const cellKey = (cx: number, cy: number) => cx * 1_000_003 + cy
  for (let i = 0; i < n; i += 1) {
    const cx = Math.floor(nodes[i].x / GRID_CELL)
    const cy = Math.floor(nodes[i].y / GRID_CELL)
    const k = cellKey(cx, cy)
    const bucket = buckets.get(k)
    if (bucket) bucket.push(i)
    else buckets.set(k, [i])
  }
  for (let i = 0; i < n; i += 1) {
    const a = nodes[i]
    const cx = Math.floor(a.x / GRID_CELL)
    const cy = Math.floor(a.y / GRID_CELL)
    for (let gx = -GRID_RANGE; gx <= GRID_RANGE; gx += 1) {
      for (let gy = -GRID_RANGE; gy <= GRID_RANGE; gy += 1) {
        const bucket = buckets.get(cellKey(cx + gx, cy + gy))
        if (!bucket) continue
        for (const j of bucket) {
          if (j <= i) continue
          pushApart(a, nodes[j], i, j, alpha)
        }
      }
    }
  }
}

function stepSim(sim: Sim) {
  const { nodes, links, alpha, rx, ry } = sim
  const cx = sim.width / 2
  const cy = (sim.height - BOTTOM_PAD) / 2

  applyRepulsion(nodes, alpha)

  for (const link of links) {
    const a = nodes[link.source]
    const b = nodes[link.target]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dist = Math.hypot(dx, dy) || 0.01
    const force = (dist - LINK_LENGTH) * 0.022 * alpha
    const fx = (dx / dist) * force
    const fy = (dy / dist) * force
    a.vx += fx
    a.vy += fy
    b.vx -= fx
    b.vy -= fy
  }

  for (const node of nodes) {
    if (node.fixed) {
      node.vx = 0
      node.vy = 0
      continue
    }
    // 软边界：贴边时给一个回推力，否则所有越界节点会被硬夹在同一条线上排成队
    const padX = node.r + 8
    const padTop = node.r + 8
    const padBottom = node.r + BOTTOM_PAD
    if (node.x < padX) node.vx += (padX - node.x) * 0.06
    if (node.x > sim.width - padX) node.vx -= (node.x - (sim.width - padX)) * 0.06
    if (node.y < padTop) node.vy += (padTop - node.y) * 0.06
    if (node.y > sim.height - padBottom) {
      node.vy -= (node.y - (sim.height - padBottom)) * 0.06
    }

    node.vx *= 0.86
    node.vy *= 0.86
    node.x += node.vx
    node.y += node.vy

    // 径向收回到自己的圈：斥力和弹簧只争「谁挨着谁」，离中心多远由权重说了算。
    // 不做这一步，迭代久了所有节点会被斥力推到画布边缘排成一圈。
    const u = (node.x - cx) / rx
    const v = (node.y - cy) / ry
    const d = Math.hypot(u, v) || 0.001
    const scale = 1 + ((node.laneR - d) / d) * LANE_SNAP * alpha
    node.x = cx + (node.x - cx) * scale
    node.y = cy + (node.y - cy) * scale
    // 兜底硬夹：极端情况下（拖拽甩出去）保证节点不跑到画布外
    const pad = node.r + 4
    node.x = Math.max(pad, Math.min(sim.width - pad, node.x))
    node.y = Math.max(pad, Math.min(sim.height - BOTTOM_PAD, node.y))
  }
  // 点多时加快冷却：否则从预热残留的 alpha 再跑两百多帧 O(n²)，拖动也会粘
  sim.alpha *= nodes.length > 80 ? 0.97 : 0.985
}

type Props = {
  graph: KgGraph | null
  loading: boolean
  error?: string
  /** 检索命中的实体 id：加光环，其余节点压暗 */
  hitIds?: string[]
  /** 是否压暗非命中节点；画布已经是检索子图时传 false，否则邻居也被压掉 */
  dimOthers?: boolean
  /**
   * 枢纽分层（全库/合并始终启用；单文件图超过 KG_HUB_CAP 也启用）：
   * 默认只显示有连接的节点里权重最高的 HUB_CAP 个，孤独点（没有关系）
   * 全部隐藏；点任意节点 = 下钻，它的一跳邻居自动显示出来，
   * 取消选中回到纯枢纽图。单文件抽出几百个实体时，全量力导向会卡死开屏。
   */
  prune?: boolean
  selectedId?: string | null
  onSelect?: (node: KgNode | null) => void
  /** 配色口径：按实体类型（默认）或按社区（簇视图） */
  colorMode?: 'type' | 'community'
  emptyTitle: string
  emptyHint: string
  emptyAction?: { label: string; onClick: () => void }
}

/** 枢纽模式下默认渲染的最大节点数：力导向是 O(n²)，一百个点仍流畅，骨干也更不容易漏 */
export const KG_HUB_CAP = 100
const HUB_CAP = KG_HUB_CAP
/** 下钻时额外带上的一跳邻居上限：星型枢纽可能有上百条边，全展开会再次卡死 */
const NEIGHBOR_CAP = 36

export default function KnowledgeGraph({
  graph,
  loading,
  error = '',
  hitIds = [],
  dimOthers = true,
  prune = false,
  selectedId = null,
  onSelect,
  colorMode = 'type',
  emptyTitle,
  emptyHint,
  emptyAction,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const detailRef = useRef<HTMLElement>(null)
  const linkRef = useRef<SVGGElement>(null)
  const labelRef = useRef<SVGGElement>(null)
  const nodeRef = useRef<SVGGElement>(null)

  const simRef = useRef<Sim | null>(null)
  // 上一轮布局：下钻展开时新 sim 从这里继承老节点的位置，整图不重新洗牌。
  // 不能依赖 simRef —— effect 的 cleanup 会把它清空，重建时已经拿不到了
  const lastLayoutRef = useRef(new Map<string, { x: number; y: number; laneR: number }>())
  const lastSizeRef = useRef<{ w: number; h: number } | null>(null)
  // 上一次渲染用的源数据（注意不是显示集）：只有源数据变了才值得重置视图
  const lastDataRef = useRef<{ nodes: KgNode[]; edges: KgEdge[] } | null>(null)
  const nodeElsRef = useRef(new Map<string, SVGGElement>())
  // 建图 effect 不依赖 colorMode（切配色不该重排力导向），用 ref 读最新值
  const colorModeRef = useRef(colorMode)
  useEffect(() => {
    colorModeRef.current = colorMode
  }, [colorMode])
  const rafRef = useRef(0)
  const runningRef = useRef(false)
  const viewRef = useRef({ k: 1, x: 0, y: 0 })
  /**
   * 最新的高亮函数。
   *
   * 建图 effect 会把整层节点重建（尺寸变化也会），重建出来的节点不带 class，
   * 必须再刷一遍高亮；但建图 effect 不能把 hitIds 放进依赖 —— 那会让每次检索
   * 都重新布局一次。用 ref 转一手拿「当前这版」高亮，重建完自己补刷。
   */
  const highlightRef = useRef<() => void>(() => {})
  /** 当前焦点实体（点选 / 外部指定 / 单条检索命中）。悬停离开时把关系名还原到它 */
  const focusIdRef = useRef<string | null>(null)

  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState({ k: 1, x: 0, y: 0 })
  const [picked, setPicked] = useState<KgNode | null>(null)
  // 证据跟实体 id 绑定存：切换选中时旧数据自然失效，不必在 effect 里同步清空
  const [evidenceState, setEvidenceState] = useState<{
    id: string
    rows: KgEvidence[]
  }>({ id: '', rows: [] })
  const [evidenceLoading, setEvidenceLoading] = useState(false)

  const nodes = useMemo(() => graph?.nodes ?? [], [graph])
  const edges = useMemo(() => graph?.edges ?? [], [graph])
  const nodeById = useMemo(() => {
    const map = new Map<string, KgNode>()
    for (const n of nodes) map.set(n.id, n)
    return map
  }, [nodes])

  // 外部 selectedId（检索/列表）优先，其次画布点击选中的节点
  const activeNodeId =
    selectedId ?? (picked && nodeById.has(picked.id) ? picked.id : null)
  const activeNode = activeNodeId ? nodeById.get(activeNodeId) ?? null : null

  /**
   * 实际渲染的节点/边。
   *
   * prune 关闭 = 全量。prune 开启 = 枢纽图：
   *   孤独点（degree 0）没有边，画出来只是一个孤零零的名字，没有信息量；
   *   有连接的节点按「提及 + 度数」挑前 HUB_CAP 个，文件多了图也不会铺满；
   *   选中节点的一跳邻居按权重补进来（最多 NEIGHBOR_CAP 个）—— 这就是
   *   「点击下钻」，点谁展开谁的周边，取消选中收回去，交互没有多出任何按钮。
   * 全集都被裁空（所有实体都没抽到关系）时仍截前 HUB_CAP，避免开天窗的同时卡死开屏。
   */
  const display = useMemo(() => {
    if (!prune) return { nodes, edges }
    const deg = new Map<string, number>()
    for (const edge of edges) {
      deg.set(edge.source, (deg.get(edge.source) ?? 0) + 1)
      deg.set(edge.target, (deg.get(edge.target) ?? 0) + 1)
    }
    const degOf = (node: KgNode) => node.degree ?? deg.get(node.id) ?? 0
    const keep = new Set<string>()
    const linked = nodes
      .filter((node) => degOf(node) > 0)
      .sort(
        (a, b) =>
          weightOf(b, degOf(b)) - weightOf(a, degOf(a)) || a.id.localeCompare(b.id),
      )
    for (const node of linked.slice(0, HUB_CAP)) keep.add(node.id)
    if (activeNodeId) {
      keep.add(activeNodeId)
      const extras: string[] = []
      const seen = new Set<string>()
      for (const edge of edges) {
        const other =
          edge.source === activeNodeId
            ? edge.target
            : edge.target === activeNodeId
              ? edge.source
              : ''
        if (!other || keep.has(other) || seen.has(other)) continue
        seen.add(other)
        extras.push(other)
      }
      if (extras.length > NEIGHBOR_CAP) {
        const byId = new Map(nodes.map((node) => [node.id, node]))
        extras.sort((a, b) => {
          const na = byId.get(a)
          const nb = byId.get(b)
          const wa = na ? weightOf(na, degOf(na)) : 0
          const wb = nb ? weightOf(nb, degOf(nb)) : 0
          return wb - wa || a.localeCompare(b)
        })
        extras.length = NEIGHBOR_CAP
      }
      for (const id of extras) keep.add(id)
    }
    if (keep.size === 0) {
      // 全是孤独点：仍截前 HUB_CAP，避免 400 个无边节点卡死开屏
      if (nodes.length > HUB_CAP) {
        return { nodes: nodes.slice(0, HUB_CAP), edges: [] }
      }
      return { nodes, edges }
    }
    return {
      nodes: nodes.filter((node) => keep.has(node.id)),
      edges: edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target)),
    }
  }, [prune, nodes, edges, activeNodeId])
  const displayNodes = display.nodes
  const displayEdges = display.edges

  const paint = useCallback(() => {
    const sim = simRef.current
    if (!sim) return
    for (const node of sim.nodes) {
      const el = nodeElsRef.current.get(node.id)
      if (el) {
        el.setAttribute(
          'transform',
          `translate(${node.x.toFixed(2)} ${node.y.toFixed(2)})`,
        )
      }
    }
    for (const link of sim.links) {
      const a = sim.nodes[link.source]
      const b = sim.nodes[link.target]
      if (link.el && a && b) {
        link.el.setAttribute('x1', a.x.toFixed(2))
        link.el.setAttribute('y1', a.y.toFixed(2))
        link.el.setAttribute('x2', b.x.toFixed(2))
        link.el.setAttribute('y2', b.y.toFixed(2))
        // 高亮时按两端 id 判邻接，写进 dataset 免得每帧重新算
        link.el.dataset.source = a.id
        link.el.dataset.target = b.id
      }
      if (link.labelEl && a && b) {
        link.labelEl.setAttribute('x', ((a.x + b.x) / 2).toFixed(2))
        link.labelEl.setAttribute('y', ((a.y + b.y) / 2).toFixed(2))
      }
    }
  }, [])

  /** 重启力导向循环；已在跑就直接返回，避免拖动时越叠越多 */
  const kick = useCallback(() => {
    if (runningRef.current) return
    runningRef.current = true
    const loop = () => {
      const sim = simRef.current
      if (!sim) {
        runningRef.current = false
        return
      }
      stepSim(sim)
      paint()
      if (sim.alpha > 0.006) {
        rafRef.current = requestAnimationFrame(loop)
      } else {
        runningRef.current = false
      }
    }
    rafRef.current = requestAnimationFrame(loop)
  }, [paint])

  // 容器尺寸
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect && rect.width > 0) setSize({ w: rect.width, h: rect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 数据或尺寸变化：重建 DOM 与模拟
  useEffect(() => {
    const nodeLayer = nodeRef.current
    const linkLayer = linkRef.current
    const labelLayer = labelRef.current
    // 直接量 DOM：state 里的尺寸在一次渲染周期内可能还是旧值（详情面板刚占位时），
    // 用旧宽度布局会把一批节点 clamp 到真实画布之外
    const w = wrapRef.current?.clientWidth || size.w
    const h = wrapRef.current?.clientHeight || size.h
    if (!nodeLayer || !linkLayer || !w || !h) return

    const prevSize = lastSizeRef.current
    const sameSize = prevSize?.w === w && prevSize?.h === h
    const sameData =
      lastDataRef.current?.nodes === nodes && lastDataRef.current?.edges === edges
    const carry = sameSize ? lastLayoutRef.current : null

    const sim = buildSim(
      displayNodes,
      displayEdges,
      w,
      h,
      carry && carry.size > 0 ? carry : undefined,
    )
    simRef.current = sim
    nodeElsRef.current = new Map()
    nodeLayer.replaceChildren()
    linkLayer.replaceChildren()
    labelLayer?.replaceChildren()
    viewRef.current = { k: 1, x: 0, y: 0 }

    // 边太多时索性不建标签，避免 DOM 过重
    const showLinkLabel = sim.links.length <= 60
    const showLinkLabelsOf = (id: string | null) => {
      for (const link of sim.links) {
        if (!link.labelEl) continue
        const on = id
          ? sim.nodes[link.source].id === id || sim.nodes[link.target].id === id
          : false
        link.labelEl.classList.toggle('is-on', on)
        link.el?.classList.toggle('is-hover', Boolean(on))
      }
    }
    for (const node of sim.nodes) {
      const meta = TYPE_META[node.type] ?? TYPE_META.other
      // 配色口径由 colorMode 决定：属性挂在元素上，切换时不用重建整张图
      const color = colorModeRef.current === 'community'
        ? communityColor(node.community)
        : meta.color
      const g = document.createElementNS(SVG_NS, 'g')
      g.setAttribute('class', 'kg-node-g')
      g.dataset.id = node.id
      g.dataset.type = node.type
      g.dataset.community = String(node.community ?? 0)

      const halo = document.createElementNS(SVG_NS, 'circle')
      halo.setAttribute('class', 'kg-halo')
      halo.setAttribute('r', String(node.r + 6))
      halo.setAttribute('fill', 'none')
      halo.setAttribute('stroke', color)
      halo.setAttribute('stroke-width', '2.2')
      halo.setAttribute('opacity', '0')
      g.appendChild(halo)

      const circle = document.createElementNS(SVG_NS, 'circle')
      circle.setAttribute('r', String(node.r))
      circle.setAttribute('fill', color)
      circle.setAttribute('fill-opacity', '0.26')
      circle.setAttribute('stroke', color)
      circle.setAttribute('stroke-width', '2')
      g.appendChild(circle)

      const text = document.createElementNS(SVG_NS, 'text')
      text.setAttribute('class', 'kg-node-label')
      text.setAttribute('text-anchor', 'middle')
      text.setAttribute('dy', String(node.r + 13))
      text.textContent =
        node.name.length > 12 ? `${node.name.slice(0, 11)}…` : node.name
      g.appendChild(text)

      // 悬停节点时只显示它的邻接关系名：全部常显在密图里会同节点标签叠成一团。
      // 离开时若有选中实体，把关系名还原到选中节点，而不是全藏
      g.addEventListener('pointerenter', () => showLinkLabelsOf(node.id))
      g.addEventListener('pointerleave', () => showLinkLabelsOf(focusIdRef.current))
      nodeLayer.appendChild(g)
      nodeElsRef.current.set(node.id, g)
    }

    for (const link of sim.links) {
      const line = document.createElementNS(SVG_NS, 'line')
      line.setAttribute('class', 'kg-link')
      linkLayer.appendChild(line)
      link.el = line
      if (labelLayer && showLinkLabel) {
        const label = document.createElementNS(SVG_NS, 'text')
        label.setAttribute('class', 'kg-link-label')
        label.setAttribute('text-anchor', 'middle')
        label.textContent = link.relation
        labelLayer.appendChild(label)
        link.labelEl = label
      }
    }

    // 记录本轮布局与源数据：下钻展开时老节点从这里继承位置；
    // 源数据没变（只是展开显示集）就不重置视图
    const layout = new Map<string, { x: number; y: number; laneR: number }>()
    for (const node of sim.nodes) {
      layout.set(node.id, { x: node.x, y: node.y, laneR: node.laneR })
    }
    lastLayoutRef.current = layout
    lastDataRef.current = { nodes, edges }
    lastSizeRef.current = { w, h }

    paint()
    const warm = requestAnimationFrame(() => {
      // 放在下一帧：effect 体内同步 setState 会触发级联渲染（eslint 也不允许），
      // 而且此时 DOM 已经换成新图，重置视图刚好来得及。
      // 只在源数据变化时重置视图、不清选中 —— setPicked(null) 会把刚点的
      // 下钻立刻收回去，正是「点节点闪一下又回到原来的图」的原因；
      // 选中节点被数据淘汰时 activeNodeId 的 nodeById.has 守卫会自动落空
      if (!sameData) setView({ k: 1, x: 0, y: 0 })
      // 新节点没有 class，补刷一遍高亮：检索切到子图、容器尺寸变化重建都会走到这里
      highlightRef.current()
      kick()
    })
    return () => {
      cancelAnimationFrame(warm)
      cancelAnimationFrame(rafRef.current)
      runningRef.current = false
      simRef.current = null
    }
    // nodes/edges 只用来判断「源数据是否变了」，故意不进依赖：
    // display 集由它们派生，源数据一变这里必然会重跑，放进依赖只会重复触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayNodes, displayEdges, size, paint, kick])

  // 选中实体 → 拉原文证据
  useEffect(() => {
    const id = activeNode?.id
    if (!id) return
    let cancelled = false
    void (async () => {
      setEvidenceLoading(true)
      try {
        const rows = await fetchKgEntityChunks(id)
        if (!cancelled) setEvidenceState({ id, rows })
      } finally {
        if (!cancelled) setEvidenceLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeNode])

  // 证据跟着实体走：切换选中后旧结果自动失效（不靠 effect 清空）
  const evidence = evidenceState.id === activeNode?.id ? evidenceState.rows : []

  // 详情抽屉盖住画布右侧：选中的节点正好落在它下面时（多见于从「关联关系」跳转），
  // 把视图横向推开，否则高亮了却看不见
  useEffect(() => {
    const id = activeNode?.id
    if (!id) return
    // 放到下一帧再量：面板同一帧刚变成展开态，offsetWidth 可能还没落到最终值
    const raf = requestAnimationFrame(() => {
      const sim = simRef.current
      const wrap = wrapRef.current
      if (!sim || !wrap) return
      const node = sim.nodes.find((n) => n.id === id)
      if (!node) return
      const panelW = detailRef.current?.offsetWidth || 300
      const v = viewRef.current
      const screenX = node.x * v.k + v.x
      const limit = wrap.clientWidth - panelW - 40
      if (screenX > limit) {
        viewRef.current = { ...v, x: v.x - (screenX - limit) }
        setView(viewRef.current)
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [activeNode])

  // 高亮：全靠 class 切换，不重排布局（否则一检索图就重新抖一次）。
  // 焦点优先用画布点选 / 外部指定的实体，其次才是「检索只命中一个」的兜底
  const applyHighlight = useCallback(() => {
    const nodeLayer = nodeRef.current
    const linkLayer = linkRef.current
    if (!nodeLayer || !linkLayer) return
    const hit = new Set(hitIds)
    const focus = activeNodeId || (hit.size === 1 ? [...hit][0] : '')
    focusIdRef.current = focus || null
    const near = new Set<string>()
    if (focus) {
      near.add(focus)
      edges.forEach((edge) => {
        if (edge.source === focus) near.add(edge.target)
        if (edge.target === focus) near.add(edge.source)
      })
    }

    nodeLayer.querySelectorAll<SVGGElement>('.kg-node-g').forEach((el) => {
      const id = el.dataset.id ?? ''
      const isHit = hit.has(id)
      const isActive = Boolean(activeNodeId) && id === activeNodeId
      el.classList.toggle('is-hit', isHit)
      el.classList.toggle('is-active', isActive)
      const dim = dimOthers && (hit.size > 0 || Boolean(focus)) && !isHit && !near.has(id)
      el.classList.toggle('is-dim', dim)
      const halo = el.querySelector('.kg-halo')
      if (halo) halo.setAttribute('opacity', isActive ? '0.85' : isHit ? '0.55' : '0')
    })

    linkLayer.querySelectorAll<SVGLineElement>('.kg-link').forEach((el) => {
      const s = el.getAttribute('data-source') ?? ''
      const t = el.getAttribute('data-target') ?? ''
      const related = focus ? s === focus || t === focus : hit.has(s) && hit.has(t)
      el.classList.toggle('is-dim', Boolean(focus) && dimOthers && !related)
      el.classList.toggle('is-hot', Boolean(related))
    })

    // 选中后把邻接关系名常显：否则只在悬停时闪一下，点开详情面板后就没了
    const sim = simRef.current
    if (sim) {
      for (const link of sim.links) {
        if (!link.labelEl) continue
        const a = sim.nodes[link.source]
        const b = sim.nodes[link.target]
        const on = Boolean(focus && (a.id === focus || b.id === focus))
        link.labelEl.classList.toggle('is-on', on)
      }
    }
  }, [hitIds, dimOthers, activeNodeId, edges])

  useEffect(() => {
    highlightRef.current = applyHighlight
    applyHighlight()
  }, [applyHighlight])

  // 切换配色口径：只改已渲染节点的描边/填充，不动布局也不用重建 sim
  useEffect(() => {
    for (const el of nodeElsRef.current.values()) {
      const community = Number(el.dataset.community || 0)
      const type = (el.dataset.type as KgEntityType) || 'other'
      const color =
        colorMode === 'community'
          ? communityColor(community)
          : (TYPE_META[type] ?? TYPE_META.other).color
      el.querySelector('.kg-halo')?.setAttribute('stroke', color)
      const circle = el.querySelector('circle:not(.kg-halo)')
      circle?.setAttribute('fill', color)
      circle?.setAttribute('stroke', color)
    }
  }, [colorMode, graph])

  // 拖拽 / 平移 / 缩放
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    let dragNode: SimNode | null = null
    let panning = false
    let moved = false
    let downId: string | null = null
    let start = { x: 0, y: 0, vx: 0, vy: 0 }

    const toGraph = (clientX: number, clientY: number) => {
      const rect = svg.getBoundingClientRect()
      const v = viewRef.current
      return {
        x: (clientX - rect.left - v.x) / v.k,
        y: (clientY - rect.top - v.y) / v.k,
      }
    }

    const onDown = (event: PointerEvent) => {
      moved = false
      start = {
        x: event.clientX,
        y: event.clientY,
        vx: viewRef.current.x,
        vy: viewRef.current.y,
      }
      const target = (event.target as Element).closest('.kg-node-g')
      downId = (target as SVGGElement | null)?.dataset.id ?? null
      if (downId) {
        const sim = simRef.current
        dragNode = sim?.nodes.find((n) => n.id === downId) ?? null
        if (dragNode) {
          dragNode.fixed = true
          // 收敛后再拖，需要补一点能量，否则邻域纹丝不动
          if (sim) sim.alpha = Math.max(sim.alpha, 0.3)
          kick()
        }
      } else {
        panning = true
      }
      // 合成事件（测试/预览）里的 pointerId 可能不存在，捕获失败不该中断选中
      try {
        svg.setPointerCapture(event.pointerId)
      } catch {
        /* ignore */
      }
    }

    const onMove = (event: PointerEvent) => {
      if (!dragNode && !panning) return
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true
      if (dragNode) {
        const point = toGraph(event.clientX, event.clientY)
        dragNode.x = point.x
        dragNode.y = point.y
        paint()
      } else if (panning) {
        viewRef.current = { ...viewRef.current, x: start.vx + dx, y: start.vy + dy }
        setView(viewRef.current)
      }
    }

    const onUp = (event: PointerEvent) => {
      if (dragNode) {
        dragNode.fixed = false
        const sim = simRef.current
        if (sim) {
          // 拖到哪就认哪：把它的目标圈改成当前位置，否则松手会被径向收缩拽回原来的圈
          const u = (dragNode.x - sim.width / 2) / sim.rx
          const v = (dragNode.y - (sim.height - BOTTOM_PAD) / 2) / sim.ry
          dragNode.laneR = Math.min(1.2, Math.hypot(u, v))
          sim.alpha = Math.max(sim.alpha, 0.12)
        }
        kick()
      }
      if (!moved && downId) {
        const node = nodeById.get(downId) ?? null
        setPicked(node)
        onSelect?.(node)
      } else if (!moved && !downId) {
        setPicked(null)
        onSelect?.(null)
      }
      dragNode = null
      panning = false
      downId = null
      try {
        if (svg.hasPointerCapture(event.pointerId)) {
          svg.releasePointerCapture(event.pointerId)
        }
      } catch {
        /* ignore */
      }
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = svg.getBoundingClientRect()
      const v = viewRef.current
      const next = Math.min(3, Math.max(0.35, v.k * Math.exp(-event.deltaY / 480)))
      // 以指针为中心缩放：指针下的图坐标保持不动
      const gx = (event.clientX - rect.left - v.x) / v.k
      const gy = (event.clientY - rect.top - v.y) / v.k
      viewRef.current = {
        k: next,
        x: event.clientX - rect.left - gx * next,
        y: event.clientY - rect.top - gy * next,
      }
      setView(viewRef.current)
    }

    svg.addEventListener('pointerdown', onDown)
    svg.addEventListener('pointermove', onMove)
    svg.addEventListener('pointerup', onUp)
    svg.addEventListener('pointercancel', onUp)
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      svg.removeEventListener('pointerdown', onDown)
      svg.removeEventListener('pointermove', onMove)
      svg.removeEventListener('pointerup', onUp)
      svg.removeEventListener('pointercancel', onUp)
      svg.removeEventListener('wheel', onWheel)
    }
  }, [nodeById, onSelect, paint, kick])

  const zoomBy = (factor: number) => {
    const v = viewRef.current
    const k = Math.min(3, Math.max(0.35, v.k * factor))
    const cx = size.w / 2
    const cy = size.h / 2
    const gx = (cx - v.x) / v.k
    const gy = (cy - v.y) / v.k
    viewRef.current = { k, x: cx - gx * k, y: cy - gy * k }
    setView(viewRef.current)
  }

  const relations = useMemo(() => {
    if (!activeNode) return []
    return edges
      .filter((e) => e.source === activeNode.id || e.target === activeNode.id)
      .map((e) => {
        const otherId = e.source === activeNode.id ? e.target : e.source
        return {
          id: e.id,
          relation: e.relation,
          otherId,
          otherName: nodeById.get(otherId)?.name ?? '未知实体',
          outgoing: e.source === activeNode.id,
        }
      })
      .slice(0, 24)
  }, [activeNode, edges, nodeById])

  const hasData = nodes.length > 0

  return (
    <div className="kg-shell">
      <div className="kg-canvas" ref={wrapRef}>
        <svg ref={svgRef} className="kg-svg" width="100%" height="100%" aria-label="知识图谱画布">
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            <g ref={linkRef} />
            <g ref={labelRef} />
            <g ref={nodeRef} />
          </g>
        </svg>

        {!hasData && !loading ? (
          <div className="kg-placeholder">
            <svg viewBox="0 0 120 88" width="126" height="92" aria-hidden="true">
              <g fill="none" stroke="#c7d2fe" strokeWidth="1.4" strokeLinecap="round">
                <path d="M30 24 60 44M60 44 92 26M60 44 46 70M60 44 82 66" />
              </g>
              <g fill="#fff" stroke="#a5b4fc" strokeWidth="1.6">
                <circle cx="30" cy="24" r="7" />
                <circle cx="92" cy="26" r="6" />
                <circle cx="46" cy="70" r="6" />
                <circle cx="82" cy="66" r="7" />
              </g>
              <circle cx="60" cy="44" r="11" fill="#e9eeff" stroke="#4d6bfe" strokeWidth="1.8" />
            </svg>
            <h2>{emptyTitle}</h2>
            <p>{emptyHint}</p>
            {emptyAction ? (
              <button type="button" className="kg-empty-cta" onClick={emptyAction.onClick}>
                {emptyAction.label}
              </button>
            ) : null}
          </div>
        ) : null}

        {loading ? <div className="kg-loading">正在读取图谱…</div> : null}
        {error ? <p className="kg-error">{error}</p> : null}

        {hasData ? (
          <>
            <div className="kg-legend">
              {colorMode === 'community'
                ? (graph?.communities ?? [])
                    .filter((c) => !c.isolated)
                    .slice(0, 6)
                    .map((c) => (
                      <span key={c.id} className="kg-legend-item" title={c.members.join('、')}>
                        <i style={{ background: communityColor(c.id) }} />
                        {c.label}
                        <em className="kg-legend-count">{c.size}</em>
                      </span>
                    ))
                : Object.entries(TYPE_META)
                    .filter(([type]) => displayNodes.some((n) => n.type === type))
                    .map(([type, meta]) => (
                      <span key={type} className="kg-legend-item">
                        <i style={{ background: meta.color }} />
                        {meta.label}
                      </span>
                    ))}
            </div>
            <div className="kg-zoom">
              <button type="button" onClick={() => zoomBy(1.25)} aria-label="放大" title="放大">
                +
              </button>
              <button type="button" onClick={() => zoomBy(0.8)} aria-label="缩小" title="缩小">
                −
              </button>
              <button
                type="button"
                onClick={() => {
                  viewRef.current = { k: 1, x: 0, y: 0 }
                  setView(viewRef.current)
                }}
                aria-label="重置视图"
                title="重置视图"
              >
                ⟲
              </button>
            </div>
            <p className="kg-tip">
              {prune && displayNodes.length < nodes.length
                ? `显示 ${displayNodes.length} / ${nodes.length} 个实体 · 点节点展开邻域 · 滚轮缩放`
                : '拖节点调位置 · 滚轮缩放 · 点节点看关系与原文'}
            </p>
          </>
        ) : null}
      </div>

      {/* 默认收起；选中节点后从右侧滑出，取消选中（点空白/关闭）再收回 */}
      <aside
        ref={detailRef}
        className={`kg-detail${activeNode ? ' is-open' : ''}`}
        aria-hidden={!activeNode}
      >
        {activeNode ? (
          <div className="kg-detail-inner">
            <header className="kg-detail-head">
              <span
                className="kg-detail-dot"
                style={{ background: (TYPE_META[activeNode.type] ?? TYPE_META.other).color }}
              />
              <h3>{activeNode.name}</h3>
              <button
                type="button"
                className="kg-detail-close"
                onClick={() => {
                  setPicked(null)
                  onSelect?.(null)
                }}
                aria-label="关闭详情"
              >
                ✕
              </button>
            </header>
            <p className="kg-detail-type">
              {(TYPE_META[activeNode.type] ?? TYPE_META.other).label} · 提及{' '}
              {activeNode.mentions} 次
            </p>
            {activeNode.description ? (
              <p className="kg-detail-desc">{activeNode.description}</p>
            ) : null}
            {activeNode.filename ? (
              <p className="kg-detail-src">来源：{activeNode.filename}</p>
            ) : null}

            <h4 className="kg-detail-sub">关联关系（{relations.length}）</h4>
            {relations.length === 0 ? (
              <p className="kg-detail-empty">这个实体没有抽到明确关系。</p>
            ) : (
              <ul className="kg-rel-list">
                {relations.map((rel) => (
                  <li key={rel.id}>
                    <button
                      type="button"
                      onClick={() => {
                        const next = nodeById.get(rel.otherId)
                        if (next) {
                          setPicked(next)
                          onSelect?.(next)
                        }
                      }}
                    >
                      <span className="kg-rel-arrow">{rel.outgoing ? '→' : '←'}</span>
                      <span className="kg-rel-name">{rel.relation}</span>
                      <span className="kg-rel-target">{rel.otherName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <h4 className="kg-detail-sub">原文片段</h4>
            {evidenceLoading ? (
              <p className="kg-detail-empty">读取中…</p>
            ) : evidence.length === 0 ? (
              <p className="kg-detail-empty">没有定位到原文片段。</p>
            ) : (
              <ul className="kg-evidence">
                {evidence.slice(0, 4).map((item) => (
                  <li key={`${item.filename}-${item.chunk_seq}`}>
                    <div className="kg-evidence-head">
                      {item.filename}
                      {item.page !== null
                        ? ` · 第${item.page}页`
                        : ` · 第${item.chunk_seq + 1}段`}
                    </div>
                    <p>{item.text.length > 170 ? `${item.text.slice(0, 170)}…` : item.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </aside>
    </div>
  )
}
