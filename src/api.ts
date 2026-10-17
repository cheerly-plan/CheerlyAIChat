import type { ChatEvent } from './types'

export async function sendChatStream(
  message: string,
  onEvent: (event: ChatEvent) => void,
): Promise<void> {
  const response = await fetch('/v1/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ message }),
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
