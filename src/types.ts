export type UserInfo = {
  user_id: string
  sessionsid: string
  user_name: string
}

export type ChatEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end'; name: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  tools?: string[]
}
