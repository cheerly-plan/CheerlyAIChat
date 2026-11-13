import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  fetchInspectSessions,
  fetchInspectTurns,
  fetchInspectUsers,
  type InspectSession,
  type InspectStep,
  type InspectTurn,
  type InspectUser,
} from '../../api'
import { CheckIcon, ChevronDownIcon } from '../chat/icons'
import './trace.css'

type Props = {
  currentUserId: string
}

function defaultUserId(list: InspectUser[], currentUserId: string) {
  const self = list.find((item) => item.is_admin && item.user_id === currentUserId)
  if (self) return self.user_id
  return list.find((item) => item.is_admin)?.user_id ?? list[0]?.user_id ?? ''
}

function userCaption(item: InspectUser) {
  if (item.username && item.username !== item.user_name) {
    return `${item.user_name} · ${item.username}`
  }
  return item.user_name
}

function UserSelect({
  users,
  value,
  onChange,
}: {
  users: InspectUser[]
  value: string
  onChange: (userId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const current = users.find((item) => item.user_id === value) ?? null

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`trace-select${open ? ' is-open' : ''}`} ref={boxRef}>
      <button
        type="button"
        className="trace-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={!users.length}
        onClick={() => setOpen((on) => !on)}
      >
        {current ? (
          <span className="trace-select-value">
            <span>{userCaption(current)}</span>
            {current.is_admin ? <span className="trace-admin">管理员</span> : null}
          </span>
        ) : (
          <span className="trace-select-placeholder">暂无用户</span>
        )}
        <ChevronDownIcon />
      </button>
      {open && users.length ? (
        <ul className="trace-select-menu" role="listbox" aria-label="用户">
          {users.map((item) => {
            const selected = item.user_id === value
            return (
              <li key={item.user_id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={selected ? 'is-on' : ''}
                  onClick={() => {
                    onChange(item.user_id)
                    setOpen(false)
                  }}
                >
                  <span className="trace-select-value">
                    <span>{userCaption(item)}</span>
                    {item.is_admin ? <span className="trace-admin">管理员</span> : null}
                  </span>
                  {selected ? <CheckIcon /> : <span className="trace-select-check" />}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

function SessionSelect({
  sessions,
  value,
  onChange,
  disabled,
}: {
  sessions: InspectSession[]
  value: string
  onChange: (sessionId: string) => void
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const current = sessions.find((item) => item.session_id === value) ?? null

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`trace-select${open ? ' is-open' : ''}`} ref={boxRef}>
      <button
        type="button"
        className="trace-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled || !sessions.length}
        onClick={() => setOpen((on) => !on)}
      >
        {current ? (
          <span className="trace-select-value">
            <span>{current.title || '新会话'}</span>
          </span>
        ) : (
          <span className="trace-select-placeholder">{disabled ? '正在加载会话…' : '暂无会话'}</span>
        )}
        <ChevronDownIcon />
      </button>
      {open && sessions.length ? (
        <ul className="trace-select-menu" role="listbox" aria-label="会话">
          {sessions.map((item) => {
            const selected = item.session_id === value
            const title = item.title || '新会话'
            return (
              <li key={item.session_id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={selected ? 'is-on' : ''}
                  onClick={() => {
                    onChange(item.session_id)
                    setOpen(false)
                  }}
                >
                  <span className="trace-select-value">
                    <span>{title}</span>
                  </span>
                  {selected ? <CheckIcon /> : <span className="trace-select-check" />}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

const STEP_LABEL: Record<string, string> = {
  question: '用户提问',
  llm: 'LLM 结果',
  tool: '工具',
  tool_result: '工具结果',
}

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

function MessageIcon() {
  return (
    <Glyph>
      <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
    </Glyph>
  )
}

function WrenchIcon() {
  return (
    <Glyph>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z" />
    </Glyph>
  )
}

function TerminalIcon() {
  return (
    <Glyph>
      <path d="m7 11 2-2-2-2" />
      <path d="M11 13h4" />
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
    </Glyph>
  )
}

function SparklesIcon() {
  return (
    <Glyph>
      <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />
      <path d="M20 2v4" />
      <path d="M22 4h-4" />
      <circle cx="4" cy="20" r="2" />
    </Glyph>
  )
}

function ArrowRightIcon() {
  return (
    <Glyph>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </Glyph>
  )
}

function StepGlyph({ kind }: { kind: string }) {
  if (kind === 'tool') return <WrenchIcon />
  if (kind === 'tool_result') return <TerminalIcon />
  if (kind === 'llm') return <SparklesIcon />
  return <MessageIcon />
}

function formatArgs(args: Record<string, unknown> | null | undefined) {
  if (!args || typeof args !== 'object') return ''
  const keys = Object.keys(args)
  if (!keys.length) return ''
  return JSON.stringify(args, null, 2)
}

function flowLabel(step: InspectStep) {
  if (step.kind === 'tool') return step.name || '工具'
  if (step.kind === 'tool_result') return step.name ? `${step.name} 结果` : '结果'
  if (step.kind === 'llm') return 'LLM'
  return step.kind
}

function flowTitle(step: InspectStep) {
  const label = step.kind === 'tool' || step.kind === 'tool_result'
    ? `${STEP_LABEL[step.kind] ?? step.kind}${step.name ? ` · 工具 ${step.name}` : ''}`
    : flowLabel(step)
  const args = formatArgs(step.arguments).replace(/\s+/g, ' ')
  return args ? `${label} ${args}` : label
}

function FlowDiagram({ steps }: { steps: InspectStep[] }) {
  const nodes = [
    { kind: 'question', label: '提问', title: '提问' },
    ...steps.map((step) => ({ kind: step.kind, label: flowLabel(step), title: flowTitle(step) })),
  ]
  return (
    <div className="trace-diagram" aria-label="调用过程">
      {nodes.map((node, index) => (
        <span className="trace-diagram-slot" key={`${node.kind}-${node.label}-${index}`}>
          {index > 0 ? (
            <span className="trace-diagram-arrow">
              <ArrowRightIcon />
            </span>
          ) : null}
          <span className={`trace-diagram-node kind-${node.kind}`} title={node.title}>
            <StepGlyph kind={node.kind} />
            <span>{node.label}</span>
          </span>
        </span>
      ))}
    </div>
  )
}

// token 展示：没采集到（null）显示「—」，不要显示成 0 误导人
function fmtTokens(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return value.toLocaleString('zh-CN')
}

function hasTokens(...values: Array<number | null | undefined>): boolean {
  return values.some((v) => v !== null && v !== undefined)
}

function TokenBadge({
  prompt,
  completion,
}: {
  prompt: number | null | undefined
  completion: number | null | undefined
}) {
  if (!hasTokens(prompt, completion)) return null
  return (
    <span className="trace-step-tokens" title="输入 / 输出 token（网关计费口径）">
      <span className="trace-token-in">↑{fmtTokens(prompt)}</span>
      <span className="trace-token-out">↓{fmtTokens(completion)}</span>
    </span>
  )
}

function preview(text: string | null | undefined) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!flat) return '（空提问）'
  return flat.length > 72 ? `${flat.slice(0, 72)}…` : flat
}

function StepCard({ step }: { step: InspectStep }) {
  const args = formatArgs(step.arguments)
  const isCall = step.kind === 'tool' || step.kind === 'tool_result'
  return (
    <li className={`trace-step kind-${step.kind}`}>
      <span className="trace-step-icon">
        <StepGlyph kind={step.kind} />
      </span>
      <div className="trace-step-main">
        <div className="trace-step-head">
          <span className="trace-step-kind">{STEP_LABEL[step.kind] ?? step.kind}</span>
          {step.name ? (
            <span className="trace-step-tool">
              {step.kind === 'tool_result' ? <span>工具</span> : null}
              <span className="trace-step-tool-name">{step.name}</span>
            </span>
          ) : null}
          {step.kind === 'llm' ? (
            <TokenBadge prompt={step.prompt_tokens} completion={step.completion_tokens} />
          ) : null}
        </div>
        {isCall ? (
          args ? (
            <>
              <span className="trace-step-block-label">参数</span>
              <pre className="trace-step-body">{args}</pre>
            </>
          ) : (
            <p className="trace-step-empty">这次调用没有参数。</p>
          )
        ) : null}
        {step.kind !== 'tool' ? (
          step.content ? (
            <>
              {step.kind === 'tool_result' ? <span className="trace-step-block-label">结果</span> : null}
              <pre className="trace-step-body">{step.content}</pre>
            </>
          ) : (
            <p className="trace-step-empty">这一步没有正文。</p>
          )
        ) : null}
      </div>
    </li>
  )
}

export function Trace({ currentUserId }: Props) {
  const [users, setUsers] = useState<InspectUser[]>([])
  const [userId, setUserId] = useState('')
  const [sessions, setSessions] = useState<InspectSession[]>([])
  const [sessionId, setSessionId] = useState('')
  const [sessionTitle, setSessionTitle] = useState('')
  const [sessionTokens, setSessionTokens] = useState<{
    prompt: number | null
    completion: number | null
  }>({ prompt: null, completion: null })
  const [turns, setTurns] = useState<InspectTurn[]>([])
  const [turnIndex, setTurnIndex] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'users' | 'sessions' | 'turns' | ''>('users')
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => {
    let cancelled = false
    setBusy('users')
    setError('')
    void fetchInspectUsers()
      .then((list) => {
        if (cancelled) return
        setUsers(list)
        setUserId(defaultUserId(list, currentUserId))
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '用户列表加载失败')
      })
      .finally(() => {
        if (!cancelled) setBusy('')
      })
    return () => {
      cancelled = true
    }
  }, [currentUserId])

  useEffect(() => {
    if (!userId) {
      setSessions([])
      setSessionId('')
      return
    }
    let cancelled = false
    setBusy('sessions')
    setError('')
    setSessions([])
    setSessionId('')
    void fetchInspectSessions(userId)
      .then((list) => {
        if (cancelled) return
        setSessions(list)
        setSessionId(list[0]?.session_id ?? '')
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '会话列表加载失败')
      })
      .finally(() => {
        if (!cancelled) setBusy('')
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  useEffect(() => {
    if (!userId || !sessionId) {
      setTurns([])
      setSessionTitle('')
      setSessionTokens({ prompt: null, completion: null })
      setTurnIndex(0)
      return
    }
    let cancelled = false
    setBusy('turns')
    setError('')
    void fetchInspectTurns(userId, sessionId)
      .then((data) => {
        if (cancelled) return
        setSessionTitle(data.title)
        setSessionTokens({
          prompt: data.prompt_tokens ?? null,
          completion: data.completion_tokens ?? null,
        })
        setTurns(data.turns)
        setTurnIndex(data.turns.length ? data.turns.length - 1 : 0)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '对话过程加载失败')
      })
      .finally(() => {
        if (!cancelled) setBusy('')
      })
    return () => {
      cancelled = true
    }
  }, [userId, sessionId])

  const turn = turns[turnIndex] ?? null
  const turnSteps = Array.isArray(turn?.steps) ? turn.steps : []

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [sessionId, turnIndex])

  const questions = [...turns].reverse()

  return (
    <div className="trace-page">
      {error ? <p className="trace-error">{error}</p> : null}
      <div className="trace-body">
        <aside className="trace-col">
          <span className="trace-label">用户</span>
          <UserSelect users={users} value={userId} onChange={setUserId} />
          <h2 className="trace-label">会话</h2>
          <SessionSelect
            sessions={sessions}
            value={sessionId}
            disabled={busy === 'sessions' || busy === 'users'}
            onChange={setSessionId}
          />
          <h2 className="trace-label">提问</h2>
          <div className="trace-list">
            {busy === 'turns' || busy === 'sessions' || busy === 'users' ? (
              <p className="trace-muted">正在加载提问…</p>
            ) : !sessionId ? (
              <p className="trace-muted">这个用户还没有会话。</p>
            ) : questions.length === 0 ? (
              <p className="trace-muted">这个会话还没有用户提问。</p>
            ) : (
              questions.map((item) => (
                <button
                  key={item.index}
                  type="button"
                  className={`trace-item${item.index === turnIndex ? ' is-on' : ''}`}
                  onClick={() => setTurnIndex(item.index)}
                >
                  <span className="trace-item-title">{preview(item.question)}</span>
                  <span className="trace-item-meta">
                    {item.steps?.length ?? 0} 步
                    {hasTokens(item.prompt_tokens, item.completion_tokens) ? (
                      <span className="trace-item-tokens">
                        {' · '}
                        {fmtTokens(item.completion_tokens)} tok
                      </span>
                    ) : null}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>
        <section className="trace-main" aria-label="过程" ref={mainRef}>
          {sessionId && hasTokens(sessionTokens.prompt, sessionTokens.completion) ? (
            <div className="trace-session-tokens" title="整个会话的网关计费累计">
              <span className="trace-session-tokens-label">本会话累计</span>
              <span className="trace-token-in">输入 {fmtTokens(sessionTokens.prompt)}</span>
              <span className="trace-token-out">输出 {fmtTokens(sessionTokens.completion)}</span>
            </div>
          ) : null}
          {!turn ? (
            <p className="trace-muted trace-main-empty">
              {sessionTitle ? `「${sessionTitle}」里还没有可查看的过程。` : '选一条提问后，这里显示 agent 过程。'}
            </p>
          ) : (
            <>
              {turnSteps.length > 0 ? <FlowDiagram steps={turnSteps} /> : null}
              <ol className="trace-steps">
                <li className="trace-step kind-question">
                  <span className="trace-step-icon">
                    <MessageIcon />
                  </span>
                  <div className="trace-step-main">
                    <div className="trace-step-head">
                      <span className="trace-step-kind">用户提问</span>
                    </div>
                    <p className="trace-question-text">{String(turn.question ?? '').trim() || '（空提问）'}</p>
                  </div>
                </li>
                {turnSteps.map((step, index) => (
                  <StepCard key={`${step.kind}-${step.tool_call_id}-${index}`} step={step} />
                ))}
              </ol>
              {turnSteps.length === 0 ? (
                <p className="trace-muted">这一问后面没有工具调用或模型结果。</p>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
