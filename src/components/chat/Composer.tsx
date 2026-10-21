import { useEffect, useRef } from 'react'
import { GlobeIcon, PaperclipIcon, SendIcon } from './icons'

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
        rows={2}
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
          <span className="chip">
            <GlobeIcon />
            智能搜索
          </span>
        </div>
        <div className="composer-actions">
          <button type="button" className="composer-attach" aria-label="上传附件" disabled={loading}>
            <PaperclipIcon />
          </button>
          <button type="submit" disabled={loading || !value.trim()} aria-label="发送">
            <SendIcon />
          </button>
        </div>
      </div>
    </form>
  )
}
