export type UserInfo = {
  user_id: string
  chat_session_id: string
  user_name: string
  /** 管理员才显示知识库上传/删除入口（后端 403 才是真防线） */
  is_admin?: boolean
}

export type SessionInfo = {
  session_id: string
  title: string
  created_at?: string | null
  updated_at?: string | null
}

export type ChatEvent =
  | { type: 'run_started'; run_id: string }
  | { type: 'text'; content: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end'; name: string; sources?: ChatSource[] }
  | { type: 'done'; sources?: ChatSource[] }
  | { type: 'error'; message: string }
  | { type: 'title_updated'; session_id: string; title: string }

export type AuthUser = {
  user_id: string
  user_name: string
  /** 管理员才能进入知识库页（后端 403 才是真防线） */
  is_admin?: boolean
}

export type AuthResponse = {
  token: string
  expires_at: string
  user: AuthUser
}

export type SessionTitle = {
  session_id: string
  title: string
}

/** 知识库引用：回答里用到的一段原文，key = file_id#seq 用于去重与展开态 */
export type ChatSource = {
  key: string
  file_id: string
  filename: string
  seq: number
  page: number | null
  /** 切片起始页；无页文档为 null（旧后端只有 page，等价于 page_start） */
  page_start?: number | null
  /** 切片结束页：跨页切片（同节内聚合）时大于 page_start，单页时相等 */
  page_end?: number | null
  /** 所属一级节，如「第十节 管理层讨论与分析」；无章节结构时为 null */
  section?: string | null
  kind: string
  /** 人读的位置：第3页 / 第134–135页 / 表2 / 第5页图表 / 第7段 */
  where: string
  excerpt: string
}

export type MemoryMessage = {
  role: string
  content?: string
  tool_calls?: { name: string }[]
  tool_call_id?: string
  name?: string
  /** 消息级附属信息（当前只有 sources） */
  meta?: { sources?: ChatSource[] } | null
}

export type ChatMemory = {
  user_id: string
  chat_session_id: string
  messages: MemoryMessage[]
  has_more?: boolean
  next_before_seq?: number | null
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** 知识库引用（回答下方「参考来源」，点开看原文摘录） */
  sources?: ChatSource[]
}
