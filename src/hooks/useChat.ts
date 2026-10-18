import { useEffect, useRef, useState } from 'react'
import { fetchUserInfo, sendChatStream } from '../api'
import type { ChatMessage, UserInfo } from '../types'

export function useChat() {
  const [user, setUser] = useState<UserInfo | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const pendingText = useRef('')
  const streamId = useRef<string | null>(null)
  const raf = useRef(0)

  useEffect(() => {
    let cancelled = false
    fetchUserInfo()
      .then((info) => {
        if (!cancelled) setUser(info)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '获取用户信息失败')
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

  async function streamReply(userContent: string, assistantId: string) {
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
      await sendChatStream(userContent, user, (event) => {
        if (streamId.current !== assistantId) return
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
      })
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

  async function send(text?: string) {
    const content = (text ?? input).trim()
    if (!content || loading || !user) return

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
    if (loading || !user) return
    const index = messages.findIndex((item) => item.id === id)
    const previous = messages[index - 1]
    if (!previous || previous.role !== 'user') return
    const assistantId = crypto.randomUUID()
    setMessages([
      ...messages.slice(0, index),
      { id: assistantId, role: 'assistant', content: '', tools: [] },
    ])
    await streamReply(previous.content, assistantId)
  }

  function reset() {
    stopStream()
    setMessages([])
    setInput('')
    setError('')
    setLoading(false)
  }

  const title = conversationTitle(messages)

  return {
    user,
    messages,
    input,
    setInput,
    loading,
    ready: Boolean(user),
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
