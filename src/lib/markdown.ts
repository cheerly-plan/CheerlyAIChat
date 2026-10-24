export type Inline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: Inline[] }
  | { type: 'break' }

export type Block =
  | { type: 'heading'; level: number; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'code'; lang: string; value: string }
  | { type: 'quote'; children: Inline[] }
  | { type: 'hr' }

const FENCE = /^\s*```/
const HEADING = /^(#{1,6})\s+(.+)$/
const UL = /^\s*[-*]\s+(.+)$/
const OL = /^\s*\d+\.\s+(.+)$/
const HR = /^---+$/
const LINK = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/

export function splitClosed(source: string, streaming: boolean) {
  const text = source.replace(/\r\n/g, '\n')
  if (!text) return { closed: '', pending: '' }
  if (!streaming) return { closed: text, pending: '' }

  let inFence = false
  let fenceStart = 0
  let offset = 0

  while (offset < text.length) {
    const nl = text.indexOf('\n', offset)
    const end = nl === -1 ? text.length : nl
    const line = text.slice(offset, end)
    if (FENCE.test(line)) {
      if (inFence) inFence = false
      else {
        inFence = true
        fenceStart = offset
      }
    }
    if (nl === -1) break
    offset = nl + 1
  }

  if (inFence) {
    return { closed: text.slice(0, fenceStart), pending: text.slice(fenceStart) }
  }

  if (!text.endsWith('\n')) {
    const lastNl = text.lastIndexOf('\n')
    if (lastNl === -1) return { closed: '', pending: text }
    return {
      closed: text.slice(0, lastNl + 1),
      pending: text.slice(lastNl + 1),
    }
  }

  return { closed: text, pending: '' }
}

export function parseBlocks(source: string): Block[] {
  if (!source) return []
  const lines = source.split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (line === undefined) break
    if (line === '') {
      i += 1
      continue
    }

    if (FENCE.test(line)) {
      const lang = line.replace(FENCE, '').trim()
      const body: string[] = []
      i += 1
      while (i < lines.length && !FENCE.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '')
        i += 1
      }
      i += 1
      blocks.push({ type: 'code', lang, value: body.join('\n') })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        children: parseInline(heading[2]),
      })
      i += 1
      continue
    }

    if (HR.test(line.trim())) {
      blocks.push({ type: 'hr' })
      i += 1
      continue
    }

    const ul = UL.exec(line)
    const ol = OL.exec(line)
    if (ul || ol) {
      const ordered = Boolean(ol)
      const items: Inline[][] = []
      while (i < lines.length) {
        const item = ordered ? OL.exec(lines[i] ?? '') : UL.exec(lines[i] ?? '')
        if (!item) break
        items.push(parseInline(item[1]))
        i += 1
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    if (line.startsWith('>')) {
      const quoted: string[] = []
      while (i < lines.length && (lines[i] ?? '').startsWith('>')) {
        quoted.push((lines[i] ?? '').replace(/^>\s?/, ''))
        i += 1
      }
      blocks.push({ type: 'quote', children: parseInline(quoted.join('\n')) })
      continue
    }

    const para: string[] = [line]
    i += 1
    while (i < lines.length && lines[i] !== '' && !isBlockStart(lines[i] ?? '')) {
      para.push(lines[i] ?? '')
      i += 1
    }
    blocks.push({
      type: 'paragraph',
      children: para.flatMap((part, index) =>
        index === 0 ? parseInline(part) : [{ type: 'break' }, ...parseInline(part)],
      ),
    })
  }

  return blocks
}

function isBlockStart(line: string) {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    HR.test(line.trim()) ||
    UL.test(line) ||
    OL.test(line) ||
    line.startsWith('>')
  )
}

export function parseInline(text: string): Inline[] {
  const nodes: Inline[] = []
  let buffer = ''
  let i = 0

  const flush = () => {
    if (!buffer) return
    nodes.push({ type: 'text', value: buffer })
    buffer = ''
  }

  while (i < text.length) {
    const char = text[i]
    if (char === '\\' && i + 1 < text.length) {
      buffer += text[i + 1]
      i += 2
      continue
    }

    if (char === '`') {
      const end = text.indexOf('`', i + 1)
      if (end !== -1) {
        flush()
        nodes.push({ type: 'code', value: text.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }

    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2)
      if (end !== -1) {
        flush()
        nodes.push({ type: 'strong', children: parseInline(text.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }

    if (char === '*') {
      const end = text.indexOf('*', i + 1)
      if (end !== -1) {
        flush()
        nodes.push({ type: 'em', children: parseInline(text.slice(i + 1, end)) })
        i = end + 1
        continue
      }
    }

    if (char === '[') {
      const link = LINK.exec(text.slice(i))
      if (link) {
        flush()
        nodes.push({
          type: 'link',
          href: link[2],
          children: parseInline(link[1]),
        })
        i += link[0].length
        continue
      }
    }

    buffer += char
    i += 1
  }

  flush()
  return nodes
}
