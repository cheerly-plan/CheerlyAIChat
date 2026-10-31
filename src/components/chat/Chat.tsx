import { useEffect, useState } from 'react'
import { hasCachedActiveSession } from '../../api'
import { useChat } from '../../hooks/useChat'
import { navigate, useRoute } from '../../router'
import type { UserInfo } from '../../types'
import { KnowledgeBase } from '../kb/KnowledgeBase'
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
    title,
    regenerate,
    canResume,
    resumeRun,
    stop,
  } = useChat(initialUser)
  const [sidebarOpen, setSidebarOpen] = useState(
    () => window.matchMedia('(min-width: 861px)').matches,
  )
  // 主区域视图由 URL 决定（#/kb = 知识库），刷新后仍停在原页面
  const route = useRoute()
  // 知识库页（上传/编辑切片/建图）只对管理员开放：入口不渲染 + 直接
  // 访问 #/kb 时回落到对话。对话里的「知识库」开关是另一回事——所有
  // 用户都能开（挂载 kb_search 工具查库）
  const isAdmin = Boolean(user?.is_admin)
  // 用户信息未就绪前不能做权限判定：#/kb 刷新进来时 user 还是 null，
  // 此时 isAdmin 必为 false，若立即判会把管理员也打回对话页（表现为刷新后回退）。
  // sessionsReady 同时作为「初始化已结束」的兜底信号：取用户信息失败时
  // ready 会一直为 false，靠它把占位页收掉，不至于永久停在加载中。
  const kbAccessPending = route === 'kb' && !ready && !sessionsReady
  useEffect(() => {
    if (route !== 'kb' || kbAccessPending || isAdmin) return
    navigate('chat')
  }, [route, kbAccessPending, isAdmin])
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
        chatLoading={loading}
        userName={user?.user_name}
        onLogout={onLogout}
        onOpenKb={isAdmin ? () => navigate('kb') : undefined}
      />
      <main className="chat">
        {kbAccessPending ? (
          // 权限待定：先铺知识库的白底，避免闪一帧对话页再切走
          <div className="kb-page">
            <p className="kb-boot">正在加载知识库…</p>
          </div>
        ) : route === 'kb' && isAdmin ? (
          <KnowledgeBase onBack={() => navigate('chat')} canManage={isAdmin} />
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
                  <h1 className="landing-hello">
                    <Logo size={36} />
                    <span>{timeGreeting()}，让我们开始聊天吧</span>
                  </h1>
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
