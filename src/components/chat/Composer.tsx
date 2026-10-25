import { useEffect, useRef } from 'react'
import { PaperclipIcon, SendIcon, StopIcon } from './icons'
import { GlobeToggleIcon } from './GlobeToggleIcon'

type Props = {
  value: string
  loading: boolean
  webSearch: boolean
  onToggleWebSearch: () => void
  onChange: (value: string) => void
  onSend: () => void
  /** 流式回复期间传入：发送按钮变为停止按钮 */
  onStop?: () => void
}

export function Composer({
  value,
  loading,
  webSearch,
  onToggleWebSearch,
  onChange,
  onSend,
  onStop,
}: Props) {
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
          <button
            type="button"
            className={`chip chip-toggle${webSearch ? ' active' : ''}`}
            aria-pressed={webSearch}
            title={webSearch ? '联网搜索已开启' : '开启后回答可联网查询'}
            disabled={loading}
            onClick={onToggleWebSearch}
          >
            {/* DeepSeek 同款 Lottie 地球：开启正向播放、关闭倒放 */}
            <GlobeToggleIcon enabled={webSearch} size={14} />
            智能搜索
          </button>
        </div>
        <div className="composer-actions">
          <button type="button" className="composer-attach" aria-label="上传附件" disabled={loading}>
            <PaperclipIcon />
          </button>
          {loading && onStop ? (
            <button
              type="button"
              className="composer-stop"
              aria-label="停止生成"
              title="停止生成"
              onClick={onStop}
            >
              <StopIcon />
            </button>
          ) : (
            <button type="submit" disabled={loading || !value.trim()} aria-label="发送">
              <SendIcon />
            </button>
          )}
        </div>
      </div>
    </form>
  )
}
