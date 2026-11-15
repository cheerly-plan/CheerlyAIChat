import { useEffect, useState } from 'react'
import {
  batchApproveReportReviews,
  decideReportReview,
  fetchActionableReviews,
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

/** 条目种类 → 一句人话。列表里直接说明在审什么。 */
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
 * 研报审核面板。
 *
 * 列表本身就是操作界面：每条直接列出待审内容、批注框与处置按钮，
 * 不再有「详情页」。原来要先点进去才看得到在审什么、才能批准或定稿，
 * 而点进去看到的信息和列表能提供的是同一批——多一跳没有任何信息增量。
 */
export function ReportReviewPanel({ reportId }: { reportId?: string }) {
  const { close, canReview } = useReportPreview()
  const [records, setRecords] = useState<ReportReviewRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    fetchActionableReviews()
      .then((data) => {
        if (cancelled) return
        setError('')
        setRecords(data)
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

  async function refresh() {
    setRecords(await fetchActionableReviews())
    setSelected([])
  }

  async function act(
    record: ReportReviewRecord,
    action: 'approve' | 'reject' | 'reset',
  ) {
    setBusy(`${record.report_id}:${action}`)
    setError('')
    try {
      await decideReportReview(record.report_id, action, (notes[record.report_id] ?? '').trim())
      setNotes((prev) => ({ ...prev, [record.report_id]: '' }))
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusy('')
    }
  }

  async function finalize(record: ReportReviewRecord) {
    setBusy(`${record.report_id}:finalize`)
    setError('')
    try {
      await finalizeReportReview(record.report_id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '定稿失败')
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
            skipped.map((item) => item.reason).join('；'),
        )
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量确认失败')
    } finally {
      setBusy('')
    }
  }

  const title = canReview ? '研报审核' : '我的研报审核'
  const subtitle = canReview
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

        {!loading && records.length ? (
          <>
            <BatchBar
              records={records}
              selected={selected}
              busy={busy}
              onChange={setSelected}
              onApprove={() => void approveSelected()}
            />
            <ul className="report-review-list">
              {records.map((record) => {
                const pending = record.pending_list ?? []
                const id = record.report_id
                const working = busy.startsWith(`${id}:`)
                return (
                  <li key={id} className="report-review-card">
                    <div className="report-review-card-head">
                      <span className="report-review-item-title">{record.title}</span>
                      <span className={`report-review-badge is-${record.status}`}>
                        {STATUS_LABEL[record.status] ?? record.status}
                      </span>
                    </div>
                    <p className="report-review-item-meta">
                      {record.status === 'approved'
                        ? // 已批准但还没定稿：明确告诉用户下一步做什么，
                          // 否则「待处置 0 项」会让人以为没活可干
                          '待审项已全部批准，点「定稿」完成发布'
                        : `待处置 ${record.pending_items ?? 0} 项`}{' '}
                      · 创建 {formatTime(record.created_at)}
                    </p>

                    {pending.length ? (
                      <ul className="report-review-pending">
                        {pending.map((item) => (
                          <li key={item.id} className="report-review-pending-row">
                            <span className={`report-review-kind is-${item.kind}`}>
                              {ITEM_KIND_LABEL[item.kind ?? 'other'] ?? '其他'}
                            </span>
                            <span>{itemHint(item)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {record.gate_reason ? (
                      <p className="report-review-gate-line">
                        定稿条件：{record.gate_reason}
                      </p>
                    ) : null}

                    {/* 只有被驳回时才需要写明原因，其余情况不强制 */}
                    {record.status === 'rejected' ? (
                      <input
                        className="report-review-note"
                        placeholder="批注（可选）"
                        value={notes[id] ?? ''}
                        onChange={(event) =>
                          setNotes((prev) => ({ ...prev, [id]: event.target.value }))
                        }
                      />
                    ) : null}

                    <div className="report-review-card-actions">
                      {(record.pending_items ?? 0) > 0 ? (
                        <button
                          type="button"
                          className="report-review-btn"
                          disabled={working}
                          onClick={() => void act(record, 'approve')}
                        >
                          {busy === `${id}:approve`
                            ? '处理中…'
                            : `批准 ${record.pending_items} 项`}
                        </button>
                      ) : null}
                      {record.status === 'rejected' ? (
                        <button
                          type="button"
                          className="report-review-btn"
                          disabled={working}
                          onClick={() => void act(record, 'reset')}
                        >
                          退回待审
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="report-review-btn"
                          disabled={working}
                          onClick={() => void act(record, 'reject')}
                        >
                          驳回
                        </button>
                      )}
                      <button
                        type="button"
                        className="report-review-btn primary"
                        disabled={working || !record.finalizable}
                        title={record.finalizable ? '' : record.gate_reason}
                        onClick={() => void finalize(record)}
                      >
                        {busy === `${id}:finalize` ? '定稿中…' : '定稿'}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        ) : null}

        {!loading && !records.length ? (
          <div className="report-review-empty">
            <p>当前没有待审核的研报</p>
            <p className="report-review-empty-hint">
              深度解析产物生成后会出现在这里；已定稿的报告不再列出。
            </p>
          </div>
        ) : null}
      </div>

    </aside>
  )
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
  const eligible = records
    .filter((record) => record.batch_approvable)
    .map((record) => record.report_id)
  if (!eligible.length) return null
  const allSelected = eligible.every((id) => selected.includes(id))
  const toggle = (id: string) =>
    onChange(
      selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id],
    )

  return (
    <div className="report-review-batch">
      <label className="report-review-batch-head">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={() => onChange(allSelected ? [] : eligible)}
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
