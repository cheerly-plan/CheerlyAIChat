import { useEffect, useState } from 'react'
import {
  batchApproveReportReviews,
  decideReportReview,
  fetchReviewGroups,
  finalizeReportReview,
} from '../../api'
import type { ReportReviewGroup, ReportReviewItem, ReportReviewLayer } from '../../types'
import { CloseIcon } from './icons'
import { useReportPreview } from './ReportPreviewContext'

const STATUS_LABEL: Record<string, string> = {
  pending: '待审核',
  approved: '已批准',
  rejected: '已驳回',
  finalized: '已定稿',
}

const ITEM_KIND_LABEL: Record<string, string> = {
  deep_pdf: '推断层确认',
  number: '未核对数字',
  citation: '出处缺失',
  other: '其他',
}

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

/** 一层的状态徽标文案。 */
function layerBadge(layer: ReportReviewLayer | null): string {
  if (!layer) return '无'
  if (layer.pending_items > 0) return `${layer.pending_items} 项待确认`
  return STATUS_LABEL[layer.status] ?? layer.status
}

/**
 * 研报审核面板：**按报告组织**，一份报告一张卡。
 *
 * 底稿与推断层在后端是两条独立审核记录（底稿可自动定稿、推断层必须人工审），
 * 但用户眼里是同一份报告。按记录平铺会看到一堆同名条目、也不知道下一步做什么，
 * 所以列表按报告分组，卡片内显示两层各自的状态。
 */
