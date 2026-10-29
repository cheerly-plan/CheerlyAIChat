import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  fetchKgGraph,
  rebuildKgGraph,
  fetchKgDocTypes,
  searchKg,
  type KbFile,
  type KgDocType,
  type KgGraph,
  type KgSearchResult,
} from '../../api'
import KnowledgeGraph from './KnowledgeGraph'
import { KgBuildDialog } from './KgBuildDialog'
import { SearchIcon, ChevronDownIcon, CheckIcon, CloseIcon, RefreshIcon } from '../chat/icons'

type Props = {
  /** 选中文件时看该文件的图谱；为空时看全库或合并范围 */
  fileId: string | null
  file: KbFile | null
  /** 全库视图的合并范围：非空 = 只看这些勾选文件的合并图 */
  fileIds?: string[]
  /** 有文件正在建图（含其他文件）：全库视图没有 graph_status，靠父组件告诉这里 */
  building?: boolean
  /** 管理能力开关：构建/重建按钮只对管理员出现，普通用户只能看图与检索 */
  canManage?: boolean
  /** 把当前范围的统计抛给父组件，放到页面标题里显示 */
  onStats?: (stats: KgGraph['stats'] | null) => void
  /** 单文件视图拉到图谱后，把 graph_status 推回父组件同步进文件列表：
      构建入口在右侧面板，列表轮询认不到这次构建，不推回去勾选框会一直禁用 */
  onStatus?: (fileId: string, graphStatus: string) => void
}

/**
 * 图谱视图：检索栏 + 画布 + 检索证据。
 *
 * 图谱数据按「当前范围」拉取（选中文件 = 单文件图，未选中 = 全库图
 * 或勾选文件的合并图），检索也带着同样的范围，这样筛出来的子图和
 * 画布是同一批数据，不会出现「命中了却不在图上」。
 */
