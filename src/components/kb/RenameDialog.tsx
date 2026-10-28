import { useEffect, useId, useRef, useState } from 'react'
import { CloseIcon } from '../chat/icons'

type Props = {
  filename: string
  saving?: boolean
  /** 保存失败的服务端文案：留在弹窗里显示，不关弹窗（草稿还在） */
  error?: string
  onCancel: () => void
  onSave: (filename: string) => void
}

/**
 * 重命名弹窗：与标签弹窗同一套骨架（session-dialog），只有单个输入框。
 * 后端规则：扩展名不能变、stem 变了会触发整份重嵌——这里只做非空校验，
 * 其余交后端把关（错误文案会回显在本弹窗里）。
 */
export function RenameDialog({
  filename,
  saving = false,
  error: surfaceError,
  onCancel,
  onSave,
}: Props) {
  const titleId = useId()
  const [draft, setDraft] = useState(filename)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    // 全选方便直接输入新名字覆盖
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // 输入法组合中按 Esc 是取消候选，不该顺手关掉弹窗
      if (event.key === 'Escape' && !event.isComposing) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  const submit = () => {
    if (saving) return
    const name = draft.trim()
    if (!name) {
      setError('文件名不能为空')
      return
    }
    if (name === filename) {
      // 名字没变就不打扰后端，直接当取消处理
      onCancel()
      return
    }
    onSave(name)
  }

  return (
    <div className="session-dialog-mask" onClick={onCancel}>
      <div
        className="session-dialog rename-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="session-dialog-head">
          <h3 id={titleId}>重命名</h3>
          <button
            type="button"
            className="session-dialog-close"
            aria-label="关闭"
            onClick={onCancel}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="rename-dialog-field">
          <input
            ref={inputRef}
            value={draft}
            maxLength={255}
            onChange={(event) => {
              setDraft(event.target.value)
              setError('')
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                submit()
              }
            }}
            aria-label="新文件名"
          />
        </div>
        {surfaceError || error ? (
          <p className="rename-dialog-error">{surfaceError || error}</p>
        ) : (
          <p className="rename-dialog-hint">
            改名后向量会按新文件名在后台重新生成，检索不受影响。
          </p>
        )}

        <div className="session-dialog-actions">
          <button type="button" onClick={onCancel} disabled={saving}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            onClick={submit}
            disabled={saving || !draft.trim()}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
