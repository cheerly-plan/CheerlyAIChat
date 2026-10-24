// 会话大纲数据：把消息流按 user/assistant 配对成可跳转的轮次列表，
// 供 SessionOutline 渲染（纯函数，与组件分离便于复用与测试）。

export type SessionTurn = {
  id: string
  replyId?: string
  title: string
  excerpt: string
}

export function buildSessionTurns(
  messages: { id: string; role: 'user' | 'assistant'; content: string }[],
): SessionTurn[] {
  const turns: SessionTurn[] = []
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i]
    if (!message || message.role !== 'user') continue
    const next = messages[i + 1]
    turns.push({
      id: message.id,
      replyId: next?.role === 'assistant' ? next.id : undefined,
      title: oneLine(message.content),
      excerpt: next?.role === 'assistant' ? replyExcerpt(next.content) : '',
    })
  }
  return turns
}

function oneLine(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

function replyExcerpt(text: string) {
  const compact = oneLine(text)
  const heading = text.match(/^#{1,6}\s+(.+)$/m)
  if (heading?.[1]) {
    const title = heading[1].trim()
    const rest = compact.replace(title, '').replace(/^#+\s*/, '').trim()
    return `# ${title}${rest ? ` ${rest}` : ''}`
  }
  return compact
}