export default function KbGraphPanel({
  fileId,
  file,
  fileIds,
  building = false,
  canManage = false,
  onStats,
  onStatus,
}: Props) {
  const [graph, setGraph] = useState<KgGraph | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [query, setQuery] = useState('')
  const [depth, setDepth] = useState(1)
  const [result, setResult] = useState<KgSearchResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')

  // 抽取配置（文档类型 + 粒度）：构建/重建时在弹窗里选，提交时落库并触发重抽
  const [docTypes, setDocTypes] = useState<KgDocType[]>([])
  const [defaultDocType, setDefaultDocType] = useState('general')
  // 建图配置弹窗开关：点「构建图谱」/「重建」都先弹这个，确认配置再提交
  const [buildDialogOpen, setBuildDialogOpen] = useState(false)
  const [buildingNow, setBuildingNow] = useState(false)
  const [buildError, setBuildError] = useState('')

  const requestIdRef = useRef(0)
  const searchIdRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(
    /** quiet：后台刷新（轮询/构建收尾）不置 loading，避免画布上闪一层「正在读取」 */
    async (options?: { quiet?: boolean }) => {
      const token = ++requestIdRef.current
      if (!options?.quiet) setLoading(true)
      setError('')
      try {
        const data = await fetchKgGraph(
          fileId
            ? { fileId }
            : fileIds && fileIds.length > 0
              ? { fileIds }
              : undefined,
        )
        // 快速切文件时丢弃过期响应
        if (token === requestIdRef.current) {
          setGraph(data)
          onStats?.(data.stats ?? null)
        }
      } catch (e) {
        if (token === requestIdRef.current) {
          setGraph(null)
          onStats?.(null)
          setError(e instanceof Error ? e.message : '获取图谱失败')
        }
      } finally {
        if (token === requestIdRef.current) setLoading(false)
      }
    },
    [fileId, fileIds, onStats],
  )

  useEffect(() => {
    // 清空检索态交给「切文件时组件重挂载」（父组件用 key），这里只负责拉图。
    // 放到下一帧再调：load 开头会同步 setLoading，直接在 effect 体里调等于
    // 在 effect 里同步 setState，会触发级联渲染（react-hooks 规则禁止）
    const raf = requestAnimationFrame(() => void load())
    return () => cancelAnimationFrame(raf)
  }, [load])

  /**
   * 可选抽取配置只给管理员拉：普通用户不建图，拿到列表也用不上。
   *
   * 列表来自后端（内置 + data/kb_doc_profiles.json 的自定义类型），
   * 前端不硬编码文档类型——加一种新文档只改后端配置，不用发版。
   */
  useEffect(() => {
    if (!canManage) return
    let alive = true
    void fetchKgDocTypes().then((data) => {
      if (!alive) return
      setDocTypes(data.types)
      setDefaultDocType(data.default)
    })
    return () => {
      alive = false
    }
  }, [canManage])

  // 弹窗表单初值：已有图谱按其用的配置预填，首次构建用全局默认
  const activeDocType = graph?.doc_type || defaultDocType
  const activeLevel = (graph?.extract_level || 'full') as 'full' | 'light'

  /** 是否已有可看的图谱：节点非空即「有图」，决定隐藏检索栏还是隐藏构建入口 */
  const hasGraph = Boolean(graph && graph.nodes.length > 0)

  /**
   * 实体对齐已并入建图流程：重建图谱时自动对齐，无需手动触发。
   * 当前图用的抽取配置已挪到左侧列表文件名下方展示，画布只留对齐结果。
   */

  // 图谱构建中：单文件视图看自己的 graph_status，全库/合并视图看父组件给的 building
  const isBuilding = building || graph?.graph_status === 'building'
  // 构建中只有单文件视图重拉：那份图最多几十个节点，用户也正盯着进度看。
  // 全库/合并的整图有上百节点、单次几十到几百 KB，构建期间每 3 秒重拉既费带宽，
  // 又会让力导向每 3 秒重排一次（节点乱跳）。它改由下面 wasBuildingRef
  // 在构建结束那一帧补拉一次，中途保持旧图 + 一行提示
  const pollWhileBuilding = isBuilding && Boolean(fileId)
  useEffect(() => {
    if (!pollWhileBuilding) return
    const timer = window.setInterval(() => void load({ quiet: true }), 3000)
    return () => window.clearInterval(timer)
  }, [pollWhileBuilding, load])

  // 构建结束的那一帧补拉一次整图：轮询的最后一拍往往早于后端落库，
  // 停表后画布会停在构建中途的旧图上（新实体没进来）。
  // 全库/合并视图不轮询，靠的就是这条路径把构建完成的整图取回来
  const wasBuildingRef = useRef(false)
  useEffect(() => {
    if (wasBuildingRef.current && !isBuilding) void load({ quiet: true })
    wasBuildingRef.current = isBuilding
  }, [isBuilding, load])

  // 单文件视图：拉到图谱状态就推回父组件，左侧列表的勾选框才跟得上构建进度。
  // status 不变不会重复推；全库/合并视图没有单文件语义，不推
  useEffect(() => {
    const status = graph?.graph_status
    if (fileId && status) onStatus?.(fileId, status)
  }, [fileId, graph?.graph_status, onStatus])

  /** 只清检索结果：图谱高亮、命中实体、命中依据一起收掉 */
  const resetResult = () => {
    // 让还在飞的检索请求失效，避免结果回填
    searchIdRef.current += 1
    setSearching(false)
    setResult(null)
    setSearchError('')
  }

  /**
   * 检索只在「点检索 / 回车 / 点清空」时发生，输入过程一概不触发。
   *
   * 空词也是合法检索：不做实体匹配，直接取消筛选回到当前范围的全图。
   * 这条路径不发请求——图本来就在手上，后端也明确拒收空检索词。
   */
  const runSearch = async (raw?: string) => {
    const q = (raw ?? query).trim()
    // 放在 searching 判断之前：正在检索时点清空，也要立刻把画面还原
    if (!q) {
      resetResult()
      return
    }
    if (searching) return
    // 检索期间用户可能清空或改词重检，用序号丢弃过期响应，
    // 否则清空之后迟到的结果会把命中依据又弹回来
    const token = ++searchIdRef.current
    setSearching(true)
    setSearchError('')
    try {
      const data = await searchKg(q, {
        depth,
        fileId: fileId ?? undefined,
        // 合并视图：检索范围与画布同源，命中实体保证在图上
        fileIds: fileId ? undefined : fileIds,
      })
      if (token !== searchIdRef.current) return
      setResult(data)
    } catch (e) {
      if (token !== searchIdRef.current) return
      setSearchError(e instanceof Error ? e.message : '图谱检索失败')
      setResult(null)
    } finally {
      if (token === searchIdRef.current) setSearching(false)
    }
  }

  /** 清空 = 清词 + 走一次空检索（回到全图），焦点回到输入框好继续输 */
  const clearSearch = () => {
    setQuery('')
    void runSearch('')
    inputRef.current?.focus()
  }

  // 输入即检索：query 变化后防抖 400ms 自动发起，省掉「检索」按钮。
  // 首次挂载跳过（初始 query 为空，不该发请求）；空词走 runSearch('') 回到全图。
  const runSearchRef = useRef(runSearch)
  useEffect(() => {
    runSearchRef.current = runSearch
  })
  const firstQueryRef = useRef(true)
  useEffect(() => {
    if (firstQueryRef.current) {
      firstQueryRef.current = false
      return
    }
    const timer = setTimeout(() => {
      void runSearchRef.current(query)
    }, 400)
    return () => clearTimeout(timer)
  }, [query])

  /**
   * 收起命中依据 = 退出这次检索。
   *
   * 只收面板、不清词的话，搜索框里还留着「HBM」而画布已经回到全图，
   * 看起来像是检索失效了。所以连词一起清，只是不抢焦点（收起常常是
   * 在面板底部点的，把光标拽回顶部输入框会很突兀）。
   */
  const collapseEvidence = () => {
    setQuery('')
    resetResult()
  }

  /**
   * 打开建图配置弹窗：构建（首次）与重建（已有图）共用，标题/按钮文案
   * 由 hasGraph 区分。打开前清掉上一次的提交错误，表单初值由父级状态决定。
   */
  const openBuildDialog = () => {
    setBuildError('')
    setBuildDialogOpen(true)
  }

  /**
   * 弹窗提交：配置作为本次重建的参数，随请求一起提交（一次请求）。
   *
   * 不再有「先存配置、等重建才生效」的中间态——配置只跟着这次构建走，
   * 后端落库并重抽，库里存的配置和眼前的图始终对得上。
   * 首次构建（还没图）与重建走同一条 rebuild 接口（后端都会按切片重抽）。
   */
  const submitBuild = async (config: { docType: string; level: 'full' | 'light' }) => {
    if (!fileId || buildingNow) return
    setBuildingNow(true)
    setBuildError('')
    try {
      // 弹窗用空串表示「通用（不限定）」，原样传给后端（后端空串也回落到 general）
      await rebuildKgGraph(fileId, {
        docType: config.docType || '',
        level: config.level,
      })
      // 后端已把人状态改成 building，立刻重拉一次就能看到「构建中」
      await load()
      setBuildDialogOpen(false)
    } catch (e) {
      // 弹窗不关：保住刚选的配置，用户改完可以直接重试
      setBuildError(e instanceof Error ? e.message : '提交构建失败')
    } finally {
      setBuildingNow(false)
    }
  }

  /**
   * 过期重抽：切片修订后图谱 stale，按**上次的配置**重抽一遍。
   *
   * 不带 body（沿用已存配置）——过期只是文本变了，不该顺手把人选好的
   * 文档类型/粒度清掉。想换配置走 hover 的「重建」弹窗。
   */
  const onReapply = async () => {
    if (!fileId || buildingNow) return
    setBuildingNow(true)
    setError('')
    try {
      await rebuildKgGraph(fileId)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '重建失败')
    } finally {
      setBuildingNow(false)
    }
  }

  // 空态文案按图谱进度分流：构建中不显示「重建」按钮，失败/未建给按钮
  const canvasState: {
    title: string
    hint: string
    action?: { label: string; onClick: () => void }
  } = (() => {
    if (result && result.nodes.length === 0) {
      return {
        title: '没有检索到相关实体',
        hint: `「${result.query}」没有匹配到图谱里的实体。换个说法，或清空检索回到全图。`,
        action: undefined,
      }
    }
    if (graph && graph.nodes.length > 0) {
      return { title: '', hint: '' }
    }
    if (isBuilding) {
      return {
        title: '正在构建图谱',
        hint: '正在从切片里抽取实体与关系。已抽到的部分会陆续上图，完成后自动刷新。',
        action: undefined,
      }
    }
    if (graph?.graph_status === 'failed') {
      return {
        title: '图谱构建失败',
        hint: '抽取时出错了（模型超时或返回格式异常）。切片不受影响，仍可正常检索与对话。',
        action:
          fileId && canManage
            ? { label: '重新构建', onClick: openBuildDialog }
            : undefined,
      }
    }
    if (graph?.graph_status === 'skipped') {
      return {
        title: '图谱抽取已关闭',
        hint: '部署配置里关闭了图谱构建（KB_GRAPH_ENABLED=false），只保留切片检索。',
        action: undefined,
      }
    }
    if (file && file.status !== 'ready') {
      return {
        title: '文件还在处理中',
        hint: '切片与图谱要等解析完成后才开始生成。',
        action: undefined,
      }
    }
    return {
      title: fileId ? '这份文件还没有图谱' : '还没有知识图谱',
      hint: fileId
        ? canManage
          ? '确认切片没问题后，点下方按钮从当前切片文本抽取。'
          : '管理员还没有为这份文件生成图谱，生成后即可在这里查看。'
        : '在左侧「图谱」tab 勾选图谱已生成的文件（可多选，合并查看）；还没生成图谱的文件点它的状态徽标进来构建。',
      action:
        fileId && canManage
          ? { label: '构建图谱', onClick: openBuildDialog }
          : undefined,
    }
  })()

  const seeds = result?.seeds ?? []
  const evidence = result?.chunks ?? []

  /**
   * 画布数据源：检索有结果时换成「命中的子图」，没结果就看完整图。
   *
   * 后端 /v1/kg/search 本来就把「种子实体 + N 跳邻域」算成了一个 nodes/edges
   * 子图，直接拿它渲染就是过滤；早前只把种子 id 传下去做压暗，图里那几十个
   * 无关节点全都还在，看起来就跟没检索一样。
   */
  const filtered = Boolean(result && result.nodes.length > 0)
  const viewGraph = useMemo<KgGraph | null>(() => {
    if (!result) return graph
    // 确实没命中时给空图，画布显示「没有找到相关实体」，而不是退回全图让人以为没反应
    return { nodes: result.nodes, edges: result.edges }
  }, [result, graph])

  /**
   * 命中实体 → 画布节点。
   *
   * 不能直接拿 seed.id 去比：全库图会把跨文件的同名实体合并成一个节点，
   * 留下的「代表」按提及数选，而检索命中的记录可能来自另一份文档。两条
   * 记录 id 不同，只按 id 高亮就会出现「明明命中了，图上却不亮」。
   * 所以 id 之外再按 norm_name、名称对一次。
   */
  // 簇视图（P4）：配色口径 + 当前聚焦的社区。
  // 聚焦复用检索那套高亮（hitIds），非成员自动压暗，不额外加渲染分支
  const [colorMode, setColorMode] = useState<'type' | 'community'>('type')
  const [focusCluster, setFocusCluster] = useState<number | null>(null)
  // 着色选择：一个级联下拉（左列 按类型/按簇，右列 簇）。自绘避免原生 select 割裂
  const [shadeOpen, setShadeOpen] = useState(false)
  // 级联面板左列当前激活的项：决定右列显示什么
  const [activeBranch, setActiveBranch] = useState<'type' | 'community'>('type')
  const shadeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!shadeOpen) return
    function onDown(event: MouseEvent) {
      if (shadeRef.current && !shadeRef.current.contains(event.target as Node)) {
        setShadeOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [shadeOpen])

  const clusters = useMemo(
    () => (viewGraph?.communities ?? []).filter((c) => !c.isolated),
    [viewGraph],
  )

  const clusterHitIds = useMemo(() => {
    if (focusCluster === null) return null
    const target = clusters.find((c) => c.id === focusCluster)
    return target ? target.node_ids : null
  }, [focusCluster, clusters])

  const hitIds = useMemo(() => {
    const list = result?.seeds ?? []
    const nodes = viewGraph?.nodes ?? []
    if (list.length === 0 || nodes.length === 0) return []
    const ids = new Set(list.map((s) => s.id))
    const norms = new Set(
      list.map((s) => s.norm_name).filter((n): n is string => Boolean(n)),
    )
    const names = new Set(list.map((s) => s.name))
    return nodes
      .filter(
        (n) =>
          ids.has(n.id) ||
          names.has(n.name) ||
          (n.norm_name ? norms.has(n.norm_name) : false),
      )
      .map((n) => n.id)
  }, [result, viewGraph])

  return (
    <div className="kb-kg">
      {/* 还没有图谱时不显示检索栏：没有实体可检索，空留一排控件反而误导。
          有图才出现着色/搜索/跳数，配合画布右上角 hover 的「重建」按钮 */}
      {hasGraph ? (
      <div className="kb-kg-bar">
        {/* 着色选择：最左，做成检索按钮同款样式。左列 按类型/按簇，右列展开各簇 */}
        {clusters.length > 0 ? (
          <div className="kb-kg-shade" ref={shadeRef}>
            <button
              type="button"
              className={`kb-kg-shade-trigger${shadeOpen ? ' is-open' : ''}`}
              aria-haspopup="listbox"
              aria-expanded={shadeOpen}
              onClick={() => {
                setActiveBranch(colorMode)
                setShadeOpen((open) => !open)
              }}
              title="切换图谱着色方式"
            >
              {colorMode === 'type'
                ? '按类型'
                : focusCluster != null
                  ? `按簇 · ${clusters.find((c) => c.id === focusCluster)?.label ?? ''}`
                  : '按簇'}
              <ChevronDownIcon />
            </button>
            {focusCluster != null ? (
              <button
                type="button"
                className="kb-kg-shade-clear"
                onClick={() => {
                  setColorMode('type')
                  setFocusCluster(null)
                }}
                aria-label="清除着色选中，回到按类型"
                title="清除选中"
              >
                <CloseIcon />
              </button>
            ) : null}
            {shadeOpen ? (
              <div className="kb-kg-shade-panel">
                <ul className="kb-kg-shade-menu" role="listbox" aria-label="着色方式">
                  <li>
                    <button
                      type="button"
                      role="option"
                      aria-selected={colorMode === 'type'}
                      className={`${activeBranch === 'type' ? 'is-active' : ''}${
                        colorMode === 'type' ? ' is-on' : ''
                      }`}
                      onMouseEnter={() => setActiveBranch('type')}
                      onClick={() => {
                        setColorMode('type')
                        setFocusCluster(null)
                        setShadeOpen(false)
                      }}
                    >
                      按类型
                      {colorMode === 'type' ? <CheckIcon /> : null}
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      role="option"
                      aria-selected={colorMode === 'community'}
                      className={`${activeBranch === 'community' ? ' is-active' : ''}${
                        colorMode === 'community' ? ' is-on' : ''
                      }`}
                      onMouseEnter={() => setActiveBranch('community')}
                      onClick={() => {
                        setColorMode('community')
                        setActiveBranch('community')
                      }}
                    >
                      <span className="kb-kg-shade-branch">
                        按簇
                        {colorMode === 'community' ? <CheckIcon /> : null}
                      </span>
                    </button>
                  </li>
                </ul>
                {activeBranch === 'community' ? (
                  <ul
                    className="kb-kg-shade-menu kb-kg-shade-sub"
                    role="listbox"
                    aria-label="选择簇"
                  >
                    <li>
                      <button
                        type="button"
                        role="option"
                        aria-selected={colorMode === 'community' && focusCluster === null}
                        onClick={() => {
                          setColorMode('community')
                          setFocusCluster(null)
                          setShadeOpen(false)
                        }}
                      >
                        全部簇
                      </button>
                    </li>
                    {clusters.slice(0, 10).map((cluster) => (
                      <li key={cluster.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={
                            colorMode === 'community' && focusCluster === cluster.id
                          }
                          className={
                            colorMode === 'community' && focusCluster === cluster.id
                              ? 'is-on'
                              : ''
                          }
                          onClick={() => {
                            setColorMode('community')
                            setFocusCluster(cluster.id)
                            setShadeOpen(false)
                          }}
                        >
                          <span className="kb-kg-shade-cluster">
                            {cluster.label}
                            <i>{cluster.size}</i>
                          </span>
                          {colorMode === 'community' && focusCluster === cluster.id ? (
                            <CheckIcon />
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* 搜索框：占满中间，输入即检索（防抖） */}
        <label className="kb-kg-search">
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // 中文输入法用回车选候选词时 isComposing 为 true，别当成检索
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void runSearch()
              if (e.key === 'Escape') clearSearch()
            }}
            placeholder={
              fileId
                ? '在这份文件的图谱里检索实体'
                : fileIds && fileIds.length > 0
                  ? `在这 ${fileIds.length} 份文件的合并图谱里检索`
                  : '在全库图谱里检索实体或关系'
            }
            aria-label="图谱检索"
          />
          {query ? (
            <button type="button" className="kb-kg-clear" onClick={clearSearch} aria-label="清空">
              ✕
            </button>
          ) : null}
        </label>

        <div className="kb-kg-depth" role="group" aria-label="扩展跳数">
          {[1, 2].map((d) => (
            <button
              key={d}
              type="button"
              className={depth === d ? 'is-on' : ''}
              aria-pressed={depth === d}
              onClick={() => setDepth(d)}
              title={d === 1 ? '沿关系扩展一跳' : '沿关系扩展两跳，召回更广但噪音更多'}
            >
              {d} 跳
            </button>
          ))}
        </div>
      </div>
      ) : null}

      {seeds.length > 0 ? (
        <div className="kb-kg-seeds">
          <span className="kb-kg-seeds-label">
            命中实体
            {filtered ? ` · 子图 ${result?.nodes.length} 个实体` : ''}
          </span>
          {seeds.map((seed) => (
            <span key={seed.id} className="kb-kg-seed">
              {seed.name}
              <i>{seed.score.toFixed(2)}</i>
            </span>
          ))}
          {result?.empty ? <span className="kb-kg-seeds-empty">没有扩展出关系</span> : null}
        </div>
      ) : null}

      {searchError ? <p className="kb-error">{searchError}</p> : null}
      {isBuilding ? (
        <p className="kb-kg-building">
          {pollWhileBuilding
            ? '图谱构建中，当前显示已抽取的部分…'
            : '有文件正在构建图谱，完成后这里自动刷新。'}
        </p>
      ) : null}
      {file?.graph_status === 'stale' ? (
        // 切片人工修订后图谱就基于旧文本了：保留旧图供参考。
        // 重建按钮只给管理员；普通用户只看说明。这里按上次配置重抽，不弹配置窗
        <p className="kb-kg-stale">
          {canManage ? (
            <>
              图谱已过期（切片修订或抽取配置变更），当前显示的是旧图。
              <button
                type="button"
                onClick={() => void onReapply()}
                disabled={buildingNow}
              >
                {buildingNow ? '重建中…' : '重新生成'}
              </button>
            </>
          ) : (
            '图谱基于旧切片或旧抽取配置，等待管理员重建。'
          )}
        </p>
      ) : null}

      <div className="kb-kg-canvas">
        {/* 实体对齐已并入建图流程；这里只展示对齐结果，不再有手动对齐入口 */}
        {hasGraph && (graph?.alias_count ?? 0) > 0 ? (
          <div className="kb-kg-align">
            已合并 {graph!.alias_count} 个写法
          </div>
        ) : null}
        {/* 已有图谱：hover 画布时右上角浮出「重建」按钮，点击同样进配置弹窗 */}
        {hasGraph && fileId && canManage ? (
          <button
            type="button"
            className="kb-kg-rebuild"
            onClick={openBuildDialog}
            disabled={isBuilding}
            title="按新的文档类型与抽取粒度重建这份图谱"
          >
            <RefreshIcon />
            重建
          </button>
        ) : null}
        <KnowledgeGraph
          graph={viewGraph}
          loading={loading}
          error={error}
          hitIds={clusterHitIds ?? hitIds}
          colorMode={colorMode}
          // 过滤后的子图里全是命中和它们的邻居，再压暗就把扩展出来的关系藏掉了
          dimOthers={!filtered || focusCluster !== null}
          // 枢纽分层只对「完整图」启用：全库/合并视图文件多了点会铺满画布，
          // 单文件图和检索子图本来就小，全显更直观
          prune={!fileId && !filtered}
          emptyTitle={canvasState.title}
          emptyHint={canvasState.hint}
          emptyAction={canvasState.action}
        />
      </div>

      {evidence.length > 0 ? (
        <div className="kb-kg-evidence">
          <div className="kb-kg-evidence-head">
            <span>命中依据 · {evidence.length} 段原文</span>
            <button type="button" onClick={collapseEvidence} title="收起并清空检索">
              收起
            </button>
          </div>
          <div className="kb-kg-evidence-scroll">
            <ul>
              {evidence.map((item) => (
                <li key={`${item.filename}-${item.chunk_seq}`}>
                  <div className="kb-kg-evidence-meta">
                    <span className="kb-kg-evidence-entity">{item.entity}</span>
                    <span>
                      {item.filename}
                      {item.page !== null ? ` · 第${item.page}页` : ` · 第${item.chunk_seq + 1}段`}
                    </span>
                  </div>
                  <p>{item.text.length > 150 ? `${item.text.slice(0, 150)}…` : item.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {buildDialogOpen ? (
        <KgBuildDialog
          filename={file?.filename ?? ''}
          docTypes={docTypes.filter((t) => !t.is_general)}
          // 弹窗用空串表示「通用」，把后端的 general 归一过去，选中态才对得上
          initialDocType={activeDocType === 'general' ? '' : activeDocType}
          initialLevel={activeLevel}
          hasGraph={hasGraph}
          submitting={buildingNow}
          error={buildError}
          onCancel={() => setBuildDialogOpen(false)}
          onSubmit={(config) => void submitBuild(config)}
        />
      ) : null}
    </div>
  )
}
