import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../../types'
import { ChevronDownIcon } from './icons'
import { Logo } from './Logo'
import { MessageItem } from './MessageItem'

const SUGGESTS = ['北京今天天气怎么样？', '用一句话介绍你自己', '帮我写一份周报提纲']
const PIN_GAP = 32

type Props = {
  messages: ChatMessage[]
  loading: boolean
  onSuggest: (text: string) => void
  onEditSubmit: (text: string) => void
  onRegenerate: (id: string) => void
}

export function MessageList({
  messages,
  loading,
  onSuggest,
  onEditSubmit,
  onRegenerate,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const programmatic = useRef(false)
  const count = useRef(0)
  const [showJump, setShowJump] = useState(false)
  const last = messages[messages.length - 1]

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

  function syncFromUser() {
    const el = ref.current
    if (!el || programmatic.current) return
    const atBottom = distanceFromBottom(el) <= PIN_GAP
    pinned.current = atBottom
    setShowJump(!atBottom)
  }

  useEffect(() => {
    if (messages.length > count.current) {
      pinned.current = true
      setShowJump(false)
    }
    count.current = messages.length
    followBottom()
  }, [messages, loading])

  if (messages.length === 0) {
    return (
      <div className="list empty-list">
        <div className="hello">
          <Logo size={72} />
          <h1>有什么可以帮您的吗？</h1>
          <div className="suggests">
            {SUGGESTS.map((item) => (
              <button key={item} type="button" onClick={() => onSuggest(item)}>
                {item}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="list-wrap">
      <div
        className="list"
        ref={ref}
        onScroll={syncFromUser}
        onWheel={(event) => {
          if (event.deltaY < 0) {
            pinned.current = false
            setShowJump(true)
            return
          }
          requestAnimationFrame(syncFromUser)
        }}
        onTouchMove={() => {
          pinned.current = false
          requestAnimationFrame(syncFromUser)
        }}
      >
        {messages.map((message) => (
          <MessageItem
            key={message.id}
            message={message}
            loading={loading && message.id === last?.id}
            busy={loading}
            onEditSubmit={onEditSubmit}
            onRegenerate={onRegenerate}
          />
        ))}
      </div>
      {showJump ? (
        <button type="button" className="jump-bottom" aria-label="滚动到底部" onClick={jumpToBottom}>
          <ChevronDownIcon />
        </button>
      ) : null}
    </div>
  )
}
