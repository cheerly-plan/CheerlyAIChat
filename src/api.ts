import type { AuthResponse, ChatEvent, ChatMemory, ChatMessage, ChatSource, MemoryMessage, SessionInfo, SessionTitle, TraceStep, UserInfo } from './types'

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
  let steps: TraceStep[] = []
  // 引用挂在带正文的那条回答上；万一某轮只调了工具没留正文，
  // 就顺延给下一条有正文的回答，别把引用丢了
  let pendingSources: ChatSource[] = []

  const flushAssistant = (content: string, sources?: ChatSource[]) => {
    const merged = sources?.length ? sources : pendingSources
    const trace = steps.length ? steps : undefined
    if (!content && !trace && !merged.length) {
      steps = []
      pendingSources = []
      return
    }
    result.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      content,
      steps: trace,
      sources: merged.length ? merged : undefined,
    })
    steps = []
    pendingSources = []
  }

  for (const msg of raw) {
    if (msg.role === 'user') {
      if (steps.length) flushAssistant('')
      pendingSources = []
      result.push({
        id: crypto.randomUUID(),
        role: 'user',
        content: msg.content ?? '',
      })
      continue
    }
    if (msg.role !== 'assistant') continue

    const tools = (msg.tool_calls ?? []).map((item) => item.name).filter(Boolean)
    const sources = msg.meta?.sources ?? []
    const text = msg.content ?? ''
    if (tools.length) {
      if (text.trim()) {
        steps.push({ kind: 'plan', text: text.trim() })
      }
      for (const name of tools) {
        steps.push({ kind: 'tool', name, label: name, running: false })
      }
      if (sources.length) pendingSources = sources
      continue
    }

    flushAssistant(text, sources)
  }
  if (steps.length) flushAssistant('')

  return result
}

// SSE 流的公共读取逻辑：按空行分帧、解析 data: 行，坏数据只跳过该条
async function readSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatEvent) => void,
): Promise<void> {
  const reader = body.getReader()
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

export async function sendChatStream(
  message: string,
  chatSessionId: string,
  onEvent: (event: ChatEvent) => void,
  options: {
    regenerate?: boolean
    webSearch?: boolean
    /** 「知识库」开关：开启时后端为模型挂载 kb_search 工具，可检索全库文档 */
    kb?: boolean
    signal?: AbortSignal
  } = {},
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
      web_search: options.webSearch ?? false,
      use_kb: options.kb ?? false,
    }),
    signal: options.signal,
  })

  if (!response.ok || !response.body) {
    throw new Error(await errorMessage(response, '请求失败'))
  }

  await readSSE(response.body, onEvent)
}

// 断点续跑：从后端 checkpoint 恢复上次中断的回复（整段重跑，前端用首包覆盖半截内容）
export async function resumeChatStream(
  runId: string,
  chatSessionId: string,
  onEvent: (event: ChatEvent) => void,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  const response = await authedFetch('/v1/chat/resume', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...authHeaders(),
    },
    body: JSON.stringify({ run_id: runId, chat_session_id: chatSessionId }),
    signal: options.signal,
  })
  if (!response.ok || !response.body) {
    throw new Error(await errorMessage(response, '恢复失败'))
  }
  await readSSE(response.body, onEvent)
}

// 会话加载后查询有没有可恢复的未完成回复（刷新页面后找回 run_id）
export async function fetchPendingRun(
  chatSessionId: string,
): Promise<string | null> {
  const params = new URLSearchParams({ chat_session_id: chatSessionId })
  const response = await authedFetch(`/v1/chat/pending_run?${params}`, {
    headers: authHeaders(),
  })
  if (!response.ok) return null
  const data = (await response.json()) as { run_id?: string | null }
  return data.run_id ?? null
}

// ——— 知识库（P1）：分片上传、列表、删除 ———

export type KbFile = {
  file_id: string
  filename: string
  size_bytes: number
  status: 'uploaded' | 'parsing' | 'embedding' | 'ready' | 'failed'
  error: string
  chunk_count: number
  // 文件类型后缀（如 .pdf），文件名本身已是纯名；下载/徽标按它识别类型
  mime?: string
  // 图谱进度：'' 未构建 / building / ready / stale（切片修订后待重建）/ failed / skipped
  graph_status?: string
  graph_entity_count?: number
  // 这份文件上次建图用的抽取配置：列表行 hover 重建时预填进弹窗
  doc_type?: string
  extract_level?: string
  tags?: string[]
  created_at: string
}

