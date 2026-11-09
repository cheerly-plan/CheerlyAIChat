import { useEffect, useRef, useState } from 'react'
import { downloadReportFile, fetchReportFile, type ReportFileBlob } from '../../api'
import { CloseIcon, DownloadIcon } from './icons'
import { Markdown } from './Markdown'
import { useReportPreview } from './ReportPreviewContext'

const WIDTH_KEY = 'ai_chat.report_preview_width'
const DEFAULT_RATIO = 0.45
const MIN_WIDTH = 300
const MAX_RATIO = 0.7
const MIN_CENTER = 400

function kindOf(file: ReportFileBlob): 'pdf' | 'markdown' | 'json' | 'text' | 'other' {
  const name = file.filename.toLowerCase()
  const type = file.contentType.toLowerCase()
  if (name.endsWith('.pdf') || type.includes('pdf')) return 'pdf'
  if (name.endsWith('.md') || type.includes('markdown') || type.includes('text/plain')) {
    if (name.endsWith('.md') || type.includes('markdown')) return 'markdown'
    return 'text'
  }
  if (name.endsWith('.json') || type.includes('json')) return 'json'
  if (type.startsWith('text/')) return 'text'
  return 'other'
}

function clampPreviewWidth(raw: number, viewport = window.innerWidth): number {
  const maxByRatio = Math.floor(viewport * MAX_RATIO)
  const maxByCenter = Math.max(MIN_WIDTH, viewport - MIN_CENTER)
  const max = Math.min(maxByRatio, maxByCenter)
  return Math.min(max, Math.max(MIN_WIDTH, Math.round(raw)))
}

function readStoredWidth(): number {
  try {
    const raw = window.localStorage.getItem(WIDTH_KEY)
    if (raw) {
      const n = Number(raw)
      if (Number.isFinite(n)) return clampPreviewWidth(n)
    }
  } catch {
    /* ignore */
  }
  return clampPreviewWidth(window.innerWidth * DEFAULT_RATIO)
}

