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
    is_admin: user.is_admin,
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

  const handleAuthed = useCallback(async (authUser: AuthUser) => {
    // 登录响应只作为兜底：权威用户信息（含 is_admin）以 /user/info 为准。
    // 两个接口字段可能不同步（登录接口未及时更新时 is_admin 会缺失），
    // 任一侧判定为管理员即放行入口，真正的权限校验在后端 require_admin。
    const seed = toUserInfo(authUser)
    const info = await fetchUserInfo().catch(() => null)
    const merged = info
      ? { ...seed, ...info, is_admin: Boolean(info.is_admin || seed.is_admin) }
      : seed
    setUser(merged)
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
