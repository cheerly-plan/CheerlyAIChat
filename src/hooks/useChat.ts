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
  const pendingText = useRef('')
  const streamId = useRef<string | null>(null)
  const raf = useRef(0)
  const nextBeforeSeq = useRef<number | null>(null)
  const loadingOlder = useRef(false)
  const draftKey = useRef(crypto.randomUUID())
  const sessionIdRef = useRef<string | null>(null)
  const sessionsRef = useRef<SessionInfo[]>([])
  const resumeRunId = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

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
    return () => {
      cancelled = true
      if (raf.current) cancelAnimationFrame(raf.current)
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

  function patchMessage(id: string, patch: (item: ChatMessage) => ChatMessage) {
    setMessages((prev) => {
      const index = prev.findIndex((item) => item.id === id)
      if (index === -1) return prev
      const item = prev[index]
      if (!item) return prev
      const next = prev.slice()
      next[index] = patch(item)
      return next
    })
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
        const { title } = await fetchSessionTitle(sessionId)
        if (title !== DEFAULT_SESSION_TITLE) {
          applyGeneratedTitle(sessionId, title)
          return
        }
      } catch {
        // 单次查询失败忽略，继续下一轮
      }
    }
  }

  function flushText() {
    if (raf.current) {
      cancelAnimationFrame(raf.current)
      raf.current = 0
    }
    const id = streamId.current
    const chunk = pendingText.current
    if (!id || !chunk) return
    pendingText.current = ''
    patchMessage(id, (item) => ({ ...item, content: item.content + chunk }))
  }

  function queueText(chunk: string) {
    pendingText.current += chunk
    if (raf.current) return
    raf.current = requestAnimationFrame(() => {
      raf.current = 0
      flushText()
    })
  }

  function stopStream() {
    // 取消在途的 SSE 请求（后端会把该 run 标为 interrupted）
    abortRef.current?.abort()
    abortRef.current = null
    pendingText.current = ''
    streamId.current = null
    if (raf.current) {
      cancelAnimationFrame(raf.current)
      raf.current = 0
    }
  }

  function clearConversation() {
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

  // 暂停生成：中止 SSE 请求，后端收到断开后把 checkpoint 标为 interrupted，
  // "继续生成"按钮随即亮起
  function stop() {
    abortRef.current?.abort()
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
    if (resumeRunId.current) {
      setCanResume(true)
      return
    }
    setMessages((prev) =>
      prev.filter((item) => {
        if (item.id !== assistantId || item.role !== 'assistant') return true
        return Boolean(
          item.content || (item.tools && item.tools.length) || item.sources?.length,
        )
      }),
    )
  }

  // 重新生成失败（error 事件）：后端未动库、旧回答原样保留，
  // 但前端已把旧气泡换成了新的，从服务端拉回权威历史恢复现场
  async function restoreHistoryAfterFailedRegenerate(id: string) {
    try {
      const page = await fetchChatMemory(id)
      if (sessionIdRef.current !== id) return
      setMessages(toChatMessages(page.messages))
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
    streamId.current = assistantId
    pendingText.current = ''
    if (raf.current) {
      cancelAnimationFrame(raf.current)
      raf.current = 0
    }
    setError('')
    setLoading(true)
    const controller = new AbortController()
    abortRef.current = controller
    // 流内出现 error 事件（LLM 失败等）：后端已把 checkpoint 标为 failed，
    // 属于异常收尾而非正常结束
    let sawError = false
    // 恢复时后端会重跑整段（不是只发剩余 token），第一条 text 覆盖半截内容
    let resumeReplacePending = Boolean(options.resumeRunId)
    try {
      const handler = (event: ChatEvent) => {
        if (streamId.current !== assistantId) return
        if (event.type === 'run_started') {
          // 记下本次 run 的 id：流异常断开后"继续生成"靠它发起恢复
          resumeRunId.current = event.run_id
          return
        }
        if (event.type === 'title_updated') {
          patchSessionTitle(event.session_id, event.title)
          return
        }
        if (event.type === 'text') {
          if (resumeReplacePending) {
            resumeReplacePending = false
            pendingText.current = ''
            patchMessage(assistantId, (item) => ({
              ...item,
              content: event.content,
            }))
            return
          }
          queueText(event.content)
          return
        }
        flushText()
        if (event.type === 'tool_start') {
          patchMessage(assistantId, (item) => ({
            ...item,
            // 优先用后端返回的展示名（如「智能搜索」），老后端缺 label 时回退工具名
            tools: [...(item.tools ?? []), { label: event.label ?? event.name, running: true }],
          }))
        }
        if (event.type === 'tool_end') {
          // 引用是累积后的整表（后端已按切片去重），直接替换
          const cited = event.sources
          // 把对应工具标记为已完成；之后到下一批 token 到达前是「模型思考」状态
          patchMessage(assistantId, (item) => ({
            ...item,
            tools: (item.tools ?? []).map((tool, index) =>
              index === (item.tools ?? []).length - 1 && tool.running
                ? { ...tool, running: false }
                : tool,
            ),
            sources: cited?.length ? cited : item.sources,
          }))
        }
        if (event.type === 'done') {
          const cited = event.sources
          if (cited?.length) {
            patchMessage(assistantId, (item) => ({ ...item, sources: cited }))
          }
        }
        if (event.type === 'error') {
          sawError = true
          setError(event.message)
          // LLM 失败在后端标为 failed，同样可恢复
          if (resumeRunId.current) setCanResume(true)
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
      if (streamId.current === assistantId) flushText()
      // 只有正常结束才清除可恢复标记；error 事件点亮的状态必须保留，
      // 否则"继续生成"按钮会刚亮起就被这里抹掉
      if (!sawError) clearResumeState()
      // SSE 流结束后标题由后台生成，轮询接口拿最终结果
      // （regenerate/resume 也可能补触发生成；pollSessionTitle 自带
      //  "标题非默认即退出"守卫，不会覆盖用户改过的名字）
      if (streamId.current === assistantId) {
        void pollSessionTitle(activeSessionId)
      }
      // 重新生成失败：恢复被前端移除的旧回答（后端库里原样保留）
      if (options.regenerate && sawError && sessionIdRef.current === activeSessionId) {
        await restoreHistoryAfterFailedRegenerate(activeSessionId)
      }
    } catch (err) {
      if (streamId.current === assistantId) {
        flushText()
        if (err instanceof DOMException && err.name === 'AbortError') {
          // 主动暂停：已生成的部分保留，checkpoint 在后端标为 interrupted
          setError('')
        } else {
          setError(err instanceof Error ? err.message : '发送失败')
        }
        // 极速暂停/断网时 run_started 可能未到达前端，向后端补查一次
        await settleInterruptedStream(activeSessionId, assistantId)
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      if (streamId.current === assistantId) {
        streamId.current = null
        setLoading(false)
      }
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
        setMessages((prev) => [...older, ...prev])
      }
      setHasMore(Boolean(page.has_more))
      nextBeforeSeq.current = page.next_before_seq ?? null
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
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', content },
      { id: assistantId, role: 'assistant', content: '', tools: [] },
    ])
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
    setMessages([
      ...messages.slice(0, index),
      { id: assistantId, role: 'assistant', content: '', tools: [] },
    ])
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
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', content: '', tools: [] },
      ])
    }
    await streamReply('', assistantId, sessionId, { resumeRunId: runId })
  }

  async function selectSession(id: string) {
    if (!user || id === sessionId) return
    stopStream()
    draftKey.current = crypto.randomUUID()
    sessionIdRef.current = id
    setSessionId(id)
    writeActiveSessionId(user.user_id, id)
    setError('')
    setLoading(false)
    clearResumeState()
    setMessages([])
    setHasMore(false)
    nextBeforeSeq.current = null
    loadingOlder.current = false
    setHistoryLoading(true)
    try {
      const page = await fetchChatMemory(id)
      if (sessionIdRef.current !== id) return
      setMessages(toChatMessages(page.messages))
      setHasMore(Boolean(page.has_more))
      nextBeforeSeq.current = page.next_before_seq ?? null
    } catch (err) {
      if (sessionIdRef.current === id) {
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
      setSessions((prev) => prev.filter((item) => item.session_id !== id))
      if (sessionIdRef.current === id) reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除会话失败')
    }
  }

  function reset() {
    stopStream()
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
