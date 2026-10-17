import { Logo } from './Logo'
import { PanelIcon } from './icons'

type Props = {
  onNewChat: () => void
  onCollapse: () => void
  title?: string
}

export function Sidebar({ onNewChat, onCollapse, title = '' }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <Logo size={28} />
        <span>Cheerly</span>
        <button type="button" className="sidebar-toggle" aria-label="收起侧栏" onClick={onCollapse}>
          <PanelIcon />
        </button>
      </div>
      <button type="button" className="new-chat" onClick={onNewChat}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M4 20.5V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10.5a2 2 0 0 1-2 2H8l-4 3Z"
          />
        </svg>
        开启新对话
      </button>
      <div className="history">
        <p>今天</p>
        {title ? (
          <div className="history-item active" title={title}>
            {title}
          </div>
        ) : (
          <span>暂无历史会话</span>
        )}
      </div>
      <div className="account">本地助手</div>
    </aside>
  )
}
