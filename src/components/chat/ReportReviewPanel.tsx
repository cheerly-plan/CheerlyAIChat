import { useEffect, useState } from 'react'
import {
  decideReportReview,
  fetchReviewGroups,
  finalizeReportReview,
} from '../../api'
import type { ReportReviewGroup, ReportReviewItem, ReportReviewLayer } from '../../types'
import { CloseIcon } from './icons'
import { useReportPreview } from './ReportPreviewContext'

const ITEM_KIND_LABEL: Record<string, string> = {
  deep_pdf: 'AI 推断结论',
  number: '未核对数字',
  citation: '出处缺失',
  other: '其他',
}

const DEEP_PDF_HINT = '需确认标注、证据边界与免责声明完整'

function itemHint(item: ReportReviewItem): string {
  if (item.kind === 'deep_pdf') return DEEP_PDF_HINT
  if (item.kind === 'number' && item.value) return `正文出现未核对数字 ${item.value}`
  if (item.kind === 'citation' && item.name) {
    return `${item.subject || ''} ${item.name}=${item.value || ''} 缺出处`.trim()
  }
  return item.reason
}

function formatDate(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('zh-CN')
}

/** 这份报告卡在哪一步，以及这步该作用在哪一层。 */
type Step =
  | { kind: 'approve'; layer: ReportReviewLayer }
  | { kind: 'finalize'; layer: ReportReviewLayer }
  | { kind: 'rejected'; layer: ReportReviewLayer }
  | { kind: 'done' }

/**
 * 从分层的审核状态推出「用户看到的一步」。
 *
 * 后端把底稿与推断层拆成两条独立记录（底稿可自动定稿、推断层必须人工审），
 * 但那是实现细节：用户只关心这份报告能不能发布。这里把两层折叠成一步，
 * 并把「批准」和「定稿」合成一个动作——分两次点对用户没有意义。
 */
function nextStep(group: ReportReviewGroup): Step {
  const layers = [group.base, group.deep].filter(Boolean) as ReportReviewLayer[]
  const rejected = layers.find((layer) => layer.status === 'rejected')
  if (rejected) return { kind: 'rejected', layer: rejected }
  const pending = layers.find((layer) => layer.pending_items > 0)
  if (pending) return { kind: 'approve', layer: pending }
  const toFinalize = layers.find(
    (layer) => layer.finalizable && layer.status !== 'finalized',
  )
  if (toFinalize) return { kind: 'finalize', layer: toFinalize }
  return { kind: 'done' }
}

