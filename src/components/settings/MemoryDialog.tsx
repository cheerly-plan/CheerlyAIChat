import { useEffect, useState } from 'react'
import {
  clearAllMemory,
  clearMemoryKind,
  deleteMemoryItem,
  exportMemory,
  fetchMemoryPage,
  fetchMemorySettings,
  setMemorySettings,
  writeMemoryProfile,
  type MemoryKind,
  type MemoryRow,
} from '../../api'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { CloseIcon, DownloadIcon, EditIcon, TrashIcon } from '../chat/icons'
import './settings.css'

const PAGE_SIZE = 20

const TABS: { key: MemoryKind; label: string; hint: string }[] = [
  { key: 'profile', label: '长期画像', hint: '稳定偏好与个人信息，会常驻在对话上下文中' },
  { key: 'episodes', label: '情景记忆', hint: '近期对话里提到的具体事情，只读，过期后自动降权；可单条删除' },
  { key: 'archive', label: '归档', hint: '历史留档，只读，不会自动进入对话' },
]

const FACET_LABELS: Record<string, string> = {
  name: '姓名',
  occupation: '职业',
  locale: '地区',
  language: '语言',
  preference: '偏好',
  constraint: '约束',
  other: '其他',
}

type ConfirmState = {
  title: string
  description: string
  confirmText?: string
  run: () => Promise<void>
}

/** 一页列表的快照。key 对应 (分类, 页码, 刷新次数)，用来派生 loading，
    避免切页时在 effect 里同步 setState 触发级联渲染。 */
type ListView = {
  key: string
  items: MemoryRow[]
  hasMore: boolean
  nextOffset: number | null
  error: string
}

type Props = { onClose: () => void }

/** 记忆管理：查看 / 自然语言编辑画像 / 删除 / 开关 / 导出，全部走 /v1/memory。
    画像不做「按 id 直接改某一行」，统一交给后端写入链判断该新增、更新还是删除；
    情景记忆是系统自动观察记录，只读 + 单条删除。 */
