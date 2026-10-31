import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage } from '../../types'
import { buildSessionTurns } from '../../lib/sessionTurns'
import { ChevronDownIcon } from './icons'
import { MessageItem } from './MessageItem'
import { SessionOutline } from './SessionOutline'

const PIN_GAP = 32

type Props = {
  messages: ChatMessage[]
  loading: boolean
  historyLoading?: boolean
  hasMore?: boolean
  onEditSubmit: (text: string) => void
  onRegenerate: (id: string) => void
  onResume?: () => void
  canResume?: boolean
  onLoadOlder?: () => void
}

export function MessageList({
  messages,
  loading,
  historyLoading = false,
  hasMore = false,
  onEditSubmit,
  onRegenerate,
  onResume,
  canResume = false,
  onLoadOlder,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null)
  const pinned = useRef(true)
  const programmatic = useRef(false)
  const count = useRef(0)
  const firstId = useRef<string | undefined>(undefined)
  const prevHeight = useRef(0)
  const [showJump, setShowJump] = useState(false)
  const last = messages[messages.length - 1]
  const turns = useMemo(() => buildSessionTurns(messages), [messages])
  const showOutline = turns.length >= 2

  function jumpToTurn(id: string) {
    const el = ref.current
    const target = document.getElementById(`msg-${id}`)
    if (!el || !target) return
    pinned.current = false
    setShowJump(true)
    programmatic.current = true
    el.scrollTop +=
      target.getBoundingClientRect().top - el.getBoundingClientRect().top - 12
    queueMicrotask(() => {
      programmatic.current = false
    })
  }

  function distanceFromBottom(el: HTMLDivElement) {
    return el.scrollHeight - el.scrollTop - el.clientHeight
  }

  function followBottom() {
    const el = ref.current
    if (!el || !pinned.current) return
    programmatic.current = true
    el.scrollTop = el.scrollHeight
    queueMicrotask(() => {
      programmatic.current = false
    })
  }

  function jumpToBottom() {
    const el = ref.current
    if (!el) return
    pinned.current = true
    setShowJump(false)
    programmatic.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    window.setTimeout(() => {
      programmatic.current = false
      followBottom()
    }, 320)
  }

  function maybeLoadOlder(el: HTMLDivElement) {
    if (!hasMore || historyLoading || !onLoadOlder) return
    if (el.scrollTop <= PIN_GAP) onLoadOlder()
  }

  function syncFromUser() {
    const el = ref.current
    if (!el || programmatic.current) return
    const atBottom = distanceFromBottom(el) <= PIN_GAP
    pinned.current = atBottom
    setShowJump(!atBottom)
    maybeLoadOlder(el)
  }

  useLayoutEffect(() => {
    const el = ref.current
    const currentFirst = messages[0]?.id
    const prepended =
      Boolean(currentFirst) &&
      Boolean(firstId.current) &&
      currentFirst !== firstId.current &&
      messages.length > count.current

    if (prepended && el) {
      el.scrollTop += el.scrollHeight - prevHeight.current
    } else if (messages.length > count.current) {
      pinned.current = true
      setShowJump(false)
      followBottom()
    } else {
      followBottom()
    }

    firstId.current = currentFirst
    count.current = messages.length
    prevHeight.current = el?.scrollHeight ?? 0
  }, [messages, loading, historyLoading])

  if (messages.length === 0) {
    return <div className="list empty-list" />
  }

  return (
    <div className={`list-wrap${showOutline ? ' has-session-outline' : ''}`}>
      {showOutline ? (
        <SessionOutline
          items={turns}
          scrollRoot={scrollRoot}
          onJump={jumpToTurn}
        />
      ) : null}
      <div
        className="list"
        ref={(el) => {
          ref.current = el
          if (el !== scrollRoot) setScrollRoot(el)
        }}
        onScroll={syncFromUser}
        onWheel={(event) => {
          if (event.deltaY < 0) {
            pinned.current = false
            setShowJump(true)
          }
          requestAnimationFrame(syncFromUser)
        }}
        onTouchMove={() => {
          pinned.current = false
          requestAnimationFrame(syncFromUser)
        }}
      >
        <div className="list-inner">
          {hasMore ? (
            <div className="load-older">
              <button type="button" disabled={historyLoading} onClick={onLoadOlder}>
                {historyLoading ? '加载中…' : '加载更早消息'}
              </button>
            </div>
          ) : null}
          {messages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              loading={loading && message.id === last?.id}
              busy={loading}
              canRegenerate={message.id === last?.id && last?.role === 'assistant'}
              canResume={
                canResume &&
                !loading &&
                message.id === last?.id &&
                last?.role === 'assistant'
              }
              onEditSubmit={onEditSubmit}
              onRegenerate={onRegenerate}
              onResume={onResume}
            />
          ))}
          {canResume && !loading && last?.role !== 'assistant' ? (
            <div className="row assistant">
              <div className="assistant-body">
                <div className="msg-footer has-resume">
                  <button
                    type="button"
                    className="msg-resume"
                    onClick={() => onResume?.()}
                  >
                    继续生成
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {showJump ? (
        <button type="button" className="jump-bottom" aria-label="滚动到底部" onClick={jumpToBottom}>
          <ChevronDownIcon />
        </button>
      ) : null}
    </div>
  )
}