export function ReportReviewPanel({ reportId }: { reportId?: string }) {
  const { close, canReview } = useReportPreview()
  const [groups, setGroups] = useState<ReportReviewGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchReviewGroups()
      .then((data) => {
        if (cancelled) return
        setError('')
        setGroups(data)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载审核记录失败')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reportId])

  /**
   * 确认并发布：先批准待审项，再定稿。
   *
   * 两步都是后端硬门禁，不能跳过；但在用户这里是一件事，串起来调用，
   * 中途失败就停在那一步把错误报出来，不会只做一半还装作成功。
   */
  async function confirmAndPublish(step: Step, key: string) {
    if (step.kind === 'done' || step.kind === 'rejected') return
    setBusy(key)
    setError('')
    try {
      if (step.kind === 'approve') {
        await decideReportReview(step.layer.review_id, 'approve', '')
      }
      await finalizeReportReview(step.layer.review_id)
      setGroups(await fetchReviewGroups())
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
      // 中途失败也要刷新：可能第一步已经成功，界面不能还停在旧状态
      try {
        setGroups(await fetchReviewGroups())
      } catch {
        /* 刷新失败就保留旧列表，错误信息已经显示了 */
      }
    } finally {
      setBusy('')
    }
  }

  async function reject(step: Step, key: string) {
    if (step.kind === 'done' || step.kind === 'rejected') return
    setBusy(key)
    setError('')
    try {
      await decideReportReview(step.layer.review_id, 'reject', note.trim())
      setNote('')
      setGroups(await fetchReviewGroups())
    } catch (err) {
      setError(err instanceof Error ? err.message : '驳回失败')
    } finally {
      setBusy('')
    }
  }

  async function reset(step: Step, key: string) {
    if (step.kind !== 'rejected') return
    setBusy(key)
    setError('')
    try {
      await decideReportReview(step.layer.review_id, 'reset', '')
      setGroups(await fetchReviewGroups())
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusy('')
    }
  }

  const title = canReview ? '研报审核' : '我的研报审核'

  return (
    <aside
      className="report-preview report-review"
      role="dialog"
      aria-modal="false"
      aria-label="研报审核"
    >
      <div className="report-preview-bar">
        <div className="report-preview-heading">
          <div className="report-preview-row">
            <span className="report-preview-name">{title}</span>
          </div>
          <div className="report-preview-meta">
            {groups.length ? `${groups.length} 份` : ''}
          </div>
        </div>
        <div className="report-preview-actions">
          <button
            type="button"
            className="report-preview-action"
            aria-label="关闭"
            title="关闭"
            onClick={close}
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      <div className="report-review-body">
        {error ? <p className="report-review-error">{error}</p> : null}
        {loading ? <p className="report-review-status">正在加载…</p> : null}

        {!loading && groups.length ? (
          <ul className="report-review-list">
            {groups.map((group) => {
              const step = nextStep(group)
              const key = group.report_id
              const working = busy === key
              return (
                <li key={key} className="report-review-card">
                  <div className="report-review-card-head">
                    <span className="report-review-item-title">{group.title}</span>
                    <span className="report-review-item-date">
                      {formatDate(group.created_at)}
                    </span>
                  </div>

                  {step.kind === 'approve' ? (
                    <div className="report-review-callout is-todo">
                      <p className="report-review-callout-title">
                        {step.layer.pending_items} 项待确认
                      </p>
                      <ul className="report-review-callout-items">
                        {step.layer.pending_list?.map((item) => (
                          <li key={item.id}>
                            <span className={`report-review-kind is-${item.kind}`}>
                              {ITEM_KIND_LABEL[item.kind ?? 'other'] ?? '其他'}
                            </span>
                            <span className="report-review-item-hint">
                              {itemHint(item)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {step.kind === 'finalize' ? (
                    <div className="report-review-callout is-ready">
                      <p className="report-review-callout-title">
                        待发布
                      </p>
                    </div>
                  ) : null}

                  {step.kind === 'rejected' ? (
                    <div className="report-review-callout is-rejected">
                      <p className="report-review-callout-title">
                        已驳回
                      </p>
                    </div>
                  ) : null}

                  {step.kind === 'done' ? (
                    <div className="report-review-callout is-done">
                      <p className="report-review-callout-title">已发布</p>
                    </div>
                  ) : null}

                  {step.kind === 'rejected' ? (
                    <>
                      <input
                        className="report-review-note"
                        placeholder="批注（可选）"
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                      />
                      <div className="report-review-card-actions">
                        <button
                          type="button"
                          className="report-review-btn"
                          disabled={working}
                          onClick={() => void reset(step, key)}
                        >
                          {working ? '处理中…' : '撤销驳回'}
                        </button>
                      </div>
                    </>
                  ) : null}

                  {step.kind === 'approve' || step.kind === 'finalize' ? (
                    <div className="report-review-card-actions">
                      <button
                        type="button"
                        className="report-review-btn primary"
                        disabled={working}
                        onClick={() => void confirmAndPublish(step, key)}
                      >
                        {working
                          ? '处理中…'
                          : step.kind === 'approve'
                            ? '确认并发布'
                            : '发布'}
                      </button>
                      <button
                        type="button"
                        className="report-review-btn"
                        disabled={working}
                        onClick={() => void reject(step, key)}
                      >
                        驳回
                      </button>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : null}

        {!loading && !groups.length ? (
          <div className="report-review-empty">
            <p>当前没有待审核的研报</p>
            <p className="report-review-empty-hint">
              深度解析产物生成后会出现在这里；已发布的报告不再列出。
            </p>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
