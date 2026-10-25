import { useEffect, useRef, useState } from 'react'
import type { SessionTurn } from '../../lib/sessionTurns'

type Props = {
  items: SessionTurn[]
  scrollRoot: HTMLElement | null
  onJump: (id: string) => void
}

export function SessionOutline({ items, scrollRoot, onJump }: Props) {
  const railRef = useRef<HTMLDivElement>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [hover, setHover] = useState<{ id: string; top: number } | null>(null)

  // 窗口切到后台时清掉预览：Cmd+Tab 切走时鼠标可能悬在刻度上，
  // onMouseLeave 不会触发，切回来弹窗会残留在屏幕上
  useEffect(() => {
    const clear = () => setHover(null)
    window.addEventListener('blur', clear)
    document.addEventListener('visibilitychange', clear)
    return () => {
      window.removeEventListener('blur', clear)
      document.removeEventListener('visibilitychange', clear)
    }
  }, [])

  useEffect(() => {
    if (!scrollRoot) return

    function read() {
      const root = scrollRoot
      if (!root) return
      const rootRect = root.getBoundingClientRect()
      const next: string[] = []

      for (const item of items) {
        const nodes = [
          document.getElementById(`msg-${item.id}`),
          item.replyId ? document.getElementById(`msg-${item.replyId}`) : null,
        ]
        const visible = nodes.some((node) => {
          if (!node) return false
          const rect = node.getBoundingClientRect()
          return rect.bottom > rootRect.top + 8 && rect.top < rootRect.bottom - 8
        })
        if (visible) next.push(item.id)
      }

      setSelectedIds(next)
    }

    read()
    scrollRoot.addEventListener('scroll', read, { passive: true })
    window.addEventListener('resize', read)
    const observer = new ResizeObserver(read)
    observer.observe(scrollRoot)
    return () => {
      scrollRoot.removeEventListener('scroll', read)
      window.removeEventListener('resize', read)
      observer.disconnect()
    }
  }, [items, scrollRoot])

  const preview = hover ? items.find((item) => item.id === hover.id) : null
  const selected = new Set(selectedIds)

  if (items.length < 2) return null

  function markHover(id: string, target: HTMLElement) {
    const rail = railRef.current
    if (!rail) return
    const tick = target.getBoundingClientRect()
    const box = rail.getBoundingClientRect()
    setHover({
      id,
      top: tick.top - box.top + tick.height / 2,
    })
  }

  return (
    <div
      className="session-outline"
      ref={railRef}
      onMouseLeave={() => setHover(null)}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`session-outline-tick${selected.has(item.id) ? ' active' : ''}${item.id === hover?.id ? ' hover' : ''}`}
          aria-label={item.title}
          onMouseEnter={(event) => markHover(item.id, event.currentTarget)}
          onFocus={(event) => {
            // 只响应键盘导航（Tab）触发的焦点：点过的刻度保持 DOM 焦点，
            // 窗口切走再切回来时浏览器会补发 focus，但不带 :focus-visible，
            // 用这个区分，避免 Cmd+Tab 切回应用时弹出幽灵预览
            if (event.currentTarget.matches(':focus-visible')) {
              markHover(item.id, event.currentTarget)
            }
          }}
          onBlur={() => setHover(null)}
          onClick={() => {
            setHover(null)
            onJump(item.id)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setHover(null)
              event.currentTarget.blur()
            }
          }}
        />
      ))}
      {preview && hover ? (
        <div className="session-outline-preview" style={{ top: hover.top }}>
          <p className="session-outline-preview-title">{preview.title}</p>
          {preview.excerpt ? (
            <p className="session-outline-preview-excerpt">{preview.excerpt}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
