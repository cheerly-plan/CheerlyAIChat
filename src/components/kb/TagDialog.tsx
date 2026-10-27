import { useEffect, useId, useRef, useState } from 'react'
import { CloseIcon } from '../chat/icons'

type Props = {
  filename: string
  /** 进来时的已有标签：作为草稿起点，取消即丢弃 */
  initialTags: string[]
  /** 全库汇总的标签集合：点一下就加，避免同一概念打出几种写法 */
  suggestions: string[]
  saving?: boolean
  /** 保存失败的服务端文案：留在弹窗里显示，不关弹窗（草稿还在） */
  error?: string
  onCancel: () => void
  onSave: (tags: string[]) => void
}

/** 与后端保持一致：每文件最多 8 个标签，单标签最长 24 字 */
const MAX_TAGS = 8
const MAX_LEN = 24
/** 输入停顿即视为一个词的分隔符（英文逗号 / 中文逗号 / 顿号） */
const SEPARATOR = /[,，、]/

/**
 * 标签编辑弹窗：chips + 回车追加 + 已有标签候选。
 *
 * 为什么用弹窗而不是行内编辑：卡片的侧栏只有 80px 宽，塞不下多标签的
 * 输入与增删；弹窗里才有空间把「已选 + 候选 + 规则提示」摆清楚。
 */
export function TagDialog({
  filename,
  initialTags,
  suggestions,
  saving = false,
  error: surfaceError,
  onCancel,
  onSave,
}: Props) {
  const titleId = useId()
  const [tags, setTags] = useState<string[]>(initialTags)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // 输入法组合中按 Esc 是取消候选，不该顺手关掉弹窗
      if (event.key === 'Escape' && !event.isComposing) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  /**
   * 把一段文本按分隔符切开逐个加：粘贴「考勤,制度」也能一次加两个。
   * 不清空草稿——候选点击时用户可能正在打字，清不清由调用方决定。
   */
  const add = (raw: string) => {
    const words = raw
      .split(SEPARATOR)
      .map((word) => word.trim())
      .filter(Boolean)
    if (words.length === 0) return
    // 只在事件回调里调用（非并发批处理），直接基于当前 tags 算出新数组即可
    const next = [...tags]
    let full = false
    for (const word of words) {
      const tag = word.slice(0, MAX_LEN)
      if (!tag || next.includes(tag)) continue
      if (next.length >= MAX_TAGS) {
        full = true
        break
      }
      next.push(tag)
    }
    setTags(next)
    setError(full ? `最多 ${MAX_TAGS} 个标签` : '')
  }

  const remove = (tag: string) => {
    setTags((current) => current.filter((item) => item !== tag))
    setError('')
  }

  const submit = () => {
    if (saving) return
    // 还有没提交的草稿顺手带上，避免「打完字直接点保存」丢词
    const pending = draft.trim().slice(0, MAX_LEN)
    const finalTags =
      pending && tags.length < MAX_TAGS && !tags.includes(pending)
        ? [...tags, pending]
        : tags
    onSave(finalTags)
  }

  const candidates = suggestions.filter((tag) => !tags.includes(tag))

  return (
    <div className="session-dialog-mask" onClick={onCancel}>
      <div
        className="session-dialog tag-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="session-dialog-head">
          <h3 id={titleId}>编辑标签</h3>
          <button
            type="button"
            className="session-dialog-close"
            aria-label="关闭"
            onClick={onCancel}
          >
            <CloseIcon />
          </button>
        </div>

        <p className="tag-dialog-file" title={filename}>
          {filename}
        </p>

        <div
          className="tag-dialog-field"
          onClick={() => inputRef.current?.focus()}
        >
          {tags.map((tag) => (
            <span key={tag} className="tag-dialog-chip">
              {tag}
              <button
                type="button"
                aria-label={`移除标签 ${tag}`}
                onClick={(event) => {
                  event.stopPropagation()
                  remove(tag)
                }}
              >
                <CloseIcon />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            value={draft}
            // 单标签上限 24 字，但允许粘贴一串（切成多个标签），所以放宽输入长度
            maxLength={MAX_LEN * 4}
            autoFocus
            aria-label="输入标签"
            placeholder={tags.length === 0 ? '输入标签后回车，如：考勤' : '继续添加…'}
            onChange={(event) => {
              const value = event.target.value
              // 出现分隔符就把已输入的部分变成 chips（输入法组合中不动：
              // 此时 value 里的还是拼音，确认后才成词）
              // React 把 ChangeEvent.nativeEvent 标成泛化的 Event，实际是带
              // isComposing 的 InputEvent，这里窄化后取用
              const composing = (event.nativeEvent as InputEvent).isComposing
              if (!composing && SEPARATOR.test(value)) {
                add(value)
                setDraft('')
              } else {
                setDraft(value)
              }
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter') {
                event.preventDefault()
                if (draft.trim()) {
                  add(draft)
                  setDraft('')
                } else {
                  submit()
                }
              } else if (event.key === 'Backspace' && !draft && tags.length > 0) {
                // 输入框空着按退格：撤掉最后一个标签，符合 chips 输入的习惯
                event.preventDefault()
                remove(tags[tags.length - 1])
              }
            }}
          />
        </div>

        <p className="tag-dialog-hint">
          回车或逗号分隔可加多个，最多 {MAX_TAGS} 个
          {error ? <span className="tag-dialog-error">{error}</span> : null}
        </p>

        {surfaceError ? (
          <p className="tag-dialog-error-line">{surfaceError}</p>
        ) : null}

        {candidates.length > 0 ? (
          <div className="tag-dialog-suggests">
            <span className="tag-dialog-suggests-label">已有标签</span>
            <div className="tag-dialog-suggests-list">
              {candidates.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="tag-dialog-suggest"
                  onClick={() => add(tag)}
                >
                  + {tag}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="session-dialog-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            onClick={submit}
            disabled={saving}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