// 与后端 kb_part_size_mb 对齐
const KB_PART_SIZE = 4 * 1024 * 1024

// 分片上传完整流程：建档 → 逐片上传 → 触发解析。
// 顺序上传、不做断点续传；任一步失败整体报错，用户重传整个文件。
export async function uploadKbFile(file: File): Promise<string> {
  const initRes = await authedFetch('/v1/kb/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ filename: file.name, size_bytes: file.size }),
  })
  if (!initRes.ok) {
    throw new Error(await errorMessage(initRes, '创建上传任务失败'))
  }
  const { file_id: fileId } = (await initRes.json()) as { file_id: string }

  const total = Math.ceil(file.size / KB_PART_SIZE)
  for (let i = 0; i < total; i += 1) {
    const blob = file.slice(i * KB_PART_SIZE, (i + 1) * KB_PART_SIZE)
    const res = await authedFetch(`/v1/kb/files/${fileId}/parts/${i}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', ...authHeaders() },
      body: blob,
    })
    if (!res.ok) {
      throw new Error(await errorMessage(res, `分片 ${i + 1}/${total} 上传失败`))
    }
  }

  const done = await authedFetch(`/v1/kb/files/${fileId}/complete`, {
    method: 'POST',
    headers: authHeaders(),
  })
  if (!done.ok) {
    throw new Error(await errorMessage(done, '触发解析失败'))
  }
  return fileId
}

export async function fetchKbFiles(): Promise<KbFile[]> {
  const response = await authedFetch('/v1/kb/files', { headers: authHeaders() })
  if (!response.ok) {
    throw new Error(`获取知识库文件列表失败 ${response.status}`)
  }
  const data = (await response.json()) as { files?: KbFile[] }
  return data.files ?? []
}

export async function deleteKbFile(fileId: string): Promise<void> {
  const response = await authedFetch(`/v1/kb/files/${fileId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!response.ok) {
    throw new Error(await errorMessage(response, '删除文件失败'))
  }
}

// 全量覆盖式设置文件标签：传空数组即清空
export async function setKbFileTags(fileId: string, tags: string[]): Promise<void> {
  const response = await authedFetch(`/v1/kb/files/${fileId}/tags`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ tags }),
  })
  if (!response.ok) {
    throw new Error(await errorMessage(response, '保存标签失败'))
  }
}

