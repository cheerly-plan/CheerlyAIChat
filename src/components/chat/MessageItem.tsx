import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ChatMessage, ChatSource } from '../../types'
import { CheckIcon, CopyIcon, EditIcon, RefreshIcon } from './icons'
import { Markdown } from './Markdown'

type Props = {
  message: ChatMessage
  loading?: boolean
  busy?: boolean
  canRegenerate?: boolean
  canResume?: boolean
  onEditSubmit?: (text: string) => void
  onRegenerate?: (id: string) => void
  onResume?: () => void
}

export function MessageItem({
  message,
  loading = false,
  busy = false,
  canRegenerate = false,
  canResume = false,
  onEditSubmit,
  onRegenerate,
  onResume,
}: Props) {
  const done = !loading && Boolean(message.content)
  const interrupted = canResume && !loading

  if (message.role === 'user') {
    return (
      <UserMessage
        message={message}
        done={done}
        busy={busy}
        onEditSubmit={onEditSubmit}
      />
    )
  }

  const toolRuns = message.tools ?? []
  const sources = message.sources ?? []
  const waiting = loading && !message.content && !toolRuns.length
  // 有工具记录但都在执行完、还没等到下一批 token：展示「正在思考」，
  // 避免工具已跑完还一直挂着「正在调用 xx」
  const thinking = loading && !message.content && toolRuns.length > 0
  // 多轮循环里模型可能重复调用同一工具（如连续两次搜索），展示时去重
  const runningLabels = [
    ...new Set(toolRuns.filter((tool) => tool.running).map((tool) => tool.label)),
  ].join('、')
  const statusText = runningLabels ? `正在调用 ${runningLabels}` : '正在思考…'
  return (
    <div className="row assistant" id={`msg-${message.id}`}>
      <div className="assistant-body">
        {thinking ? (
          <p className={runningLabels ? 'tool' : 'tool thinking'}>{statusText}</p>
        ) : null}
        {waiting ? <span className="typing" /> : null}
        {message.content ? (
          <Markdown content={message.content} streaming={loading} />
        ) : null}
        {sources.length > 0 && (done || interrupted) ? (
          <SourceList sources={sources} />
        ) : null}
        {done || interrupted ? (
          <MessageActions>
            {done ? <CopyButton text={message.content} /> : null}
            {canRegenerate ? (
              <button
                type="button"
                aria-label="重新生成"
                title="重新生成"
                disabled={busy}
                onClick={() => onRegenerate?.(message.id)}
              >
                <RefreshIcon />
              </button>
            ) : null}
            {interrupted ? (
              <button
                type="button"
                className="msg-resume"
                disabled={busy}
                onClick={() => onResume?.()}
              >
                继续生成
              </button>
            ) : null}
          </MessageActions>
        ) : null}
      </div>
    </div>
  )
}

function UserMessage({
  message,
  done,
  busy,
  onEditSubmit,
}: {
  message: ChatMessage
  done: boolean
  busy: boolean
  onEditSubmit?: (text: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  function resize() {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  useEffect(() => {
    if (!editing) return
    const el = areaRef.current
    if (!el) return
    el.focus()
    el.selectionStart = el.value.length
    el.selectionEnd = el.value.length
    resize()
  }, [editing])

  if (editing) {
    return (
      <div className="row user" id={`msg-${message.id}`}>
        <form
          className="inline-composer"
          onSubmit={(event) => {
            event.preventDefault()
            const text = draft.trim()
            if (!text || busy) return
            setEditing(false)
            onEditSubmit?.(text)
          }}
        >
          <textarea
            ref={areaRef}
            value={draft}
            rows={1}
            disabled={busy}
            onChange={(event) => {
              setDraft(event.target.value)
              resize()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                setEditing(false)
                setDraft(message.content)
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
          />
          <div className="inline-composer-bar">
            <button
              type="button"
              className="inline-cancel"
              onClick={() => {
                setEditing(false)
                setDraft(message.content)
              }}
            >
              取消
            </button>
            <button type="submit" disabled={busy || !draft.trim()} aria-label="发送">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path fill="currentColor" d="M12 4 5 11h4v9h6v-9h4z" />
              </svg>
            </button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div className="row user" id={`msg-${message.id}`}>
      <div className="user-block">
        <div className="bubble">{message.content}</div>
        {done ? (
          <MessageActions>
            <CopyButton text={message.content} />
            <button
              type="button"
              aria-label="重新编辑"
              title="重新编辑"
              disabled={busy}
              onClick={() => {
                setDraft(message.content)
                setEditing(true)
              }}
            >
              <EditIcon />
            </button>
          </MessageActions>
        ) : null}
      </div>
    </div>
  )
}

function MessageActions({ children }: { children: ReactNode }) {
  return <div className="msg-actions">{children}</div>
}

/**
 * 参考来源：回答里用到的知识库切片。
 *
 * 一排小卡片（编号 + 文件名 + 位置），点任意一张就在下面展开这段原文——
 * 用户想核实「这句话是从文档哪一段来的」，需要看到原文本身，而不是只看到
 * 文件名。默认全部收起：回答已经是主体，引用不该抢注意力。
 */
function SourceList({ sources }: { sources: ChatSource[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const active = sources.find((item) => item.key === openKey) ?? null

  return (
    <div className="msg-sources">
      <span className="msg-sources-label">参考来源</span>
      <div className="msg-sources-chips">
        {sources.map((source, index) => {
          const open = source.key === openKey
          return (
            <button
              key={source.key}
              type="button"
              className={`msg-source${open ? ' is-open' : ''}`}
              title={`${source.filename} · ${source.where}`}
              aria-expanded={open}
              onClick={() => setOpenKey(open ? null : source.key)}
            >
              <span className="msg-source-idx">{index + 1}</span>
              <span className="msg-source-name">{source.filename}</span>
              <span className="msg-source-where">{source.where}</span>
            </button>
          )
        })}
      </div>
      {active ? (
        <div className="msg-source-detail">
          <div className="msg-source-head">
            <span className="msg-source-file" title={active.filename}>
              {active.filename}
            </span>
            <span className="msg-source-where">{active.where}</span>
            {active.kind === 'figure' ? (
              <span className="msg-source-note">图像识别，可能有误差</span>
            ) : null}
          </div>
          <pre className="msg-source-text">{active.excerpt}</pre>
        </div>
      ) : null}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef(0)

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  return (
    <button
      type="button"
      className={copied ? 'copied' : undefined}
      aria-label={copied ? '已复制' : '复制'}
      title={copied ? '已复制' : '复制'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          window.clearTimeout(timerRef.current)
          timerRef.current = window.setTimeout(() => setCopied(false), 1200)
        } catch {
          setCopied(false)
        }
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  )
}