export function ReportReviewPanel({ reportId }: { reportId?: string }) {
  const { close, canReview } = useReportPreview()
  const [groups, setGroups] = useState<ReportReviewGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<string[]>([])

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

  async function refresh() {
    setGroups(await fetchReviewGroups())
    setSelected([])
  }

  async function act(layer: ReportReviewLayer, action: 'approve' | 'reject' | 'reset') {
    setBusy(`${layer.review_id}:${action}`)
    setError('')
    try {
      await decideReportReview(layer.review_id, action, (notes[layer.review_id] ?? '').trim())
      setNotes((prev) => ({ ...prev, [layer.review_id]: '' }))
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusy('')
    }
  }

  async function finalize(layer: ReportReviewLayer) {
    setBusy(`${layer.review_id}:finalize`)
    setError('')
    try {
      await finalizeReportReview(layer.review_id)
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
  const subtitle = `${groups.length} 份报告`

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
          <div className="report-preview-meta">{subtitle}</div>
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
          <>
            <BatchBar
              groups={groups}
              selected={selected}
              busy={busy}
              onChange={setSelected}
              onApprove={() => void approveSelected()}
            />
            <ul className="report-review-list">
              {groups.map((group) => (
                <GroupCard
                  key={group.report_id}
                  group={group}
                  busy={busy}
                  note={notes}
                  onNote={(id, value) =>
                    setNotes((prev) => ({ ...prev, [id]: value }))
                  }
                  onAct={act}
                  onFinalize={finalize}
                />
              ))}
            </ul>
          </>
        ) : null}

        {!loading && !groups.length ? (
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

/** 一份报告一张卡：标题 + 两层状态 + 下一步动作。 */
function GroupCard({
  group,
  busy,
  note,
  onNote,
  onAct,
  onFinalize,
}: {
  group: ReportReviewGroup
  busy: string
  note: Record<string, string>
  onNote: (id: string, value: string) => void
  onAct: (layer: ReportReviewLayer, action: 'approve' | 'reject' | 'reset') => Promise<void>
  onFinalize: (layer: ReportReviewLayer) => Promise<void>
}) {
  const layers: { key: string; label: string; layer: ReportReviewLayer | null }[] = [
    { key: 'base', label: '底稿', layer: group.base },
    { key: 'deep', label: '推断层', layer: group.deep },
  ]
  const target =
    group.next_action === 'approve_deep'
      ? group.deep
      : group.next_action === 'approve_base'
        ? group.base
        : null
  const pendingLayer = target ?? group.deep ?? group.base
  const toFinalize =
    group.next_action === 'finalize'
      ? [group.base, group.deep].find(
          (l) => l && l.finalizable && l.status !== 'finalized',
        ) ?? null
      : null
  const rejectedLayer = [group.base, group.deep].find((l) => l?.status === 'rejected') ?? null
  const working = busy.startsWith(`${pendingLayer?.review_id ?? ''}:`)

  return (
    <li className="report-review-card">
      <div className="report-review-card-head">
        <span className="report-review-item-title">{group.title}</span>
        <span className={`report-review-badge is-${group.next_action === 'finalized' ? 'finalized' : 'pending'}`}>
          {group.next_action === 'finalized'
            ? '已完成'
            : group.next_action === 'rejected'
              ? '已驳回'
              : '待处理'}
        </span>
      </div>
      <p className="report-review-item-meta">创建 {formatTime(group.created_at)}</p>

      <ul className="report-review-pending">
        {layers
          .filter((item) => item.layer)
          .map(({ key, label, layer }) => (
            <li key={key} className="report-review-pending-row">
              <span className={`report-review-kind is-${layer!.pending_items ? 'number' : 'other'}`}>
                {label}
              </span>
              <span>{layerBadge(layer)}</span>
            </li>
          ))}
      </ul>

      {pendingLayer?.pending_list?.length ? (
        <ul className="report-review-pending">
          {pendingLayer.pending_list.map((item) => (
            <li key={item.id} className="report-review-pending-row">
              <span className={`report-review-kind is-${item.kind}`}>
                {ITEM_KIND_LABEL[item.kind ?? 'other'] ?? '其他'}
              </span>
              <span>{itemHint(item)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {group.next_action !== 'finalized' && group.next_action !== 'rejected' ? (
        <p className="report-review-gate-line">
          定稿条件：{toFinalize?.gate_reason || pendingLayer?.gate_reason || '—'}
        </p>
      ) : null}

      {rejectedLayer ? (
        <input
          className="report-review-note"
          placeholder="批注（可选）"
          value={note[rejectedLayer.review_id] ?? ''}
          onChange={(event) => onNote(rejectedLayer.review_id, event.target.value)}
        />
      ) : null}

      <div className="report-review-card-actions">
        {target && target.pending_items > 0 ? (
          <button
            type="button"
            className="report-review-btn"
            disabled={working}
            onClick={() => void onAct(target, 'approve')}
          >
            {busy === `${target.review_id}:approve`
              ? '处理中…'
              : `批准 ${target.pending_items} 项`}
          </button>
        ) : null}
        {toFinalize ? (
          <button
            type="button"
            className="report-review-btn primary"
            disabled={working || !toFinalize.finalizable}
            title={toFinalize.gate_reason}
            onClick={() => void onFinalize(toFinalize)}
          >
            {busy === `${toFinalize.review_id}:finalize` ? '定稿中…' : '定稿'}
          </button>
        ) : null}
        {group.next_action === 'rejected' && rejectedLayer ? (
          <button
            type="button"
            className="report-review-btn"
            disabled={working}
            onClick={() => void onAct(rejectedLayer, 'reset')}
          >
            退回待审
          </button>
        ) : null}
        {pendingLayer && group.next_action !== 'finalized' && group.next_action !== 'rejected' ? (
          <button
            type="button"
            className="report-review-btn"
            disabled={working}
            onClick={() => void onAct(pendingLayer, 'reject')}
          >
            驳回
          </button>
        ) : null}
      </div>
    </li>
  )
}

/** 批量确认条：只列可整批确认的层。 */
function BatchBar({
  groups,
  selected,
  busy,
  onChange,
  onApprove,
}: {
  groups: ReportReviewGroup[]
  selected: string[]
  busy: string
  onChange: (ids: string[]) => void
  onApprove: () => void
}) {
  const eligible = groups
    .map((group) => group.deep)
    .filter((layer): layer is ReportReviewLayer => Boolean(layer?.batch_approvable))
  if (!eligible.length) return null
  const ids = eligible.map((layer) => layer.review_id)
  const allSelected = ids.every((id) => selected.includes(id))

  return (
    <div className="report-review-batch">
      <label className="report-review-batch-head">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={() => onChange(allSelected ? [] : ids)}
          aria-label="全选可批量确认的探断层"
        />
        <span>可批量确认 {eligible.length} 份推断层</span>
      </label>
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
