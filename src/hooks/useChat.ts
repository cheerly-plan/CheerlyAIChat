import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_SESSION_TITLE,
  createSession,
  deleteSession,
  fetchChatMemory,
  fetchPendingRun,
  fetchSessionTitle,
  fetchSessions,
  fetchUserInfo,
  readActiveSessionId,
  renameSession,
  resumeChatStream,
  sendChatStream,
  toChatMessages,
  writeActiveSessionId,
} from '../api'
import type { ChatEvent, ChatMessage, SessionInfo, UserInfo } from '../types'

// 后端在对话结束后异步生成会话标题并写库，
// 前端轮询 GET /v1/session/title 直到拿到非默认标题或超时。
const TITLE_POLL_INTERVAL_MS = 2000
const TITLE_POLL_MAX_ATTEMPTS = 12
// 服务端重启场景：流断开瞬间后端可能还没 ready（启动收敛 running→interrupted
// 尚未执行），首次 pending_run 查不到时延迟重试一次
const RESUME_DISCOVERY_RETRY_MS = 4000

// 切走会话时 SSE 继续读完。界面状态挂在这条记录上，回来再铺回当前视图。
type LiveRun = {
  controller: AbortController
  assistantId: string
  messages: ChatMessage[]
  pending: string
  raf: number
  error: string
  canResume: boolean
  resumeRunId: string | null
  hasMore: boolean
  nextBeforeSeq: number | null
}

