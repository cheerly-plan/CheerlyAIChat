import { useState } from 'react'
import { sendChatStream } from '../api'
import type { ChatMessage } from '../types'

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function streamReply(userContent: string, assistantId: string) {
    setError('')
    setLoading(true)
    try {
      await sendChatStream(userContent, (event) => {
        if (event.type === 'text') {
          setMessages((prev) =>
            prev.map((item) =>
              item.id === assistantId
                ? { ...item, content: item.content + event.content }
                : item,
            ),
          )
        }
        if (event.type === 'tool_start') {
          setMessages((prev) =>
            prev.map((item) =>
              item.id === assistantId
                ? { ...item, tools: [...(item.tools ?? []), event.name] }
                : item,
            ),
          )
        }
        if (event.type === 'error') {
          setError(event.message)
        }
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败')
    } finally {
      setLoading(false)
    }
  }

  async function send(text?: string) {
    const content = (text ?? input).trim()
    if (!content || loading) return

    const assistantId = crypto.randomUUID()
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', content },
      { id: assistantId, role: 'assistant', content: '', tools: [] },
    ])
    setInput('')
    await streamReply(content, assistantId)
  }

  async function regenerate(id: string) {
    if (loading) return
    const index = messages.findIndex((item) => item.id === id)
    const user = messages[index - 1]
    if (!user || user.role !== 'user') return
    const assistantId = crypto.randomUUID()
    setMessages([
      ...messages.slice(0, index),
      { id: assistantId, role: 'assistant', content: '', tools: [] },
    ])
    await streamReply(user.content, assistantId)
  }

  function reset() {
    setMessages([])
    setInput('')
    setError('')
  }

  const title = conversationTitle(messages)

  return {
    messages,
    input,
    setInput,
    loading,
    error,
    send,
    reset,
    title,
    regenerate,
  }
}

function conversationTitle(messages: ChatMessage[]) {
  const text = messages.find((item) => item.role === 'user')?.content.trim()
  if (!text) return ''
  const line = text.split('\n')[0] ?? ''
  return line.length > 28 ? `${line.slice(0, 28)}…` : line
}
