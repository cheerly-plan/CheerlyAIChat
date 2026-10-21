import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ChatMessage } from '../../types'
import { CopyIcon, EditIcon, RefreshIcon } from './icons'
import { Markdown } from './Markdown'

type Props = {
  message: ChatMessage
  loading?: boolean
  busy?: boolean
  canRegenerate?: boolean
  onEditSubmit?: (text: string) => void
  onRegenerate?: (id: string) => void
}

export function MessageItem({
  message,
  loading = false,
  busy = false,
  canRegenerate = false,
  onEditSubmit,
  onRegenerate,
}: Props) {
  const done = !loading && Boolean(message.content)

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

  const waiting = loading && !message.content && !message.tools?.length
  const thinking = loading && Boolean(message.tools?.length) && !message.content
  return (
    <div className="row assistant" id={`msg-${message.id}`}>
      <div className="assistant-body">
        {thinking ? <p className="tool">正在调用 {message.tools?.join('、')}</p> : null}
        {waiting ? <span className="typing" /> : null}
        {message.content ? (
          <Markdown content={message.content} streaming={loading} />
        ) : null}
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
    setDraft(message.content)
    const el = areaRef.current
    if (!el) return
    el.focus()
    el.selectionStart = el.value.length
    el.selectionEnd = el.value.length
    resize()
  }, [editing, message.content])

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
              onClick={() => setEditing(true)}
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      type="button"
      aria-label={copied ? '已复制' : '复制'}
      title={copied ? '已复制' : '复制'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        } catch {
          setCopied(false)
        }
      }}
    >
      <CopyIcon />
    </button>
  )
}
