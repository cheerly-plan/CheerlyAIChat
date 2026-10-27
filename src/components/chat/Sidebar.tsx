import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DEFAULT_SESSION_TITLE } from '../../api'
import copyIcon from '../../assets/copy.svg'
import deleteIcon from '../../assets/delete.svg'
import kbIcon from '../../assets/kb.svg'
import optionsIcon from '../../assets/options.svg'
import renameIcon from '../../assets/rename.svg'
import type { SessionInfo } from '../../types'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { Logo } from './Logo'
import { CloseIcon, NewChatIcon, PanelIcon } from './icons'

type Props = {
  onNewChat: () => void
  onCollapse: () => void
  onSelectSession: (id: string) => void
  onRenameSession: (id: string, title: string) => Promise<void> | void
  onDeleteSession: (id: string) => Promise<void> | void
  sessions: SessionInfo[]
  sessionsReady?: boolean
  sessionsError?: string
  onRetrySessions?: () => void
  activeSessionId?: string | null
  /** 对话进行中（等待/流式回复），会话列表对应标题右侧显示 loading 指示 */
  chatLoading?: boolean
  userName?: string
  onLogout?: () => void
  /** 打开知识库页（与对话视图互斥） */
  onOpenKb?: () => void
}

export function Sidebar({
  onNewChat,
  onCollapse,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  sessions,
  sessionsReady = false,
  sessionsError = '',
  onRetrySessions,
  activeSessionId = null,
  chatLoading = false,
  userName = '',
  onLogout,
  onOpenKb,
}: Props) {
  const groups = groupSessions(sessions)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [renameItem, setRenameItem] = useState<SessionInfo | null>(null)
  const [deleteItem, setDeleteItem] = useState<SessionInfo | null>(null)

  async function confirmRename(title: string) {
    if (!renameItem) return
    const id = renameItem.session_id
    setRenameItem(null)
    await onRenameSession(id, title)
  }

  async function confirmDelete() {
    if (!deleteItem) return
    const id = deleteItem.session_id
    setDeleteItem(null)
    await onDeleteSession(id)
  }

  return (
    <>
    <aside className="sidebar">
      <div className="brand">
        <Logo size={28} />
        <span>Cheerly</span>
        <button type="button" className="sidebar-toggle" aria-label="收起侧栏" onClick={onCollapse}>
          <PanelIcon />
        </button>
      </div>
      <button type="button" className="new-chat" onClick={onNewChat}>
        <NewChatIcon />
        开启新对话
      </button>
      {onOpenKb ? (
        <button type="button" className="kb-entry" onClick={onOpenKb}>
          <img src={kbIcon} alt="" className="kb-entry-icon" />
          知识库
        </button>
      ) : null}
      <div className="history">
        {/* 显式四态，互斥渲染：加载骨架 / 加载失败 / 空态 / 会话分组 */}
        {!sessionsReady ? (
          <HistorySkeleton />
        ) : sessionsError ? (
          <div className="history-error">
            <span>{sessionsError}</span>
            {onRetrySessions ? (
              <button type="button" className="history-retry" onClick={onRetrySessions}>
                重试
              </button>
            ) : null}
          </div>
        ) : groups.length ? (
          groups.map((group) => (
            <section key={group.label} className="history-group">
              <h2 className="history-label">{group.label}</h2>
              {group.items.map((item) => (
                <HistoryItem
                  key={item.session_id}
                  item={item}
                  active={item.session_id === activeSessionId}
                  loading={chatLoading && item.session_id === activeSessionId}
                  menuOpen={menuId === item.session_id}
                  onSelect={() => onSelectSession(item.session_id)}
                  onOpenMenu={() => setMenuId(item.session_id)}
                  onCloseMenu={() => setMenuId(null)}
                  onStartRename={() => {
                    setMenuId(null)
                    setRenameItem(item)
                  }}
                  onDelete={() => {
                    setMenuId(null)
                    setDeleteItem(item)
                  }}
                />
              ))}
            </section>
          ))
        ) : (
          <span className="history-empty">暂无历史会话</span>
        )}
      </div>
      <div className="account">
        <span className="account-name">{userName}</span>
        {onLogout ? (
          <button
            type="button"
            className="account-logout"
            onClick={onLogout}
            aria-label="退出登录"
          >
            退出登录
          </button>
        ) : null}
      </div>
    </aside>
    {renameItem ? (
      <RenameDialog
        title={renameItem.title || DEFAULT_SESSION_TITLE}
        onCancel={() => setRenameItem(null)}
        onConfirm={(title) => void confirmRename(title)}
      />
    ) : null}
    {deleteItem ? (
      <ConfirmDialog
        title="确定删除对话?"
        description="删除后，聊天记录将不可恢复。"
        onCancel={() => setDeleteItem(null)}
        onConfirm={() => void confirmDelete()}
      />
    ) : null}
    </>
  )
}

type ItemProps = {
  item: SessionInfo
  active: boolean
  /** 该会话的对话正在进行中，标题右侧显示 loading 指示 */
  loading?: boolean
  menuOpen: boolean
  onSelect: () => void
  onOpenMenu: () => void
  onCloseMenu: () => void
  onStartRename: () => void
  onDelete: () => void
}

