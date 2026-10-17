import { useEffect, useRef } from 'react'

type Props = {
  value: string
  loading: boolean
  onChange: (value: string) => void
  onSend: () => void
}

export function Composer({ value, loading, onChange, onSend }: Props) {
  const areaRef = useRef<HTMLTextAreaElement>(null)

  function resize() {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  useEffect(() => {
    resize()
  }, [value])

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault()
        onSend()
      }}
    >
      <textarea
        ref={areaRef}
        value={value}
        placeholder="给 Cheerly 发送消息"
        rows={1}
        disabled={loading}
        onChange={(event) => {
          onChange(event.target.value)
          resize()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            onSend()
          }
        }}
      />
      <div className="composer-bar">
        <div className="chips">
          <span className="chip">深度思考</span>
          <span className="chip">联网搜索</span>
        </div>
        <button type="submit" disabled={loading || !value.trim()} aria-label="发送">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path fill="currentColor" d="M12 4 5 11h4v9h6v-9h4z" />
          </svg>
        </button>
      </div>
    </form>
  )
}
