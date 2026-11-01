import { useMemo } from 'react'

// 解析层把 PDF/DOCX/Excel 的表格转成 Markdown 表格存进 text（列关系全靠
// 竖线撑着），这里再渲染回 <table>。不还原的话表格就是一串竖线文本，
// 销量、收入、占比三项根本对不上列。

type ContentBlock =
  | { kind: 'text'; text: string }
  | { kind: 'table'; rows: string[][] }

const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_SEP = /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/
const NUMERIC_CELL = /^[-+]?[\d,]+(\.\d+)?%?$/

function parseRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .replace(/\\\|/g, '@@PIPE@@')
    .split('|')
    .map((cell) => cell.replace(/@@PIPE@@/g, '|').trim())
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

type HtmlCell = { text: string; rowSpan: number; colSpan: number }

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function parseHtmlTable(html: string): HtmlCell[][] {
  const rows: HtmlCell[][] = []
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRe.exec(html))) {
    const cells: HtmlCell[] = []
    const cellRe = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi
    let cellMatch: RegExpExecArray | null
    const rowHtml = rowMatch[1] ?? ''
    while ((cellMatch = cellRe.exec(rowHtml))) {
      const attrs = cellMatch[1] ?? ''
      const rowSpan = Number(/rowspan="(\d+)"/i.exec(attrs)?.[1] ?? 1)
      const colSpan = Number(/colspan="(\d+)"/i.exec(attrs)?.[1] ?? 1)
      cells.push({
        text: decodeEntities(cellMatch[2] ?? ''),
        rowSpan: rowSpan > 0 ? rowSpan : 1,
        colSpan: colSpan > 0 ? colSpan : 1,
      })
    }
    if (cells.length) rows.push(cells)
  }
  return rows
}

export function containsHtmlTable(text: string): boolean {
  return /<table[\s>]/i.test(text)
}

export function HtmlTable({ html }: { html: string }) {
  const rows = parseHtmlTable(html)
  if (!rows.length) return null
  const headSpan = Math.max(1, ...rows[0].map((cell) => cell.rowSpan))
  const headCount = Math.min(headSpan, rows.length)
  const head = rows.slice(0, headCount)
  const body = rows.slice(headCount)
  return (
    <div className="kb-chunk-table-wrap">
      <table className="kb-chunk-table">
        <thead>
          {head.map((row, j) => (
            <tr key={j}>
              {row.map((cell, k) => (
                <th
                  key={k}
                  rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                  colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                >
                  {cell.text || ' '}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        {body.length ? (
          <tbody>
            {body.map((row, j) => (
              <tr key={j}>
                {row.map((cell, k) => (
                  <td
                    key={k}
                    rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                    colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                    className={NUMERIC_CELL.test(cell.text) ? 'is-num' : undefined}
                  >
                    {cell.text}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ) : null}
      </table>
    </div>
  )
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
          <div className="kb-chunk-table-wrap" key={i}>
            <table className="kb-chunk-table">
              <thead>
                <tr>
                  {block.rows[0].map((cell, j) => (
                    <th key={j}>{cell || ' '}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.slice(1).map((row, j) => (
                  <tr key={j}>
                    {row.map((cell, k) => (
                      <td
                        key={k}
                        className={NUMERIC_CELL.test(cell) ? 'is-num' : undefined}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
