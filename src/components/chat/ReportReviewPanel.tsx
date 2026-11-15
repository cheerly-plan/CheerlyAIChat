import { useEffect, useState } from 'react'
import {
  batchApproveReportReviews,
  decideReportReview,
  fetchReportReview,
  fetchReportReviews,
  finalizeReportReview,
} from '../../api'
import type { ReportReviewItem, ReportReviewRecord } from '../../types'
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

/** 条目种类 → 一句人话。列表里要让用户不点进去也知道在审什么。 */
const ITEM_KIND_LABEL: Record<string, string> = {
  deep_pdf: '推断层确认',
  number: '未核对数字',
  citation: '出处缺失',
  other: '其他',
}

/** 推断层 PDF 那条 reason 很长，列表里只留核心诉求。 */
const DEEP_PDF_HINT = '含大模型推断结论，需确认标注与免责声明完整性'

function itemHint(item: ReportReviewItem): string {
  if (item.kind === 'deep_pdf') return DEEP_PDF_HINT
  if (item.kind === 'number' && item.value) return `正文出现未核对数字 ${item.value}`
  if (item.kind === 'citation' && item.name) {
    return `${item.subject || ''} ${item.name}=${item.value || ''} 缺出处`.trim()
  }
  return item.reason
}

function formatTime(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { hour12: false })
}

/**
 * 批量确认条。
 *
 * 只有全部待审项都属于可整批确认的种类（目前是推断层 PDF 的整体确认）
 * 才允许勾选；含具体数字/出处问题的报告必须逐条核对，这里不给勾。
 */
function BatchBar({
  records,
  selected,
  busy,
  onChange,
  onApprove,
}: {
  records: ReportReviewRecord[]
  selected: string[]
  busy: string
  onChange: (ids: string[]) => void
  onApprove: () => void
}) {
  const eligible = records.filter((r) => r.batch_approvable).map((r) => r.report_id)
  if (!eligible.length) return null
  const allSelected = eligible.every((id) => selected.includes(id))
  const toggleAll = () =>
    onChange(allSelected ? [] : eligible)
  const toggle = (id: string) =>
    onChange(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id],
    )

  return (
    <div className="report-review-batch">
      <label className="report-review-batch-head">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={toggleAll}
          aria-label="全选可批量确认的研报"
        />
        <span>可批量确认 {eligible.length} 份</span>
      </label>
      <div className="report-review-batch-list">
        {eligible.map((id) => (
          <label key={id} className="report-review-batch-row">
            <input
              type="checkbox"
              checked={selected.includes(id)}
              onChange={() => toggle(id)}
            />
            <span>{records.find((r) => r.report_id === id)?.title}</span>
          </label>
        ))}
      </div>
      <button
        type="button"
        className="report-review-batch-btn"
        disabled={!selected.length || busy === 'batch'}
        onClick={onApprove}
      >
        {busy === 'batch' ? '确认中…' : `确认选中 ${selected.length} 份`}
      </button>
    </div>
  )
}

/** 研报审核面板：待审队列 → 详情 → 批准/驳回/定稿（全部走 M2 硬门禁）。 */
export function ReportReviewPanel({ reportId }: { reportId?: string }) {
  const { close, canReview } = useReportPreview()
  const [selectedId, setSelectedId] = useState<string | undefined>(reportId)
  const [records, setRecords] = useState<ReportReviewRecord[]>([])
  const [current, setCurrent] = useState<ReportReviewRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [selected, setSelected] = useState<string[]>([])

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

  async function approveSelected() {
    if (!selected.length) return
    setBusy('batch')
    setError('')
    try {
      const result = await batchApproveReportReviews(selected)
      const skipped = result.skipped ?? []
      if (skipped.length) {
        setError(
          `${result.approved.length} 份已确认，${skipped.length} 份未处理：` +
            skipped.map((s) => s.reason).join('；'),
        )
      }
      setSelected([])
      setRecords(await fetchReportReviews('pending'))
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量确认失败')
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

  const title = selectedId ? '审核详情' : canReview ? '研报审核' : '我的研报审核'
  const subtitle = selectedId
    ? ''
    : canReview
      ? `${records.length} 份待人工处置`
      : `我生成的研报里 ${records.length} 份待处置`

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
            <>
              <BatchBar
                records={records}
                selected={selected}
                busy={busy}
                onChange={setSelected}
                onApprove={() => void approveSelected()}
              />
              <ul className="report-review-list">
                {records.map((record) => (
                  <li key={record.report_id}>
                    <button
                      type="button"
                      className="report-review-item"
                      onClick={() => setSelectedId(record.report_id)}
                    >
                      <span className="report-review-item-title">
                        {record.title}
                      </span>
                      {record.pending_list?.length ? (
                        <span className="report-review-item-pending">
                          {record.pending_list.slice(0, 2).map((item) => (
                            <span key={item.id} className="report-review-pending-row">
                              <span className={`report-review-kind is-${item.kind}`}>
                                {ITEM_KIND_LABEL[item.kind ?? 'other'] ?? '其他'}
                              </span>
                              {itemHint(item)}
                            </span>
                          ))}
                          {record.pending_list.length > 2 ? (
                            <span className="report-review-pending-more">
                              另有 {record.pending_list.length - 2} 项
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                      <span className="report-review-item-meta">
                        待处置 {record.pending_items ?? 0} 项 ·{' '}
                        {formatTime(record.created_at)}
                      </span>
                      <span className={`report-review-badge is-${record.status}`}>
                        {STATUS_LABEL[record.status] ?? record.status}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
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
