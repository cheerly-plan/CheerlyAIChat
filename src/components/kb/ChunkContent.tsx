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

export function ChunkContent({ text }: { text: string }) {
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
