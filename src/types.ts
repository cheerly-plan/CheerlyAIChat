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
  | { type: 'text'; content: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end'; name: string }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'title_updated'; session_id: string; title: string }

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

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  tools?: string[]
}
