import { useMemo, type MouseEvent, type ReactNode } from 'react'
import { downloadReportFile } from '../../api'
import { parseBlocks, parseInline, splitClosed, type Block, type Inline } from '../../lib/markdown'
import { DataTable, HtmlTable } from '../kb/ChunkContent'
import { isReportFilePath, useReportPreview } from './ReportPreviewContext'

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
  const preview = useReportPreview()
  const { closed, pending } = useMemo(
    () => splitClosed(content, streaming),
    [content, streaming],
  )
  const pieces = useMemo(() => splitHtmlTables(closed), [closed])
  const pendingView = useMemo(() => {
    if (!pending) return null
    if (/^\s*```/.test(pending)) return pending
    return renderInline(parseInline(pending), preview.open)
  }, [pending, preview.open])

  return (
    <div className="markdown">
      {pieces.map((piece, index) =>
        piece.kind === 'html' ? (
          <HtmlTable html={piece.html} key={index} />
        ) : (
          parseBlocks(piece.text).map((block, blockIndex) => (
            <BlockView
              key={`${index}-${blockIndex}`}
              block={block}
              onOpenReport={preview.open}
            />
          ))
        ),
      )}
      {pendingView ? <span className="markdown-pending">{pendingView}</span> : null}
    </div>
  )
}

function BlockView({
  block,
  onOpenReport,
}: {
  block: Block
  onOpenReport: (path: string, label?: string) => void
}) {
  switch (block.type) {
    case 'heading': {
      const Tag = (`h${Math.min(block.level, 4)}`) as 'h1' | 'h2' | 'h3' | 'h4'
      return <Tag>{renderInline(block.children, onOpenReport)}</Tag>
    }
    case 'paragraph':
      return <p>{renderInline(block.children, onOpenReport)}</p>
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag>
          {block.items.map((item, index) => (
            <li key={index}>{renderInline(item, onOpenReport)}</li>
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
      return <blockquote>{renderInline(block.children, onOpenReport)}</blockquote>
    case 'hr':
      return <hr />
    case 'table': {
      const all = [block.header, ...block.rows]
      return (
        <DataTable
          rows={all.map((row) => row.map(inlinePlain))}
          cell={(row, col, text) =>
            renderInline(
              all[row]?.[col] ?? [{ type: 'text', value: text }],
              onOpenReport,
            )
          }
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

function onMarkdownLinkClick(
  event: MouseEvent<HTMLAnchorElement>,
  href: string,
  label: string,
  onOpenReport: (path: string, label?: string) => void,
) {
  // 站内 /v1/... 需要 Bearer；浏览器直开 <a> 不会带鉴权头。
  if (!href.startsWith('/v1/')) return
  event.preventDefault()
  // 研报产物：右侧预览（DeepSeek / 豆包式）；其它站内链仍走下载。
  if (isReportFilePath(href)) {
    onOpenReport(href, label || undefined)
    return
  }
  void downloadReportFile(href).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : '下载失败'
    window.alert(message)
  })
}

function renderInline(
  nodes: Inline[],
  onOpenReport: (path: string, label?: string) => void = () => undefined,
): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return node.value
      case 'strong':
        return <strong key={index}>{renderInline(node.children, onOpenReport)}</strong>
      case 'em':
        return <em key={index}>{renderInline(node.children, onOpenReport)}</em>
      case 'code':
        return <code key={index}>{node.value}</code>
      case 'link': {
        const label = inlinePlain(node.children).trim()
        return (
          <a
            key={index}
            href={node.href}
            target="_blank"
            rel="noreferrer"
            className={isReportFilePath(node.href) ? 'report-file-link' : undefined}
            title={isReportFilePath(node.href) ? '点击在右侧预览' : undefined}
            onClick={(event) =>
              onMarkdownLinkClick(event, node.href, label, onOpenReport)
            }
          >
            {renderInline(node.children, onOpenReport)}
          </a>
        )
      }
      case 'break':
        return <br key={index} />
    }
  })
}
