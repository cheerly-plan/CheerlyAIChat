import { useEffect, useId } from 'react'
import { WarningIcon } from '../chat/icons'

type Props = {
  /** 弹窗标题，例如「确定删除对话?」 */
  title: string
  /** 补充说明，讲清后果（不可恢复 / 影响范围） */
  description: string
  /** 确认按钮文案，默认「删除」 */
  confirmText?: string
  onCancel: () => void
  onConfirm: () => void
}

/**
 * 危险操作二次确认弹窗：与删除会话共用同一套视觉（.session-dialog 系列样式），
 * 蒙层 z-index 40 高于知识库整页(36)，两处都能盖住。
 */
export function ConfirmDialog({
  title,
  description,
  confirmText = '删除',
  onCancel,
  onConfirm,
}: Props) {
  const titleId = useId()

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="session-dialog-mask" onClick={onCancel}>
      <div
        className="session-dialog session-dialog-warn"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id={titleId}>
          <WarningIcon />
          {title}
        </h3>
        <p>{description}</p>
        <div className="session-dialog-actions">
          {/* 默认聚焦「取消」，避免回车误删 */}
          <button type="button" className="ghost" onClick={onCancel} autoFocus>
            取消
          </button>
          <button type="button" className="danger" onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
