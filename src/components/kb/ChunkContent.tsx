import { useMemo, type ReactNode } from 'react'
import { expandHtmlGrid, layoutTable, parseMarkdownRow, type LaidCell } from './tableGrid'

// 解析层的 Markdown 表、整页 OCR 的 HTML 表，都铺成同一套格子再画出来。
// 表头里被展开的重复字（两列都写「期末余额」）合并回跨列，和模型读到的行列一致。

type ContentBlock =
  | { kind: 'text'; text: string }
  | { kind: 'table'; rows: string[][] }

const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_SEP = /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/

function parseRow(line: string): string[] {
  return parseMarkdownRow(line)
}

function splitContent(text: string): ContentBlock[] {
  const blocks: ContentBlock[] = []
  let paragraph: string[] = []
  let rows: string[][] = []
  const flushText = () => {
    const joined = paragraph.join('\n').trim()
    if (joined) blocks.push({ kind: 'text', text: joined })
    paragraph = []
  }
  const flushTable = () => {
    if (rows.length) blocks.push({ kind: 'table', rows })
    rows = []
  }
  for (const line of text.split('\n')) {
    if (TABLE_ROW.test(line)) {
      flushText()
      if (!TABLE_SEP.test(line)) rows.push(parseRow(line))
      continue
    }
    flushTable()
    paragraph.push(line)
  }
  flushTable()
  flushText()
  return blocks
}

const HTML_TABLE = /<table\b[^>]*>[\s\S]*?<\/table>/gi
const HTML_ROW = /<tr\b[^>]*>[\s\S]*?<\/tr>/gi

function columnClass(limit: boolean, numeric = false) {
  const names = [limit ? 'kb-chunk-col1-cell' : '', numeric ? 'is-num' : ''].filter(Boolean)
  return names.join(' ') || undefined
}

function firstColumn(content: ReactNode, limit: boolean) {
  if (!limit) return content
  return <span className="kb-chunk-col1">{content}</span>
}

export function DataTable({
  rows,
  cell,
}: {
  rows: string[][]
  cell?: (row: number, col: number, text: string) => ReactNode
}) {
  const laid = useMemo(() => layoutTable(rows), [rows])
  if (!laid.some((row) => row.length)) return null
  const head = laid.filter((row) => row.some((item) => item.header))
  const body = laid.filter((row) => row.length > 0 && row.every((item) => !item.header))
  const renderRow = (row: LaidCell[], rowKey: number, header: boolean) => (
    <tr key={rowKey}>
      {row.map((item) => {
        const content = cell ? cell(item.row, item.col, item.text) : item.text || ' '
        const props = {
          className: columnClass(item.limitFirst, !header && item.numeric),
          rowSpan: item.rowSpan > 1 ? item.rowSpan : undefined,
          colSpan: item.colSpan > 1 ? item.colSpan : undefined,
          children: firstColumn(content, item.limitFirst),
        }
        return header ? <th key={item.col} {...props} /> : <td key={item.col} {...props} />
      })}
    </tr>
  )
  return (
    <div className="kb-chunk-table-wrap">
      <table className="kb-chunk-table">
        <thead>{head.map((row, index) => renderRow(row, index, true))}</thead>
        {body.length ? <tbody>{body.map((row, index) => renderRow(row, index, false))}</tbody> : null}
      </table>
    </div>
  )
}

export function HtmlTable({ html }: { html: string }) {
  const rows = useMemo(() => expandHtmlGrid(html), [html])
  return <DataTable rows={rows} />
}

type MixedBlock = { kind: 'html'; html: string } | { kind: 'text'; text: string }

function splitHtmlTables(text: string): MixedBlock[] {
  const blocks: MixedBlock[] = []
  let last = 0
  for (const match of text.matchAll(HTML_TABLE)) {
    const index = match.index ?? 0
    if (index > last) blocks.push({ kind: 'text', text: text.slice(last, index) })
    blocks.push({ kind: 'html', html: match[0] })
    last = index + match[0].length
  }
  if (blocks.some((block) => block.kind === 'html')) {
    if (last < text.length) blocks.push({ kind: 'text', text: text.slice(last) })
    return blocks
  }
  const salvaged = salvageHtmlTable(text)
  if (salvaged) return salvaged
  if (last < text.length) blocks.push({ kind: 'text', text: text.slice(last) })
  if (!blocks.length) blocks.push({ kind: 'text', text })
  return blocks
}

function salvageHtmlTable(text: string): MixedBlock[] | null {
  const start = text.search(/<table\b/i)
  if (start === -1) return null
  const rows = [...text.slice(start).matchAll(HTML_ROW)]
  if (!rows.length) return null
  const first = rows[0]
  const lastRow = rows[rows.length - 1]
  const lastEnd = (lastRow.index ?? 0) + lastRow[0].length
  const head = text
    .slice(0, start + (first.index ?? 0))
    .replace(/<table\b[^>]*>/i, '')
    .trim()
  const tail = text
    .slice(start + lastEnd)
    .replace(/<\/table>/i, '')
    .trim()
  const blocks: MixedBlock[] = []
  if (head) blocks.push({ kind: 'text', text: head })
  blocks.push({
    kind: 'html',
    html: `<table>${rows.map((row) => row[0]).join('')}</table>`,
  })
  if (tail && tail !== '…') blocks.push({ kind: 'text', text: tail })
  return blocks
}

export function ChunkContent({ text }: { text: string }) {
  const blocks = useMemo(() => splitHtmlTables(text), [text])
  return (
    <>
      {blocks.map((block, i) =>
        block.kind === 'html' ? (
          <HtmlTable html={block.html} key={i} />
        ) : (
          <PipeContent text={block.text} key={i} />
        ),
      )}
    </>
  )
}

function PipeContent({ text }: { text: string }) {
  const blocks = useMemo(() => splitContent(text), [text])
  return (
    <>
      {blocks.map((block, i) =>
        block.kind === 'table' ? (
          <DataTable rows={block.rows} key={i} />
        ) : (
          <div className="kb-chunk-text" key={i}>
            {block.text.split(/\n+/).map((para, j) => (
              <p className="kb-chunk-p" key={j}>
                {para}
              </p>
            ))}
          </div>
        ),
      )}
    </>
  )
}
