import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { openKbFileAtPage, searchKb, type KbFile, type KbSearchHit } from '../../api'
import { CheckIcon, ChevronDownIcon, CloseIcon } from '../chat/icons'
import { ChunkContent } from './ChunkContent'

const MAX_FILES = 50

function fileLabel(file: KbFile) {
  const mime = file.mime ?? ''
  if (!mime || file.filename.toLowerCase().endsWith(mime.toLowerCase())) {
    return file.filename
  }
  return `${file.filename}${mime}`
}

function isPdf(file: KbFile) {
  const mime = (file.mime ?? '').toLowerCase()
  return mime.includes('pdf') || file.filename.toLowerCase().endsWith('.pdf')
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="m14 6-6 6 6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="m10 6 6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

type Props = {
  files: KbFile[]
  onClose: () => void
}

export function KbRetrieveDialog({ files, onClose }: Props) {
  const ready = useMemo(() => files.filter((file) => file.status === 'ready'), [files])
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [keyword, setKeyword] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hits, setHits] = useState<KbSearchHit[] | null>(null)
  const [hitIndex, setHitIndex] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)

  const shown = ready.filter((file) =>
    fileLabel(file).toLowerCase().includes(keyword.trim().toLowerCase()),
  )
  const pickedFiles = picked
    .map((id) => ready.find((file) => file.file_id === id))
    .filter((file): file is KbFile => Boolean(file))
  const visibleFile = pickedFiles[0]
  const moreCount = Math.max(0, pickedFiles.length - 1)
  const safeIndex = hits && hits.length > 0 ? Math.min(hitIndex, hits.length - 1) : 0
  const current = hits?.[safeIndex] ?? null
  const currentFile = current
    ? files.find((file) => file.file_id === current.file_id)
    : undefined
  const canOpenOriginal = Boolean(currentFile && current?.page != null && isPdf(currentFile))

  useEffect(() => {
    if (!menuOpen) return
    function onPointer(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
        setKeyword('')
      }
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [menuOpen])

  function closeMenu() {
    setMenuOpen(false)
    setKeyword('')
  }

  function toggle(id: string) {
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((item) => item !== id)
      if (prev.length >= MAX_FILES) return prev
      return [...prev, id]
    })
  }

  function step(delta: number) {
    if (!hits || hits.length < 2) return
    setHitIndex((index) => {
      const currentIndex = Math.min(index, hits.length - 1)
      const next = currentIndex + delta
      if (next < 0 || next >= hits.length) return currentIndex
      return next
    })
  }

  async function runSearch() {
    const text = query.trim()
    if (!text || loading) return
    setLoading(true)
    setError('')
    closeMenu()
    try {
      setHits(await searchKb(text, picked))
      setHitIndex(0)
    } catch (err) {
      setHits(null)
      setError(err instanceof Error ? err.message : '检索失败')
    } finally {
      setLoading(false)
    }
  }

  return createPortal(
    <div className="session-dialog-mask" onClick={onClose}>
      <div
        className="session-dialog kb-retrieve-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kb-retrieve-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            if (menuOpen) {
              event.stopPropagation()
              closeMenu()
              return
            }
            onClose()
            return
          }
          if (menuOpen) return
          const tag = (event.target as HTMLElement).tagName
          if (tag === 'INPUT' || tag === 'TEXTAREA') return
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            step(-1)
          } else if (event.key === 'ArrowRight') {
            event.preventDefault()
            step(1)
          }
        }}
      >
        <div className="session-dialog-head">
          <h3 id="kb-retrieve-title">知识库检索</h3>
          <button type="button" className="session-dialog-close" aria-label="关闭" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="kb-retrieve-bar">
        <div
          ref={wrapRef}
          className={`kb-retrieve-select-wrap${menuOpen ? ' is-open' : ''}`}
        >
          <div
            className="kb-retrieve-select"
            onClick={() => {
              if (menuOpen) {
                closeMenu()
                return
              }
              setMenuOpen(true)
              filterRef.current?.focus()
            }}
          >
            <div className="kb-retrieve-select-main">
              {visibleFile ? (
                <span className="kb-retrieve-chip" title={fileLabel(visibleFile)}>
                  <span>{fileLabel(visibleFile)}</span>
                  <button
                    type="button"
                    aria-label={`移除 ${fileLabel(visibleFile)}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      toggle(visibleFile.file_id)
                    }}
                  >
                    <CloseIcon />
                  </button>
                </span>
              ) : null}
              {moreCount > 0 ? (
                <span
                  className="kb-retrieve-more"
                  title={pickedFiles.slice(1).map((file) => fileLabel(file)).join('、')}
                >
                  + {moreCount}
                </span>
              ) : null}
              <input
                ref={filterRef}
                className="kb-retrieve-select-input"
                value={keyword}
                placeholder={pickedFiles.length === 0 ? '请选择检索文件' : ''}
                aria-label="请选择检索文件"
                role="combobox"
                aria-expanded={menuOpen}
                aria-haspopup="listbox"
                aria-controls="kb-retrieve-file-list"
                aria-autocomplete="list"
                onChange={(event) => {
                  setKeyword(event.target.value)
                  setMenuOpen(true)
                }}
                onMouseDown={(event) => {
                  if (!menuOpen) return
                  event.preventDefault()
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.preventDefault()
                }}
              />
            </div>
            <button
              type="button"
              className="kb-retrieve-select-chevron"
              aria-label={menuOpen ? '收起文件列表' : '展开文件列表'}
              onClick={(event) => {
                event.stopPropagation()
                if (menuOpen) closeMenu()
                else {
                  setMenuOpen(true)
                  filterRef.current?.focus()
                }
              }}
            >
              <ChevronDownIcon />
            </button>
          </div>
          {menuOpen ? (
            <div className="kb-retrieve-menu">
              <ul id="kb-retrieve-file-list" role="listbox" aria-multiselectable="true" aria-label="检索文件">
                {ready.length === 0 ? (
                  <li className="kb-retrieve-menu-empty">还没有可检索的文档。</li>
                ) : shown.length === 0 ? (
                  <li className="kb-retrieve-menu-empty">没有匹配的文件</li>
                ) : (
                  shown.map((file) => {
                    const label = fileLabel(file)
                    const on = picked.includes(file.file_id)
                    return (
                      <li key={file.file_id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={on}
                          className={`kb-retrieve-option${on ? ' is-on' : ''}`}
                          title={label}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => toggle(file.file_id)}
                        >
                          <span>{label}</span>
                          {on ? <CheckIcon /> : null}
                        </button>
                      </li>
                    )
                  })
                )}
              </ul>
            </div>
          ) : null}
        </div>

        <form
          className="kb-retrieve-query"
          onSubmit={(event) => {
            event.preventDefault()
            void runSearch()
          }}
        >
          <input
            className="session-dialog-input"
            value={query}
            placeholder="请输入检索问题"
            aria-label="检索问题"
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="submit"
            className={`primary${loading ? ' is-loading' : ''}`}
            disabled={loading || !query.trim()}
            aria-label={loading ? '检索中' : '检索'}
          >
            {loading ? <span className="kb-gspinner" aria-hidden="true" /> : '检索'}
          </button>
        </form>
        </div>

        {error || hits ? (
          <div className="kb-retrieve-results" aria-live="polite">
            {error ? <p className="kb-retrieve-empty">{error}</p> : null}
            {!error && hits && hits.length === 0 ? (
              <p className="kb-retrieve-empty">没有召回到相关片段。</p>
            ) : null}
            {current && hits ? (
              <div className="kb-retrieve-stage">
                <div className="kb-retrieve-pager">
                  <span className="kb-retrieve-pager-label">命中依据 · {hits.length} 段原文</span>
                  <div className="kb-retrieve-pager-ctrl">
                    <button
                      type="button"
                      className="kb-retrieve-nav"
                      aria-label="上一条片段"
                      disabled={safeIndex === 0}
                      onClick={() => step(-1)}
                    >
                      <ChevronLeftIcon />
                    </button>
                    <span>
                      {safeIndex + 1} / {hits.length}
                    </span>
                    <button
                      type="button"
                      className="kb-retrieve-nav"
                      aria-label="下一条片段"
                      disabled={safeIndex >= hits.length - 1}
                      onClick={() => step(1)}
                    >
                      <ChevronRightIcon />
                    </button>
                  </div>
                </div>
                <article className="kb-retrieve-hit">
                  <header>
                    <span className="kb-retrieve-hit-name" title={current.filename}>
                      {current.filename}
                    </span>
                    {canOpenOriginal && currentFile && current.page != null ? (
                      <button
                        type="button"
                        className="kb-retrieve-hit-where is-link"
                        title={`在新标签打开原件第 ${current.page} 页`}
                        onClick={() => {
                          const page = current.page
                          if (page == null) return
                          void openKbFileAtPage(currentFile, page).catch((err) => {
                            setError(err instanceof Error ? err.message : '打开原件失败')
                          })
                        }}
                      >
                        {current.where}
                      </button>
                    ) : (
                      <span className="kb-retrieve-hit-where">{current.where}</span>
                    )}
                  </header>
                  {current.section ? (
                    <p className="kb-retrieve-hit-section">{current.section}</p>
                  ) : null}
                  <div className="kb-retrieve-hit-body">
                    <ChunkContent text={current.text} />
                  </div>
                </article>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
