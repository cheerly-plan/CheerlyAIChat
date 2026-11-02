import { Logo } from './Logo'
import { NewChatIcon, PanelIcon, SearchIcon } from './icons'

type Props = {
  title: string
  titleLoading?: boolean
  collapsed: boolean
  onToggleSidebar: () => void
  onNewChat: () => void
}

export function ChatHeader({
  title,
  titleLoading = false,
  collapsed,
  onToggleSidebar,
  onNewChat,
}: Props) {
  const showTitle = Boolean(title) || titleLoading
  if (!collapsed && !showTitle) return null

  return (
    <header className="chat-header">
      {collapsed ? (
        <div className="header-side">
          <Logo size={28} />
          <div className="header-capsule">
            <button type="button" aria-label="展开侧栏" onClick={onToggleSidebar}>
              <PanelIcon />
            </button>
            <button type="button" aria-label="搜索" title="搜索">
              <SearchIcon />
            </button>
            <button type="button" aria-label="开启新对话" onClick={onNewChat}>
              <NewChatIcon />
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="sidebar-toggle chat-header-toggle"
          aria-label="收起侧栏"
          onClick={onToggleSidebar}
        >
          <PanelIcon />
        </button>
      )}
      {showTitle ? (
        <div className="chat-header-center">
          {titleLoading && !title ? (
            <span className="chat-header-title skeleton-line skeleton-title" aria-hidden="true" />
          ) : (
            <span className="chat-header-title">{title}</span>
          )}
        </div>
      ) : null}
    </header>
  )
}
