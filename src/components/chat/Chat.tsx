import { useState } from 'react'
import { useChat } from '../../hooks/useChat'
import { ChatHeader } from './ChatHeader'
import { Composer } from './Composer'
import { MessageList } from './MessageList'
import { Sidebar } from './Sidebar'
import './chat.css'

export function Chat() {
  const { messages, input, setInput, loading, error, send, reset, title, regenerate } =
    useChat()
  const [sidebarOpen, setSidebarOpen] = useState(
    () => window.matchMedia('(min-width: 861px)').matches,
  )

  return (
    <div className={`shell${sidebarOpen ? '' : ' sidebar-collapsed'}`}>
      <div className="sidebar-mask" onClick={() => setSidebarOpen(false)} />
      <Sidebar
        onNewChat={reset}
        onCollapse={() => setSidebarOpen(false)}
        title={title}
      />
      <main className="chat">
        <ChatHeader
          title={title}
          collapsed={!sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          onNewChat={reset}
        />
        <MessageList
          messages={messages}
          loading={loading}
          onSuggest={(text) => void send(text)}
          onEditSubmit={(text) => void send(text)}
          onRegenerate={(id) => void regenerate(id)}
        />
        <div className="dock">
          {error ? <p className="error">{error}</p> : null}
          <Composer
            value={input}
            loading={loading}
            onChange={setInput}
            onSend={() => void send()}
          />
          <p className="disclaimer">内容由 AI 生成，请仔细甄别</p>
        </div>
      </main>
    </div>
  )
}
