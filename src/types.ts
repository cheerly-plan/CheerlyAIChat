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
  | { type: 'tool_start'; name: string; label?: string }
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
  kind: string
  /** 人读的位置：第3页 / 表2 / 第5页图表 / 第7段 */
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

/** 工具调用记录：label 为后端下发的展示名，running 标记工具是否仍在执行 */
export type ToolRun = { label: string; running: boolean }

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  tools?: ToolRun[]
  /** 知识库引用（回答下方「参考来源」，点开看原文摘录） */
  sources?: ChatSource[]
}
