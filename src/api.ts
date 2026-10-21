import type { ChatEvent, ChatMemory, ChatMessage, MemoryMessage, SessionInfo, UserInfo } from './types'

export const CHAT_MEMORY_PAGE_SIZE = 20
export const DEFAULT_SESSION_TITLE = '新会话'

const ACTIVE_SESSION_KEY = 'cheerly.active_session'

export function readActiveSessionId(userId: string): string | null {
  try {
    return sessionStorage.getItem(`${ACTIVE_SESSION_KEY}:${userId}`)
  } catch {
    return null
  }
}

export function writeActiveSessionId(userId: string, sessionId: string | null) {
  try {
    const key = `${ACTIVE_SESSION_KEY}:${userId}`
    if (sessionId) sessionStorage.setItem(key, sessionId)
    else sessionStorage.removeItem(key)
  } catch {
    /* 隐私模式等无法写入时忽略 */
  }
}

export function hasCachedActiveSession() {
  try {
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i)
      if (key?.startsWith(`${ACTIVE_SESSION_KEY}:`)) return true
    }
  } catch {
    return false
  }
  return false
}

export async function fetchUserInfo(): Promise<UserInfo> {
  const response = await fetch('/user/info')
  if (!response.ok) {
    throw new Error(`获取用户信息失败 ${response.status}`)
  }
  const data = (await response.json()) as UserInfo
  if (!data.user_id || !data.user_name) {
    throw new Error('用户信息不完整')
  }
  return data
}

export async function createSession(
  userId: string,
  idempotencyKey: string,
): Promise<SessionInfo> {
  const response = await fetch('/v1/session/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      idempotency_key: idempotencyKey,
    }),
  })
  if (!response.ok) {
    throw new Error(`创建会话失败 ${response.status}`)
  }
  const data = (await response.json()) as SessionInfo
  if (!data.session_id) {
    throw new Error('会话创建结果不完整')
  }
  return {
    ...data,
    title: data.title || DEFAULT_SESSION_TITLE,
  }
}

export async function renameSession(
  userId: string,
  sessionId: string,
  title: string,
): Promise<SessionInfo> {
  const response = await fetch('/v1/session/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      session_id: sessionId,
      title,
    }),
  })
  if (!response.ok) {
    throw new Error(`重命名会话失败 ${response.status}`)
  }
  const data = (await response.json()) as SessionInfo
  return { ...data, title: data.title || DEFAULT_SESSION_TITLE }
}

export async function deleteSession(userId: string, sessionId: string): Promise<void> {
  const response = await fetch('/v1/session/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      session_id: sessionId,
    }),
  })
  if (!response.ok) {
    throw new Error(`删除会话失败 ${response.status}`)
  }
}

export async function fetchSessions(userId: string): Promise<SessionInfo[]> {
  const params = new URLSearchParams({ user_id: userId })
  const response = await fetch(`/v1/session/list?${params}`)
  if (!response.ok) {
    throw new Error(`获取会话列表失败 ${response.status}`)
  }
  const data = (await response.json()) as { sessions?: SessionInfo[] }
  return (data.sessions ?? []).map((item) => ({
    ...item,
    title: item.title || DEFAULT_SESSION_TITLE,
  }))
}

export async function fetchChatMemory(
  user: Pick<UserInfo, 'user_id' | 'chat_session_id'>,
  options: { limit?: number; beforeSeq?: number | null } = {},
): Promise<ChatMemory> {
  const params = new URLSearchParams({
    user_id: user.user_id,
    chat_session_id: user.chat_session_id,
    limit: String(options.limit ?? CHAT_MEMORY_PAGE_SIZE),
  })
  if (options.beforeSeq != null) {
    params.set('before_seq', String(options.beforeSeq))
  }
  const response = await fetch(`/v1/chat/memory?${params}`)
  if (!response.ok) {
    throw new Error(`获取会话记忆失败 ${response.status}`)
  }
  const data = (await response.json()) as ChatMemory
  return {
    ...data,
    messages: data.messages ?? [],
    has_more: Boolean(data.has_more),
    next_before_seq: data.next_before_seq ?? null,
  }
}

export function toChatMessages(raw: MemoryMessage[]): ChatMessage[] {
  const result: ChatMessage[] = []
  let pendingTools: string[] = []

  for (const msg of raw) {
    if (msg.role === 'user') {
      pendingTools = []
      result.push({
        id: crypto.randomUUID(),
        role: 'user',
        content: msg.content ?? '',
      })
      continue
    }
    if (msg.role !== 'assistant') continue

    const tools = (msg.tool_calls ?? []).map((item) => item.name).filter(Boolean)
    if (tools.length && !(msg.content ?? '').trim()) {
      pendingTools = [...pendingTools, ...tools]
      continue
    }

    result.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: msg.content ?? '',
      tools: pendingTools.length ? pendingTools : tools.length ? tools : undefined,
    })
    pendingTools = []
  }

  return result
}

export async function sendChatStream(
  message: string,
  user: Pick<UserInfo, 'user_id' | 'chat_session_id'>,
  onEvent: (event: ChatEvent) => void,
): Promise<void> {
  const params = new URLSearchParams({
    sessionId: user.chat_session_id,
    content: message,
    user_id: user.user_id,
  })
  const response = await fetch(`/v1/chat/stream?${params}`, {
    headers: { Accept: 'text/event-stream' },
  })

  if (!response.ok || !response.body) {
    throw new Error(`请求失败 ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      for (const line of part.split('\n')) {
        if (!line.startsWith('data: ')) continue
        onEvent(JSON.parse(line.slice(6)) as ChatEvent)
      }
    }
  }
}
