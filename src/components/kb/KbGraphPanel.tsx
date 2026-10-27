import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  fetchKgGraph,
  rebuildKgGraph,
  searchKg,
  type KbFile,
  type KgGraph,
  type KgSearchResult,
} from '../../api'
import KnowledgeGraph from './KnowledgeGraph'
import { SearchIcon } from '../chat/icons'

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
  const [rebuilding, setRebuilding] = useState(false)

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

  const onRebuild = async () => {
    if (!fileId || rebuilding) return
    setRebuilding(true)
    try {
      await rebuildKgGraph(fileId)
      // 后端已把人状态改成 building，立刻重拉一次就能看到「构建中」
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '重建失败')
    } finally {
      setRebuilding(false)
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
        hint: '正在从切片里抽取实体与关系，通常几十秒，完成后自动出现。',
        action: undefined,
      }
    }
    if (graph?.graph_status === 'failed') {
      return {
        title: '图谱构建失败',
        hint: '抽取时出错了（模型超时或返回格式异常）。切片不受影响，仍可正常检索与对话。',
        action:
          fileId && canManage
            ? { label: '重新构建', onClick: () => void onRebuild() }
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
          ? { label: '构建图谱', onClick: () => void onRebuild() }
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
      <div className="kb-kg-bar">
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

        <button
          type="button"
          className="kb-kg-go"
          onClick={() => void runSearch()}
          disabled={searching}
        >
          {searching ? '检索中…' : '检索'}
        </button>
      </div>

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
        // 重建按钮只给管理员；普通用户只看说明
        <p className="kb-kg-stale">
          {canManage ? (
            <>
              切片已人工修订，当前图谱基于旧文本。
              <button
                type="button"
                onClick={() => void onRebuild()}
                disabled={rebuilding}
              >
                {rebuilding ? '重建中…' : '重新生成'}
              </button>
            </>
          ) : (
            '切片已人工修订，图谱基于旧文本，等待管理员重建。'
          )}
        </p>
      ) : null}

      <div className="kb-kg-canvas">
        <KnowledgeGraph
          graph={viewGraph}
          loading={loading}
          error={error}
          hitIds={hitIds}
          // 过滤后的子图里全是命中和它们的邻居，再压暗就把扩展出来的关系藏掉了
          dimOthers={!filtered}
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
    </div>
  )
}