export function ReportPreviewPanel() {
  const { target, close } = useReportPreview()
  const [file, setFile] = useState<ReportFileBlob | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // 下载中按文件 path 记录：切换预览目标时状态自动失效，不用在 effect 里手动重置
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null)
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 520 : readStoredWidth(),
  )
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    if (!target) {
      setFile((prev) => {
        if (prev) URL.revokeObjectURL(prev.objectUrl)
        return null
      })
      setText('')
      setError('')
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError('')
    setText('')
    void fetchReportFile(target.path, { preview: true })
      .then(async (next) => {
        if (cancelled) {
          URL.revokeObjectURL(next.objectUrl)
          return
        }
        setFile((prev) => {
          if (prev) URL.revokeObjectURL(prev.objectUrl)
          return next
        })
        const kind = kindOf(next)
        if (kind === 'markdown' || kind === 'json' || kind === 'text') {
          const body = await next.blob.text()
          if (!cancelled) setText(body)
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '打开失败')
        setFile(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [target])

  useEffect(() => {
    if (!target) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [target, close])

  useEffect(() => {
    if (!target) return
    function onResize() {
      setWidth((prev) => clampPreviewWidth(prev))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [target])

  useEffect(() => {
    function onMove(event: PointerEvent) {
      const drag = dragRef.current
      if (!drag) return
      const next = clampPreviewWidth(drag.startWidth + (drag.startX - event.clientX))
      setWidth(next)
    }
    function onUp() {
      if (!dragRef.current) return
      dragRef.current = null
      document.body.classList.remove('is-resizing-preview')
      setWidth((prev) => {
        try {
          window.localStorage.setItem(WIDTH_KEY, String(prev))
        } catch {
          /* ignore */
        }
        return prev
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  if (!target) return null

  const path = target.path
  const downloading = downloadingPath === path
  // 后端 M2 门禁：未定稿的深度层 PDF 只可在线预览，不提供下载入口
  const canDownload = file === null || file.downloadAllowed
  function startDownload() {
    if (downloading || !canDownload) return
    setDownloadingPath(path)
    void downloadReportFile(path)
      .catch((err: unknown) => {
        window.alert(err instanceof Error ? err.message : '下载失败')
      })
      .finally(() => setDownloadingPath(null))
  }

  const title = target.label || file?.filename || '文件预览'
  const sizeText = file ? formatSize(file.blob.size) : ''
  const metaNote = file
    ? canDownload
      ? '可直接下载'
      : '需人工审核，仅可在线预览'
    : loading
      ? '正在打开…'
      : ''
  const kind = file ? kindOf(file) : null
  const ext = extensionOf(title, kind)
  const layer = reportLayerOf(target.path, title)

  return (
    <aside
      className="report-preview"
      role="dialog"
      aria-modal="false"
      aria-label="文件预览"
      style={{ width }}
    >
      <div
        className="report-preview-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整预览宽度"
        onPointerDown={(event) => {
          event.preventDefault()
          dragRef.current = { startX: event.clientX, startWidth: width }
          document.body.classList.add('is-resizing-preview')
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
      />
      <div className="report-preview-bar">
        <div className="report-preview-heading">
          <div className="report-preview-row" title={title}>
            {layer ? (
              <span className={`report-preview-layer report-preview-layer-${layer.tone}`}>
                {layer.label}
              </span>
            ) : null}
            {ext ? <span className={`report-preview-badge report-preview-badge-${ext}`}>{ext}</span> : null}
            <span className="report-preview-name">{title}</span>
          </div>
          <div className="report-preview-meta">
            {sizeText ? <span>{sizeText}</span> : null}
            {sizeText && metaNote ? (
              <span className="report-preview-meta-sep">·</span>
            ) : null}
            {metaNote ? (
              <span className={file && !canDownload ? 'report-preview-meta-warn' : undefined}>
                {metaNote}
              </span>
            ) : null}
          </div>
        </div>
        <div className="report-preview-actions">
          <button
            type="button"
            className="report-preview-download"
            aria-label={downloading ? '正在下载' : canDownload ? '下载文件' : '需人工审核通过后可下载'}
            title={
              canDownload
                ? downloading
                  ? '正在下载…'
                  : '下载文件'
                : '需人工审核通过后可下载'
            }
            disabled={!file || loading || downloading || !canDownload}
            onClick={startDownload}
          >
            {downloading ? (
              <span className="report-preview-spinner" aria-hidden="true" />
            ) : (
              <DownloadIcon />
            )}
            <span>{downloading ? '下载中' : '下载'}</span>
          </button>
          <button
            type="button"
            className="report-preview-action"
            aria-label="关闭"
            title="关闭"
            onClick={close}
          >
            <CloseIcon />
          </button>
        </div>
      </div>
      <div className={`report-preview-body${kind === 'pdf' ? ' is-pdf' : ''}`}>
        {loading ? (
          <div
            className="report-preview-skeleton"
            role="status"
            aria-label="正在打开文件"
          >
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        ) : null}
        {error ? (
          <div className="report-preview-error-wrap">
            <div className="report-preview-error-card">
              <div className="report-preview-error-icon" aria-hidden="true">
                !
              </div>
              <p className="report-preview-error-title">无法打开这个文件</p>
              <p className="report-preview-error-detail">{error}</p>
            </div>
          </div>
        ) : null}
        {!loading && !error && file && kind === 'pdf' ? (
          <iframe
            className="report-preview-frame"
            title={title}
            src={`${file.objectUrl}${canDownload ? '' : '#toolbar=0&navpanes=0&scrollbar=0'}`}
          />
        ) : null}
        {!loading && !error && file && kind === 'markdown' ? (
          <div className="report-preview-markdown">
            <Markdown content={text} />
          </div>
        ) : null}
        {!loading && !error && file && (kind === 'json' || kind === 'text') ? (
          <pre className="report-preview-code">{formatText(text, kind)}</pre>
        ) : null}
        {!loading && !error && file && kind === 'other' ? (
          <div className="report-preview-fallback">
            <div className="report-preview-fallback-card">
              <span className="report-preview-fallback-icon" aria-hidden="true">
                <DownloadIcon />
              </span>
              <p className="report-preview-fallback-title">此格式暂不支持在线预览</p>
              <p className="report-preview-fallback-desc">
                {canDownload ? '下载到本地即可查看完整内容' : '此文件需人工审核，暂不提供下载'}
              </p>
              {canDownload ? (
                <button
                  type="button"
                  className="report-preview-download-btn"
                  disabled={downloading}
                  onClick={startDownload}
                >
                  <DownloadIcon />
                  <span>{downloading ? '正在下载…' : '下载文件'}</span>
                </button>
              ) : null}
              {file.filename ? (
                <p className="report-preview-fallback-name" title={file.filename}>
                  {file.filename}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  )
}

/** 文件大小：0 或未知时返回空串，别在头部显示「0 B」 */
function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function extensionOf(
  title: string,
  kind: 'pdf' | 'markdown' | 'json' | 'text' | 'other' | null,
): string {
  const match = /\.([a-z0-9]+)$/i.exec(title)
  if (match) return match[1]!.toUpperCase()
  switch (kind) {
    case 'pdf':
      return 'PDF'
    case 'markdown':
      return 'MD'
    case 'json':
      return 'JSON'
    case 'text':
      return 'TXT'
    default:
      return ''
  }
}

/** 研报双 PDF：按文件名区分事实层底稿与深度解析，方便右侧预览一眼辨认。 */
function reportLayerOf(
  path: string,
  title: string,
): { label: string; tone: 'deep' | 'draft' | 'meta' } | null {
  const tail = path.split('/').pop() || title
  let raw: string
  try {
    raw = decodeURIComponent(tail)
  } catch {
    raw = tail
  }
  const name = raw.toLowerCase()
  if (/\.deep\.(pdf|md|json)$/i.test(name)) {
    return { label: '深度解析', tone: 'deep' }
  }
  if (/\.provenance\.md$/i.test(name) || /\.review\.json$/i.test(name)) {
    return { label: '附件', tone: 'meta' }
  }
  if (/\.(pdf|md)$/i.test(name)) {
    return { label: '底稿', tone: 'draft' }
  }
  return null
}

function formatText(raw: string, kind: 'json' | 'text'): string {
  if (kind !== 'json') return raw
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}
