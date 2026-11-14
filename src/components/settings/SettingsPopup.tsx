import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { LogoutIcon, MemoryIcon } from '../chat/icons'
import './settings.css'

type Props = {
  /** 侧栏底部的账号卡片：popup 左对齐它、浮在它上方，点卡片内不算「点击外部」 */
  anchorRef: { current: HTMLElement | null }
  userName?: string
  onClose: () => void
  onOpenMemory: () => void
  onLogout?: () => void
}

/** 上限取账号卡片宽度；侧栏收窄或窗口变小时跟随卡片实际宽度 */
const MAX_POPUP_WIDTH = 256

/**
 * 账号 popup：不用居中 dialog / 全屏蒙层，而是从侧栏底部账号栏上方浮出。
 * 用 portal 挂到 body，避免被 .sidebar 的 overflow:hidden 裁掉；
 * 位置在 useLayoutEffect 里直接写 style（首帧前完成，无闪烁、无 setState）。
 */
export function SettingsPopup({
  anchorRef,
  userName = '',
  onClose,
  onOpenMemory,
  onLogout,
}: Props) {
  const popupRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    function place() {
      const popup = popupRef.current
      const anchor = anchorRef.current
      if (!popup || !anchor) return
      const rect = anchor.getBoundingClientRect()
      const width = Math.min(rect.width, MAX_POPUP_WIDTH, window.innerWidth - 24)
      popup.style.width = `${width}px`
      popup.style.left = `${Math.max(
        12,
        Math.min(rect.left, window.innerWidth - width - 12),
      )}px`
      popup.style.bottom = `${Math.max(12, window.innerHeight - rect.top + 10)}px`
    }

    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchorRef])

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (anchorRef.current?.contains(target) || popupRef.current?.contains(target)) return
      onClose()
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchorRef, onClose])

  const name = userName.trim()

  return createPortal(
    <div ref={popupRef} className="settings-popup" role="menu" aria-label="设置">
      <div className="settings-popup-user">
        <span className="settings-popup-avatar" aria-hidden="true">
          {name ? name.slice(0, 1).toUpperCase() : 'U'}
        </span>
        <span className="settings-popup-user-text">
          <strong>{name || '当前账号'}</strong>
          <small>账号与偏好</small>
        </span>
      </div>

      <div className="settings-popup-band" aria-hidden="true" />

      <button
        type="button"
        role="menuitem"
        className="settings-popup-item"
        onClick={onOpenMemory}
      >
        <span className="settings-popup-item-icon"><MemoryIcon size={20} /></span>
        <span className="settings-popup-item-label">记忆</span>
      </button>

      <div className="settings-popup-sep" />

      {onLogout ? (
        <button
          type="button"
          role="menuitem"
          className="settings-popup-item danger"
          onClick={onLogout}
        >
          <span className="settings-popup-item-icon"><LogoutIcon /></span>
          <span className="settings-popup-item-label">退出登录</span>
        </button>
      ) : null}
    </div>,
    document.body,
  )
}
