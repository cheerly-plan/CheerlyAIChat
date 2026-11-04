import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ChatMessage, ChatSource } from '../../types'
import { ChunkContent } from '../kb/ChunkContent'
import { CheckIcon, CloseIcon, CopyIcon, EditIcon, RefreshIcon, SendIcon } from './icons'
import { Markdown } from './Markdown'

type Props = {
  message: ChatMessage
  loading?: boolean
  busy?: boolean
  canRegenerate?: boolean
  canResume?: boolean
  onEditSubmit?: (text: string) => void
  onRegenerate?: (id: string) => void
  onResume?: () => void
}

export function MessageItem({
  message,
  loading = false,
  busy = false,
  canRegenerate = false,
  canResume = false,
  onEditSubmit,
  onRegenerate,
  onResume,
}: Props) {
  const done = !loading && Boolean(message.content || message.sources?.length)
  const interrupted = canResume && !loading

  if (message.role === 'user') {
    return (
      <UserMessage
        message={message}
        done={done}
        busy={busy}
        onEditSubmit={onEditSubmit}
      />
    )
  }

  const sources = message.sources ?? []
  const waiting = loading && !message.content
  return (
    <div className="row assistant" id={`msg-${message.id}`}>
      <div className="assistant-body">
        {waiting ? <span className="typing" /> : null}
        {message.content ? (
          <Markdown content={message.content} streaming={loading} />
        ) : null}
        {!loading && !message.content ? (
          <p className="msg-empty">没有生成文字回复，可重新生成</p>
        ) : null}
        {done || interrupted ? (
          <div className={`msg-footer${interrupted ? ' has-resume' : ''}`}>
            {sources.length > 0 ? <SourceList sources={sources} /> : null}
            {done ? (
              <MessageActions>
                <CopyButton text={message.content} />
                {canRegenerate ? (
                  <button
                    type="button"
                    aria-label="重新生成"
                    title="重新生成"
                    disabled={busy}
                    onClick={() => onRegenerate?.(message.id)}
                  >
                    <RefreshIcon />
                  </button>
                ) : null}
              </MessageActions>
            ) : null}
            {interrupted ? (
              <button
                type="button"
                className="msg-resume"
                disabled={busy}
                onClick={() => onResume?.()}
              >
                继续生成
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function UserMessage({
  message,
  done,
  busy,
  onEditSubmit,
}: {
  message: ChatMessage
  done: boolean
  busy: boolean
  onEditSubmit?: (text: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  function resize() {
    const el = areaRef.current
    if (!el) return
    const wrap = el.parentElement
    const pin = wrap
      ? wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight <= 8
      : true
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
    if (wrap && pin) wrap.scrollTop = wrap.scrollHeight
  }

  useEffect(() => {
    if (!editing) return
    const el = areaRef.current
    if (!el) return
    el.focus()
    el.selectionStart = el.value.length
    el.selectionEnd = el.value.length
    resize()
  }, [editing])

  if (editing) {
    return (
      <div className="row user" id={`msg-${message.id}`}>
        <form
          className="inline-composer"
          onSubmit={(event) => {
            event.preventDefault()
            const text = draft.trim()
            if (!text || busy) return
            setEditing(false)
            onEditSubmit?.(text)
          }}
        >
          <div className="inline-composer-input">
            <textarea
              ref={areaRef}
              value={draft}
              rows={1}
              disabled={busy}
              onChange={(event) => {
                setDraft(event.target.value)
                resize()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setEditing(false)
                  setDraft(message.content)
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
            />
          </div>
          <div className="inline-composer-bar">
            <button
              type="button"
              className="inline-cancel"
              onClick={() => {
                setEditing(false)
                setDraft(message.content)
              }}
            >
              取消
            </button>
            <button type="submit" disabled={busy || !draft.trim()} aria-label="发送">
              <SendIcon />
            </button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div className="row user" id={`msg-${message.id}`}>
      <div className="user-block">
        <div className="bubble">{message.content}</div>
        {done ? (
          <MessageActions>
            <CopyButton text={message.content} />
            <button
              type="button"
              aria-label="重新编辑"
              title="重新编辑"
              disabled={busy}
              onClick={() => {
                setDraft(message.content)
                setEditing(true)
              }}
            >
              <EditIcon />
            </button>
          </MessageActions>
        ) : null}
      </div>
    </div>
  )
}

function MessageActions({ children }: { children: ReactNode }) {
  return <div className="msg-actions">{children}</div>
}

/**
 * 参考来源：回答里用到的知识库切片。
 *
 * 按钮和复制放在同一行，默认就显示。点开后，右侧面板按文件列出全部原文，不再折叠。
 * 文字直接铺开。摘录里的表格换成「表格」按钮，悬停后在按钮左侧弹出。
 *
 * 位置按「第134页」/「第134–135页」展示：按章节切块后同节内允许跨页聚合，
 * 约一半切片跨两页，只写起始页会让用户翻错页。
 */
function SourceList({ sources }: { sources: ChatSource[] }) {
  const [open, setOpen] = useState(false)
  const [tableTip, setTableTip] = useState<{ key: string; anchor: HTMLElement } | null>(null)
  const hideTipRef = useRef(0)
  const groups = groupSources(sources)
  const tableSource = sources.find((item) => item.key === tableTip?.key) ?? null

  function close() {
    window.clearTimeout(hideTipRef.current)
    setOpen(false)
    setTableTip(null)
  }

  function showTableTip(key: string, anchor: HTMLElement) {
    window.clearTimeout(hideTipRef.current)
    setTableTip({ key, anchor })
  }

  function queueHideTableTip() {
    window.clearTimeout(hideTipRef.current)
    hideTipRef.current = window.setTimeout(() => setTableTip(null), 140)
  }

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }
    function onPointer(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Element)) return
      if (
        target.closest('.msg-source-drawer') ||
        target.closest('.msg-sources-open') ||
        target.closest('.msg-source-popover')
      ) {
        return
      }
      close()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        className={`msg-sources-open${open ? ' is-open' : ''}`}
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        参考来源
        <span className="msg-sources-count">{sources.length}</span>
      </button>
      {open
        ? createPortal(
            <div className="msg-source-layer">
              <aside className="msg-source-drawer" role="dialog" aria-modal="false" aria-label="参考来源">
                <div className="msg-source-drawer-bar">
                  <div className="msg-source-drawer-title">
                    <span className="msg-source-file">参考来源</span>
                    <span className="msg-source-drawer-count">{sources.length} 条</span>
                  </div>
                  <button type="button" className="msg-source-drawer-close" aria-label="关闭" onClick={close}>
                    <CloseIcon />
                  </button>
                </div>
                <div className="msg-source-drawer-body">
                  <div className="msg-source-list">
                    {groups.map((group) => (
                      <section key={`${group.filename}:${group.items[0]?.source.key}`} className="msg-source-group">
                        <h3 className="msg-source-group-name" title={group.filename}>
                          {group.filename}
                        </h3>
                        <ul>
                          {group.items.map(({ source, index }) => (
                            <SourceCard
                              key={source.key}
                              source={source}
                              index={index}
                              tipOpen={tableTip?.key === source.key}
                              onTableEnter={(anchor) => showTableTip(source.key, anchor)}
                              onTableLeave={queueHideTableTip}
                            />
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                </div>
              </aside>
              {tableSource && tableTip ? (
                <TablePopover
                  source={tableSource}
                  anchor={tableTip.anchor}
                  onEnter={() => window.clearTimeout(hideTipRef.current)}
                  onLeave={queueHideTableTip}
                />
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

function SourceCard({
  source,
  index,
  tipOpen,
  onTableEnter,
  onTableLeave,
}: {
  source: ChatSource
  index: number
  tipOpen: boolean
  onTableEnter: (anchor: HTMLElement) => void
  onTableLeave: () => void
}) {
  const loc = sourceLocator(source)
  const kind = sourceKindLabel(source.kind)
  const prose = excerptProse(source.excerpt)
  const tableText = excerptTable(source.excerpt)
  const title = loc.section || (!prose ? sourcePreview(source.excerpt) || '原文' : null)

  return (
    <li>
      <div className="msg-source">
        <span className="msg-source-idx">{index + 1}</span>
        <span className="msg-source-main">
          <span className="msg-source-line">
            {title ? (
              <span className="msg-source-section" title={title}>
                {title}
              </span>
            ) : null}
            <span className="msg-source-meta">
              {kind && !tableText ? <span className="msg-source-tag">{kind}</span> : null}
              <span className="msg-source-where">{loc.where}</span>
            </span>
          </span>
        </span>
      </div>
      {prose ? <SourceExcerpt source={source} text={prose} /> : null}
      {tableText ? (
        <div className="msg-source-table-slot">
          <button
            type="button"
            className={`msg-source-table-btn${tipOpen ? ' is-open' : ''}`}
            onMouseEnter={(event) => onTableEnter(event.currentTarget)}
            onMouseLeave={onTableLeave}
          >
            表格
          </button>
        </div>
      ) : null}
    </li>
  )
}

/** 多级表头不能都吸在 top: 0，否则滚动时叠成一层。按每一行自己的高度往下排。 */
function stickHeaderRows(table: HTMLTableElement) {
  const rows = [...(table.tHead?.rows ?? [])]
  let offset = 0
  rows.forEach((row, index) => {
    const singles = [...row.cells].filter((cell) => cell.rowSpan <= 1)
    const rowHeight = singles.length
      ? Math.max(...singles.map((cell) => cell.getBoundingClientRect().height))
      : row.getBoundingClientRect().height
    for (const cell of row.cells) {
      cell.style.top = `${offset}px`
      cell.style.zIndex = String(3 + rows.length - index)
    }
    offset += rowHeight
  })
}

function TablePopover({
  source,
  anchor,
  onEnter,
  onLeave,
}: {
  source: ChatSource
  anchor: HTMLElement
  onEnter: () => void
  onLeave: () => void
}) {
  const popRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ left: 8, width: 320, arrow: 20, bridge: 24, scrollX: false })

  useLayoutEffect(() => {
    function place() {
      const pop = popRef.current
      const rect = anchor.getBoundingClientRect()
      const margin = 8
      const drawer = anchor.closest('.msg-source-drawer')
      const drawerLeft = drawer ? window.innerWidth - drawer.getBoundingClientRect().width : rect.left
      const limitRight = Math.max(margin + 160, drawerLeft - 12)
      const available = limitRight - margin
      const body = pop?.querySelector('.msg-source-popover-body') as HTMLElement | null
      const table = pop?.querySelector('table')
      const prev = {
        width: pop?.style.width ?? '',
        maxWidth: pop?.style.maxWidth ?? '',
        overflow: body?.style.overflow ?? '',
      }
      if (pop) {
        pop.style.width = 'max-content'
        pop.style.maxWidth = 'none'
      }
      if (body) body.style.overflow = 'visible'
      const intrinsic = Math.max(160, Math.ceil((table?.getBoundingClientRect().width ?? 296) + 24))
      if (pop) {
        pop.style.width = prev.width
        pop.style.maxWidth = prev.maxWidth
      }
      if (body) body.style.overflow = prev.overflow
      const width = Math.min(Math.max(intrinsic, Math.min(320, available)), available)
      const left = Math.max(margin, limitRight - width)
      const popHeight = pop?.offsetHeight ?? Math.min(300, window.innerHeight - margin * 2)
      const visualTop = Math.max(margin, (window.innerHeight - popHeight) / 2)
      const arrow = Math.min(
        Math.max(14, popHeight - 20),
        Math.max(14, rect.top + rect.height / 2 - visualTop - 6),
      )
      const bridge = Math.max(16, rect.right - (left + width))
      if (body) body.scrollLeft = 0
      setBox({ left, width, arrow, bridge, scrollX: intrinsic > width + 1 })
    }
    place()
    const scroller = anchor.closest('.msg-source-drawer-body')
    scroller?.addEventListener('scroll', place, { passive: true })
    window.addEventListener('resize', place)
    return () => {
      scroller?.removeEventListener('scroll', place)
      window.removeEventListener('resize', place)
    }
  }, [anchor])

  useLayoutEffect(() => {
    const table = popRef.current?.querySelector('table')
    if (table) stickHeaderRows(table)
  }, [box.width, box.scrollX, source.excerpt])

  return (
    <div
      ref={popRef}
      className="msg-source-popover"
      style={{
        left: box.left,
        width: box.width,
        maxWidth: box.width,
        ['--arrow' as string]: `${box.arrow}px`,
        ['--bridge' as string]: `${box.bridge}px`,
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div
        className={`msg-source-popover-body${box.scrollX ? ' is-scroll-x' : ''}`}
      >
        <div className="msg-source-body">
          <ChunkContent text={excerptTable(source.excerpt) || source.excerpt} />
        </div>
      </div>
    </div>
  )
}

function SourceExcerpt({ source, text }: { source: ChatSource; text: string }) {
  return (
    <div className="msg-source-excerpt">
      {source.kind === 'figure' ? <p className="msg-source-note">图像识别，可能有误差</p> : null}
      <div className="msg-source-body">
        <ChunkContent text={reflowExcerpt(text)} />
      </div>
    </div>
  )
}

/** 摘录里的正文：去掉 HTML 表和 Markdown 表，剩下的按文字显示。 */
function excerptProse(excerpt: string): string {
  return excerpt
    .replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, '')
    .split('\n')
    .filter((line) => !/^\s*\|/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 摘录里的表格：HTML 表和 Markdown 表单独交给弹出框。 */
function excerptTable(excerpt: string): string {
  const html = excerpt.match(/<table\b[^>]*>[\s\S]*?<\/table>/gi) ?? []
  const pipes = excerpt
    .split('\n')
    .filter((line) => /^\s*\|/.test(line))
    .join('\n')
    .trim()
  return [...html, pipes].filter(Boolean).join('\n\n')
}

function groupSources(sources: ChatSource[]) {
  const groups: { filename: string; items: { source: ChatSource; index: number }[] }[] = []
  sources.forEach((source, index) => {
    const last = groups[groups.length - 1]
    const item = { source, index }
    if (last && last.filename === source.filename) last.items.push(item)
    else groups.push({ filename: source.filename, items: [item] })
  })
  return groups
}

function sourceKindLabel(kind: string): string | null {
  if (kind === 'figure') return '图表'
  if (kind === 'table') return '表格'
  return null
}

/** 卡片上的两行摘要：去掉表格标记，把换行收成一句。 */
function sourcePreview(excerpt: string): string {
  const plain = excerpt
    .replace(/<[^>]+>/g, ' ')
    .split('\n')
    .filter((line) => !/^\s*\|/.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/…+$/g, '')
    .trim()
  return plain
}

/**
 * PDF 抽取常常一行一句。阅读页把段内换行接上，空行仍分段。
 * 英文单词之间补空格，中文直接相接。
 */
function reflowExcerpt(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) =>
      block
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .reduce((acc, line) => {
          if (!acc) return line
          const needSpace = /[A-Za-z0-9.,;:!?)]$/.test(acc) && /^[A-Za-z0-9(]/.test(line)
          return acc + (needSpace ? ' ' : '') + line
        }, ''),
    )
    .filter(Boolean)
    .join('\n\n')
}

/** 页码和章节拆开。旧图谱引用曾把「页码 · 章节」写进 where。 */
function sourceLocator(source: ChatSource): { where: string; section: string | null } {
  const raw = sourceWhere(source)
  const cut = raw.indexOf(' · ')
  const where = cut > 0 ? raw.slice(0, cut) : raw
  const fromWhere = cut > 0 ? raw.slice(cut + 3).trim() : ''
  return { where, section: source.section?.trim() || fromWhere || null }
}

/** PDF/Word 表格落在页上；旧引用把页码写成了「表43」，这里按页码显示。Excel 仍用表号。 */
function sourceWhere(source: ChatSource): string {
  if (source.kind !== 'table') return source.where
  const name = (source.filename || '').toLowerCase()
  if (/\.(xlsx|xlsm|xls|csv)$/.test(name)) return source.where
  const start = source.page_start ?? source.page
  const end = source.page_end ?? source.page
  if (start == null) return source.where || '表格'
  if (end != null && end !== start) return `第${start}–${end}页`
  return `第${start}页`
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef(0)

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  return (
    <button
      type="button"
      className={copied ? 'copied' : undefined}
      aria-label={copied ? '已复制' : '复制'}
      title={copied ? '已复制' : '复制'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          window.clearTimeout(timerRef.current)
          timerRef.current = window.setTimeout(() => setCopied(false), 1200)
        } catch {
          setCopied(false)
        }
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  )
}
