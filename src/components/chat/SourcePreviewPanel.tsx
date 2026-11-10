import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChatSource } from '../../types'
import { ChunkContent } from '../kb/ChunkContent'
import { CloseIcon } from './icons'
import { useChatSidePanel } from './ReportPreviewContext'

export function SourcePreviewPanel() {
  const { panel, close } = useChatSidePanel()
  const [tableTip, setTableTip] = useState<{ key: string; anchor: HTMLElement } | null>(null)
  const hideTipRef = useRef(0)

  const open = panel?.mode === 'sources'
  const sources = open ? panel.sources : []
  const groups = groupSources(sources)
  const tableSource = sources.find((item) => item.key === tableTip?.key) ?? null

  function clearTip() {
    window.clearTimeout(hideTipRef.current)
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
    if (!open) {
      clearTip()
      return
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  return (
    <aside className="source-panel" role="dialog" aria-modal="false" aria-label="参考来源">
      <div className="source-panel-bar">
        <div className="source-panel-title">
          <span className="source-panel-name">参考来源</span>
          <span className="source-panel-count">{sources.length} 条</span>
        </div>
        <button
          type="button"
          className="source-panel-close"
          aria-label="关闭"
          onClick={close}
        >
          <CloseIcon />
        </button>
      </div>
      <div className="source-panel-body msg-source-drawer-body">
        <div className="msg-source-list">
          {groups.map((group) => (
            <section
              key={`${group.filename}:${group.items[0]?.source.key}`}
              className="msg-source-group"
            >
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
      {tableSource && tableTip ? (
        <TablePopover
          source={tableSource}
          anchor={tableTip.anchor}
          onEnter={() => window.clearTimeout(hideTipRef.current)}
          onLeave={queueHideTableTip}
        />
      ) : null}
    </aside>
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
      const panel = anchor.closest('.source-panel')
      const panelLeft = panel
        ? panel.getBoundingClientRect().left
        : window.innerWidth - 360
      const limitRight = Math.max(margin + 160, panelLeft - 12)
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
    const scroller = anchor.closest('.source-panel-body')
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
      <div className={`msg-source-popover-body${box.scrollX ? ' is-scroll-x' : ''}`}>
        <div className="msg-source-body">
          <ChunkContent text={excerptTable(source.excerpt) || source.excerpt} />
        </div>
      </div>
    </div>
  )
}

function excerptProse(excerpt: string): string {
  return excerpt
    .replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, '')
    .split('\n')
    .filter((line) => !/^\s*\|/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

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

function sourcePreview(excerpt: string): string {
  return excerpt
    .replace(/<[^>]+>/g, ' ')
    .split('\n')
    .filter((line) => !/^\s*\|/.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/…+$/g, '')
    .trim()
}

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

function sourceLocator(source: ChatSource): { where: string; section: string | null } {
  const raw = sourceWhere(source)
  const cut = raw.indexOf(' · ')
  const where = cut > 0 ? raw.slice(0, cut) : raw
  const fromWhere = cut > 0 ? raw.slice(cut + 3).trim() : ''
  return { where, section: source.section?.trim() || fromWhere || null }
}

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
