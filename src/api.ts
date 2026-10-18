import type { ChatEvent, UserInfo } from './types'

export async function fetchUserInfo(): Promise<UserInfo> {
  const response = await fetch('/user/info')
  if (!response.ok) {
    throw new Error(`获取用户信息失败 ${response.status}`)
  }
  const data = (await response.json()) as UserInfo
  if (!data.user_id || !data.sessionsid || !data.user_name) {
    throw new Error('用户信息不完整')
  }
  return data
}

export async function sendChatStream(
  message: string,
  user: Pick<UserInfo, 'user_id' | 'sessionsid'>,
  onEvent: (event: ChatEvent) => void,
): Promise<void> {
  const response = await fetch('/v1/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      message,
      user_id: user.user_id,
      sessionsid: user.sessionsid,
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
        onEvent(JSON.parse(line.slice(6)) as ChatEvent)
      }
    }
  }
}
