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
    void fetchReportFile(target.path)
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

  const title = target.label || file?.filename || '文件预览'
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
        <div className="report-preview-title" title={title}>
          {layer ? (
            <span className={`report-preview-layer report-preview-layer-${layer.tone}`}>
              {layer.label}
            </span>
          ) : null}
          {ext ? <span className={`report-preview-badge report-preview-badge-${ext}`}>{ext}</span> : null}
          <span className="report-preview-name">{title}</span>
        </div>
        <div className="report-preview-actions">
          <button
            type="button"
            className="report-preview-action"
            aria-label="下载"
            title="下载"
            disabled={!file || loading}
            onClick={() => {
              void downloadReportFile(target.path).catch((err: unknown) => {
                window.alert(err instanceof Error ? err.message : '下载失败')
              })
            }}
          >
            <DownloadIcon />
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
        {loading ? <p className="report-preview-status">正在打开…</p> : null}
        {error ? <p className="report-preview-error">{error}</p> : null}
        {!loading && !error && file && kind === 'pdf' ? (
          <iframe className="report-preview-frame" title={title} src={file.objectUrl} />
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
            <p>此类型暂不支持内嵌预览，请下载后查看。</p>
            <button
              type="button"
              className="report-preview-download-btn"
              onClick={() => {
                void downloadReportFile(target.path).catch((err: unknown) => {
                  window.alert(err instanceof Error ? err.message : '下载失败')
                })
              }}
            >
              下载文件
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  )
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
  let raw = title
  try {
    raw = decodeURIComponent(path.split('/').pop() || title)
  } catch {
    raw = path.split('/').pop() || title
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