export function useChat(initialUser?: UserInfo | null) {
  const [user, setUser] = useState<UserInfo | null>(null)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [sessionsReady, setSessionsReady] = useState(false)
  const [sessionsError, setSessionsError] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  // 断点续跑：后端 checkpoint 里存在 failed/interrupted 的 run 时可"继续生成"
  const [canResume, setCanResume] = useState(false)
  // 仍在读 SSE 的会话。侧栏给这些会话显示进行中，不限于当前打开的那一个
  const [streamingIds, setStreamingIds] = useState<string[]>([])
  const nextBeforeSeq = useRef<number | null>(null)
  const loadingOlder = useRef(false)
  const draftKey = useRef(crypto.randomUUID())
  const sessionIdRef = useRef<string | null>(null)
  const sessionsRef = useRef<SessionInfo[]>([])
  const messagesRef = useRef<ChatMessage[]>([])
  const resumeRunId = useRef<string | null>(null)
  const runsRef = useRef<Map<string, LiveRun>>(new Map())

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    let cancelled = false
    // App 登录门禁已校验令牌并拿到用户信息时直接复用，避免重复请求 /user/info
    const ready = initialUser ? Promise.resolve(initialUser) : fetchUserInfo()
    ready
      .then(async (info) => {
        let list: SessionInfo[] = []
        let listError = ''
        try {
          list = await fetchSessions()
        } catch (err) {
          listError = err instanceof Error ? err.message : '获取会话列表失败'
        }
        if (cancelled) return
        setUser(info)
        if (listError) {
          // 加载失败 ≠ 没有会话，交给侧栏展示错误并支持重试
          setSessionsError(listError)
        } else {
          setSessions(mergePendingSessions(sessionsRef.current, list))
        }
        setSessionsReady(true)
        const cached = readActiveSessionId(info.user_id)
        if (!cached || !list.some((item) => item.session_id === cached)) {
          if (cached) writeActiveSessionId(info.user_id, null)
          return
        }
        sessionIdRef.current = cached
        setSessionId(cached)
        setHistoryLoading(true)
        try {
          const page = await fetchChatMemory(cached)
          if (cancelled || sessionIdRef.current !== cached) return
          setMessages(toChatMessages(page.messages))
          setHasMore(Boolean(page.has_more))
          nextBeforeSeq.current = page.next_before_seq ?? null
        } catch (err) {
          if (!cancelled && sessionIdRef.current === cached) {
            setError(err instanceof Error ? err.message : '获取会话记忆失败')
          }
        } finally {
          if (!cancelled && sessionIdRef.current === cached) {
            setHistoryLoading(false)
          }
        }
        if (!cancelled && sessionIdRef.current === cached) {
          void discoverPendingRun(cached)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '获取用户信息失败')
          setSessionsError('会话列表加载失败')
          setSessionsReady(true)
        }
      })
    const runs = runsRef.current
    return () => {
      cancelled = true
      for (const run of runs.values()) {
        if (run.raf) cancelAnimationFrame(run.raf)
        run.controller.abort()
      }
    }
    // 仅在挂载时初始化；用户切换/登出由 App 用 key 重建整个 Chat，无需依赖 initialUser
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 合并服务器列表与本地临时会话：列表请求期间用户新建的会话不被覆盖丢失
  function mergePendingSessions(
    pending: SessionInfo[],
    list: SessionInfo[],
  ): SessionInfo[] {
    const known = new Set(list.map((item) => item.session_id))
    const local = pending.filter((item) => !known.has(item.session_id))
    return local.length ? [...local, ...list] : list
  }

  async function reloadSessions() {
    if (!sessionsReady) return
    setSessionsError('')
    try {
      const list = await fetchSessions()
      setSessions(mergePendingSessions(sessionsRef.current, list))
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : '获取会话列表失败')
    }
  }

  function viewing(id: string) {
    return sessionIdRef.current === id
  }

  function publishStreaming() {
    setStreamingIds([...runsRef.current.keys()])
  }

  function commitMessages(id: string, next: ChatMessage[]) {
    const run = runsRef.current.get(id)
    if (run) run.messages = next
    if (viewing(id)) {
      messagesRef.current = next
      setMessages(next)
    }
  }

  function patchRun(
    id: string,
    messageId: string,
    patch: (item: ChatMessage) => ChatMessage,
  ) {
    const run = runsRef.current.get(id)
    const prev = run?.messages ?? (viewing(id) ? messagesRef.current : [])
    const index = prev.findIndex((item) => item.id === messageId)
    if (index === -1) return
    const item = prev[index]
    if (!item) return
    const next = prev.slice()
    next[index] = patch(item)
    commitMessages(id, next)
  }

  function flushRun(id: string) {
    const run = runsRef.current.get(id)
    if (!run) return
    if (run.raf) {
      cancelAnimationFrame(run.raf)
      run.raf = 0
    }
    const chunk = run.pending
    if (!chunk) return
    run.pending = ''
    patchRun(id, run.assistantId, (item) => ({
      ...item,
      content: item.content + chunk,
    }))
  }

  function queueRunText(id: string, chunk: string) {
    const run = runsRef.current.get(id)
    if (!run) return
    run.pending += chunk
    if (run.raf) return
    run.raf = requestAnimationFrame(() => {
      const current = runsRef.current.get(id)
      if (current) current.raf = 0
      flushRun(id)
    })
  }

  function abortRun(id: string) {
    runsRef.current.get(id)?.controller.abort()
  }

  function upsertSession(session: SessionInfo) {
    setSessions((prev) => {
      const index = prev.findIndex((item) => item.session_id === session.session_id)
      if (index === -1) return [session, ...prev]
      const merged = { ...prev[index], ...session }
      const next = prev.slice()
      next.splice(index, 1)
      next.unshift(merged)
      return next
    })
  }

  function patchSessionTitle(id: string, title: string) {
    setSessions((prev) => {
      const index = prev.findIndex((item) => item.session_id === id)
      if (index === -1) return prev
      const current = prev[index]
      if (!current || current.title === title) return prev
      const next = prev.slice()
      next[index] = { ...current, title }
      return next
    })
  }

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  // 只在会话仍为默认标题时应用生成结果，避免覆盖用户手动改的名字；
  // 会话被删除后停止轮询。
  function applyGeneratedTitle(id: string, title: string) {
    const target = sessionsRef.current.find((item) => item.session_id === id)
    if (!target || target.title !== DEFAULT_SESSION_TITLE) return
    patchSessionTitle(id, title)
  }

  async function pollSessionTitle(sessionId: string) {
    if (!user) return
    for (let attempt = 0; attempt < TITLE_POLL_MAX_ATTEMPTS; attempt += 1) {
      await sleep(TITLE_POLL_INTERVAL_MS)
      const target = sessionsRef.current.find((item) => item.session_id === sessionId)
      if (!target || target.title !== DEFAULT_SESSION_TITLE) return
      try {
        const result = await fetchSessionTitle(sessionId)
        if (!result) return
        if (result.title !== DEFAULT_SESSION_TITLE) {
          applyGeneratedTitle(sessionId, result.title)
          return
        }
      } catch {
        // 单次查询失败忽略，继续下一轮
      }
    }
  }

  function clearConversation() {
    messagesRef.current = []
    setMessages([])
    setError('')
    setLoading(false)
    setHistoryLoading(false)
    setHasMore(false)
    nextBeforeSeq.current = null
    loadingOlder.current = false
    clearResumeState()
  }

  function clearResumeState() {
    resumeRunId.current = null
    setCanResume(false)
  }

  // 暂停当前会话的生成。只断开这一条 SSE，其它会话里还在跑的流不动
  function stop() {
    const id = sessionIdRef.current
    if (id) abortRun(id)
  }

  // 会话记忆加载完成后查询后端有没有可恢复的未完成回复（刷新页面后找回现场）
  async function discoverPendingRun(id: string) {
    try {
      const runId = await fetchPendingRun(id)
      if (runId && sessionIdRef.current === id) {
        resumeRunId.current = runId
        setCanResume(true)
      }
      return runId
    } catch {
      /* 发现失败不影响正常使用 */
      return null
    }
  }

  // 流异常终止（暂停/断网/服务端重启）后的收尾。极速暂停时 run_started 可能
  // 还没到达前端，resumeRunId 为空——此时向后端查询；确认没有任何可恢复内容
  // 时才移除末尾空气泡，避免残影
  async function settleInterruptedStream(
    activeSessionId: string,
    assistantId: string,
  ) {
    if (!resumeRunId.current) {
      // 后端 close 生成器是异步的，极速暂停时 checkpoint 可能还没标成 interrupted
      for (let i = 0; i < 5 && !resumeRunId.current; i += 1) {
        if (i) await sleep(200)
        await discoverPendingRun(activeSessionId)
      }
      // 服务端重启场景：断流瞬间后端可能还没 ready（启动收敛 running→
      // interrupted 尚未执行），短轮询拿不到时等几秒再补查一次
      if (!resumeRunId.current && sessionIdRef.current === activeSessionId) {
        await sleep(RESUME_DISCOVERY_RETRY_MS)
        if (sessionIdRef.current === activeSessionId) {
          await discoverPendingRun(activeSessionId)
        }
      }
    }
    if (sessionIdRef.current !== activeSessionId) return
    if (resumeRunId.current) {
      const run = runsRef.current.get(activeSessionId)
      if (run) run.canResume = true
      setCanResume(true)
      return
    }
    setMessages((prev) => {
      const next = prev.filter((item) => {
        if (item.id !== assistantId || item.role !== 'assistant') return true
        return Boolean(item.content || item.sources?.length)
      })
      messagesRef.current = next
      const run = runsRef.current.get(activeSessionId)
      if (run) run.messages = next
      return next
    })
  }

  // 重新生成失败（error 事件）：后端未动库、旧回答原样保留，
  // 但前端已把旧气泡换成了新的，从服务端拉回权威历史恢复现场
  async function restoreHistoryAfterFailedRegenerate(id: string) {
    try {
      const page = await fetchChatMemory(id)
      if (sessionIdRef.current !== id) return
      const next = toChatMessages(page.messages)
      messagesRef.current = next
      setMessages(next)
      setHasMore(Boolean(page.has_more))
      nextBeforeSeq.current = page.next_before_seq ?? null
    } catch {
      /* 恢复失败保留当前界面，错误提示已单独展示 */
    }
  }

  async function streamReply(
    userContent: string,
    assistantId: string,
    activeSessionId: string,
    options: {
      regenerate?: boolean
      resumeRunId?: string
      webSearch?: boolean
      // 知识库开关：透传给后端决定是否挂载 kb_search / kg_search
      kb?: boolean
    } = {},
  ) {
    if (!user) {
      setError('用户信息未就绪')
      return
    }
    const controller = new AbortController()
    const run: LiveRun = {
      controller,
      assistantId,
      messages: messagesRef.current.slice(),
      pending: '',
      raf: 0,
      error: '',
      canResume: false,
      resumeRunId: options.resumeRunId ?? null,
      hasMore,
      nextBeforeSeq: nextBeforeSeq.current,
    }
    const previous = runsRef.current.get(activeSessionId)
    if (previous && previous.assistantId !== assistantId) previous.controller.abort()
    runsRef.current.set(activeSessionId, run)
    publishStreaming()
    if (viewing(activeSessionId)) {
      setError('')
      setLoading(true)
    }
    // 流内出现 error 事件（LLM 失败等）：后端已把 checkpoint 标为 failed，
    // 属于异常收尾而非正常结束
    let sawError = false
    // 恢复时后端会重跑整段（不是只发剩余 token），第一条 text 覆盖半截内容
    let resumeReplacePending = Boolean(options.resumeRunId)
    const owned = () => runsRef.current.get(activeSessionId)?.assistantId === assistantId
    try {
      const handler = (event: ChatEvent) => {
        if (!owned()) return
        if (event.type === 'run_started') {
          // 记下本次 run 的 id：流异常断开后"继续生成"靠它发起恢复
          run.resumeRunId = event.run_id
          if (viewing(activeSessionId)) resumeRunId.current = event.run_id
          return
        }
        if (event.type === 'title_updated') {
          patchSessionTitle(event.session_id, event.title)
          return
        }
        if (event.type === 'text') {
          if (resumeReplacePending) {
            resumeReplacePending = false
            run.pending = ''
            patchRun(activeSessionId, assistantId, (item) => ({
              ...item,
              content: event.content,
            }))
            return
          }
          queueRunText(activeSessionId, event.content)
          return
        }
        flushRun(activeSessionId)
        if (event.type === 'tool_start') {
          // 工具调用不展示过程。清掉调用前的半截字，气泡只留写作光标，
          // 直到最终回答的 text 流过来。
          run.pending = ''
          patchRun(activeSessionId, assistantId, (item) => ({ ...item, content: '' }))
        }
        if (event.type === 'tool_end') {
          const cited = event.sources
          if (cited?.length) {
            patchRun(activeSessionId, assistantId, (item) => ({ ...item, sources: cited }))
          }
        }
        if (event.type === 'done') {
          const cited = event.sources
          patchRun(activeSessionId, assistantId, (item) => ({
            ...item,
            sources: cited?.length ? cited : item.sources,
          }))
        }
        if (event.type === 'error') {
          sawError = true
          run.error = event.message
          run.canResume = Boolean(run.resumeRunId)
          if (viewing(activeSessionId)) {
            setError(event.message)
            if (run.resumeRunId) setCanResume(true)
          }
        }
      }
      if (options.resumeRunId) {
        await resumeChatStream(options.resumeRunId, activeSessionId, handler, {
          signal: controller.signal,
        })
      } else {
        await sendChatStream(userContent, activeSessionId, handler, {
          ...options,
          signal: controller.signal,
        })
      }
      if (owned()) flushRun(activeSessionId)
      // 只有正常结束才清除可恢复标记；error 事件点亮的状态必须保留，
      // 否则"继续生成"按钮会刚亮起就被这里抹掉
      if (!sawError && viewing(activeSessionId)) clearResumeState()
      // SSE 流结束后标题由后台生成，轮询接口拿最终结果
      // （regenerate/resume 也可能补触发生成；pollSessionTitle 自带
      //  "标题非默认即退出"守卫，不会覆盖用户改过的名字）
      if (owned()) void pollSessionTitle(activeSessionId)
      // 重新生成失败：恢复被前端移除的旧回答（后端库里原样保留）
      if (options.regenerate && sawError && viewing(activeSessionId)) {
        await restoreHistoryAfterFailedRegenerate(activeSessionId)
      }
    } catch (err) {
      if (!owned()) return
      flushRun(activeSessionId)
      if (!viewing(activeSessionId)) return
      if (err instanceof DOMException && err.name === 'AbortError') {
        // 主动暂停：已生成的部分保留，checkpoint 在后端标为 interrupted
        setError('')
      } else {
        setError(err instanceof Error ? err.message : '发送失败')
      }
      // 极速暂停/断网时 run_started 可能未到达前端，向后端补查一次
      await settleInterruptedStream(activeSessionId, assistantId)
    } finally {
      if (runsRef.current.get(activeSessionId)?.assistantId === assistantId) {
        const current = runsRef.current.get(activeSessionId)
        if (current?.raf) cancelAnimationFrame(current.raf)
        runsRef.current.delete(activeSessionId)
        publishStreaming()
      }
      if (viewing(activeSessionId)) setLoading(runsRef.current.has(activeSessionId))
    }
  }

  async function loadOlder() {
    if (!user || !sessionId || !hasMore || loadingOlder.current) return
    loadingOlder.current = true
    setHistoryLoading(true)
    try {
      const page = await fetchChatMemory(
        sessionId,
        { beforeSeq: nextBeforeSeq.current },
      )
      const older = toChatMessages(page.messages)
      if (older.length) {
        setMessages((prev) => {
          const next = [...older, ...prev]
          messagesRef.current = next
          const run = runsRef.current.get(sessionId)
          if (run) run.messages = next
          return next
        })
      }
      const more = Boolean(page.has_more)
      const before = page.next_before_seq ?? null
      setHasMore(more)
      nextBeforeSeq.current = before
      const run = runsRef.current.get(sessionId)
      if (run) {
        run.hasMore = more
        run.nextBeforeSeq = before
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载更早消息失败')
    } finally {
      loadingOlder.current = false
      setHistoryLoading(false)
    }
  }

  async function ensureSession(): Promise<string | null> {
    if (!user) {
      setError('用户信息未就绪')
      return null
    }
    if (sessionIdRef.current) return sessionIdRef.current
    const created = await createSession(draftKey.current)
    sessionIdRef.current = created.session_id
    setSessionId(created.session_id)
    writeActiveSessionId(user.user_id, created.session_id)
    upsertSession(created)
    return created.session_id
  }

  async function send(
    text?: string,
    options: { webSearch?: boolean; kb?: boolean } = {},
  ) {
    const content = (text ?? input).trim()
    if (!content || loading || !user) return

    setInput('')
    setLoading(true)
    setError('')
    let activeId: string | null
    try {
      activeId = await ensureSession()
    } catch (err) {
      setLoading(false)
      setInput(content)
      setError(err instanceof Error ? err.message : '创建会话失败')
      return
    }
    if (!activeId) {
      setLoading(false)
      setInput(content)
      return
    }
    // 发新消息覆盖未完成回复，不再展示「继续生成」
    clearResumeState()

    const assistantId = crypto.randomUUID()
    const next = [
      ...messages,
      { id: crypto.randomUUID(), role: 'user' as const, content },
      { id: assistantId, role: 'assistant' as const, content: '' },
    ]
    messagesRef.current = next
    setMessages(next)
    await streamReply(content, assistantId, activeId, {
      webSearch: options.webSearch,
      kb: options.kb,
    })
  }

  async function regenerate(
    id: string,
    options: { webSearch?: boolean; kb?: boolean } = {},
  ) {
    if (loading || !user || !sessionId) return
    clearResumeState()
    const last = messages[messages.length - 1]
    if (!last || last.id !== id || last.role !== 'assistant') return
    const index = messages.length - 1
    const previous = messages[index - 1]
    if (!previous || previous.role !== 'user') return
    const assistantId = crypto.randomUUID()
    const next = [
      ...messages.slice(0, index),
      { id: assistantId, role: 'assistant' as const, content: '' },
    ]
    messagesRef.current = next
    setMessages(next)
    // regenerate=true：后端不重复保存用户消息，并剔除旧的助手回答
    await streamReply(previous.content, assistantId, sessionId, {
      regenerate: true,
      webSearch: options.webSearch,
      kb: options.kb,
    })
  }

  // 断点续跑：后端从完整消息重跑，首条 text 覆盖半截内容；
  // 没有半截回答时新建一条气泡
  async function resumeRun() {
    const runId = resumeRunId.current
    if (!runId || loading || !user || !sessionId) return
    clearResumeState()
    const last = messages[messages.length - 1]
    let assistantId: string
    if (last && last.role === 'assistant') {
      assistantId = last.id
    } else {
      assistantId = crypto.randomUUID()
      const next = [
        ...messages,
        { id: assistantId, role: 'assistant' as const, content: '' },
      ]
      messagesRef.current = next
      setMessages(next)
    }
    await streamReply('', assistantId, sessionId, { resumeRunId: runId })
  }

  async function selectSession(id: string) {
    if (!user || id === sessionId) return
    const leaving = sessionIdRef.current
    if (leaving) flushRun(leaving)
    draftKey.current = crypto.randomUUID()
    sessionIdRef.current = id
    setSessionId(id)
    writeActiveSessionId(user.user_id, id)
    const run = runsRef.current.get(id)
    if (run) {
      // 这条会话的 SSE 还在读，直接铺回切走前的气泡，不重新拉历史盖掉半截回答
      messagesRef.current = run.messages
      setMessages(run.messages)
      setLoading(true)
      setError(run.error)
      resumeRunId.current = run.resumeRunId
      setCanResume(run.canResume)
      setHasMore(run.hasMore)
      nextBeforeSeq.current = run.nextBeforeSeq
      setHistoryLoading(false)
      return
    }
    setError('')
    setLoading(false)
    clearResumeState()
    messagesRef.current = []
    setMessages([])
    setHasMore(false)
    nextBeforeSeq.current = null
    loadingOlder.current = false
    setHistoryLoading(true)
    try {
      const page = await fetchChatMemory(id)
      if (sessionIdRef.current !== id) return
      const next = toChatMessages(page.messages)
      messagesRef.current = next
      setMessages(next)
      setHasMore(Boolean(page.has_more))
      nextBeforeSeq.current = page.next_before_seq ?? null
    } catch (err) {
      if (sessionIdRef.current === id) {
        messagesRef.current = []
        setMessages([])
        setError(err instanceof Error ? err.message : '获取会话记忆失败')
      }
    } finally {
      if (sessionIdRef.current === id) setHistoryLoading(false)
    }
    if (sessionIdRef.current === id) await discoverPendingRun(id)
  }

  async function renameSessionTitle(id: string, title: string) {
    if (!user) return
    const next = title.trim()
    if (!next) return
    try {
      const updated = await renameSession(id, next)
      patchSessionTitle(id, updated.title)
    } catch (err) {
      setError(err instanceof Error ? err.message : '重命名会话失败')
    }
  }

  async function removeSession(id: string) {
    if (!user) return
    try {
      await deleteSession(id)
      abortRun(id)
      setSessions((prev) => prev.filter((item) => item.session_id !== id))
      if (sessionIdRef.current === id) reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除会话失败')
    }
  }

  function reset() {
    const leaving = sessionIdRef.current
    if (leaving) flushRun(leaving)
    draftKey.current = crypto.randomUUID()
    sessionIdRef.current = null
    setSessionId(null)
    if (user) writeActiveSessionId(user.user_id, null)
    clearConversation()
  }

  const activeSession = sessions.find((item) => item.session_id === sessionId)
  const title = activeSession?.title ?? ''

  return {
    user,
    sessions,
    sessionsReady,
    sessionsError,
    reloadSessions,
    sessionId,
    streamingIds,
    messages,
    input,
    setInput,
    loading,
    historyLoading,
    hasMore,
    ready: Boolean(user),
    error,
    send,
    loadOlder,
    reset,
    selectSession,
    renameSessionTitle,
    removeSession,
    title,
    regenerate,
    canResume,
    resumeRun,
    stop,
  }
}
