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

/** 卡片上的字数：HTML 标签不算，只数单元格文字。和切片时的 800 字上限同一把尺子。 */
export function visibleChunkLength(text: string): number {
  if (!/<table\b/i.test(text)) return text.length
  const plain = text.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (table) => {
    const lines: string[] = []
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
    let row: RegExpExecArray | null
    while ((row = rowRe.exec(table))) {
      const cells: string[] = []
      const cellRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi
      let cell: RegExpExecArray | null
      while ((cell = cellRe.exec(row[1] ?? ''))) {
        cells.push(cellPlain(cell[1] ?? ''))
      }
      const line = cells.join(' | ')
      if (line.trim()) lines.push(line)
    }
    return lines.join('\n')
  })
  return plain.trim().length
}

export function containsHtmlTable(text: string): boolean {
  return /<table[\s>]/i.test(text)
}
