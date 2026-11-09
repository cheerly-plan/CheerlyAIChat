import { useEffect, useState } from 'react'
import {
  decideReportReview,
  fetchReportReview,
  fetchReportReviews,
  finalizeReportReview,
} from '../../api'
import type { ReportReviewRecord } from '../../types'
import { CloseIcon } from './icons'
import { useReportPreview } from './ReportPreviewContext'

const STATUS_LABEL: Record<string, string> = {
  pending: '待审核',
  approved: '已批准',
  rejected: '已驳回',
  finalized: '已定稿',
}

const ITEM_STATE_LABEL: Record<string, string> = {
  pending: '待处置',
  approved: '已批准',
  rejected: '已驳回',
}

function formatTime(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { hour12: false })
}

/** 研报审核面板：待审队列 → 详情 → 批准/驳回/定稿（全部走 M2 硬门禁）。 */
export function ReportReviewPanel({ reportId }: { reportId?: string }) {
  const { close } = useReportPreview()
  const [selectedId, setSelectedId] = useState<string | undefined>(reportId)
  const [records, setRecords] = useState<ReportReviewRecord[]>([])
  const [current, setCurrent] = useState<ReportReviewRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    let cancelled = false
    const task = selectedId ? fetchReportReview(selectedId) : fetchReportReviews('pending')
    task
      .then((data) => {
        if (cancelled) return
        setError('')
        if (Array.isArray(data)) {
          setRecords(data)
          setCurrent(null)
        } else {
          setCurrent(data)
        }
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
  }, [selectedId])

  async function act(action: 'approve' | 'reject' | 'reset') {
    if (!current) return
    setBusy(action)
    setError('')
    try {
      setCurrent(await decideReportReview(current.report_id, action, note.trim()))
      setNote('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusy('')
    }
  }

  async function finalize() {
    if (!current) return
    setBusy('finalize')
    setError('')
    try {
      setCurrent(await finalizeReportReview(current.report_id))
    } catch (err) {
      setError(err instanceof Error ? err.message : '定稿失败')
    } finally {
      setBusy('')
    }
  }

  const title = selectedId ? '审核详情' : '研报审核'
  const subtitle = selectedId ? '' : `${records.length} 份待人工处置`

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
            {subtitle ? <span>{subtitle}</span> : null}
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

        {!loading && !selectedId ? (
          records.length ? (
            <ul className="report-review-list">
              {records.map((record) => (
                <li key={record.report_id}>
                  <button
                    type="button"
                    className="report-review-item"
                    onClick={() => setSelectedId(record.report_id)}
                  >
                    <span className="report-review-item-title">{record.title}</span>
                    <span className="report-review-item-meta">
                      {record.report_id} · 待处置 {record.pending_items ?? 0} 项 ·{' '}
                      {formatTime(record.created_at)}
                    </span>
                    <span className={`report-review-badge is-${record.status}`}>
                      {STATUS_LABEL[record.status] ?? record.status}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="report-review-empty">
              <p>当前没有待审核的研报</p>
              <p className="report-review-empty-hint">
                深度解析产物生成后会出现在这里；已定稿的报告不再列出。
              </p>
            </div>
          )
        ) : null}

        {!loading && current ? (
          <div className="report-review-detail">
            <button
              type="button"
              className="report-review-back"
              onClick={() => setSelectedId(undefined)}
            >
              ← 返回队列
            </button>
            <h3 className="report-review-title">{current.title}</h3>
            <p className="report-review-sub">
              {current.report_id} · {STATUS_LABEL[current.status] ?? current.status} · 创建{' '}
              {formatTime(current.created_at)}
            </p>
            <p className="report-review-gate">定稿条件：{current.gate_reason || '—'}</p>

            {(current.items ?? []).length ? (
              <div className="report-review-entries">
                {(current.items ?? []).map((item) => (
                  <div className="report-review-entry" key={item.id}>
                    <div className="report-review-entry-head">
                      <span className="report-review-entry-id">{item.id}</span>
                      <span className={`report-review-state is-${item.state}`}>
                        {ITEM_STATE_LABEL[item.state] ?? item.state}
                      </span>
                    </div>
                    <p className="report-review-entry-reason">{item.reason}</p>
                    {item.subject ? (
                      <p className="report-review-entry-meta">
                        {item.subject} {item.period}
                      </p>
                    ) : null}
                    {item.note ? (
                      <p className="report-review-entry-meta">批注：{item.note}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {current.status !== 'finalized' ? (
              <textarea
                className="report-review-note"
                placeholder="批注（可选，驳回时建议写明原因）"
                value={note}
                rows={3}
                onChange={(event) => setNote(event.target.value)}
              />
            ) : null}

            <div className="report-review-actions">
              {current.status === 'finalized' ? (
                <span className="report-review-done">
                  已定稿{current.finalized_by ? ` · ${current.finalized_by}` : ''}
                </span>
              ) : (
                <>
                  {(current.pending_items ?? 0) > 0 ? (
                    <button
                      type="button"
                      className="report-review-btn"
                      disabled={Boolean(busy)}
                      onClick={() => void act('approve')}
                    >
                      {busy === 'approve'
                        ? '处理中…'
                        : `批准 ${current.pending_items} 项`}
                    </button>
                  ) : null}
                  {current.status === 'rejected' ? (
                    <button
                      type="button"
                      className="report-review-btn"
                      disabled={Boolean(busy)}
                      onClick={() => void act('reset')}
                    >
                      退回待审
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="report-review-btn"
                      disabled={Boolean(busy)}
                      onClick={() => void act('reject')}
                    >
                      驳回
                    </button>
                  )}
                  <button
                    type="button"
                    className="report-review-btn primary"
                    disabled={Boolean(busy) || !current.finalizable}
                    onClick={() => void finalize()}
                  >
                    {busy === 'finalize' ? '定稿中…' : '定稿'}
                  </button>
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
