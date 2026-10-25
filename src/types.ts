export type UserInfo = {
  user_id: string
  chat_session_id: string
  user_name: string
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
  | { type: 'tool_end'; name: string }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'title_updated'; session_id: string; title: string }

export type AuthUser = {
  user_id: string
  user_name: string
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

export type MemoryMessage = {
  role: string
  content?: string
  tool_calls?: { name: string }[]
  tool_call_id?: string
  name?: string
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
}
