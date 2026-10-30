import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ChatMessage, ChatSource, TraceStep } from '../../types'
import { ChunkContent } from '../kb/ChunkContent'
import { CheckIcon, CopyIcon, EditIcon, RefreshIcon } from './icons'
import { Markdown } from './Markdown'

type Props = {
  message: ChatMessage
  loading?: boolean
  busy?: boolean
  canRegenerate?: boolean
  canResume?: boolean
  onEditSubmit?: (text: string) => void
  onRegenerate?: (id: string) => void
  onResume?: () => void
}

export function MessageItem({
  message,
  loading = false,
  busy = false,
  canRegenerate = false,
  canResume = false,
  onEditSubmit,
  onRegenerate,
  onResume,
}: Props) {
  const done = !loading && Boolean(message.content || message.steps?.length)
  const interrupted = canResume && !loading

  if (message.role === 'user') {
    return (
      <UserMessage
        message={message}
        done={done}
        busy={busy}
        onEditSubmit={onEditSubmit}
      />
    )
  }

  const steps = message.steps ?? []
  const sources = message.sources ?? []
  const hasTrace = steps.length > 0
  const toolRunning = steps.some((step) => step.kind === 'tool' && step.running)
  const waiting = loading && !message.content && !hasTrace
  // 工具刚跑完、下一段正文还没到：时间线末尾挂「正在思考」
  const thinking = loading && !message.content && hasTrace && !toolRunning
  return (
    <div className="row assistant" id={`msg-${message.id}`}>
      <div className="assistant-body">
        {hasTrace ? (
          <Trace
            steps={steps}
            thinking={thinking}
            startedAt={message.startedAt}
            endedAt={message.endedAt}
            running={loading}
          />
        ) : null}
        {waiting ? <span className="typing" /> : null}
        {message.content ? (
          <Markdown content={message.content} streaming={loading} />
        ) : null}
        {!loading && hasTrace && !message.content ? (
          <p className="trace-empty">没有生成文字回复，可重新生成</p>
        ) : null}
        {sources.length > 0 && (done || interrupted) ? (
          <SourceList sources={sources} />
        ) : null}
        {done || interrupted ? (
          <div className={`msg-footer${interrupted ? ' has-resume' : ''}`}>
            {done ? (
              <MessageActions>
                <CopyButton text={message.content} />
                {canRegenerate ? (
                  <button
                    type="button"
                    aria-label="重新生成"
                    title="重新生成"
                    disabled={busy}
                    onClick={() => onRegenerate?.(message.id)}
                  >
                    <RefreshIcon />
                  </button>
                ) : null}
              </MessageActions>
            ) : null}
            {interrupted ? (
              <button
                type="button"
                className="msg-resume"
                disabled={busy}
                onClick={() => onResume?.()}
              >
                继续生成
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function UserMessage({
  message,
  done,
  busy,
  onEditSubmit,
}: {
  message: ChatMessage
  done: boolean
  busy: boolean
  onEditSubmit?: (text: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  function resize() {
    const el = areaRef.current
    if (!el) return
    const wrap = el.parentElement
    const pin = wrap
      ? wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight <= 8
      : true
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
    if (wrap && pin) wrap.scrollTop = wrap.scrollHeight
  }

  useEffect(() => {
    if (!editing) return
    const el = areaRef.current
    if (!el) return
    el.focus()
    el.selectionStart = el.value.length
    el.selectionEnd = el.value.length
    resize()
  }, [editing])

  if (editing) {
    return (
      <div className="row user" id={`msg-${message.id}`}>
        <form
          className="inline-composer"
          onSubmit={(event) => {
            event.preventDefault()
            const text = draft.trim()
            if (!text || busy) return
            setEditing(false)
            onEditSubmit?.(text)
          }}
        >
          <div className="inline-composer-input">
            <textarea
              ref={areaRef}
              value={draft}
              rows={1}
              disabled={busy}
              onChange={(event) => {
                setDraft(event.target.value)
                resize()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setEditing(false)
                  setDraft(message.content)
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
            />
          </div>
          <div className="inline-composer-bar">
            <button
              type="button"
              className="inline-cancel"
              onClick={() => {
                setEditing(false)
                setDraft(message.content)
              }}
            >
              取消
            </button>
            <button type="submit" disabled={busy || !draft.trim()} aria-label="发送">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path fill="currentColor" d="M12 4 5 11h4v9h6v-9h4z" />
              </svg>
            </button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div className="row user" id={`msg-${message.id}`}>
      <div className="user-block">
        <div className="bubble">{message.content}</div>
        {done ? (
          <MessageActions>
            <CopyButton text={message.content} />
            <button
              type="button"
              aria-label="重新编辑"
              title="重新编辑"
              disabled={busy}
              onClick={() => {
                setDraft(message.content)
                setEditing(true)
              }}
            >
              <EditIcon />
            </button>
          </MessageActions>
        ) : null}
      </div>
    </div>
  )
}

function MessageActions({ children }: { children: ReactNode }) {
  return <div className="msg-actions">{children}</div>
}

function Trace({
  steps,
  thinking,
  startedAt,
  endedAt,
  running,
}: {
  steps: TraceStep[]
  thinking: boolean
  startedAt?: number
  endedAt?: number
  running: boolean
}) {
  const elapsed = useElapsedSeconds(startedAt, endedAt, running)
  return (
    <div className="trace">
      {elapsed != null ? (
        <p className="trace-time">已处理 {elapsed} 秒</p>
      ) : null}
      {steps.map((step, index) =>
        step.kind === 'plan' ? (
          <div key={`plan-${index}`} className="trace-plan">
            {step.text.split(/\n{2,}/).map((block, i) => (
              <p key={i}>{block}</p>
            ))}
          </div>
        ) : (
          <p
            key={`tool-${index}-${step.name}`}
            className={`trace-action${step.running ? ' is-run' : ''}`}
          >
            <TraceActionIcon />
            {step.running ? `正在调用 ${step.label}` : `已调用 ${step.label}`}
          </p>
        ),
      )}
      {thinking ? (
        <p className="trace-action">
          <TraceActionIcon />
          <span className="thinking">正在思考</span>
        </p>
      ) : null}
    </div>
  )
}

function useElapsedSeconds(
  startedAt?: number,
  endedAt?: number,
  running?: boolean,
) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running || !startedAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running, startedAt])
  if (!startedAt) return null
  const end = running ? now : endedAt
  if (!end) return null
  return Math.max(1, Math.round((end - startedAt) / 1000))
}

function TraceActionIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M4 3.5h6.2L13 6.3v6.2H4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M10.2 3.5V6.3H13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * 参考来源：回答里用到的知识库切片。
 *
 * 一排小卡片（编号 + 文件名 + 位置），点任意一张就在下面展开这段原文——
 * 用户想核实「这句话是从文档哪一段来的」，需要看到原文本身，而不是只看到
 * 文件名。默认全部收起：回答已经是主体，引用不该抢注意力。
 *
 * 位置按「P134」/「P134–P135」展示：按章节切块后同节内允许跨页聚合，
 * 约一半切片跨两页，只写起始页会让用户翻错页。章节名放详情里——它比
 * 页码长得多，塞进小卡片会把文件名挤没。
 */
function SourceList({ sources }: { sources: ChatSource[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const active = sources.find((item) => item.key === openKey) ?? null
  const activeLoc = active ? sourceLocator(active) : null

  return (
    <div className="msg-sources">
      <span className="msg-sources-label">参考来源</span>
      <div className="msg-sources-chips">
        {sources.map((source, index) => {
          const open = source.key === openKey
          const loc = sourceLocator(source)
          return (
            <button
              key={source.key}
              type="button"
              className={`msg-source${open ? ' is-open' : ''}`}
              title={[source.filename, loc.where, loc.section].filter(Boolean).join(' · ')}
              aria-expanded={open}
              onClick={() => setOpenKey(open ? null : source.key)}
            >
              <span className="msg-source-idx">{index + 1}</span>
              <span className="msg-source-name">{source.filename}</span>
              <span className="msg-source-where">{loc.where}</span>
            </button>
          )
        })}
      </div>
      {active ? (
        <div className="msg-source-detail">
          <div className="msg-source-head">
            {activeLoc?.section ? (
              <span className="msg-source-section" title={activeLoc.section}>
                {activeLoc.section}
              </span>
            ) : null}
            {active.kind === 'figure' ? (
              <span className="msg-source-note">图像识别，可能有误差</span>
            ) : null}
            {isCrossPage(active) ? (
              <span className="msg-source-hint">
                该片段跨第 {active.page_start ?? active.page}–
                {active.page_end ?? active.page} 页
              </span>
            ) : null}
          </div>
          {active.kind === 'table' ? (
            <div className="msg-source-body">
              <ChunkContent text={active.excerpt} />
            </div>
          ) : (
            <pre className="msg-source-text">
              <span className="msg-source-text-inner">{active.excerpt}</span>
            </pre>
          )}
        </div>
      ) : null}
    </div>
  )
}

/** 芯片只放页码；章节进展开区。旧图谱引用曾把「页码 · 章节」写进 where。 */
function sourceLocator(source: ChatSource): { where: string; section: string | null } {
  const raw = sourceWhere(source)
  const cut = raw.indexOf(' · ')
  const where = cut > 0 ? raw.slice(0, cut) : raw
  const fromWhere = cut > 0 ? raw.slice(cut + 3).trim() : ''
  return { where, section: source.section?.trim() || fromWhere || null }
}

/** PDF/Word 表格落在页上；旧引用把页码写成了「表43」，这里按页码显示。Excel 仍用表号。 */
function sourceWhere(source: ChatSource): string {
  if (source.kind !== 'table') return source.where
  const name = (source.filename || '').toLowerCase()
  if (/\.(xlsx|xlsm|xls|csv)$/.test(name)) return source.where
  const start = source.page_start ?? source.page
  const end = source.page_end ?? source.page
  if (start == null) return source.where || '表格'
  if (end != null && end !== start) return `第${start}–${end}页`
  return `第${start}页`
}

/** 切片是否跨页：页码区间不一致即跨页（老数据没有 page_end，视为单页） */
function isCrossPage(source: ChatSource): boolean {
  const start = source.page_start ?? source.page
  const end = source.page_end ?? source.page
  return start != null && end != null && start !== end
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef(0)

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  return (
    <button
      type="button"
      className={copied ? 'copied' : undefined}
      aria-label={copied ? '已复制' : '复制'}
      title={copied ? '已复制' : '复制'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          window.clearTimeout(timerRef.current)
          timerRef.current = window.setTimeout(() => setCopied(false), 1200)
        } catch {
          setCopied(false)
        }
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  )
}
