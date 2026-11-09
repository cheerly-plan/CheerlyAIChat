import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
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
import { ReportPreviewPanel } from './ReportPreviewPanel'
import { ReportReviewPanel } from './ReportReviewPanel'
import { ReportPreviewProvider, useChatSidePanel } from './ReportPreviewContext'
import { SourcePreviewPanel } from './SourcePreviewPanel'
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
    <ReportPreviewProvider>
      <ChatShell
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        route={route}
        isAdmin={isAdmin}
        isLanding={isLanding}
        title={title}
        sessionsReady={sessionsReady}
        error={error}
        input={input}
        setInput={setInput}
        loading={loading}
        ready={ready}
        webSearch={webSearch}
        toggleWebSearch={toggleWebSearch}
        kbOn={kbOn}
        toggleKb={toggleKb}
        send={send}
        stop={stop}
        messages={messages}
        historyLoading={historyLoading}
        hasMore={hasMore}
        canResume={canResume}
        regenerate={regenerate}
        resumeRun={resumeRun}
        loadOlder={loadOlder}
        reset={reset}
        selectSession={selectSession}
        renameSessionTitle={renameSessionTitle}
        removeSession={removeSession}
        sessions={sessions}
        sessionsError={sessionsError}
        reloadSessions={reloadSessions}
        sessionId={sessionId}
        streamingIds={streamingIds}
        userName={user?.user_name}
        onLogout={onLogout}
      />
    </ReportPreviewProvider>
  )
}

type ShellProps = {
  sidebarOpen: boolean
  setSidebarOpen: Dispatch<SetStateAction<boolean>>
  route: ReturnType<typeof useRoute>
  isAdmin: boolean
  isLanding: boolean
  title: string
  sessionsReady: boolean
  error: string | null
  input: string
  setInput: (value: string) => void
  loading: boolean
  ready: boolean
  webSearch: boolean
  toggleWebSearch: () => void
  kbOn: boolean
  toggleKb: () => void
  send: (
    text?: string,
    options?: { webSearch?: boolean; kb?: boolean },
  ) => void | Promise<void>
  stop: () => void
  messages: ReturnType<typeof useChat>['messages']
  historyLoading: boolean
  hasMore: boolean
  canResume: boolean
  regenerate: (
    id: string,
    options?: { webSearch?: boolean; kb?: boolean },
  ) => void | Promise<void>
  resumeRun: () => void | Promise<void>
  loadOlder: () => void | Promise<void>
  reset: () => void
  selectSession: (id: string) => void | Promise<void>
  renameSessionTitle: (id: string, next: string) => void
  removeSession: (id: string) => void
  sessions: ReturnType<typeof useChat>['sessions']
  sessionsError: string | null
  reloadSessions: () => void | Promise<void>
  sessionId: string | null | undefined
  streamingIds: ReturnType<typeof useChat>['streamingIds']
  userName?: string | null
  onLogout: () => void
}

