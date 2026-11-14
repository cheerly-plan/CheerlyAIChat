import { useEffect, useRef, useState } from 'react'
import {
  CloseIcon,
  KbIcon,
  PaperclipIcon,
  PlusIcon,
  ReportGenerateIcon,
  SendIcon,
  StopIcon,
} from './icons'
import { GlobeToggleIcon } from './GlobeToggleIcon'

type Props = {
  value: string
  loading: boolean
  webSearch: boolean
  onToggleWebSearch: () => void
  /** 「知识库」开关：开启时本轮挂载 kb_search 工具，对话即可查知识库 */
  kbOn?: boolean
  onToggleKb?: () => void
  /** 「研报生成」标签：点「+」选中后作为一次性任务挂到输入框，发送时带 use_report=true */
  reportTag?: boolean
  onAddReport?: () => void
  onRemoveReport?: () => void
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
  reportTag = false,
  onAddReport,
  onRemoveReport,
  onChange,
  onSend,
  onStop,
}: Props) {
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const plusRef = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)

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

  // 点击弹层外关闭（同侧栏历史菜单的做法：mousedown 命中外部即收起）
  useEffect(() => {
    if (!menuOpen) return
    function onPointer(event: MouseEvent) {
      const target = event.target as Node
      if (plusRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [menuOpen])

  // Esc 关闭
  useEffect(() => {
    if (!menuOpen) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen])

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault()
        onSend()
      }}
    >
      {/* 研报标签：独立一行在输入框顶部（textarea 只管正文，标签与正文分离） */}
      {reportTag ? (
        <div className="composer-tags">
          <span className="composer-tag">
            <ReportGenerateIcon enabled size={14} />
            研报生成
            <button
              type="button"
              className="composer-tag-close"
              aria-label="移除研报生成"
              title="移除"
              onClick={onRemoveReport}
            >
              <CloseIcon size={12} />
            </button>
          </span>
        </div>
      ) : null}
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
          {/* 「+」入口（最左）：一次性任务（研报生成）+ 文件 */}
          <button
            ref={plusRef}
            type="button"
            className={`composer-plus${menuOpen ? ' active' : ''}`}
            aria-label="添加功能"
            aria-expanded={menuOpen}
            title="研报与文件"
            disabled={loading}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <PlusIcon />
          </button>
          {/* 常驻开关：智能搜索 */}
          <button
            type="button"
            className={`chip chip-toggle${webSearch ? ' active' : ''}`}
            aria-pressed={webSearch}
            title={webSearch ? '已开启 · 点击关闭' : '联网检索最新信息'}
            disabled={loading}
            onClick={onToggleWebSearch}
          >
            <GlobeToggleIcon enabled={webSearch} size={15} />
            智能搜索
          </button>
          {/* 常驻开关：知识检索 */}
          {onToggleKb ? (
            <button
              type="button"
              className={`chip chip-toggle${kbOn ? ' active' : ''}`}
              aria-pressed={kbOn}
              title={kbOn ? '已开启 · 点击关闭' : '检索知识库文档'}
              disabled={loading}
              onClick={onToggleKb}
            >
              <KbIcon enabled={kbOn} size={16} />
              知识检索
            </button>
          ) : null}
          {menuOpen ? (
            <div ref={menuRef} className="composer-menu" role="menu" aria-label="研报与文件">
              <button
                type="button"
                role="menuitem"
                className={`composer-menu-item${reportTag ? ' active' : ''}`}
                aria-pressed={reportTag}
                disabled={reportTag}
                onClick={() => {
                  onAddReport?.()
                  setMenuOpen(false)
                }}
              >
                <span className="composer-menu-icon">
                  <ReportGenerateIcon enabled={reportTag} size={15} />
                </span>
                <span className="composer-menu-text">
                  <span className="composer-menu-title">研报生成</span>
                  <span className="composer-menu-desc">
                    {reportTag ? '已添加' : '生成公司或行业研报'}
                  </span>
                </span>
              </button>
              <div className="composer-menu-sep" />
              <button
                type="button"
                role="menuitem"
                className="composer-menu-item"
                disabled
                title="敬请期待"
              >
                <span className="composer-menu-icon">
                  <PaperclipIcon />
                </span>
                <span className="composer-menu-text">
                  <span className="composer-menu-title">添加文件</span>
                  <span className="composer-menu-desc">上传附件并基于它提问</span>
                </span>
              </button>
            </div>
          ) : null}
        </div>
        <div className="composer-actions">
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
