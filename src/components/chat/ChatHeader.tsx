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
    <header className={`chat-header${collapsed ? ' chat-header-collapsed' : ''}`}>
      <div className="header-side">
        {collapsed ? (
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
        ) : null}
      </div>
      <div className="chat-header-center">
        {showTitle ? (
          titleLoading && !title ? (
            <span className="chat-header-title skeleton-line skeleton-title" aria-hidden="true" />
          ) : (
            <span className="chat-header-title">{title}</span>
          )
        ) : null}
      </div>
      {collapsed ? null : <div className="chat-header-trail" aria-hidden="true" />}
    </header>
  )
}