function ChatShell(props: ShellProps) {
  const { panel, close: closeSidePanel } = useChatSidePanel()
  const panelOpen = panel != null
  // 打开右侧面板前侧栏是否展开：关闭时仅在当时是展开的才恢复。
  const sidebarBeforePanel = useRef<boolean | null>(null)
  const sidebarOpenRef = useRef(props.sidebarOpen)
  sidebarOpenRef.current = props.sidebarOpen

  useEffect(() => {
    if (panelOpen) {
      if (sidebarBeforePanel.current === null) {
        sidebarBeforePanel.current = sidebarOpenRef.current
        props.setSidebarOpen(false)
      }
      return
    }
    if (sidebarBeforePanel.current !== null) {
      if (sidebarBeforePanel.current) props.setSidebarOpen(true)
      sidebarBeforePanel.current = null
    }
  }, [panelOpen, props.setSidebarOpen])

  function toggleSidebar() {
    if (props.sidebarOpen) {
      props.setSidebarOpen(false)
      return
    }
    // 用户主动展开侧栏：关掉右侧，且不要在关面板时再自动恢复侧栏。
    sidebarBeforePanel.current = null
    closeSidePanel()
    props.setSidebarOpen(true)
  }

  return (
    <div
      className={`shell${props.sidebarOpen ? '' : ' sidebar-collapsed'}${
        panelOpen ? ' side-panel-open' : ''
      }`}
    >
      <div className="sidebar-mask" onClick={() => props.setSidebarOpen(false)} />
      <Sidebar
        onNewChat={() => {
          navigate('chat')
          props.reset()
        }}
        onCollapse={() => props.setSidebarOpen(false)}
        onSelectSession={(id) => {
          navigate('chat')
          void props.selectSession(id)
        }}
        onRenameSession={(id, next) => props.renameSessionTitle(id, next)}
        onDeleteSession={(id) => props.removeSession(id)}
        sessions={props.sessions}
        sessionsReady={props.sessionsReady}
        sessionsError={props.sessionsError ?? undefined}
        onRetrySessions={() => void props.reloadSessions()}
        activeSessionId={props.sessionId ?? undefined}
        streamingSessionIds={props.streamingIds}
        userName={props.userName ?? undefined}
        onLogout={props.onLogout}
      />
      <main className="chat">
        {props.route === 'kb' && props.isAdmin ? (
          <KnowledgeBase
            onBack={() => goBack(props.isAdmin ? 'board' : 'chat')}
            canManage={props.isAdmin}
          />
        ) : (
          <>
            <ChatHeader
              title={props.title}
              titleLoading={!props.sessionsReady && hasCachedActiveSession()}
              collapsed={!props.sidebarOpen}
              onToggleSidebar={toggleSidebar}
              onNewChat={props.reset}
            />
            {props.isLanding ? (
              <div className="landing">
                {props.error ? <p className="error">{props.error}</p> : null}
                <div className="landing-hero">
                  <h1 className="landing-hello">{timeGreeting()}，让我们开始聊天吧</h1>
                  <Composer
                    value={props.input}
                    loading={props.loading || !props.ready}
                    webSearch={props.webSearch}
                    onToggleWebSearch={props.toggleWebSearch}
                    kbOn={props.kbOn}
                    onToggleKb={props.toggleKb}
                    onChange={props.setInput}
                    onSend={() =>
                      void props.send(undefined, {
                        webSearch: props.webSearch,
                        kb: props.kbOn,
                      })
                    }
                    onStop={() => props.stop()}
                  />
                </div>
              </div>
            ) : (
              <>
                <MessageList
                  key={props.sessionId ?? 'new'}
                  messages={props.messages}
                  loading={props.loading}
                  historyLoading={props.historyLoading}
                  hasMore={props.hasMore}
                  canResume={props.canResume}
                  onEditSubmit={(text) =>
                    void props.send(text, {
                      webSearch: props.webSearch,
                      kb: props.kbOn,
                    })
                  }
                  onRegenerate={(id) =>
                    void props.regenerate(id, {
                      webSearch: props.webSearch,
                      kb: props.kbOn,
                    })
                  }
                  onResume={() => void props.resumeRun()}
                  onLoadOlder={() => void props.loadOlder()}
                />
                <div className="dock">
                  {props.error ? <p className="error">{props.error}</p> : null}
                  <Composer
                    value={props.input}
                    loading={props.loading || !props.ready}
                    webSearch={props.webSearch}
                    onToggleWebSearch={props.toggleWebSearch}
                    kbOn={props.kbOn}
                    onToggleKb={props.toggleKb}
                    onChange={props.setInput}
                    onSend={() =>
                      void props.send(undefined, {
                        webSearch: props.webSearch,
                        kb: props.kbOn,
                      })
                    }
                    onStop={() => props.stop()}
                  />
                </div>
              </>
            )}
            <p className="disclaimer">内容由 AI 生成，请仔细甄别</p>
          </>
        )}
      </main>
      <ReportPreviewPanel />
      {panel?.mode === 'review' ? (
        <ReportReviewPanel
          key={panel.reportId ?? 'queue'}
          reportId={panel.reportId}
        />
      ) : null}
      <SourcePreviewPanel />
    </div>
  )
}
