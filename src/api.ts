import type { AuthResponse, ChatEvent, ChatMemory, ChatMessage, MemoryMessage, SessionInfo, SessionTitle, UserInfo } from './types'

export const CHAT_MEMORY_PAGE_SIZE = 20
export const DEFAULT_SESSION_TITLE = '新会话'

const AUTH_TOKEN_KEY = 'cheerly.auth_token'

export function readAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY)
  } catch {
    return null
  }
}

export function writeAuthToken(token: string) {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token)
  } catch {
    /* 隐私模式等无法写入时忽略 */
  }
}

export function clearAuthToken() {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

function authHeaders(): Record<string, string> {
  const token = readAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// 业务请求统一入口：令牌失效（401）时清除本地令牌并刷新，
// App 门禁检测不到令牌会自然回到登录页
async function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init)
  if (response.status === 401 && readAuthToken()) {
    clearAuthToken()
    window.location.reload()
  }
  return response
}

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

export async function login(
  username: string,
  password: string,
): Promise<AuthResponse> {
  const response = await fetch('/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!response.ok) {
    const detail = await errorMessage(response, '登录失败')
    throw new Error(detail)
  }
  return (await response.json()) as AuthResponse
}

export async function register(
  username: string,
  password: string,
  displayName: string,
): Promise<AuthResponse> {
  const response = await fetch('/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password,
      display_name: displayName.trim(),
    }),
  })
  if (!response.ok) {
    throw new Error(await errorMessage(response, '注册失败'))
  }
  return (await response.json()) as AuthResponse
}

export async function logout(): Promise<void> {
  try {
    await fetch('/v1/auth/logout', { method: 'POST', headers: authHeaders() })
  } catch {
    /* 本地退出不受网络影响 */
  }
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = (await response.json()) as { detail?: string }
    if (data.detail) return data.detail
  } catch {
    /* 非 JSON 响应时用兜底文案 */
  }
  return `${fallback} ${response.status}`
}

export async function fetchUserInfo(): Promise<UserInfo> {
  const response = await authedFetch('/user/info', { headers: authHeaders() })
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
  idempotencyKey: string,
): Promise<SessionInfo> {
  const response = await authedFetch('/v1/session/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ idempotency_key: idempotencyKey }),
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
  sessionId: string,
  title: string,
): Promise<SessionInfo> {
  const response = await authedFetch('/v1/session/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ session_id: sessionId, title }),
  })
  if (!response.ok) {
    throw new Error(`重命名会话失败 ${response.status}`)
  }
  const data = (await response.json()) as SessionInfo
  return { ...data, title: data.title || DEFAULT_SESSION_TITLE }
}

export async function deleteSession(sessionId: string): Promise<void> {
  const response = await authedFetch('/v1/session/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ session_id: sessionId }),
  })
  if (!response.ok) {
    throw new Error(`删除会话失败 ${response.status}`)
  }
}

export async function fetchSessionTitle(
  sessionId: string,
): Promise<SessionTitle> {
  const params = new URLSearchParams({ session_id: sessionId })
  const response = await authedFetch(`/v1/session/title?${params}`, { headers: authHeaders() })
  if (!response.ok) {
    throw new Error(`获取会话标题失败 ${response.status}`)
  }
  const data = (await response.json()) as SessionTitle
  return { session_id: data.session_id, title: data.title || DEFAULT_SESSION_TITLE }
}

export async function fetchSessions(): Promise<SessionInfo[]> {
  const response = await authedFetch('/v1/session/list', { headers: authHeaders() })
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
  chatSessionId: string,
  options: { limit?: number; beforeSeq?: number | null } = {},
): Promise<ChatMemory> {
  const params = new URLSearchParams({
    chat_session_id: chatSessionId,
    limit: String(options.limit ?? CHAT_MEMORY_PAGE_SIZE),
  })
  if (options.beforeSeq != null) {
    params.set('before_seq', String(options.beforeSeq))
  }
  const response = await authedFetch(`/v1/chat/memory?${params}`, { headers: authHeaders() })
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
  chatSessionId: string,
  onEvent: (event: ChatEvent) => void,
  options: { regenerate?: boolean } = {},
): Promise<void> {
  // POST + JSON body：用户消息不再进 URL，避免落入代理/访问日志/浏览器历史
  const response = await authedFetch('/v1/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...authHeaders(),
    },
    body: JSON.stringify({
      message,
      chat_session_id: chatSessionId,
      regenerate: options.regenerate ?? false,
    }),
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
        // 坏数据只跳过该条，不让整段流挂掉
        try {
          onEvent(JSON.parse(line.slice(6)) as ChatEvent)
        } catch {
          /* 忽略无法解析的事件 */
        }
      }
    }
  }
}
