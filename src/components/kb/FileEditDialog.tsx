import { useEffect, useId, useRef, useState } from 'react'
import { CloseIcon } from '../chat/icons'

type Props = {
  /** 当前展示名（纯名，不含后缀） */
  filename: string
  /** 后缀单独存（.pdf/.docx…），输入框里只编 stem，后缀作为固定尾巴显示 */
  suffix?: string
  /** 处理中的文件不能改名：后端要同步改磁盘文件名，和解析/重嵌会打架 */
  canRename: boolean
  /** 进来时的已有标签：作为草稿起点，取消即丢弃 */
  initialTags: string[]
  /** 全库汇总的标签集合：点一下就加，避免同一概念打出几种写法 */
  suggestions: string[]
  saving?: boolean
  /** 保存失败的服务端文案：留在弹窗里显示，不关弹窗（草稿还在） */
  error?: string
  onCancel: () => void
  onSave: (payload: { filename: string; tags: string[] }) => void
}

/** 与后端保持一致：每文件最多 8 个标签，单标签最长 24 字 */
const MAX_TAGS = 8
const MAX_LEN = 24
/** 输入停顿即视为一个词的分隔符（英文逗号 / 中文逗号 / 顿号） */
const SEPARATOR = /[,，、]/

/**
 * 文件编辑弹窗：名字 + 标签一处改完，一次保存。
 *
 * 原来「重命名」「编辑标签」是两个菜单项、两个弹窗，用户改个元信息要开两次；
 * 对同一份文件来说这两件事本来就是一件事（我是谁、我归哪类）。
 * 两个后端接口仍然是分开的，提交时按实际改动分别调用，只改标签不会碰文件名。
 */
export function FileEditDialog({
  filename,
  suffix,
  canRename,
  initialTags,
  suggestions,
  saving = false,
  error: surfaceError,
  onCancel,
  onSave,
}: Props) {
  const titleId = useId()
  const [name, setName] = useState(filename)
  const [nameError, setNameError] = useState('')
  const [tags, setTags] = useState<string[]>(initialTags)
  const [draft, setDraft] = useState('')
  const [tagError, setTagError] = useState('')
  const nameRef = useRef<HTMLInputElement | null>(null)
  const tagInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!canRename) return
    nameRef.current?.focus()
    // 全选方便直接输入新名字覆盖
    nameRef.current?.select()
  }, [canRename])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // 输入法组合中按 Esc 是取消候选，不该顺手关掉弹窗
      if (event.key === 'Escape' && !event.isComposing) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  const nameChanged = canRename && name.trim() !== filename
  const tagsChanged = tags.join('\u0000') !== initialTags.join('\u0000')
  const dirty = nameChanged || tagsChanged

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
    setTagError(full ? `最多 ${MAX_TAGS} 个标签` : '')
  }

  const remove = (tag: string) => {
    setTags((current) => current.filter((item) => item !== tag))
    setTagError('')
  }

  const submit = () => {
    if (saving || !dirty) return
    const nextName = name.trim()
    if (canRename && !nextName) {
      setNameError('文件名不能为空')
      nameRef.current?.focus()
      return
    }
    // 还有没提交的草稿顺手带上，避免「打完字直接点保存」丢词
    const pending = draft.trim().slice(0, MAX_LEN)
    const finalTags =
      pending && tags.length < MAX_TAGS && !tags.includes(pending)
        ? [...tags, pending]
        : tags
    onSave({ filename: canRename ? nextName : filename, tags: finalTags })
  }

  const candidates = suggestions.filter((tag) => !tags.includes(tag))

  return (
    <div className="session-dialog-mask" onClick={onCancel}>
      <div
        className="session-dialog file-edit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="session-dialog-head">
          <h3 id={titleId}>编辑文件</h3>
          <button
            type="button"
            className="session-dialog-close"
            aria-label="关闭"
            onClick={onCancel}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="file-edit-section">
          <label className="file-edit-label" htmlFor={`${titleId}-name`}>
            文件名
          </label>
          <div
            className={`file-edit-name${canRename ? '' : ' is-locked'}`}
            onClick={() => nameRef.current?.focus()}
          >
            <input
              id={`${titleId}-name`}
              ref={nameRef}
              value={name}
              maxLength={255}
              disabled={!canRename}
              onChange={(event) => {
                setName(event.target.value)
                setNameError('')
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  submit()
                }
              }}
              aria-label="文件名"
            />
            {suffix ? (
              <span className="file-edit-suffix" title="扩展名不可修改">
                {suffix}
              </span>
            ) : null}
          </div>
          {nameError ? (
            <p className="file-edit-hint is-error">{nameError}</p>
          ) : canRename ? (
            <p className="file-edit-hint">
              {nameChanged
                ? '改名后会在后台按新名称重新生成向量，检索不受影响。'
                : '扩展名不可修改。'}
            </p>
          ) : (
            <p className="file-edit-hint">处理完成后才能改名。</p>
          )}
        </div>

        <div className="file-edit-section">
          <span className="file-edit-label">标签</span>
          <div
            className="tag-dialog-field"
            onClick={() => tagInputRef.current?.focus()}
          >
            <div className="tag-dialog-field-inner">
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
                ref={tagInputRef}
                value={draft}
                // 单标签上限 24 字，但允许粘贴一串（切成多个标签），所以放宽输入长度
                maxLength={MAX_LEN * 4}
                aria-label="输入标签"
                placeholder={
                  tags.length === 0 ? '输入标签后回车，如：考勤' : '继续添加…'
                }
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
                  } else if (
                    event.key === 'Backspace' &&
                    !draft &&
                    tags.length > 0
                  ) {
                    // 输入框空着按退格：撤掉最后一个标签，符合 chips 输入的习惯
                    event.preventDefault()
                    remove(tags[tags.length - 1])
                  }
                }}
              />
            </div>
          </div>
          <p className="tag-dialog-hint">
            回车或逗号分隔可加多个，最多 {MAX_TAGS} 个
            {tagError ? (
              <span className="tag-dialog-error">{tagError}</span>
            ) : null}
          </p>
        </div>

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
            disabled={saving || !dirty}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