// 重命名文件：后端同步改 DB 与磁盘文件名；stem 变化会触发后台整份重嵌
export async function renameKbFile(fileId: string, filename: string): Promise<void> {
  const response = await authedFetch(`/v1/kb/files/${fileId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ filename }),
  })
  if (!response.ok) {
    throw new Error(await errorMessage(response, '重命名失败'))
  }
}

// 下载原始文件：鉴权走请求头，不能用 <a href> 直链，先取 blob 再触发保存
async function fetchKbFileObjectUrl(file: KbFile): Promise<string> {
  const response = await authedFetch(`/v1/kb/files/${file.file_id}/download`, {
    headers: authHeaders(),
  })
  if (!response.ok) {
    throw new Error(await errorMessage(response, '获取原文件失败'))
  }
  return URL.createObjectURL(await response.blob())
}

export async function downloadKbFile(file: KbFile): Promise<void> {
  const url = await fetchKbFileObjectUrl(file)
  const link = document.createElement('a')
  link.href = url
  // 文件名是纯名，后缀由 mime 单独存；下载补回后缀，否则本地打不开
  link.download = file.mime ? `${file.filename}${file.mime}` : file.filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * 打开原件并翻到指定页：PDF 靠 `#page=N` 让浏览器内置阅读器直接跳页。
 * 标签必须先同步开出来——取 blob 是异步的，等回来了再 window.open
 * 会被当成非用户手势拦掉。
 */
export async function openKbFileAtPage(
  file: KbFile,
  page: number,
): Promise<void> {
  const win = window.open('', '_blank')
  try {
    const url = await fetchKbFileObjectUrl(file)
    const target = `${url}#page=${page}`
    if (win) win.location.replace(target)
    else window.open(target, '_blank')
    // 阅读过程中不能 revoke（翻到未加载的页会重新请求同一 blob）
    setTimeout(() => URL.revokeObjectURL(url), 300_000)
  } catch (e) {
    win?.close()
    throw e
  }
}

export type KbChunk = {
  seq: number
  page: number | null
  kind: 'text' | 'table' | 'figure'
  text: string
}

// 人工修订切片：保存即单片重嵌入；图谱已建的话会被后端标成 stale
export async function editKbChunk(
  fileId: string,
  seq: number,
  text: string,
): Promise<{ changed: boolean; graph_status: string }> {
  const response = await authedFetch(
    `/v1/kb/files/${fileId}/chunks/${seq}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ text }),
    },
  )
  if (!response.ok) {
    throw new Error(await errorMessage(response, '保存切片失败'))
  }
  const data = (await response.json()) as {
    changed?: boolean
    graph_status?: string
  }
  return { changed: data.changed ?? true, graph_status: data.graph_status ?? '' }
}

// 管理员选文件批量生成图谱（上传后不再自动建图）。
// 可顺带套一套抽取配置（docType/level）：批量选同一类文档时省得逐个设
export async function buildKgGraphs(
  fileIds: string[],
  options?: { docType?: string; level?: string },
): Promise<{ file_id: string; status: string }[]> {
  const response = await authedFetch('/v1/kg/graph/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      file_ids: fileIds,
      doc_type: options?.docType ?? '',
      level: options?.level ?? '',
    }),
  })
  if (!response.ok) {
    throw new Error(await errorMessage(response, '提交图谱构建失败'))
  }
  const data = (await response.json()) as { results?: { file_id: string; status: string }[] }
  return data.results ?? []
}

export async function fetchKbChunks(
  fileId: string,
  offset = 0,
  limit = 50,
): Promise<{ chunks: KbChunk[]; total: number; pageCount: number }> {
  const response = await authedFetch(
    `/v1/kb/files/${fileId}/chunks?limit=${limit}&offset=${offset}`,
    { headers: authHeaders() },
  )
  if (!response.ok) {
    throw new Error(`获取切片列表失败 ${response.status}`)
  }
  const data = (await response.json()) as {
    chunks?: KbChunk[]
    total?: number
    page_count?: number
  }
  return {
    chunks: data.chunks ?? [],
    total: data.total ?? 0,
    pageCount: data.page_count ?? 0,
  }
}

/**
 * 按页码定位切片（「跳到第 N 页」）：返回目标切片在文件内的序号 index
 * 与 seq。该页没有切片时后端顺延到后一页，page 是实际命中的页。
 */
export async function locateKbChunkPage(
  fileId: string,
  page: number,
): Promise<{
  found: boolean
  seq: number | null
  page: number | null
  index: number | null
  pageCount: number
}> {
  const response = await authedFetch(
    `/v1/kb/files/${fileId}/chunks/locate?page=${page}`,
    { headers: authHeaders() },
  )
  if (!response.ok) {
    throw new Error(await errorMessage(response, '页码定位失败'))
  }
  const data = (await response.json()) as {
    found?: boolean
    seq?: number | null
    page?: number | null
    index?: number | null
    page_count?: number
  }
  return {
    found: Boolean(data.found),
    seq: data.seq ?? null,
    page: data.page ?? null,
    index: data.index ?? null,
    pageCount: data.page_count ?? 0,
  }
}

// ——— 知识图谱（P2）：看图、检索、重建 ———

export type KgEntityType =
  | 'person'
  | 'org'
  | 'product'
  | 'technology'
  | 'metric'
  | 'event'
  | 'location'
  | 'concept'
  | 'other'

export type KgNode = {
  id: string
  name: string
  /** 跨文件同名实体的合并键；检索命中靠它对齐到画布节点 */
  norm_name?: string
  type: KgEntityType
  description: string
  mentions: number
  /** 在返回边集里的连接数：全库视图据此隐藏孤独点、挑枢纽节点 */
  degree?: number
  file_id: string
  filename: string
  /** 社区编号（P4 簇视图）：0 表示孤立点，其余从 1 开始按规模降序 */
  community?: number
}

/** 一个「抱团的块」：社区检测的产物，前端用来做簇列表与配色 */
export type KgCommunity = {
  id: number
  /** 簇代表名：簇内提及最多的实体，比"簇 3"有用 */
  label: string
  size: number
  members: string[]
  node_ids: string[]
  isolated: boolean
}

export type KgEdge = {
  id: string
  source: string
  target: string
  relation: string
  description: string
  weight: number
  chunk_seq: number | null
}

export type KgGraph = {
  nodes: KgNode[]
  edges: KgEdge[]
  stats?: { entities: number; relations: number; files: number }
  filename?: string
  graph_status?: string
  entity_count?: number
  /** 社区检测结果（按规模降序，孤立簇在最后） */
  communities?: KgCommunity[]
  /** 实体对齐进度与合并数量（P2） */
  align_status?: string
  alias_count?: number
  /** 这份图用的抽取配置：doc_type 是配置 key，空 = 全局默认（通用） */
  doc_type?: string
  extract_level?: string
}

/** 抽取配置（文档类型）：换类型 = 换 prompt 里的配置块，抽取器只有一份 */
export type KgDocType = {
  key: string
  label: string
  doc_name: string
  entity_scope: string[]
  predicates: string[]
  note_count: number
  is_general: boolean
}

export async function fetchKgDocTypes(): Promise<{ types: KgDocType[]; default: string }> {
  const response = await authedFetch('/v1/kg/doc-types', { headers: authHeaders() })
  if (!response.ok) return { types: [], default: 'general' }
  return (await response.json()) as { types: KgDocType[]; default: string }
}

export type KgSeed = {
  id: string
  name: string
  /** 与 KgNode.norm_name 对应：命中记录和画布上的代表记录可能不是同一条 */
  norm_name?: string
  type: KgEntityType
  score: number
  filename: string
}

export type KgEvidence = {
  chunk_seq: number
  page: number | null
  kind: string
  text: string
  filename: string
  entity?: string
}

export type KgSearchResult = KgGraph & {
  query: string
  seeds: KgSeed[]
  chunks: KgEvidence[]
  empty: boolean
}

// 图谱范围：不传 = 全库；fileId = 单文件；fileIds = 勾选的合并视图
export type KgScope = { fileId?: string; fileIds?: string[] }

function kgScopeParams(scope?: KgScope): URLSearchParams {
  const params = new URLSearchParams()
  if (scope?.fileId) {
    params.set('file_id', scope.fileId)
  } else if (scope?.fileIds?.length) {
    params.set('file_ids', scope.fileIds.join(','))
  }
  return params
}

// 不传范围 = 全库图谱；fileId 拿单文件图谱；fileIds 拿勾选文件的合并图谱
export async function fetchKgGraph(scope?: KgScope): Promise<KgGraph> {
  const params = kgScopeParams(scope)
  const qs = params.toString()
  const url = scope?.fileId
    ? `/v1/kg/files/${scope.fileId}/graph`
    : `/v1/kg/graph${qs ? `?${qs}` : ''}`
  const response = await authedFetch(url, { headers: authHeaders() })
  if (!response.ok) {
    throw new Error(`获取知识图谱失败 ${response.status}`)
  }
  return (await response.json()) as KgGraph
}

export async function searchKg(
  query: string,
  options: { topK?: number; depth?: number } & KgScope = {},
): Promise<KgSearchResult> {
  const params = kgScopeParams(options)
  params.set('q', query)
  params.set('top_k', String(options.topK ?? 6))
  params.set('depth', String(options.depth ?? 1))
  const response = await authedFetch(`/v1/kg/search?${params}`, {
    headers: authHeaders(),
  })
  if (!response.ok) {
    throw new Error(
      response.status === 502 ? '向量化服务暂时不可用' : `图谱检索失败 ${response.status}`,
    )
  }
  return (await response.json()) as KgSearchResult
}

export async function fetchKgEntityChunks(
  entityId: string,
): Promise<KgEvidence[]> {
  const response = await authedFetch(`/v1/kg/entities/${entityId}/chunks`, {
    headers: authHeaders(),
  })
  if (!response.ok) return []
  const data = (await response.json()) as { chunks?: KgEvidence[] }
  return data.chunks ?? []
}

export async function rebuildKgGraph(
  fileId: string,
  options?: { docType?: string; level?: string },
): Promise<void> {
  const response = await authedFetch(`/v1/kg/files/${fileId}/rebuild`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    // 不传 options 就不带 body：后端沿用该文件已保存的配置（过期刷新不改配置）
    body: options ? JSON.stringify({ doc_type: options.docType ?? '', level: options.level ?? '' }) : undefined,
  })
  if (!response.ok) {
    throw new Error(`重建图谱失败 ${response.status}`)
  }
}
