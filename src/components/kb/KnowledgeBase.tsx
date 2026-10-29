import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  deleteKbFile,
  downloadKbFile,
  editKbChunk,
  fetchKbChunks,
  fetchKbFiles,
  fetchKgDocTypes,
  rebuildKgGraph,
  renameKbFile,
  setKbFileTags,
  uploadKbFile,
  type KbChunk,
  type KbFile,
  type KgDocType,
  type KgGraph,
} from '../../api'
import {
  BackIcon,
  MoreIcon,
  PanelIcon,
  SearchIcon,
  UploadIcon,
  WarningIcon,
} from '../chat/icons'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { KgBuildDialog } from './KgBuildDialog'
import KbGraphPanel from './KbGraphPanel'
import { RenameDialog } from './RenameDialog'
import { TagDialog } from './TagDialog'
import './kb.css'

const STATUS_LABEL: Record<KbFile['status'], string> = {
  uploaded: '等待处理',
  parsing: '解析中',
  embedding: '向量化中',
  ready: '就绪',
  failed: '失败',
}

const KIND_LABEL: Record<KbChunk['kind'], string> = {
  text: '文本',
  table: '表格',
  figure: '图表',
}

// 知识图谱 tab 里每个文件的图谱状态文字（纯文字，非按钮）
// 管理员视角：「未生成/失败」是需要操作的（可构建图谱/重新构建，蓝色文字）；
// 普通用户：这两态只是状态说明（图谱得等管理员建）
const GRAPH_BADGE: Record<string, { label: string; cls: string }> = {
  '': { label: '可构建图谱', cls: 'st-action' },
  building: { label: '构建中…', cls: 'st-busy' },
  ready: { label: '已生成', cls: 'st-ok' },
  stale: { label: '待重建', cls: 'st-stale' },
  failed: { label: '重新构建', cls: 'st-action' },
  skipped: { label: '已关闭', cls: 'st-none' },
}

const GRAPH_BADGE_READONLY: Record<string, { label: string; cls: string }> = {
  '': { label: '未构建', cls: 'st-none' },
  failed: { label: '构建失败', cls: 'st-none' },
}

function graphBadge(status: string | null | undefined, canManage: boolean) {
  const key = status ?? ''
  if (!canManage && GRAPH_BADGE_READONLY[key]) return GRAPH_BADGE_READONLY[key]
  return GRAPH_BADGE[key] ?? GRAPH_BADGE['']
}

/** 重建/构建按钮的图标：12px，比会话里的 RefreshIcon 小一号，list row 才不撑高 */
function GraphRefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
      <path
        d="M20 12a8 8 0 1 1-2.2-5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M20 5v5h-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * 实体体量分级。
 *
 * 实体数不是个普通数字——它直接代表这份文档的抽取负荷：1057 个实体意味着
 * 重建要跑很久、显存吃紧、还容易爆实体；10 个实体的小规范几乎瞬间完成。
 * 所以按量级给不同色阶和体量条长度，让人在列表里一眼看出哪几份是重活。
 *
 * 条长必须是相对比例（对当前列表里最大的那份取百分比），否则按档位给固定
 * 长度会让 446 和 348 看起来一样长、比例失真。
 */
function entityTier(count: number, max: number): { cls: string; ratio: number } {
  // 最小的那几份按真比例算只有零点几像素，给个下限留一个能看见的头
  const ratio = Math.max(count / Math.max(max, 1), 0.07)
  if (count >= 1000) return { cls: 'is-huge', ratio }
  if (count >= 300) return { cls: 'is-mid', ratio }
  if (count >= 50) return { cls: 'is-small', ratio }
  return { cls: 'is-tiny', ratio }
}

/** 文档类型标签：招股书一类结构化文档用主色，通用文档用中性灰 */
function docTypeStyle(key?: string): string {
  return !key || key === 'general' ? 'is-general' : 'is-prospectus'
}

/**
 * 文档类型名：招股意向书 / 通用文档…
 *
 * 通用（general）是兜底类型，名字固定；其余取后端 doc-types 里的中文名。
 * 文件列表的分组和行内标签共用这一份，避免出现两个地方叫法不一样。
 */
function docTypeLabel(key: string, docTypes: KgDocType[]): string {
  if (!key || key === 'general') return '通用文档'
  return docTypes.find((t) => t.key === key)?.label || key
}

// 切片位置标注：与检索引用（_format_hit）同一套语义
function chunkPos(chunk: KbChunk): string {
  if (chunk.kind === 'table') {
    return chunk.page != null ? `表${chunk.page}` : '表格'
  }
  if (chunk.kind === 'figure') {
    return chunk.page != null ? `第${chunk.page}页图表` : '图表'
  }
  return chunk.page != null ? `第${chunk.page}页` : `第${chunk.seq + 1}段`
}

// 文件按扩展名着色（与状态点无关，纯粹区分文件类型）
const EXT_STYLE: Record<string, { label: string; cls: string }> = {
  pdf: { label: 'PDF', cls: 'ext-pdf' },
  docx: { label: 'DOC', cls: 'ext-doc' },
  doc: { label: 'DOC', cls: 'ext-doc' },
  xlsx: { label: 'XLS', cls: 'ext-xls' },
  xlsm: { label: 'XLS', cls: 'ext-xls' },
  csv: { label: 'CSV', cls: 'ext-csv' },
  md: { label: 'MD', cls: 'ext-txt' },
  markdown: { label: 'MD', cls: 'ext-txt' },
  txt: { label: 'TXT', cls: 'ext-txt' },
}

function extBadge(file: KbFile) {
  // 类型后缀优先取 mime（后端单独存，filename 已是纯名），mime 缺失时回退从 filename 切
  const raw = file.mime ?? file.filename.slice(file.filename.lastIndexOf('.') + 1)
  const ext = raw.replace(/^\./, '').toLowerCase()
  const style = EXT_STYLE[ext]
  if (!style) return null
  return <span className={`kb-ext ${style.cls}`}>{style.label}</span>
}

// ——— 切片虚拟滚动（变高卡片）———
// 切片内容完整展示（高度随内容 auto），每张卡片实际渲染后把高度记进 heightsRef，
// 布局用前缀和推算；未渲染的卡片按 DEFAULT_ROW_H 估算，滚动分页逐步修正。
const PAGE_SIZE = 50
const CHUNK_GAP = 10
const DEFAULT_ROW_H = 120
const OVERSCAN = 3

const ACCEPT = '.pdf,.docx,.xlsx,.xlsm,.md,.markdown,.txt,.csv'

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

// 文件列表行的「更多」菜单：一个三点按钮，点击弹出下载/编辑标签/重命名/删除。
// 菜单按权限与状态动态显隐，与会话列表「更多」同一套交互（左对齐 + 点外部关闭）。
type KbFileRowProps = {
  item: KbFile
  isSelected: boolean
  canManage: boolean
  /** 文档类型名（招股意向书 / 通用文档…）：行内标签与分组都用它 */
  typeLabel: string
  /** 通用文档用中性灰标签，招股书一类用主色标签 */
  isGeneral: boolean
  /** 图谱正在构建时重建按钮不可用 */
  graphBuilding: boolean
  onToggle: (item: KbFile) => void
  onRebuild: (item: KbFile) => void
  onDownload: (item: KbFile) => void
  onTagEdit: (item: KbFile) => void
  onRename: (item: KbFile) => void
  onDelete: (item: KbFile) => void
}

