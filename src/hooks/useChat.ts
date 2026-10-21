import { useEffect, useRef, useState } from 'react'
import {
  createSession,
  deleteSession,
  fetchChatMemory,
  fetchSessions,
  fetchUserInfo,
  readActiveSessionId,
  renameSession,
  sendChatStream,
  toChatMessages,
  writeActiveSessionId,
} from '../api'
import type { ChatMessage, SessionInfo, UserInfo } from '../types'

export function useChat() {
  const [user, setUser] = useState<UserInfo | null>(null)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [sessionsReady, setSessionsReady] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const pendingText = useRef('')
  const streamId = useRef<string | null>(null)
  const raf = useRef(0)
  const nextBeforeSeq = useRef<number | null>(null)
  const loadingOlder = useRef(false)
  const draftKey = useRef(crypto.randomUUID())
  const sessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    let cancelled = false
    fetchUserInfo()
      .then(async (info) => {
        let list: SessionInfo[] = []
        let listError = ''
        try {
          list = await fetchSessions(info.user_id)
        } catch (err) {
          listError = err instanceof Error ? err.message : '获取会话列表失败'
        }
        if (cancelled) return
        setUser(info)
        setSessions(list)
        setSessionsReady(true)
        if (listError) setError(listError)
        const cached = readActiveSessionId(info.user_id)
        if (!cached || !list.some((item) => item.session_id === cached)) {
          if (cached) writeActiveSessionId(info.user_id, null)
          return
        }
        sessionIdRef.current = cached
        setSessionId(cached)
        setHistoryLoading(true)
        try {
          const page = await fetchChatMemory({
            user_id: info.user_id,
            chat_session_id: cached,
          })
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
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '获取用户信息失败')
          setSessionsReady(true)
        }
      })
    return () => {
      cancelled = true
      if (raf.current) cancelAnimationFrame(raf.current)
    }
  }, [])

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
      if (index === -1) {
        return [{ session_id: id, title }, ...prev]
      }
      const current = prev[index]
      if (!current || current.title === title) return prev
      const next = prev.slice()
      next[index] = { ...current, title }
      return next
    })
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
  }

  async function streamReply(
    userContent: string,
    assistantId: string,
    activeSessionId: string,
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
    try {
      await sendChatStream(
        userContent,
        { user_id: user.user_id, chat_session_id: activeSessionId },
        (event) => {
          if (streamId.current !== assistantId) return
          if (event.type === 'title_updated') {
            patchSessionTitle(event.session_id, event.title)
            return
          }
          if (event.type === 'text') {
            queueText(event.content)
            return
          }
          flushText()
          if (event.type === 'tool_start') {
            patchMessage(assistantId, (item) => ({
              ...item,
              tools: [...(item.tools ?? []), event.name],
            }))
          }
          if (event.type === 'error') {
            setError(event.message)
          }
        },
      )
      if (streamId.current === assistantId) flushText()
    } catch (err) {
      if (streamId.current === assistantId) {
        flushText()
        setError(err instanceof Error ? err.message : '发送失败')
      }
    } finally {
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
        { user_id: user.user_id, chat_session_id: sessionId },
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
    const created = await createSession(user.user_id, draftKey.current)
    sessionIdRef.current = created.session_id
    setSessionId(created.session_id)
    writeActiveSessionId(user.user_id, created.session_id)
    upsertSession(created)
    return created.session_id
  }

  async function send(text?: string) {
    const content = (text ?? input).trim()
    if (!content || loading || !user) return

    setInput('')
    setLoading(true)
    setError('')
    let activeId: string | null = null
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

    const assistantId = crypto.randomUUID()
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', content },
      { id: assistantId, role: 'assistant', content: '', tools: [] },
    ])
    await streamReply(content, assistantId, activeId)
  }

  async function regenerate(id: string) {
    if (loading || !user || !sessionId) return
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
    await streamReply(previous.content, assistantId, sessionId)
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
    setMessages([])
    setHasMore(false)
    nextBeforeSeq.current = null
    loadingOlder.current = false
    setHistoryLoading(true)
    try {
      const page = await fetchChatMemory({
        user_id: user.user_id,
        chat_session_id: id,
      })
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
  }

  async function renameSessionTitle(id: string, title: string) {
    if (!user) return
    const next = title.trim()
    if (!next) return
    try {
      const updated = await renameSession(user.user_id, id, next)
      patchSessionTitle(id, updated.title)
    } catch (err) {
      setError(err instanceof Error ? err.message : '重命名会话失败')
    }
  }

  async function removeSession(id: string) {
    if (!user) return
    try {
      await deleteSession(user.user_id, id)
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
  }
}
