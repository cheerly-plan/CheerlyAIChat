// 和后端 html_tables_to_markdown 同一套格子：colspan / rowspan 铺开，
// 分组标题（「流动资产：」）只留在第一列。展示时再把表头里相邻的重复字合并回去。

const HTML_TABLE = /<table\b[^>]*>[\s\S]*?<\/table>/gi
const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_SEP = /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/
const NUMERIC_CELL = /^[-+－—]?\(?[\d,，]+(\.\d+)?\)?%?$/

export type LaidCell = {
  text: string
  row: number
  col: number
  rowSpan: number
  colSpan: number
  header: boolean
  numeric: boolean
  limitFirst: boolean
}

type Slot = {
  text: string
  rowSpan: number
  colSpan: number
  skip: boolean
  header: boolean
  row: number
  col: number
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function cellPlain(raw: string): string {
  return decodeEntities(raw.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}

function spanAttr(attrs: string, name: string): number {
  const found = new RegExp(`${name}=["'](\\d+)["']`, 'i').exec(attrs)
  const value = Number(found?.[1] ?? 1)
  return value > 0 ? value : 1
}

function isSectionRow(row: string[]): boolean {
  const filled = row.map((cell) => cell.trim()).filter(Boolean)
  return filled.length === 1 && /[：:]$/.test(filled[0])
}

function isHeaderRow(row: string[]): boolean {
  if (isSectionRow(row)) return false
  const filled = row.map((cell) => cell.trim()).filter(Boolean)
  if (filled.length < 2 || filled.some((cell) => NUMERIC_CELL.test(cell))) return false
  return filled.some((cell) => /[\u4e00-\u9fff]/.test(cell))
}

export function expandHtmlGrid(html: string): string[][] {
  const parsed: { text: string; colspan: number; rowspan: number }[][] = []
  for (const rowMatch of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells: { text: string; colspan: number; rowspan: number }[] = []
    for (const cellMatch of (rowMatch[1] ?? '').matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
      const attrs = cellMatch[1] ?? ''
      cells.push({
        text: cellPlain(cellMatch[2] ?? ''),
        colspan: spanAttr(attrs, 'colspan'),
        rowspan: spanAttr(attrs, 'rowspan'),
      })
    }
    if (cells.length) parsed.push(cells)
  }

  const grid: (string | null)[][] = []
  parsed.forEach((cells, rowIndex) => {
    const sectionRow = isSectionRow(cells.map((cell) => cell.text))
    let column = 0
    for (const cell of cells) {
      while (column < (grid[rowIndex]?.length ?? 0) && grid[rowIndex][column] != null) column += 1
      const section = sectionRow && cell.colspan > 1
      for (let down = 0; down < cell.rowspan; down += 1) {
        while (grid.length <= rowIndex + down) grid.push([])
        const target = grid[rowIndex + down]
        while (target.length < column + cell.colspan) target.push(null)
        for (let offset = 0; offset < cell.colspan; offset += 1) {
          if (target[column + offset] == null) {
            target[column + offset] = section && offset ? '' : cell.text
          }
        }
      }
      column += cell.colspan
    }
  })

  const width = Math.max(0, ...grid.map((row) => row.length))
  return grid.map((row) => [
    ...row.map((cell) => cell ?? ''),
    ...Array(Math.max(0, width - row.length)).fill(''),
  ])
}

export function htmlTablesToMarkdown(text: string): string {
  if (!/<table\b/i.test(text)) return text
  return text.replace(HTML_TABLE, (table) => {
    const grid = expandHtmlGrid(table)
    if (!grid.length || !grid[0]?.length) return table
    const width = Math.max(...grid.map((row) => row.length))
    const line = (row: string[]) =>
      `| ${[...row, ...Array(width - row.length).fill('')].map((cell) => cell.replace(/\|/g, '\\|')).join(' | ')} |`
    const separator = `| ${Array(width).fill('---').join(' | ')} |`
    return [line(grid[0]), separator, ...grid.slice(1).map(line)].join('\n')
  })
}

export function parseMarkdownRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .replace(/\\\|/g, '\u0000')
    .split('|')
    .map((cell) => cell.replaceAll('\u0000', '|').trim())
}

export function containsMarkdownTable(text: string): boolean {
  const lines = text.split('\n')
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (TABLE_ROW.test(lines[index] ?? '') && TABLE_SEP.test(lines[index + 1] ?? '')) return true
  }
  return false
}

