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
  if (!collapsed && !title && !titleLoading) return null

  return (
    <header className="chat-header">
      {collapsed ? (
        <>
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
        </>
      ) : null}
      {titleLoading && !title ? (
        <span className="chat-header-title skeleton-line skeleton-title" aria-hidden="true" />
      ) : title ? (
        <span className="chat-header-title">{title}</span>
      ) : null}
    </header>
  )
}
