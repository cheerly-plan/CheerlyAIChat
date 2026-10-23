import { useState } from 'react'
import { login, register, writeAuthToken } from '../../api'
import type { AuthUser } from '../../types'
import { Logo } from '../chat/Logo'
import './auth.css'

type Props = {
  onAuthed: (user: AuthUser) => void
}

type Mode = 'login' | 'register'

export function LoginView({ onAuthed }: Props) {
  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  function switchMode(next: Mode) {
    setMode(next)
    setError('')
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const name = username.trim()
    if (!name || !password || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const result =
        mode === 'login'
          ? await login(name, password)
          : await register(name, password, displayName)
      writeAuthToken(result.token)
      onAuthed(result.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-waves" aria-hidden="true">
        <svg className="wave wave-back" viewBox="0 0 2880 320" preserveAspectRatio="none">
          <path d="M0,170 C240,230 480,110 720,170 C960,230 1200,110 1440,170 C1680,230 1920,110 2160,170 C2400,230 2640,110 2880,170 L2880,320 L0,320 Z" />
        </svg>
        <svg className="wave wave-mid" viewBox="0 0 2880 320" preserveAspectRatio="none">
          <path d="M0,190 C240,130 480,250 720,190 C960,130 1200,250 1440,190 C1680,130 1920,250 2160,190 C2400,130 2640,250 2880,190 L2880,320 L0,320 Z" />
        </svg>
        <svg className="wave wave-front" viewBox="0 0 2880 320" preserveAspectRatio="none">
          <path d="M0,220 C240,170 480,270 720,220 C960,170 1200,270 1440,220 C1680,170 1920,270 2160,220 C2400,170 2640,270 2880,220 L2880,320 L0,320 Z" />
        </svg>
      </div>
      <form className="auth-card" onSubmit={(event) => void submit(event)}>
        <div className="auth-brand">
          <Logo size={32} />
          <span>Cheerly</span>
        </div>
        <h1 className="auth-title">{mode === 'login' ? '登录' : '注册'}</h1>
        <label className="auth-field">
          <span>用户名</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            placeholder="2-32 个字符，不含空格"
            maxLength={32}
            required
          />
        </label>
        {mode === 'register' ? (
          <label className="auth-field">
            <span>昵称（可选）</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="聊天中展示的名字"
              maxLength={32}
            />
          </label>
        ) : null}
        <label className="auth-field">
          <span>密码</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            placeholder={mode === 'login' ? '输入密码' : '至少 8 位'}
            minLength={mode === 'login' ? undefined : 8}
            maxLength={64}
            required
          />
        </label>
        {error ? <p className="auth-error">{error}</p> : null}
        <button type="submit" className="auth-submit" disabled={submitting}>
          {submitting ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
        </button>
        <p className="auth-switch">
          {mode === 'login' ? (
            <>
              还没有账号？
              <button type="button" onClick={() => switchMode('register')}>
                去注册
              </button>
            </>
          ) : (
            <>
              已有账号？
              <button type="button" onClick={() => switchMode('login')}>
                去登录
              </button>
            </>
          )}
        </p>
      </form>
    </div>
  )
}
