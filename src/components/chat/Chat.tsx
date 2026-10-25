import { useState } from 'react'
import { hasCachedActiveSession } from '../../api'
import { useChat } from '../../hooks/useChat'
import type { UserInfo } from '../../types'
import { ChatHeader } from './ChatHeader'
import { Composer } from './Composer'
import { Logo } from './Logo'
import { MessageList } from './MessageList'
import { Sidebar } from './Sidebar'
import './chat.css'

function timeGreeting() {
  const hour = new Date().getHours()
  if (hour < 5) return '晚上好'
  if (hour < 11) return '早上好'
  if (hour < 13) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

const WEB_SEARCH_PREF_KEY = 'ai_chat.webSearch'

/** 读取「智能搜索」记忆偏好；从未设置过时默认开启 */
function loadWebSearchPref(): boolean {
  try {
    const saved = localStorage.getItem(WEB_SEARCH_PREF_KEY)
    return saved === null ? true : saved === 'true'
  } catch {
    return true
  }
}

function saveWebSearchPref(on: boolean) {
  try {
    localStorage.setItem(WEB_SEARCH_PREF_KEY, String(on))
  } catch {
    /* 隐私模式等场景下写入失败则不记忆 */
  }
}

type Props = {
  onLogout: () => void
  initialUser?: UserInfo | null
}

export function Chat({ onLogout, initialUser = null }: Props) {
  const {
    user,
    messages,
    input,
    setInput,
    loading,
    historyLoading,
    hasMore,
    ready,
    error,
    send,
    loadOlder,
    reset,
    selectSession,
    renameSessionTitle,
    removeSession,
    sessions,
    sessionsReady,
    sessionsError,
    reloadSessions,
    sessionId,
    title,
    regenerate,
    canResume,
    resumeRun,
    stop,
  } = useChat(initialUser)
  const [sidebarOpen, setSidebarOpen] = useState(
    () => window.matchMedia('(min-width: 861px)').matches,
  )
  // 「智能搜索」开关：开启时本轮请求携带 web_search=true，
  // 后端为模型提供 web_search 工具；重新生成沿用同一开关。
  // 默认开启，并记住用户上次的选择（localStorage）
  const [webSearch, setWebSearch] = useState(loadWebSearchPref)
  const toggleWebSearch = () =>
    setWebSearch((on) => {
      const next = !on
      saveWebSearchPref(next)
      return next
    })
  const isLanding =
    !sessionId &&
    messages.length === 0 &&
    !historyLoading &&
    (sessionsReady || !hasCachedActiveSession())

  return (
    <div className={`shell${sidebarOpen ? '' : ' sidebar-collapsed'}`}>
      <div className="sidebar-mask" onClick={() => setSidebarOpen(false)} />
      <Sidebar
        onNewChat={reset}
        onCollapse={() => setSidebarOpen(false)}
        onSelectSession={(id) => void selectSession(id)}
        onRenameSession={(id, next) => renameSessionTitle(id, next)}
        onDeleteSession={(id) => removeSession(id)}
        sessions={sessions}
        sessionsReady={sessionsReady}
        sessionsError={sessionsError}
        onRetrySessions={() => void reloadSessions()}
        activeSessionId={sessionId}
        chatLoading={loading}
        userName={user?.user_name}
        onLogout={onLogout}
      />
      <main className="chat">
        <ChatHeader
          title={title}
          titleLoading={!sessionsReady && hasCachedActiveSession()}
          collapsed={!sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          onNewChat={reset}
        />
        {isLanding ? (
          <div className="landing">
            {error ? <p className="error">{error}</p> : null}
            <div className="landing-hero">
              <h1 className="landing-hello">
                <Logo size={36} />
                <span>{timeGreeting()}，让我们开始聊天吧</span>
              </h1>
              <Composer
                value={input}
                loading={loading || !ready}
                webSearch={webSearch}
                onToggleWebSearch={toggleWebSearch}
                onChange={setInput}
                onSend={() => void send(undefined, { webSearch })}
                onStop={() => stop()}
              />
            </div>
          </div>
        ) : (
          <>
            <MessageList
              key={sessionId ?? 'new'}
              messages={messages}
              loading={loading}
              historyLoading={historyLoading}
              hasMore={hasMore}
              canResume={canResume}
              onEditSubmit={(text) => void send(text, { webSearch })}
              onRegenerate={(id) => void regenerate(id, { webSearch })}
              onResume={() => void resumeRun()}
              onLoadOlder={() => void loadOlder()}
            />
            <div className="dock">
              {canResume &&
              !loading &&
              messages[messages.length - 1]?.role !== 'assistant' ? (
                <button
                  type="button"
                  className="chat-resume-btn"
                  onClick={() => void resumeRun()}
                >
                  继续生成
                </button>
              ) : null}
              {error ? <p className="error">{error}</p> : null}
              <Composer
                value={input}
                loading={loading || !ready}
                webSearch={webSearch}
                onToggleWebSearch={toggleWebSearch}
                onChange={setInput}
                onSend={() => void send(undefined, { webSearch })}
                onStop={() => stop()}
              />
            </div>
          </>
        )}
        <p className="disclaimer">内容由 AI 生成，请仔细甄别</p>
      </main>
    </div>
  )
}
