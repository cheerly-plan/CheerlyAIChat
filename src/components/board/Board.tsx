import kbIcon from '../../assets/kb.svg'
import { LogoutIcon, NewChatIcon } from '../chat/icons'
import './board.css'

type Props = {
  userName: string
  onOpenKb: () => void
  onOpenChat: () => void
  onLogout: () => void
}

function timeGreeting() {
  const hour = new Date().getHours()
  if (hour < 5) return '晚上好'
  if (hour < 11) return '早上好'
  if (hour < 13) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

export function Board({ userName, onOpenKb, onOpenChat, onLogout }: Props) {
  const initial = userName.trim().slice(0, 1)
  return (
    <div className="board">
      <header className="board-bar">
        <div className="board-brand">
          <span>Cheerly</span>
        </div>
        <div className="board-account">
          {initial ? (
            <span className="board-avatar" aria-hidden="true">
              {initial}
            </span>
          ) : null}
          <span className="board-name">{userName}</span>
          <button type="button" className="board-logout" onClick={onLogout} aria-label="退出登录" title="退出登录">
            <LogoutIcon />
          </button>
        </div>
      </header>
      <main className="board-main">
        <h1>
          {timeGreeting()}
          {userName ? `，${userName}` : ''}
        </h1>
        <p>从这里进入知识库，或和 Cheerly 对话。</p>
        <div className="board-cards">
          <button type="button" className="board-card" onClick={onOpenKb}>
            <span className="board-card-icon">
              <img src={kbIcon} alt="" />
            </span>
            <span className="board-card-title">知识库管理</span>
            <span className="board-card-desc">上传文档，查看切片和图谱</span>
          </button>
          <button type="button" className="board-card" onClick={onOpenChat}>
            <span className="board-card-icon board-card-icon-chat">
              <NewChatIcon />
            </span>
            <span className="board-card-title">和 Cheerly 对话</span>
            <span className="board-card-desc">开一轮新对话，基于知识库提问</span>
          </button>
        </div>
      </main>
    </div>
  )
}
