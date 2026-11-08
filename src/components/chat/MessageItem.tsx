import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ChatMessage, ChatSource } from '../../types'
import { CheckIcon, CopyIcon, EditIcon, RefreshIcon, SendIcon } from './icons'
import { Markdown } from './Markdown'
import { useChatSidePanel } from './ReportPreviewContext'

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
  const done = !loading && Boolean(message.content || message.sources?.length)
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

  const sources = message.sources ?? []
  const waiting = loading && !message.content
  const status = message.status?.trim() || ''
  return (
    <div className="row assistant" id={`msg-${message.id}`}>
      <div className="assistant-body">
        {waiting ? (
          <div className="msg-progress" role="status" aria-live="polite">
            {status ? <span className="msg-progress-text">{status}</span> : null}
            <span className="typing" />
          </div>
        ) : null}
        {message.content ? (
          <Markdown content={message.content} streaming={loading} />
        ) : null}
        {!loading && !message.content ? (
          <p className="msg-empty">没有生成文字回复，可重新生成</p>
        ) : null}
        {done || interrupted ? (
          <div className={`msg-footer${interrupted ? ' has-resume' : ''}`}>
            {sources.length > 0 ? <SourceList sources={sources} /> : null}
            {done ? (
              <MessageActions>
                <CopyButton text={message.content} />
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
              </MessageActions>
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
          </div>
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
    const wrap = el.parentElement
    const pin = wrap
      ? wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight <= 8
      : true
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
    if (wrap && pin) wrap.scrollTop = wrap.scrollHeight
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
          <div className="inline-composer-input">
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
          </div>
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
              <SendIcon />
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
 * 点开后由壳层右侧入流面板展示（与研报预览同一套交互）。
 */
function SourceList({ sources }: { sources: ChatSource[] }) {
  const { panel, openSources, close } = useChatSidePanel()
  const open =
    panel?.mode === 'sources' &&
    panel.sources.length === sources.length &&
    panel.sources.every((item, index) => item.key === sources[index]?.key)

  return (
    <button
      type="button"
      className={`msg-sources-open${open ? ' is-open' : ''}`}
      aria-expanded={open}
      onClick={() => (open ? close() : openSources(sources))}
    >
      参考来源
      <span className="msg-sources-count">{sources.length}</span>
    </button>
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
