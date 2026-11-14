import { KnowledgeBaseIcon, LogoutIcon, NewChatIcon, TraceIcon } from '../chat/icons'
import './board.css'

type Props = {
  userName: string
  onOpenKb: () => void
  onOpenTrace: () => void
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

export function Board({ userName, onOpenKb, onOpenTrace, onLogout }: Props) {
  const initial = userName.trim().slice(0, 1)
  const chatHref = `${window.location.pathname}${window.location.search}#/chat`
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
        <p>从这里进入知识库、查看对话过程，或和 Cheerly 对话。</p>
        <div className="board-cards">
          <button type="button" className="board-card" onClick={onOpenKb}>
            <span className="board-card-icon board-card-icon-chat">
              <KnowledgeBaseIcon />
            </span>
            <span className="board-card-title">知识库管理</span>
            <span className="board-card-desc">上传文档，查看切片和图谱</span>
          </button>
          <button type="button" className="board-card" onClick={onOpenTrace}>
            <span className="board-card-icon board-card-icon-chat">
              <TraceIcon />
            </span>
            <span className="board-card-title">对话过程</span>
            <span className="board-card-desc">按用户、会话和提问查看工具、技能与模型结果</span>
          </button>
          <a className="board-card" href={chatHref} target="_blank" rel="noopener noreferrer">
            <span className="board-card-icon board-card-icon-chat">
              <NewChatIcon />
            </span>
            <span className="board-card-title">和 Cheerly 对话</span>
            <span className="board-card-desc">开一轮新对话，基于知识库提问</span>
          </a>
        </div>
      </main>
    </div>
  )
}