/** 卡片字数：HTML 标签和 Markdown 分隔行都不算。 */
export function visibleTableLength(text: string): number {
  const lines = htmlTablesToMarkdown(text).split('\n')
  const out: string[] = []
  let index = 0
  let changed = false
  while (index < lines.length) {
    const next = lines[index + 1] ?? ''
    if (TABLE_ROW.test(lines[index] ?? '') && TABLE_SEP.test(next)) {
      changed = true
      while (index < lines.length && TABLE_ROW.test(lines[index] ?? '')) {
        if (!TABLE_SEP.test(lines[index] ?? '')) {
          const joined = parseMarkdownRow(lines[index] ?? '').join(' | ')
          if (joined.trim()) out.push(joined)
        }
        index += 1
      }
      continue
    }
    out.push(lines[index] ?? '')
    index += 1
  }
  return (changed ? out.join('\n') : lines.join('\n')).trim().length
}

export function layoutTable(rows: string[][]): LaidCell[][] {
  if (!rows.length) return []
  const width = Math.max(...rows.map((row) => row.length))
  const grid = rows.map((row) => {
    const cells = row.map((cell) => cell.trim())
    while (cells.length < width) cells.push('')
    return cells
  })

  let headerCount = 0
  while (headerCount < grid.length && isHeaderRow(grid[headerCount])) headerCount += 1
  if (headerCount === 0) headerCount = 1

  const slots: Slot[][] = grid.map((row, rowIndex) =>
    row.map((text, col) => ({
      text,
      rowSpan: 1,
      colSpan: 1,
      skip: false,
      header: rowIndex < headerCount,
      row: rowIndex,
      col,
    })),
  )

  for (let rowIndex = 0; rowIndex < headerCount; rowIndex += 1) {
    let col = 0
    while (col < width) {
      const text = slots[rowIndex][col].text
      if (!text) {
        col += 1
        continue
      }
      let span = 1
      while (col + span < width && slots[rowIndex][col + span].text === text) span += 1
      slots[rowIndex][col].colSpan = span
      for (let offset = 1; offset < span; offset += 1) slots[rowIndex][col + offset].skip = true
      col += span
    }
  }

  for (let rowIndex = 1; rowIndex < headerCount; rowIndex += 1) {
    for (let col = 0; col < width; col += 1) {
      const current = slots[rowIndex][col]
      if (current.skip || !current.text) continue
      let aboveIndex = rowIndex - 1
      while (aboveIndex >= 0 && slots[aboveIndex][col].skip) aboveIndex -= 1
      if (aboveIndex < 0) continue
      const above = slots[aboveIndex][col]
      if (above.skip || above.text !== current.text || above.colSpan !== current.colSpan) continue
      above.rowSpan += current.rowSpan
      current.skip = true
    }
  }

  for (let rowIndex = headerCount; rowIndex < slots.length; rowIndex += 1) {
    if (!isSectionRow(grid[rowIndex])) continue
    const first = slots[rowIndex].findIndex((cell) => cell.text)
    if (first < 0) continue
    slots[rowIndex][first].colSpan = width - first
    for (let col = first + 1; col < width; col += 1) slots[rowIndex][col].skip = true
  }

  return slots.map((row) =>
    row
      .filter((cell) => !cell.skip)
      .map((cell) => ({
        text: cell.text,
        row: cell.row,
        col: cell.col,
        rowSpan: cell.rowSpan,
        colSpan: cell.colSpan,
        header: cell.header,
        numeric: NUMERIC_CELL.test(cell.text),
        limitFirst: cell.col === 0 && cell.colSpan <= 1,
      })),
  )
}
