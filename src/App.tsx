import { useCallback, useEffect, useState } from 'react'
import {
  clearAuthToken,
  fetchUserInfo,
  logout,
  readAuthToken,
} from './api'
import type { AuthUser, UserInfo } from './types'
import { Chat } from './components/chat/Chat'
import { LoginView } from './components/auth/Login'

type AuthStatus = 'checking' | 'authed' | 'anonymous'

// AuthUser（登录接口返回）→ UserInfo（聊天逻辑使用），会话信息由 /v1/session/list 管理
function toUserInfo(user: AuthUser): UserInfo {
  return {
    user_id: user.user_id,
    chat_session_id: 'default',
    user_name: user.user_name,
  }
}

function App() {
  const [status, setStatus] = useState<AuthStatus>(() =>
    readAuthToken() ? 'checking' : 'anonymous',
  )
  const [user, setUser] = useState<UserInfo | null>(null)
  // 登录/登出后重建 Chat，保证会话状态完全重新加载
  const [chatEpoch, setChatEpoch] = useState(0)

  useEffect(() => {
    if (status !== 'checking') return
    let cancelled = false
    // 用令牌换用户信息，校验通过后直接传给 Chat，避免 useChat 再查一次
    fetchUserInfo()
      .then((info) => {
        if (!cancelled) {
          setUser(info)
          setStatus('authed')
        }
      })
      .catch(() => {
        if (!cancelled) {
          clearAuthToken()
          setStatus('anonymous')
        }
      })
    return () => {
      cancelled = true
    }
  }, [status])

  const handleAuthed = useCallback((authUser: AuthUser) => {
    setUser(toUserInfo(authUser))
    setChatEpoch((epoch) => epoch + 1)
    setStatus('authed')
  }, [])

  const handleLogout = useCallback(() => {
    // 吊销服务端令牌（网络失败不阻塞本地退出），再清本地凭证
    void logout()
    clearAuthToken()
    setUser(null)
    setChatEpoch((epoch) => epoch + 1)
    setStatus('anonymous')
  }, [])

  if (status === 'checking') {
    return <div className="auth-checking"></div>
  }
  if (status === 'anonymous') {
    return <LoginView onAuthed={handleAuthed} />
  }
  return (
    <Chat key={chatEpoch} initialUser={user} onLogout={handleLogout} />
  )
}

export default App
