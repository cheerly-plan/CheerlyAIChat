import { useMemo, type MouseEvent, type ReactNode } from 'react'
import { downloadReportFile } from '../../api'
import { parseBlocks, parseInline, splitClosed, type Block, type Inline } from '../../lib/markdown'
import { DataTable, HtmlTable } from '../kb/ChunkContent'
import {
  looksLikeBrokenReportLink,
  resolveReportFilePath,
  useReportPreview,
} from './ReportPreviewContext'

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
  const reportPath = resolveReportFilePath(href)
  if (reportPath) {
    event.preventDefault()
    onOpenReport(reportPath, label || undefined)
    return
  }
  // 模型把研报链改成 example.com 等外链时，拦住新标签页，避免跳到示例域名。
  if (looksLikeBrokenReportLink(href, label)) {
    event.preventDefault()
    window.alert(
      '这条下载链接已被模型改写，无法预览。请重新生成回答，或到报告目录打开对应文件。',
    )
    return
  }
  // 其它站内 /v1/... 需要 Bearer；浏览器直开 <a> 不会带鉴权头。
  if (!href.startsWith('/v1/')) return
  event.preventDefault()
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
        const reportPath = resolveReportFilePath(node.href)
        const broken = !reportPath && looksLikeBrokenReportLink(node.href, label)
        return (
          <a
            key={index}
            href={reportPath || node.href}
            target="_blank"
            rel="noreferrer"
            className={
              reportPath || broken ? 'report-file-link' : undefined
            }
            title={
              reportPath
                ? '点击在右侧预览'
                : broken
                  ? '链接已被改写，点击查看说明'
                  : undefined
            }
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
