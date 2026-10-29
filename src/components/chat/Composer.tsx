import { useEffect, useRef } from 'react'
import { KbIcon, PaperclipIcon, SendIcon, StopIcon } from './icons'
import { GlobeToggleIcon } from './GlobeToggleIcon'

type Props = {
  value: string
  loading: boolean
  webSearch: boolean
  onToggleWebSearch: () => void
  /** 「知识库」开关：开启时本轮挂载 kb_search 工具，对话即可查知识库 */
  kbOn?: boolean
  onToggleKb?: () => void
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
  kbOn = false,
  onToggleKb,
  onChange,
  onSend,
  onStop,
}: Props) {
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
      <div className="composer-input">
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
      </div>
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
          {onToggleKb ? (
            <button
              type="button"
              className={`chip chip-toggle${kbOn ? ' active' : ''}`}
              aria-pressed={kbOn}
              title={kbOn ? '知识库检索已开启' : '开启后回答可检索知识库文档'}
              disabled={loading}
              onClick={onToggleKb}
            >
              <KbIcon enabled={kbOn} size={16} />
              知识检索
            </button>
          ) : null}
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
