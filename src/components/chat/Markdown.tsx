import { useMemo, type ReactNode } from 'react'
import { parseBlocks, parseInline, splitClosed, type Block, type Inline } from '../../lib/markdown'
import { DataTable, HtmlTable } from '../kb/ChunkContent'

const HTML_TABLE = /<table\b[^>]*>[\s\S]*?<\/table>/gi

type Piece = { kind: 'html'; html: string } | { kind: 'text'; text: string }

function splitHtmlTables(source: string): Piece[] {
  const pieces: Piece[] = []
  let last = 0
  for (const match of source.matchAll(HTML_TABLE)) {
    const index = match.index ?? 0
    if (index > last) pieces.push({ kind: 'text', text: source.slice(last, index) })
    pieces.push({ kind: 'html', html: match[0] })
    last = index + match[0].length
  }
  if (last < source.length) pieces.push({ kind: 'text', text: source.slice(last) })
  if (!pieces.length) pieces.push({ kind: 'text', text: source })
  return pieces
}

type Props = {
  content: string
  streaming?: boolean
}

export function Markdown({ content, streaming = false }: Props) {
  const { closed, pending } = useMemo(
    () => splitClosed(content, streaming),
    [content, streaming],
  )
  const pieces = useMemo(() => splitHtmlTables(closed), [closed])
  const pendingView = useMemo(() => {
    if (!pending) return null
    if (/^\s*```/.test(pending)) return pending
    return renderInline(parseInline(pending))
  }, [pending])

  return (
    <div className="markdown">
      {pieces.map((piece, index) =>
        piece.kind === 'html' ? (
          <HtmlTable html={piece.html} key={index} />
        ) : (
          parseBlocks(piece.text).map((block, blockIndex) => (
            <BlockView key={`${index}-${blockIndex}`} block={block} />
          ))
        ),
      )}
      {pendingView ? <span className="markdown-pending">{pendingView}</span> : null}
    </div>
  )
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'heading': {
      const Tag = (`h${Math.min(block.level, 4)}`) as 'h1' | 'h2' | 'h3' | 'h4'
      return <Tag>{renderInline(block.children)}</Tag>
    }
    case 'paragraph':
      return <p>{renderInline(block.children)}</p>
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag>
          {block.items.map((item, index) => (
            <li key={index}>{renderInline(item)}</li>
          ))}
        </Tag>
      )
    }
    case 'code':
      return (
        <pre>
          <code>{block.value}</code>
        </pre>
      )
    case 'quote':
      return <blockquote>{renderInline(block.children)}</blockquote>
    case 'hr':
      return <hr />
    case 'table': {
      const all = [block.header, ...block.rows]
      return (
        <DataTable
          rows={all.map((row) => row.map(inlinePlain))}
          cell={(row, col, text) => renderInline(all[row]?.[col] ?? [{ type: 'text', value: text }])}
        />
      )
    }
  }
}

function inlinePlain(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'code':
          return node.value
        case 'break':
          return ' '
        case 'strong':
        case 'em':
        case 'link':
          return inlinePlain(node.children)
      }
    })
    .join('')
}

function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return node.value
      case 'strong':
        return <strong key={index}>{renderInline(node.children)}</strong>
      case 'em':
        return <em key={index}>{renderInline(node.children)}</em>
      case 'code':
        return <code key={index}>{node.value}</code>
      case 'link':
        return (
          <a key={index} href={node.href} target="_blank" rel="noreferrer">
            {renderInline(node.children)}
          </a>
        )
      case 'break':
        return <br key={index} />
    }
  })
}
