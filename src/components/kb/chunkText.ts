import { containsMarkdownTable, visibleTableLength } from './tableGrid'

export { containsMarkdownTable }

/** 卡片上的字数：HTML 标签和 Markdown 分隔行不算，和切片时的字数同一把尺子。 */
export function visibleChunkLength(text: string): number {
  return visibleTableLength(text)
}

export function containsHtmlTable(text: string): boolean {
  return /<table[\s>]/i.test(text)
}

export function containsTable(text: string): boolean {
  return containsHtmlTable(text) || containsMarkdownTable(text)
}