function KbFileRow({
  item,
  isSelected,
  canManage,
  typeLabel,
  isGeneral,
  graphBuilding,
  onToggle,
  onRebuild,
  onDownload,
  onTagEdit,
  onRename,
  onDelete,
}: KbFileRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const moreRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })

  useLayoutEffect(() => {
    if (!menuOpen || !moreRef.current) return
    const rect = moreRef.current.getBoundingClientRect()
    const width = 132
    const left = Math.min(rect.left, window.innerWidth - width - 8)
    setMenuPos({ top: rect.bottom + 4, left })
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    function onDown(event: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        moreRef.current &&
        !moreRef.current.contains(event.target as Node)
      ) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  const hasDownload = item.status !== 'uploaded'
  const hasTagEdit = canManage
  const hasRename = canManage && item.status === 'ready'
  const hasDelete = canManage
  // 重建是图谱动作，文件还没处理完就没得建
  const hasRebuild = canManage && item.status === 'ready' && !graphBuilding

  return (
    <li
      className={`kb-item kb-${item.status}${isSelected ? ' kb-selected' : ''}`}
    >
      {/* 选中态：左侧 3px 主色竖条 + 极浅蓝底，克制一点，
          不再整块深蓝把整行压住（那样看着像弹窗遮罩而不是选中） */}
      {isSelected ? <span className="kb-item-bar" aria-hidden="true" /> : null}
      <div
        className="kb-item-main"
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        title={item.status === 'ready' ? '点击查看切片' : '处理完成后可查看切片'}
        onClick={() => onToggle(item)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle(item)
          }
        }}
      >
        <span className="kb-name" title={item.filename}>
          {extBadge(item)}
          <span className="kb-name-text">{item.filename}</span>
        </span>
        {/* 元信息分三级：文档类型标签 → 片数（主信息，决定图谱规模与重建耗时）
            → 大小（最弱）。就绪是最常态，不再占一格——只有处理中/失败
            才在行尾亮出状态，否则每行一个绿点等于没有信息 */}
        <span className="kb-meta">
          <span
            className={`kb-type ${isGeneral ? 'is-general' : 'is-prospectus'}`}
            title={`文档类型：${typeLabel}`}
          >
            {typeLabel}
          </span>
          <span className="kb-slices" title="切片数">
            {item.chunk_count} 片
          </span>
          <span className="kb-size">{formatSize(item.size_bytes)}</span>
          {item.status === 'failed' ? (
            <span className="kb-state is-failed" title={item.error || '处理失败'}>
              <WarningIcon />
              {STATUS_LABEL.failed}
            </span>
          ) : item.status === 'ready' ? null : (
            <span className="kb-state is-busy">
              <span className="kb-gspinner" aria-hidden="true" />
              {STATUS_LABEL[item.status]}
            </span>
          )}
        </span>
        {item.tags && item.tags.length > 0 ? (
          <span className="kb-tags">
            {item.tags.map((t) => (
              <span key={t} className="kb-tag">
                {t}
              </span>
            ))}
          </span>
        ) : null}
      </div>
      <div className={`kb-item-side${menuOpen ? ' menu-open' : ''}`}>
        {/* 重建：hover 才露出的图标按钮，点了弹构建配置弹窗 */}
        {hasRebuild ? (
          <button
            type="button"
            className="kb-item-act"
            onClick={() => onRebuild(item)}
            aria-label={`重建图谱 · ${item.filename}`}
            title="重建图谱"
          >
            <GraphRefreshIcon />
          </button>
        ) : null}
        <button
          type="button"
          ref={moreRef}
          className="kb-item-more"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={`更多操作 · ${item.filename}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="更多"
        >
          <MoreIcon />
        </button>
      </div>
      {menuOpen ? (
        <div
          ref={menuRef}
          className="kb-item-menu"
          style={{ top: menuPos.top, left: menuPos.left }}
          role="menu"
        >
          {hasDownload ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onDownload(item)
                setMenuOpen(false)
              }}
            >
              下载
            </button>
          ) : null}
          {hasTagEdit ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onTagEdit(item)
                setMenuOpen(false)
              }}
            >
              编辑标签
            </button>
          ) : null}
          {hasRename ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onRename(item)
                setMenuOpen(false)
              }}
            >
              重命名
            </button>
          ) : null}
          {hasDelete ? (
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => {
                onDelete(item)
                setMenuOpen(false)
              }}
            >
              删除
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

type Props = {
  onBack: () => void
  /** 管理能力开关：上传/删除/修订切片/构建图谱只对管理员可见；
      普通用户是只读视角（看列表、翻切片、看图、检索） */
  canManage?: boolean
}

/**
 * 知识库页（整页视图，覆盖对话界面）：所有用户可进，读写分离——
 * 左侧是可折起的文件面板（管理员可上传/删除），右侧留给知识图谱。
 */
export function KnowledgeBase({ onBack, canManage = false }: Props) {
  const [files, setFiles] = useState<KbFile[]>([])
  // 首屏文件列表是否已拿到结果：没拿到之前不渲染空态，否则会先闪一句
  // 「支持 PDF / DOCX…」再跳成文件列表
  const [filesLoaded, setFilesLoaded] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  const [error, setError] = useState('')
  // 文件名/标签筛选：客户端过滤（文件量级小，不值得每次打接口）
  const [query, setQuery] = useState('')
  // 标签编辑弹窗：非空即打开该文件的标签弹窗（一次只编辑一个文件）
  const [taggingFile, setTaggingFile] = useState<KbFile | null>(null)
  const [savingTags, setSavingTags] = useState(false)
  // 标签保存失败：显示在弹窗内（页面顶部的 error 会被蒙层盖住）
  const [tagError, setTagError] = useState('')
  // 待删除文件：非空即弹出确认框（与删除会话同一套弹窗）
  const [pendingDelete, setPendingDelete] = useState<KbFile | null>(null)
  // 「文件」tab 点文件看切片用（与图谱视图无关：图谱完全由勾选驱动）
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 左侧功能 tab：文件（上传/核对切片）与图谱（勾选看图）
  const [tab, setTab] = useState<'files' | 'graph'>('files')
  // 图谱 tab 的勾选 = 右侧显示范围，实时生效：
  // 勾 1 个 = 这份文件的图谱；勾多个 = 合并图谱；全不勾 = 全库图谱。
  // 只有图谱已生成的文件可勾（未生成/构建中/失败禁用，点状态徽标进构建视图）
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
  // 图谱 tab 点状态徽标 = 单独看这份文件的图谱（未生成的在这里拿构建按钮）
  const [buildFileId, setBuildFileId] = useState<string | null>(null)
  // 进构建视图那一刻该文件的 graph_status：构建完成后据此判断是否自动退出
  // （徽标本身是「待重建」进来只想看看旧图的，构建完成不该被强行带走）
  const buildEntryStatusRef = useRef('')
  const buildFileIdRef = useRef<string | null>(null)
  useEffect(() => {
    buildFileIdRef.current = buildFileId
  }, [buildFileId])

  // 列表行 hover 重建：弹窗挂在页面级（列表行不在 KbGraphPanel 里），
  // docTypes 因此在页面里单独拉一次
  const [docTypes, setDocTypes] = useState<KgDocType[]>([])
  useEffect(() => {
    if (!canManage) return
    void fetchKgDocTypes().then((data) => {
      setDocTypes(data.types)
    })
  }, [canManage])
  // 非空 = 打开该文件的重建弹窗；提交成功后 graphEpoch +1 强制面板重挂载
  const [rebuildTarget, setRebuildTarget] = useState<KbFile | null>(null)
  const [rebuilding, setRebuilding] = useState(false)
  const [rebuildError, setRebuildError] = useState('')
  // 列表里重建完，右侧面板的 graph_status 是它自己拉的，不会收到通知；
  // 拼进 KbGraphPanel 的 key 强制重挂载，否则还停在旧图上
  const [graphEpoch, setGraphEpoch] = useState(0)
  // 切片人工修订（修订 = 人工审核）：一次只编辑一片
  const [editingSeq, setEditingSeq] = useState<number | null>(null)
  const [editingText, setEditingText] = useState('')
  const [savingChunk, setSavingChunk] = useState(false)
  const [editError, setEditError] = useState('')
  // 全库图谱的规模统计：图谱面板拉回数据后回传，显示在页面标题里
  const [graphStats, setGraphStats] = useState<KgGraph['stats'] | null>(null)
  // 切片分页：chunks 是已加载的累积数组，total 用于判断还有没有下一页
  const [chunks, setChunks] = useState<KbChunk[]>([])
  const [chunksTotal, setChunksTotal] = useState(0)
  const [chunksLoading, setChunksLoading] = useState(false)
  const [chunksError, setChunksError] = useState('')
  // ——— 虚拟滚动（变高）———
  const listRef = useRef<HTMLDivElement | null>(null)
  const [viewportH, setViewportH] = useState(600)
  const [scrollTop, setScrollTop] = useState(0)
  // 每张卡片实测高度（seq → px），存 state：布局前缀和依赖它重算。
  // 同一批挂载的多张卡片会在 commit 阶段合并成一次重渲染（React 自动批处理）
  const [heights, setHeights] = useState<Map<number, number>>(() => new Map())
  const loadingMoreRef = useRef(false)
  // loadMore 异步返回时判断「用户是否已切走」用
  const selectedIdRef = useRef<string | null>(null)
  // 用户是否手动取消过选中：取消后不再自动补选第一个文件
  const userDeselectedRef = useRef(false)
  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])
  // 窄屏默认收起文件面板，避免一进来就挤压图谱区
  const [panelOpen, setPanelOpen] = useState(
    () => window.matchMedia('(min-width: 861px)').matches,
  )
  // 图谱 tab 两组文件的折叠状态：文件多了先收起不关心的那组
  const [todoOpen, setTodoOpen] = useState(true)
  const [doneOpen, setDoneOpen] = useState(true)
  // 文件 tab 按文档类型分组，组头可折叠（默认全展开）
  const [closedGroups, setClosedGroups] = useState<Set<string>>(() => new Set())

  const toggleGroup = (key: string) =>
    setClosedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const inputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      const list = await fetchKbFiles()
      setFiles(list)
      return list
    } catch {
      /* 静默，等下次轮询再试 */
      return null
    }
  }, [])

  // 选定要查看切片的文件：清掉上一次的切片数据，避免闪现旧文件内容
  const selectFile = useCallback((next: string | null) => {
    setChunks([])
    setChunksTotal(0)
    setChunksError('')
    setScrollTop(0)
    setHeights(new Map())
    setChunksLoading(next !== null)
    setSelectedId(next)
    // 编辑态跟着文件走：换文件时收起未保存的编辑框
    setEditingSeq(null)
    setEditingText('')
    setEditError('')
  }, [])

  useEffect(() => {
    // 首屏加载：setState 只发生在 await 之后（异步回调里），
    // 避免在 effect 体内同步 setState 触发级联渲染（react-hooks 规则）
    let cancelled = false
    void (async () => {
      try {
        const list = await fetchKbFiles()
        if (cancelled) return
        setFiles(list)
        // 默认选中第一个文件（看切片）；用户手动取消过选中后不再自动补选。
        // 图谱 tab 不做默认勾选：进来就是全库图谱，看哪些由用户自己勾
        if (list.length > 0 && !selectedIdRef.current && !userDeselectedRef.current) {
          selectFile(list[0].file_id)
        }
      } catch {
        /* 静默，等轮询或手动刷新 */
      } finally {
        // 成功或失败都要落位：失败时也该把空态（或错误后的空列表）放出来
        if (!cancelled) setFilesLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectFile])

  // 有文件在处理时每 2.5s 轮询一次进度
  // 图谱构建也走同一条轮询：上传后 tab 上的实体数和图谱内容都是晚一步才有的
  const processing = files.some(
    (f) =>
      f.status === 'parsing' ||
      f.status === 'embedding' ||
      f.graph_status === 'building',
  )
  const graphBuilding = files.some((f) => f.graph_status === 'building')
  useEffect(() => {
    if (!processing) return
    const timer = window.setInterval(() => void refresh(), 2500)
    return () => window.clearInterval(timer)
  }, [processing, refresh])

  // 构建收尾再补一次列表刷新：轮询的最后一拍往往早于后端把状态写成
  // ready，停止轮询后列表里的实体数会一直停在构建中途的 0
  const wasGraphBuildingRef = useRef(false)
  useEffect(() => {
    if (wasGraphBuildingRef.current && !graphBuilding) void refresh()
    wasGraphBuildingRef.current = graphBuilding
  }, [graphBuilding, refresh])

  const selectedFile = files.find((f) => f.file_id === selectedId) ?? null
  // 只取字符串做依赖：轮询刷新 files 时引用会变，但 status 没变就不该重拉切片
  const selectedStatus = selectedFile?.status ?? ''

  // ——— 文件名/标签筛选 ———
  const visibleFiles = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return files
    return files.filter(
      (f) =>
        f.filename.toLowerCase().includes(q) ||
        (f.tags ?? []).some((t) => t.toLowerCase().includes(q)),
    )
  }, [files, query])

  // 文件按文档类型分组：招股书一类是图谱重活（几百上千切片），通用技术文档
  // 只有十几片，混排时扫不出差异。组头写明数量并可折叠，文件多了把不关心的收起来
  const fileGroups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; items: KbFile[] }>()
    for (const f of visibleFiles) {
      // 没设过类型的文件归入通用组（后端默认也是 general）
      const key = (f.doc_type ?? '').trim() || 'general'
      const group = map.get(key)
      if (group) group.items.push(f)
      else map.set(key, { key, label: docTypeLabel(key, docTypes), items: [f] })
    }
    const list = [...map.values()]
    // 类型化文档在上，通用文档垫底；同档按组里文件数从多到少
    list.sort(
      (a, b) =>
        Number(a.key === 'general') - Number(b.key === 'general') ||
        b.items.length - a.items.length,
    )
    return list
  }, [visibleFiles, docTypes])

  const graphDone = useMemo(
    () =>
      visibleFiles.filter(
        (f) => f.graph_status === 'ready' || f.graph_status === 'stale',
      ),
    [visibleFiles],
  )
  // 体量条的满格基准：当前列表里实体最多的那份。筛掉文件后基准跟着变，
  // 剩下几份之间的比例关系仍然成立
  const maxEntities = useMemo(
    () => graphDone.reduce((m, f) => Math.max(m, f.graph_entity_count ?? 0), 1),
    [graphDone],
  )

  const graphTodo = useMemo(
    () =>
      visibleFiles.filter(
        (f) => f.graph_status !== 'ready' && f.graph_status !== 'stale',
      ),
    [visibleFiles],
  )

  // 全库标签去重：给标签弹窗做候选，避免同一概念被写成几种词
  const allTags = useMemo(() => {
    const pool = new Set<string>()
    for (const file of files) {
      for (const tag of file.tags ?? []) pool.add(tag)
    }
    return [...pool].sort((a, b) => a.localeCompare(b, 'zh'))
  }, [files])

  // ——— 图谱 tab 右侧视图，由勾选驱动 ———
  // 勾 1 个 = 这份文件的图谱；勾多个 = 合并图谱；全不勾 = 全库图谱
  const checkedIds = useMemo(() => [...checked].sort(), [checked])
  const checkedFile =
    checkedIds.length === 1
      ? (files.find((f) => f.file_id === checkedIds[0]) ?? null)
      : null
  // 点徽标单独查看的文件（未生成图谱时这里是构建入口）
  const buildFile =
    tab === 'graph' && buildFileId
      ? (files.find((f) => f.file_id === buildFileId) ?? null)
      : null
  // KbGraphPanel 的重挂载键：范围变化就整块重建，避免旧图残留
  const checkedKey =
    checkedIds.length === 1
      ? checkedIds[0]
      : checkedIds.length > 1
        ? checkedIds.join(',')
        : 'all'

  // 选中文件后拉取第一页切片。注意等文件就绪后再拉：
  // 处理中就拉会拿到空列表，而且 effect 依赖只有 selectedId，
  // 就绪后不会重跑，右侧会永远停在「没有切片/处理中」——新上传的文件
  // 点了像「选中不了」就是这个原因。依赖 status：轮询刷成 ready 的那
  // 一次会触发真正的拉取，status 不变就不会重复拉。
  useEffect(() => {
    if (!selectedId || selectedStatus !== 'ready') return
    let cancelled = false
    void (async () => {
      try {
        const { chunks: list, total } = await fetchKbChunks(selectedId, 0, PAGE_SIZE)
        if (cancelled) return
        setChunks(list)
        setChunksTotal(total)
        setChunksError('')
      } catch (e) {
        if (cancelled) return
        setChunks([])
        setChunksTotal(0)
        setChunksError(e instanceof Error ? e.message : '获取切片失败')
      } finally {
        if (!cancelled) setChunksLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedId, selectedStatus])

  // 加载下一页（滚动接近已加载末尾时触发）
  const loadMore = useCallback(async () => {
    if (!selectedId || loadingMoreRef.current) return
    if (chunks.length === 0 || chunks.length >= chunksTotal) return
    loadingMoreRef.current = true
    try {
      const { chunks: list } = await fetchKbChunks(selectedId, chunks.length, PAGE_SIZE)
      // 只在用户还停留在发起请求的那个文件时追加（快速切换文件时丢弃过期响应）
      setChunks((cur) => (selectedIdRef.current === selectedId ? [...cur, ...list] : cur))
    } catch {
      /* 静默：滚动会再次触发 */
    } finally {
      loadingMoreRef.current = false
    }
  }, [selectedId, chunks.length, chunksTotal])

  // 视口高度跟随容器尺寸
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const update = () => setViewportH(el.clientHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [selectedId])

  // 卡片测高 ref 回调：渲染完成后记录实际高度，变化则触发重排
  const measureCard = useCallback((seq: number, el: HTMLLIElement | null) => {
    if (!el) return
    const h = el.offsetHeight
    if (h > 0 && heights.get(seq) !== h) {
      setHeights((prev) => {
        if (prev.get(seq) === h) return prev
        const next = new Map(prev)
        next.set(seq, h)
        return next
      })
    }
  }, [heights])

  // 布局：offsets[i] = 第 i 张已加载卡片的 top；总高 = 已加载实际/估算高度 + 未加载页估算
  const { offsets, totalH, loadedBottom } = useMemo(() => {
    const offs: number[] = []
    let acc = 0
    for (const c of chunks) {
      offs.push(acc)
      acc += (heights.get(c.seq) ?? DEFAULT_ROW_H) + CHUNK_GAP
    }
    const remaining = Math.max(0, chunksTotal - chunks.length)
    return {
      offsets: offs,
      totalH: acc + remaining * (DEFAULT_ROW_H + CHUNK_GAP),
      loadedBottom: acc,
    }
  }, [chunks, chunksTotal, heights])

  // 「文件」tab 点文件 = 看切片；已选中的再点不取消（取消靠删文件或换选别的）
  const toggleSelect = (item: KbFile) => {
    if (item.file_id === selectedId) return
    selectFile(item.file_id)
  }

  // ——— 图谱 tab：勾选驱动右侧视图 ———

  const toggleChecked = (fileId: string) => {
    setBuildFileId(null)
    setChecked((cur) => {
      const next = new Set(cur)
      if (next.has(fileId)) next.delete(fileId)
      else next.add(fileId)
      return next
    })
  }

  // 点状态徽标 = 单独看这份文件的图谱（未生成的在这里拿到构建按钮）；
  // 再点一次 = 回到勾选驱动的视图
  const toggleBuildFile = (item: KbFile) => {
    setBuildFileId((cur) => {
      if (cur === item.file_id) return null
      buildEntryStatusRef.current = item.graph_status ?? ''
      return item.file_id
    })
  }

  // KbGraphPanel 拉到单文件图谱后把 graph_status 推回来同步进列表。
  // 之前构建完成后勾选框一直禁用，就是因为构建入口在右侧面板，
  // 而列表状态靠轮询刷新——轮询只认列表里的 building，触发构建时
  // 列表还是空状态，processing 为 false，根本没起轮询。
  const syncGraphStatus = useCallback((fid: string, status: string) => {
    setFiles((cur) =>
      cur.some((f) => f.file_id === fid && f.graph_status !== status)
        ? cur.map((f) => (f.file_id === fid ? { ...f, graph_status: status } : f))
        : cur,
    )
    // 在构建视图里等到构建完成（ready/stale）：自动勾上这份文件并退出
    // 构建视图——徽标此时已消失没有返回入口，而且勾上后勾选框同时亮起，
    // 新图谱以勾选驱动的方式直接展示
    if (
      buildFileIdRef.current === fid &&
      buildEntryStatusRef.current !== 'ready' &&
      buildEntryStatusRef.current !== 'stale' &&
      (status === 'ready' || status === 'stale')
    ) {
      setChecked((cur) => new Set(cur).add(fid))
      setBuildFileId(null)
    }
  }, [])

  /**
   * 列表行 hover 重建：配置随这次重建一次提交（与面板内弹窗同一套语义），
   * 不留「先存配置」的中间态。成功后重拉列表并把 graphEpoch +1，
   * 让右侧面板重挂载拉到新图。
   */
  const submitRebuild = async (config: { docType: string; level: 'full' | 'light' }) => {
    if (!rebuildTarget || rebuilding) return
    setRebuilding(true)
    setRebuildError('')
    try {
      await rebuildKgGraph(rebuildTarget.file_id, {
        docType: config.docType || '',
        level: config.level,
      })
      setRebuildTarget(null)
      setGraphEpoch((n) => n + 1)
      // 立刻重拉列表，状态徽标当场变成「构建中」
      await refresh()
    } catch (e) {
      // 弹窗不关：保住刚选的配置，改完可直接重试
      setRebuildError(e instanceof Error ? e.message : '提交重建失败')
    } finally {
      setRebuilding(false)
    }
  }

  // 当前图用的抽取配置（中文名 + 粒度）：展示在列表文件名下方，
  // 取代原来画布左上的 provenance 浮层——配置是「这份文件」的属性，跟着文件走更自然
  const docTypeLabelOf = (key?: string) => docTypeLabel(key ?? '', docTypes)
  const levelLabelOf = (level?: string) => (level === 'light' ? '轻量' : '完整')

  // ——— 切片人工修订：保存即单片重嵌入 ———

  const startEdit = (chunk: KbChunk) => {
    setEditError('')
    setEditingSeq(chunk.seq)
    setEditingText(chunk.text)
  }

  const cancelEdit = () => {
    setEditingSeq(null)
    setEditingText('')
    setEditError('')
  }

  const saveChunk = async () => {
    if (!selectedFile || editingSeq === null || savingChunk) return
    const text = editingText.trim()
    if (!text) {
      setEditError('切片内容不能为空')
      return
    }
    setSavingChunk(true)
    setEditError('')
    try {
      const seq = editingSeq
      const { graph_status } = await editKbChunk(selectedFile.file_id, seq, text)
      setChunks((cur) => cur.map((c) => (c.seq === seq ? { ...c, text } : c)))
      // stale 提示读的是文件的 graph_status，同步回列表数据
      setFiles((cur) =>
        cur.map((f) =>
          f.file_id === selectedFile.file_id ? { ...f, graph_status } : f,
        ),
      )
      setEditingSeq(null)
      setEditingText('')
    } catch (e) {
      setEditError(e instanceof Error ? e.message : '保存切片失败')
    } finally {
      setSavingChunk(false)
    }
  }

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    setUploading(file.name)
    try {
      const fileId = await uploadKbFile(file)
      // 先刷新列表再选中：库里原本没文件时首屏无从自动选中，
      // 不选中右侧就落到图谱兜底视图，看起来像「传完没反应」
      await refresh()
      setTab('files')
      selectFile(fileId)
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败')
    } finally {
      setUploading(null)
    }
  }

  const onDelete = async (item: KbFile) => {
    setPendingDelete(null)
    setError('')
    try {
      await deleteKbFile(item.file_id)
      const list = await refresh()
      // 删掉的正是当前在看的文件：接着看剩下的第一份。不补选的话
      // selectedId 指向已删除的行，右侧会掉到图谱兜底视图
      if (list && selectedIdRef.current === item.file_id) {
        selectFile(list[0]?.file_id ?? null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败')
    }
  }

  // ——— 标签管理（管理员）：弹窗里增删，保存时全量覆盖 ———

  const startTagEdit = (item: KbFile) => {
    setTagError('')
    setTaggingFile(item)
  }

  const saveTags = async (tags: string[]) => {
    if (!taggingFile || savingTags) return
    const fileId = taggingFile.file_id
    setSavingTags(true)
    setTagError('')
    try {
      await setKbFileTags(fileId, tags)
      setFiles((cur) =>
        cur.map((f) => (f.file_id === fileId ? { ...f, tags } : f)),
      )
      setTaggingFile(null)
    } catch (e) {
      // 弹窗不关：保住刚编好的标签，用户改完可以直接重试
      setTagError(e instanceof Error ? e.message : '保存标签失败')
    } finally {
      setSavingTags(false)
    }
  }

  // ——— 重命名（管理员）：弹窗改名，后端同步磁盘并按需重嵌 ———

  const [renamingFile, setRenamingFile] = useState<KbFile | null>(null)
  const [savingRename, setSavingRename] = useState(false)
  // 改名失败显示在弹窗内（页面顶部 error 会被蒙层盖住）
  const [renameError, setRenameError] = useState('')

  const saveRename = async (filename: string) => {
    if (!renamingFile || savingRename) return
    const fileId = renamingFile.file_id
    setSavingRename(true)
    setRenameError('')
    try {
      await renameKbFile(fileId, filename)
      // selectedFile 由 files 派生，改列表右侧标题/下载名即跟着变
      setFiles((cur) =>
        cur.map((f) => (f.file_id === fileId ? { ...f, filename } : f)),
      )
      setRenamingFile(null)
    } catch (e) {
      // 弹窗不关：保住刚输入的名字，用户改完可以直接重试
      setRenameError(e instanceof Error ? e.message : '重命名失败')
    } finally {
      setSavingRename(false)
    }
  }

  const onDownload = async (item: KbFile) => {
    setError('')
    try {
      await downloadKbFile(item)
    } catch (e) {
      setError(e instanceof Error ? e.message : '下载失败')
    }
  }

  return (
    <div className="kb-page">
      {/* 面板收起时控件没有落脚点，浮在左上角（位置与面板内的同一行重合，切换时不跳） */}
      {panelOpen ? null : (
        <div className="kb-float">
          <button type="button" className="kb-back" onClick={onBack} aria-label="返回" title="返回">
            <BackIcon />
          </button>
          <button
            type="button"
            className="kb-panel-toggle"
            aria-label="展开文件列表"
            aria-pressed={false}
            title="展开文件列表"
            onClick={() => setPanelOpen(true)}
          >
            <PanelIcon />
          </button>
        </div>
      )}

      <div className={`kb-body${panelOpen ? '' : ' panel-collapsed'}`}>
        <aside className="kb-panel">
          <div className="kb-panel-inner">
            <div className="kb-panel-chrome">
            {/* 首行整体工具条：返回 · 功能tab · 收起 装进同一个胶囊 */}
            <div className="kb-panel-head">
              <button
                type="button"
                className="kb-back"
                onClick={onBack}
                aria-label="返回"
                title="返回"
              >
                <BackIcon />
              </button>
              <div className="kb-tabs" role="tablist" aria-label="知识库功能区">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'files'}
                  className={tab === 'files' ? 'is-on' : ''}
                  onClick={() => setTab('files')}
                >
                  文件
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'graph'}
                  className={tab === 'graph' ? 'is-on' : ''}
                  onClick={() => setTab('graph')}
                >
                  图谱
                </button>
              </div>
              <button
                type="button"
                className="kb-panel-toggle"
                aria-label="收起文件列表"
                aria-pressed
                title="收起文件列表"
                onClick={() => setPanelOpen(false)}
              >
                <PanelIcon />
              </button>
            </div>

            <input ref={inputRef} type="file" accept={ACCEPT} hidden onChange={onPick} />

            {error ? <p className="kb-error">{error}</p> : null}

            {/* 搜索 + 上传：装进同一条工具条，两者同高，视觉上是一组。
                文件 tab 才显示上传（只有管理员能传），搜索两个 tab 共用 */}
            {filesLoaded && files.length > 0 ? (
              <div className="kb-toolbar">
                <div className="kb-search-wrap">
                  <span className="kb-search-icon" aria-hidden="true">
                    <SearchIcon />
                  </span>
                  <input
                    type="search"
                    className="kb-search"
                    placeholder="搜索文档、标签…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                {tab === 'files' && canManage ? (
                  <button
                    type="button"
                    className="kb-upload"
                    onClick={() => inputRef.current?.click()}
                    disabled={uploading !== null}
                    title={uploading ? '正在上传' : undefined}
                  >
                    <UploadIcon />
                    <span>上传</span>
                  </button>
                ) : null}
              </div>
            ) : null}
            </div>

            <div className="kb-panel-scroll">
              <div className="kb-panel-scroll-inner">
            {tab === 'files' ? (
              <>
                {!filesLoaded ? (
                  // 首屏请求还没回来：什么都不渲染，避免空态文案闪一下又消失
                  null
                ) : files.length === 0 ? (
                  <p className="kb-empty">
                    {canManage
                      ? '支持 PDF / DOCX / XLSX / MD / TXT / CSV，处理完成后即可在对话里提问文档内容。'
                      : '知识库还没有文件。管理员上传文档后，就可以在这里查看，并在对话里直接提问。'}
                  </p>
                ) : visibleFiles.length === 0 ? (
                  <p className="kb-empty">没有匹配「{query}」的文件。</p>
                ) : (
                  // 按文档类型分组：招股书一组、通用文档一组，组内是卡片行
                  <div className="kb-fgroups">
                    {fileGroups.map((group) => {
                      const open = !closedGroups.has(group.key)
                      return (
                        <div className="kb-ggroup" key={group.key}>
                          <button
                            type="button"
                            className="kb-ggroup-head"
                            onClick={() => toggleGroup(group.key)}
                            aria-expanded={open}
                          >
                            <span className={`kb-gcaret${open ? ' is-open' : ''}`}>
                              <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
                                <path
                                  d="M4.5 2.5 8 6l-3.5 3.5"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </span>
                            <span className="kb-ggroup-title">{group.label}</span>
                            <span className="kb-ggroup-count">{group.items.length}</span>
                          </button>
                          {open ? (
                            <ul className="kb-list">
                              {group.items.map((item) => (
                                <KbFileRow
                                  key={item.file_id}
                                  item={item}
                                  isSelected={item.file_id === selectedId}
                                  canManage={canManage}
                                  typeLabel={group.label}
                                  isGeneral={group.key === 'general'}
                                  graphBuilding={item.graph_status === 'building'}
                                  onToggle={toggleSelect}
                                  onRebuild={setRebuildTarget}
                                  onDownload={(f) => void onDownload(f)}
                                  onTagEdit={startTagEdit}
                                  onRename={(f) => {
                                    setRenameError('')
                                    setRenamingFile(f)
                                  }}
                                  onDelete={setPendingDelete}
                                />
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            ) : (
              <>
                {/* 勾选 = 合并查看范围，实时生效：勾几个就看几张图合在一起 */}
                {!filesLoaded ? (
                  null
                ) : files.length === 0 ? (
                  <p className="kb-empty">
                    {canManage
                      ? '还没有文件。先到「文件」tab 上传文档。'
                      : '知识库还没有文件。'}
                  </p>
                ) : (
                  <>
                    {/* 两组分开：可构建（未生成/失败）在上，已构建可勾选在下。
                        组头写明数量并可折叠，文件多了先把不关心的那组收起来 */}
                    {graphTodo.length > 0 ? (
                      <div className="kb-ggroup">
                        <button
                          type="button"
                          className="kb-ggroup-head"
                          onClick={() => setTodoOpen(!todoOpen)}
                          aria-expanded={todoOpen}
                        >
                          <span className={`kb-gcaret${todoOpen ? ' is-open' : ''}`}>
                            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
                              <path
                                d="M4.5 2.5 8 6l-3.5 3.5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                          <span className="kb-ggroup-title">未构建图谱</span>
                          <span className="kb-ggroup-count">{graphTodo.length}</span>
                        </button>
                        {todoOpen ? (
                          <ul className="kb-glist">
                            {graphTodo.map((item) => {
                              // 构建入口是文件名右侧的按钮，徽标这里只留纯状态
                              // （构建中/构建失败），不再显示可点的操作文字
                              const badge =
                                item.graph_status === 'building' ||
                                item.graph_status === 'failed'
                                  ? graphBadge(item.graph_status, false)
                                  : null
                              return (
                                <li key={item.file_id} className="kb-gitem is-muted">
                                  {/* 未构建行也留一个不可勾选的复选框：结构与已构建行
                                      保持一致，同时说明「建完才能勾进合并视图」 */}
                                  <span
                                    className="kb-gcheck is-locked"
                                    title="图谱构建完成后才能勾选进合并视图"
                                  >
                                    <input type="checkbox" disabled checked={false} />
                                    <span className="kb-gtext">
                                      <span className="kb-gname" title={item.filename}>
                                        {item.filename}
                                      </span>
                                      <span className="kb-gmeta">
                                        <span className="kb-gcount is-muted">
                                          {item.chunk_count} 切片
                                        </span>
                                      </span>
                                    </span>
                                  </span>
                                  {canManage && item.graph_status !== 'building' ? (
                                    <button
                                      type="button"
                                      className="kb-gact"
                                      onClick={() => setRebuildTarget(item)}
                                      title="选择文档类型与抽取粒度后构建图谱"
                                    >
                                      <span className="kb-gact-icon" aria-hidden="true">
                                        <GraphRefreshIcon />
                                      </span>
                                      <span className="kb-gact-text">构建</span>
                                    </button>
                                  ) : null}
                                  {badge ? (
                                    <span className={`kb-gbadge ${badge.cls}`}>
                                      {badge.cls === 'st-busy' ? (
                                        <span className="kb-gspinner" aria-hidden="true" />
                                      ) : (
                                        badge.label
                                      )}
                                    </span>
                                  ) : null}
                                </li>
                              )
                            })}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}

                    {graphDone.length > 0 ? (
                      <div className="kb-ggroup">
                        <button
                          type="button"
                          className="kb-ggroup-head"
                          onClick={() => setDoneOpen(!doneOpen)}
                          aria-expanded={doneOpen}
                        >
                          <span className={`kb-gcaret${doneOpen ? ' is-open' : ''}`}>
                            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
                              <path
                                d="M4.5 2.5 8 6l-3.5 3.5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                          <span className="kb-ggroup-title">已构建图谱</span>
                          <span className="kb-ggroup-count">{graphDone.length}</span>
                        </button>
                        {doneOpen ? (
                          <ul className="kb-glist">
                            {graphDone.map((item) => {
                              const badge =
                                item.graph_status === 'ready'
                                  ? null
                                  : graphBadge(item.graph_status, canManage)
                              const isPicked =
                                checked.has(item.file_id) || buildFileId === item.file_id
                              const count = item.graph_entity_count ?? 0
                              const tier = entityTier(count, maxEntities)
                              return (
                                <li
                                  key={item.file_id}
                                  className={`kb-gitem${isPicked ? ' is-picked' : ''}`}
                                >
                                  <label className="kb-gcheck">
                                    <input
                                      type="checkbox"
                                      checked={checked.has(item.file_id)}
                                      onChange={() => toggleChecked(item.file_id)}
                                    />
                                    <span className="kb-gtext">
                                      <span className="kb-gname" title={item.filename}>
                                        {item.filename}
                                      </span>
                                      <span className="kb-gmeta">
                                        <span
                                          className={`kb-gtype ${docTypeStyle(item.doc_type)}`}
                                          title={`这份图谱按「${docTypeLabelOf(item.doc_type)} · ${levelLabelOf(item.extract_level)}」抽取`}
                                        >
                                          {docTypeLabelOf(item.doc_type)}
                                        </span>
                                        {/* 实体体量：色阶 + 细条一起表达，
                                            1057 这种量级一眼看出是重活。
                                            条长按列表内最大值取相对比例：
                                            1057 满条，446 就是 42%，348 是 33% */}
                                        <span
                                          className={`kb-gcount ${tier.cls}`}
                                          title={
                                            count >= 1000
                                              ? `${count} 个实体 · 超过 1000，重建耗时较长`
                                              : `${count} 个实体`
                                          }
                                        >
                                          <span className="kb-gvol" aria-hidden="true">
                                            <i style={{ width: `${tier.ratio * 100}%` }} />
                                          </span>
                                          {count} 实体
                                        </span>
                                      </span>
                                    </span>
                                  </label>
                                  {/* 重建：默认只有图标，hover 行才展开文字，
                                      高危操作不该一直挂在行上吸注意力 */}
                                  {canManage ? (
                                    <button
                                      type="button"
                                      className="kb-gact"
                                      onClick={() => setRebuildTarget(item)}
                                      disabled={item.graph_status === 'building'}
                                      title="按新的文档类型与抽取粒度重建这份图谱"
                                    >
                                      <span className="kb-gact-icon" aria-hidden="true">
                                        <GraphRefreshIcon />
                                      </span>
                                      <span className="kb-gact-text">重建</span>
                                    </button>
                                  ) : null}
                                  {badge ? (
                                    <span
                                      className={`kb-gbadge ${badge.cls}`}
                                      onClick={() => toggleBuildFile(item)}
                                      title="查看这份文件的图谱"
                                    >
                                      {badge.label}
                                    </span>
                                  ) : null}
                                </li>
                              )
                            })}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                )}
              </>
            )}
              </div>
            </div>
          </div>
        </aside>

        {buildFile ? (
          // 「图谱」tab 点徽标单独查看：这份文件自己的图谱；没生成时空态里有构建按钮
          <section className="kb-chunks" aria-label="文件图谱">
            <header className="kb-chunks-head">
              <h2 className="kb-chunks-title" title={buildFile.filename}>
                {extBadge(buildFile)}
                {buildFile.filename}
                <span className="kb-graph-sub">文件图谱</span>
              </h2>
            </header>
            <KbGraphPanel
              key={`${buildFile.file_id}:${graphEpoch}`}
              fileId={buildFile.file_id}
              file={buildFile}
              canManage={canManage}
              building={buildFile.graph_status === 'building'}
              onStatus={syncGraphStatus}
            />
          </section>
        ) : selectedFile && tab === 'files' ? (
          <section className="kb-chunks" aria-label="文件内容">
            <header className="kb-chunks-head">
              <h2 className="kb-chunks-title" title={selectedFile.filename}>
                {extBadge(selectedFile)}
                {selectedFile.filename}
              </h2>
            </header>

            {editError ? <p className="kb-error">{editError}</p> : null}

            {selectedFile.status !== 'ready' ? (
              <p className="kb-chunks-empty">
                文件还在处理中，完成后即可查看切片。
              </p>
            ) : chunksError ? (
              <p className="kb-error">{chunksError}</p>
            ) : chunksLoading ? (
              <p className="kb-chunks-empty">正在加载切片…</p>
            ) : chunks.length === 0 ? (
              <p className="kb-chunks-empty">该文件没有生成任何切片。</p>
            ) : (
              <div
                ref={listRef}
                className="kb-chunk-scroll"
                onScroll={(e) => {
                  const el = e.currentTarget
                  setScrollTop(el.scrollTop)
                  // 接近已加载末尾且还有更多 → 拉下一页
                  if (el.scrollTop + el.clientHeight >= loadedBottom - 240) {
                    void loadMore()
                  }
                }}
              >
                <div className="kb-chunk-list" style={{ height: totalH }}>
                  {(() => {
                    // 二分找第一个 top ≥ scrollTop 的卡片，往前多渲 OVERSCAN 张兜住边界
                    let lo = 0
                    let hi = offsets.length - 1
                    let startIdx = 0
                    while (lo <= hi) {
                      const mid = (lo + hi) >> 1
                      if (offsets[mid] < scrollTop) {
                        startIdx = mid + 1
                        lo = mid + 1
                      } else {
                        hi = mid - 1
                      }
                    }
                    startIdx = Math.max(0, startIdx - OVERSCAN)
                    let endIdx = startIdx
                    while (
                      endIdx < chunks.length &&
                      offsets[endIdx] < scrollTop + viewportH
                    ) {
                      endIdx++
                    }
                    endIdx = Math.min(chunks.length, endIdx + OVERSCAN)
                    return chunks.slice(startIdx, endIdx).map((chunk, i) => (
                      <li
                        key={chunk.seq}
                        ref={(el) => measureCard(chunk.seq, el)}
                        className="kb-chunk"
                        style={{ top: offsets[startIdx + i] }}
                      >
                        <div className="kb-chunk-meta">
                          <span className={`kb-chunk-kind kind-${chunk.kind}`}>
                            {KIND_LABEL[chunk.kind]}
                          </span>
                          <span className="kb-chunk-pos">
                            #{chunk.seq + 1} · {chunkPos(chunk)}
                          </span>
                          {/* 修订 = 人工审核：改完保存即单片重嵌入（管理员） */}
                          {canManage &&
                          selectedFile.status === 'ready' &&
                          editingSeq !== chunk.seq ? (
                            <button
                              type="button"
                              className="kb-chunk-edit"
                              onClick={() => startEdit(chunk)}
                            >
                              编辑
                            </button>
                          ) : null}
                        </div>
                        {editingSeq === chunk.seq ? (
                          <div className="kb-chunk-editor">
                            <div className="kb-chunk-field">
                              <textarea
                                value={editingText}
                                onChange={(e) => setEditingText(e.target.value)}
                                rows={Math.min(
                                  14,
                                  Math.max(4, Math.ceil(editingText.length / 44)),
                                )}
                                spellCheck={false}
                              />
                            </div>
                            <div className="kb-chunk-actions">
                              <button
                                type="button"
                                className="kb-chunk-save"
                                onClick={() => void saveChunk()}
                                disabled={savingChunk}
                              >
                                {savingChunk ? '保存中…' : '保存'}
                              </button>
                              <button
                                type="button"
                                className="kb-chunk-cancel"
                                onClick={cancelEdit}
                                disabled={savingChunk}
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        ) : (
                          <pre className="kb-chunk-text">{chunk.text}</pre>
                        )}
                      </li>
                    ))
                  })()}
                </div>
              </div>
            )}
          </section>
        ) : tab === 'files' ? (
          // 文件 tab 但没有可看的文件：此前会落到下面的全库图谱兜底，
          // 空库时右侧挂着一张空画布，既没解释也没入口。
          // 首屏请求未回来时不渲染，避免「还没有文件」闪一下又消失
          !filesLoaded ? (
            <section className="kb-chunks" aria-label="文件" />
          ) : (
            <section className="kb-chunks kb-chunks-hint" aria-label="文件提示">
              {files.length === 0 ? (
                <>
                  <h2 className="kb-hint-title">知识库里还没有文件</h2>
                  <p className="kb-hint-text">
                    {canManage
                      ? '支持 PDF / DOCX / XLSX / MD / TXT / CSV。上传后系统会自动解析、切片并建立索引，完成后就能在对话里直接提问文档内容。'
                      : '管理员上传文档后，这里会显示文件与切片，你也可以在对话里直接提问文档内容。'}
                  </p>
                  {canManage ? (
                    <button
                      type="button"
                      className="kb-hint-upload"
                      onClick={() => inputRef.current?.click()}
                      disabled={uploading !== null}
                    >
                      <UploadIcon />
                      <span>{uploading ? `上传中 · ${uploading}` : '选择文件上传'}</span>
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  <h2 className="kb-hint-title">选择一份文件</h2>
                  <p className="kb-hint-text">
                    点左侧文件名查看切片内容；在图谱 tab 勾选文件可以查看实体关系。
                  </p>
                </>
              )}
            </section>
          )
        ) : (
          // 图谱视图：由图谱 tab 的勾选驱动（勾 1 个=单文件，多选=合并，0=全库）
          <section className="kb-chunks" aria-label="知识图谱">
            <header className="kb-chunks-head">
              <h2 className="kb-chunks-title">
                {checkedIds.length === 1 && checkedFile ? (
                  <>
                    {extBadge(checkedFile)}
                    {checkedFile.filename}
                    <span className="kb-graph-sub">文件图谱</span>
                  </>
                ) : checkedIds.length > 1 ? (
                  <>
                    合并图谱
                    <span className="kb-graph-sub">
                      {checkedIds.length} 份勾选文件
                    </span>
                  </>
                ) : (
                  <>
                    全库图谱
                    <span className="kb-graph-sub">实体关系总览</span>
                  </>
                )}
                {/* 概览拆成独立小标签：挤在一行文字里既看不出重点，
                    又容易被当成标题的一部分。单文件视图 files 恒为 1，
                    「文件」这颗标签只在真的跨文件时出现 */}
                {graphStats ? (
                  <span className="kb-graph-stats">
                    <span className="kb-graph-tag">
                      <b>{graphStats.entities}</b> 实体
                    </span>
                    <span className="kb-graph-tag">
                      <b>{graphStats.relations}</b> 关系
                    </span>
                    {graphStats.files > 1 ? (
                      <span className="kb-graph-tag">
                        <b>{graphStats.files}</b> 文件
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </h2>
            </header>
            <KbGraphPanel
              key={`${checkedKey}:${graphEpoch}`}
              fileId={checkedIds.length === 1 ? checkedIds[0] : null}
              file={checkedIds.length === 1 ? checkedFile : null}
              fileIds={checkedIds.length > 1 ? checkedIds : undefined}
              canManage={canManage}
              // 单文件视图面板自己有 graph_status，不用父组件的合并信号；
              // 合并视图和全库视图（0 勾选）都没有单文件状态，必须由父组件
              // 告诉这里「有文件在建图」，否则构建完成后画布不会重拉
              building={checkedIds.length !== 1 && graphBuilding}
              onStats={setGraphStats}
              onStatus={syncGraphStatus}
            />
          </section>
        )}
      </div>

      {taggingFile ? (
        <TagDialog
          filename={taggingFile.filename}
          initialTags={taggingFile.tags ?? []}
          suggestions={allTags}
          saving={savingTags}
          error={tagError}
          onCancel={() => setTaggingFile(null)}
          onSave={(tags) => void saveTags(tags)}
        />
      ) : null}

      {renamingFile ? (
        <RenameDialog
          filename={renamingFile.filename}
          saving={savingRename}
          error={renameError}
          onCancel={() => setRenamingFile(null)}
          onSave={(name) => void saveRename(name)}
        />
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          title="确定删除文件?"
          description={`「${pendingDelete.filename}」及其全部向量切片将被永久删除，删除后对话将检索不到该文件。`}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void onDelete(pendingDelete)}
        />
      ) : null}

      {/* 列表行 hover 重建的弹窗：挂在页面级，与面板内弹窗同一套语义 */}
      {rebuildTarget ? (
        <KgBuildDialog
          filename={rebuildTarget.filename}
          docTypes={docTypes.filter((t) => !t.is_general)}
          // 预填这份文件上次建图用的配置；空串 = 通用，与 general 等价
          initialDocType={
            !rebuildTarget.doc_type || rebuildTarget.doc_type === 'general'
              ? ''
              : rebuildTarget.doc_type
          }
          initialLevel={
            rebuildTarget.extract_level === 'light' ? 'light' : 'full'
          }
          // 未构建/失败 → 标题「构建图谱」；已生成/待重建 → 「重建图谱」
          hasGraph={
            rebuildTarget.graph_status === 'ready' ||
            rebuildTarget.graph_status === 'stale'
          }
          submitting={rebuilding}
          error={rebuildError}
          onCancel={() => setRebuildTarget(null)}
          onSubmit={(config) => void submitRebuild(config)}
        />
      ) : null}
    </div>
  )
}