export function MemoryDialog({ onClose }: Props) {
  const [tab, setTab] = useState<MemoryKind>('profile')
  const [offset, setOffset] = useState(0)
  const [pageNo, setPageNo] = useState(0)
  const [view, setView] = useState<ListView | null>(null)
  const [actionError, setActionError] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [composing, setComposing] = useState(false)
  const [inputText, setInputText] = useState('')
  const [notice, setNotice] = useState('')
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)

  const viewKey = `${tab}:${offset}:${refresh}`
  const current = view && view.key === viewKey ? view : null
  const loading = current === null
  const items = current?.items ?? []
  const hasMore = current?.hasMore ?? false
  const nextOffset = current?.nextOffset ?? null
  const error = current?.error || actionError

  useEffect(() => {
    let cancelled = false
    void fetchMemoryPage(tab, offset, PAGE_SIZE)
      .then((data) => {
        if (cancelled) return
        setView({
          key: viewKey,
          items: data.items,
          hasMore: data.has_more,
          nextOffset: data.next_offset,
          error: '',
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setView({
          key: viewKey,
          items: [],
          hasMore: false,
          nextOffset: null,
          error: err instanceof Error ? err.message : '记忆读取失败',
        })
      })
    return () => { cancelled = true }
  }, [tab, offset, refresh, viewKey])

  useEffect(() => {
    let cancelled = false
    void fetchMemorySettings()
      .then((data) => { if (!cancelled) setEnabled(data.enabled) })
      .catch(() => { /* 开关读取失败时保持默认开启，不阻塞列表 */ })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (confirm) { setConfirm(null); return }
      if (composing) { setComposing(false); return }
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, confirm, composing])

  function reload() {
    setRefresh((value) => value + 1)
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setActionError('')
    try {
      await action()
      reload()
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  function switchTab(next: MemoryKind) {
    setTab(next)
    setOffset(0)
    setPageNo(0)
    setComposing(false)
    setInputText('')
    setNotice('')
    setActionError('')
  }

  async function toggleEnabled() {
    setBusy(true)
    setActionError('')
    try {
      const data = await setMemorySettings(!enabled)
      setEnabled(data.enabled)
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : '记忆开关保存失败')
    } finally {
      setBusy(false)
    }
  }

  async function submitText() {
    const text = inputText.trim()
    if (!text) return
    setNotice('')
    await run(async () => {
      const message = await writeMemoryProfile(text)
      setNotice(message || '已提交，系统会按记忆写入规则处理')
      setComposing(false)
      setInputText('')
    })
  }

  function askDelete(item: MemoryRow) {
    setConfirm({
      title: '确定删除这条记忆?',
      description: '删除后这条内容及其派生记录将被清除，不可恢复。',
      run: async () => { await deleteMemoryItem(tab === 'profile' ? 'profile' : 'episodes', item.id) },
    })
  }

  function askClearKind() {
    const label = tab === 'profile' ? '长期画像' : '情景记忆'
    setConfirm({
      title: `清空全部${label}?`,
      description: `将删除当前分类下的所有记忆，不可恢复。其他分类不受影响。`,
      confirmText: '清空',
      run: async () => { await clearMemoryKind(tab === 'profile' ? 'profile' : 'episodes') },
    })
  }

  function askClearAll() {
    setConfirm({
      title: '清除全部记忆?',
      description: '画像、情景、候选与归档将被全部删除，不可恢复。',
      confirmText: '全部清除',
      run: async () => { await clearAllMemory() },
    })
  }

  function goPrev() {
    setOffset(Math.max(0, offset - PAGE_SIZE))
    setPageNo((value) => Math.max(0, value - 1))
  }

  function goNext() {
    if (nextOffset === null) return
    setOffset(nextOffset)
    setPageNo((value) => value + 1)
  }

  function metaOf(item: MemoryRow): string {
    if (tab === 'profile') {
      const facet = FACET_LABELS[item.facet ?? ''] ?? item.facet ?? '其他'
      return `${facet} · ${dateOf(item.created_at)}`
    }
    if (tab === 'episodes') {
      return `命中 ${item.hit_count ?? 0} 次 · 最近 ${dateOf(item.last_seen ?? item.created_at)}`
    }
    return `${item.kind ?? '归档'} · ${dateOf(item.archived_at)}`
  }

  const activeTab = TABS.find((entry) => entry.key === tab)

  return (
    <>
    <div className="session-dialog-mask" onClick={onClose}>
      <div
        className="session-dialog memory-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="memory-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="session-dialog-head">
          <div>
            <h3 id="memory-dialog-title">记忆</h3>
            <p className="memory-subtitle">管理 AI 记住的关于你的内容</p>
          </div>
          <button type="button" className="session-dialog-close" aria-label="关闭" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="memory-switch-row">
          <div className="memory-switch-text">
            <strong>记忆功能</strong>
            <span>关闭后不再写入或注入上下文，已有内容保留</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="记忆功能"
            className={`memory-switch${enabled ? ' on' : ''}`}
            disabled={busy}
            onClick={() => void toggleEnabled()}
          >
            <span />
          </button>
        </div>

        <div className="memory-tabs" role="tablist">
          {TABS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={tab === entry.key}
              className={`memory-tab${tab === entry.key ? ' active' : ''}`}
              onClick={() => switchTab(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <p className="memory-tab-hint">{activeTab?.hint}</p>

        <div className="memory-toolbar">
          {tab === 'profile' ? (
            <button
              type="button"
              className="memory-btn primary small"
              disabled={busy}
              onClick={() => setComposing((value) => !value)}
            >
              <EditIcon /> 编辑记忆
            </button>
          ) : <span />}
          <div className="memory-toolbar-right">
            <button
              type="button"
              className="memory-btn ghost small"
              disabled={busy}
              onClick={() => void run(exportMemory)}
            >
              <DownloadIcon /> 导出
            </button>
            {tab !== 'archive' ? (
              <button
                type="button"
                className="memory-btn ghost small danger-text"
                disabled={busy}
                onClick={askClearKind}
              >
                清空本类
              </button>
            ) : null}
          </div>
        </div>

        {composing && tab === 'profile' ? (
          <div className="memory-compose">
            <textarea
              className="memory-textarea"
              value={inputText}
              maxLength={500}
              autoFocus
              placeholder="例如：以后财报都用亿元；把我喝咖啡那条删掉"
              onChange={(event) => setInputText(event.target.value)}
            />
            <p className="memory-compose-hint">
              用一句话说明要记的事或要改的事，系统会判断该新增、更新还是删除；
              内容重复或不需要写时会给出提示。含具体数字的事实建议注明出处。
            </p>
            <div className="memory-compose-actions">
              <button type="button" className="memory-btn ghost small" onClick={() => { setComposing(false); setInputText('') }}>
                取消
              </button>
              <button
                type="button"
                className="memory-btn primary small"
                disabled={busy || !inputText.trim()}
                onClick={() => void submitText()}
              >
                提交
              </button>
            </div>
          </div>
        ) : null}

        {notice ? <div className="memory-notice" role="status">{notice}</div> : null}

        <div className="memory-list">
          {loading ? (
            <div className="memory-empty">正在加载…</div>
          ) : items.length === 0 ? (
            <div className="memory-empty">这里还没有记忆</div>
          ) : items.map((item) => (
            <div className="memory-item" key={item.id}>
              <p className="memory-item-text">{item.text}</p>
              <div className="memory-item-meta">
                <span>{metaOf(item)}</span>
                <div className="memory-item-actions">
                  {tab !== 'archive' ? (
                    <button
                      type="button"
                      className="danger"
                      aria-label="删除记忆"
                      title="删除"
                      disabled={busy}
                      onClick={() => askDelete(item)}
                    >
                      <TrashIcon />
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>

        {error ? <div className="memory-error" role="alert">{error}</div> : null}

        <div className="memory-footer">
          <button type="button" className="memory-btn ghost small" disabled={busy || pageNo === 0} onClick={goPrev}>
            上一页
          </button>
          <span className="memory-page-no">第 {pageNo + 1} 页</span>
          <button type="button" className="memory-btn ghost small" disabled={busy || !hasMore} onClick={goNext}>
            下一页
          </button>
          <button type="button" className="memory-clear-all" disabled={busy} onClick={askClearAll}>
            清除全部记忆
          </button>
        </div>
      </div>
    </div>

    {/* 确认弹窗必须与记忆弹窗的蒙层平级：嵌在里面时点「取消」会冒泡
        触发外层 onClick，把整个记忆弹窗一起关掉。同为 z-index 40，
        后渲染的确认弹窗自然盖在上层。 */}
    {confirm ? (
      <ConfirmDialog
        title={confirm.title}
        description={confirm.description}
        confirmText={confirm.confirmText}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const action = confirm.run
          setConfirm(null)
          void run(action)
        }}
      />
    ) : null}
    </>
  )
}

function dateOf(value?: string): string {
  if (!value) return '未知时间'
  return value.slice(0, 10)
}
