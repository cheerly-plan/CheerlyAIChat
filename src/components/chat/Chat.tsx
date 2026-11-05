import { useEffect, useState } from 'react'
import { hasCachedActiveSession } from '../../api'
import { useChat } from '../../hooks/useChat'
import { goBack, isBareHash, navigate, useRoute } from '../../router'
import type { UserInfo } from '../../types'
import { Board } from '../board/Board'
import { KnowledgeBase } from '../kb/KnowledgeBase'
import { Trace } from '../trace/Trace'
import { ChatHeader } from './ChatHeader'
import { Composer } from './Composer'
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
const KB_PREF_KEY = 'ai_chat.kb'

/** 读取布尔记忆偏好；从未设置过时用 fallback（智能搜索默认开、知识库默认关） */
function loadBoolPref(key: string, fallback: boolean): boolean {
  try {
    const saved = localStorage.getItem(key)
    return saved === null ? fallback : saved === 'true'
  } catch {
    return fallback
  }
}

function saveBoolPref(key: string, on: boolean) {
  try {
    localStorage.setItem(key, String(on))
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
    streamingIds,
    title,
    regenerate,
    canResume,
    resumeRun,
    stop,
  } = useChat(initialUser)
  const [sidebarOpen, setSidebarOpen] = useState(
    () => window.matchMedia('(min-width: 861px)').matches,
  )
  // 主区域由 URL 决定：#/board 看板、#/chat 对话、#/kb 知识库、#/trace 对话过程。
  // 空 hash 先当对话；管理员登录时由 App 换成看板，刷新 #/chat 仍停在对话。
  const route = useRoute()
  const knownUser = user ?? initialUser
  const isAdmin = Boolean(knownUser?.is_admin)
  const identityPending = !knownUser && !ready && !sessionsReady
  useEffect(() => {
    if (identityPending) return
    if (!isAdmin && (route === 'kb' || route === 'board' || route === 'trace')) {
      navigate('chat', { replace: true })
      return
    }
    if (isAdmin && isBareHash()) navigate('board', { replace: true })
  }, [identityPending, isAdmin, route])
  // 「智能搜索」开关：开启时本轮请求携带 web_search=true，
  // 后端为模型提供 web_search 工具；重新生成沿用同一开关。
  // 默认开启，并记住用户上次的选择（localStorage）
  const [webSearch, setWebSearch] = useState(() => loadBoolPref(WEB_SEARCH_PREF_KEY, true))
  const toggleWebSearch = () =>
    setWebSearch((on) => {
      const next = !on
      saveBoolPref(WEB_SEARCH_PREF_KEY, next)
      return next
    })
  // 「知识库」开关：与智能搜索同一套交互——开启时本轮挂载 kb_search
  // 工具，通过对话即可查全库文档。同样是记住上次选择，但默认关闭：
  // 检索要花钱且有延迟，不该默认替用户开
  const [kbOn, setKbOn] = useState(() => loadBoolPref(KB_PREF_KEY, false))
  const toggleKb = () =>
    setKbOn((on) => {
      const next = !on
      saveBoolPref(KB_PREF_KEY, next)
      return next
    })

  const isLanding =
    !sessionId &&
    messages.length === 0 &&
    !historyLoading &&
    (sessionsReady || !hasCachedActiveSession())

  const showBoard = isAdmin && (route === 'board' || isBareHash())
  if (identityPending && (route === 'board' || route === 'kb' || route === 'trace' || isBareHash())) {
    return <div className="board-boot" />
  }
  if (isAdmin && route === 'trace') {
    return <Trace currentUserId={knownUser?.user_id ?? ''} />
  }
  if (showBoard) {
    return (
      <Board
        userName={knownUser?.user_name ?? ''}
        onOpenKb={() => navigate('kb')}
        onOpenTrace={() => navigate('trace')}
        onLogout={onLogout}
      />
    )
  }

  return (
    <div className={`shell${sidebarOpen ? '' : ' sidebar-collapsed'}`}>
      <div className="sidebar-mask" onClick={() => setSidebarOpen(false)} />
      <Sidebar
        onNewChat={() => {
          navigate('chat')
          reset()
        }}
        onCollapse={() => setSidebarOpen(false)}
        onSelectSession={(id) => {
          navigate('chat')
          void selectSession(id)
        }}
        onRenameSession={(id, next) => renameSessionTitle(id, next)}
        onDeleteSession={(id) => removeSession(id)}
        sessions={sessions}
        sessionsReady={sessionsReady}
        sessionsError={sessionsError}
        onRetrySessions={() => void reloadSessions()}
        activeSessionId={sessionId}
        streamingSessionIds={streamingIds}
        userName={user?.user_name}
        onLogout={onLogout}
      />
      <main className="chat">
        {route === 'kb' && isAdmin ? (
          <KnowledgeBase onBack={() => goBack(isAdmin ? 'board' : 'chat')} canManage={isAdmin} />
        ) : (
          <>
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
                  <h1 className="landing-hello">{timeGreeting()}，让我们开始聊天吧</h1>
                  <Composer
                    value={input}
                    loading={loading || !ready}
                    webSearch={webSearch}
                    onToggleWebSearch={toggleWebSearch}
                    kbOn={kbOn}
                    onToggleKb={toggleKb}
                    onChange={setInput}
                    onSend={() => void send(undefined, { webSearch, kb: kbOn })}
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
                  onEditSubmit={(text) => void send(text, { webSearch, kb: kbOn })}
                  onRegenerate={(id) => void regenerate(id, { webSearch, kb: kbOn })}
                  onResume={() => void resumeRun()}
                  onLoadOlder={() => void loadOlder()}
                />
                <div className="dock">
                  {error ? <p className="error">{error}</p> : null}
                  <Composer
                    value={input}
                    loading={loading || !ready}
                    webSearch={webSearch}
                    onToggleWebSearch={toggleWebSearch}
                    kbOn={kbOn}
                    onToggleKb={toggleKb}
                    onChange={setInput}
                    onSend={() => void send(undefined, { webSearch, kb: kbOn })}
                    onStop={() => stop()}
                  />
                </div>
              </>
            )}
            <p className="disclaimer">内容由 AI 生成，请仔细甄别</p>
          </>
        )}
      </main>
    </div>
  )
}