function HistoryItem({
  item,
  active,
  loading = false,
  menuOpen,
  onSelect,
  onOpenMenu,
  onCloseMenu,
  onStartRename,
  onDelete,
}: ItemProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const title = item.title || DEFAULT_SESSION_TITLE

  useLayoutEffect(() => {
    if (!menuOpen || !moreRef.current) {
      setMenuPos(null)
      return
    }
    const rect = moreRef.current.getBoundingClientRect()
    const width = 180
    const height = 144
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8)
    const openUp = rect.bottom + height > window.innerHeight - 8
    const top = openUp ? Math.max(8, rect.top - height - 4) : rect.bottom + 4
    setMenuPos({ top, left })
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    function onPointer(event: MouseEvent) {
      const target = event.target as Node
      if (boxRef.current?.contains(target) || menuRef.current?.contains(target)) return
      onCloseMenu()
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [menuOpen, onCloseMenu])

  async function copyName() {
    try {
      await navigator.clipboard.writeText(title)
    } catch {
      const input = document.createElement('textarea')
      input.value = title
      input.setAttribute('readonly', '')
      input.style.position = 'fixed'
      input.style.left = '-9999px'
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
    }
    onCloseMenu()
  }

  return (
    <div
      ref={boxRef}
      className={`history-item${active ? ' active' : ''}${menuOpen ? ' menu-open' : ''}`}
    >
      <button type="button" className="history-item-title" onClick={onSelect}>
        {title}
      </button>
      {loading ? (
        <span className="history-item-loading" role="status" aria-label="正在回复" />
      ) : null}
      <div className="history-actions">
        <button
          ref={moreRef}
          type="button"
          className="history-more"
          aria-label="会话操作"
          onClick={(event) => {
            event.stopPropagation()
            if (menuOpen) onCloseMenu()
            else onOpenMenu()
          }}
        >
          <img src={optionsIcon} alt="" className="history-more-icon" />
        </button>
      </div>
      {menuOpen && menuPos ? (
        <div
          ref={menuRef}
          className="history-menu"
          role="menu"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <button type="button" role="menuitem" onClick={onStartRename}>
            <img src={renameIcon} alt="" className="history-menu-icon" />
            重命名
          </button>
          <button type="button" role="menuitem" onClick={() => void copyName()}>
            <img src={copyIcon} alt="" className="history-menu-icon" />
            复制名称
          </button>
          <div className="history-menu-sep" />
          <button type="button" role="menuitem" className="danger" onClick={onDelete}>
            <img src={deleteIcon} alt="" className="history-menu-icon" />
            删除
          </button>
        </div>
      ) : null}
    </div>
  )
}

const SKELETON_WIDTHS = ['78%', '92%', '64%', '86%', '70%', '81%']

function useDialogEscape(onCancel: () => void) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])
}

function RenameDialog({
  title,
  onCancel,
  onConfirm,
}: {
  title: string
  onCancel: () => void
  onConfirm: (title: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(title)
  useDialogEscape(onCancel)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function submit() {
    const next = value.trim()
    if (!next || next === title) {
      onCancel()
      return
    }
    onConfirm(next)
  }

  return (
    <div className="session-dialog-mask" onClick={onCancel}>
      <div
        className="session-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-session-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="session-dialog-head">
          <h3 id="rename-session-title">编辑对话名称</h3>
          <button type="button" className="session-dialog-close" aria-label="关闭" onClick={onCancel}>
            <CloseIcon />
          </button>
        </div>
        <input
          ref={inputRef}
          className="session-dialog-input"
          value={value}
          maxLength={30}
          aria-label="对话名称"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
        />
        <div className="session-dialog-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="primary" onClick={submit}>
            确定
          </button>
        </div>
      </div>
    </div>
  )
}

function HistorySkeleton() {
  return (
    <div className="history-skeleton" aria-hidden="true">
      <div className="skeleton-line skeleton-label" />
      {SKELETON_WIDTHS.map((width) => (
        <div key={width} className="skeleton-line skeleton-item" style={{ width }} />
      ))}
    </div>
  )
}

function groupSessions(sessions: SessionInfo[], now = new Date()) {
  const buckets = new Map<string, SessionInfo[]>()
  for (const item of sessions) {
    const label = groupLabel(item.updated_at || item.created_at, now)
    const list = buckets.get(label)
    if (list) list.push(item)
    else buckets.set(label, [item])
  }
  return [...buckets.entries()].map(([label, items]) => ({ label, items }))
}

function groupLabel(value: string | null | undefined, now: Date) {
  const today = startOfDay(now)
  const date = parseSessionDate(value)
  if (!date || startOfDay(date) >= today) return '今天'
  const day = startOfDay(date)
  if (day >= addDays(today, -1)) return '昨天'
  if (day >= addDays(today, -7)) return '7天内'
  if (day >= addDays(today, -30)) return '30天内'
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function parseSessionDate(value?: string | null) {
  if (!value) return null
  const iso = value.includes('T') ? value : value.replace(' ', 'T')
  const normalized = iso.replace(/([+-]\d{2})$/, '$1:00')
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}
