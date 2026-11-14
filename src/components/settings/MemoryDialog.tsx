import { useEffect, useState } from 'react'
import {
  clearAllMemory,
  clearMemoryKind,
  exportMemory,
  fetchMemoryPage,
  fetchMemorySettings,
  setMemorySettings,
  writeMemoryProfile,
  type MemoryKind,
  type MemoryRow,
} from '../../api'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { CloseIcon, DownloadIcon, EditIcon } from '../chat/icons'
import './settings.css'

const PAGE_SIZE = 20

const TABS: { key: MemoryKind; label: string; hint: string }[] = [
  { key: 'profile', label: '长期画像', hint: '稳定偏好与个人信息，会常驻在对话上下文中' },
  { key: 'episodes', label: '情景记忆', hint: '近期对话里提到的具体事情，过期后自动降权' },
  { key: 'archive', label: '归档', hint: '历史留档，不会自动进入对话' },
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

/** 一页列表的快照。key 对应 (分类, 游标, 刷新次数)，用来派生 loading，
    避免切页时在 effect 里同步 setState 触发级联渲染。 */
type ListView = {
  key: string
  items: MemoryRow[]
  hasMore: boolean
  nextOffset: number | null
  error: string
}

type Props = { onClose: () => void }

/** 记忆管理：查看 / 自然语言编辑画像 / 开关 / 导出，全部走 /v1/memory。

    这里刻意不提供「按 id 直接改某一行」的入口——后端写入链要自己判断
    新增、更新还是删除（含冲突消解与去重），绕过去会把判断逻辑做坏。
    所以界面上也没有单条删除按钮，删除同样交给自然语言那句输入框。 */
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
  // 每个分类各自的翻页游标栈：切回去时停在原来那一页。
  // 存游标而不是页码——后端 next_offset = offset + len(items)，某页条目
  // 少于 PAGE_SIZE 时用页码反推会跳过数据。
  const [navByTab, setNavByTab] = useState<Record<MemoryKind, { offsets: number[] }>>({
    profile: { offsets: [0] },
    episodes: { offsets: [0] },
    archive: { offsets: [0] },
  })
  // 记住「上一次成功加载的页」，连同它所属的分类。只有同分类才拿来垫底，
  // 否则切到别的分类会把它上一个分类的条目短暂显示出来。
  const [lastPage, setLastPage] = useState<{ tab: MemoryKind; items: MemoryRow[] } | null>(null)

  const viewKey = `${tab}:${offset}:${refresh}`
  const current = view && view.key === viewKey ? view : null
  const loading = current === null
  /** 同一分类的旧内容才可复用；换分类一律视为首次加载 */
  const stale = lastPage && lastPage.tab === tab ? lastPage.items : null
  const initialLoading = loading && stale === null
  /** 加载中先垫同分类上一次的内容；加载完成后一律用本次结果（含空页）。 */
  const items = current ? current.items : (stale ?? [])
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
        // 记住这一页（连同分类），供同分类下一次加载的间隙垫底。
        // 空页也要覆盖，否则切走再回来会闪出更早的内容。
        setLastPage({ tab, items: data.items })
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
        setLastPage(null)
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
    if (next === tab) return
    const offsets = navByTab[next].offsets
    setTab(next)
    setOffset(offsets[offsets.length - 1])
    setPageNo(offsets.length - 1)
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

  /** 唯一的清空入口：按钮文案随分类变化，写明会删掉什么。
      归档是只读留档，不提供清空。 */
  function askClear() {
    if (tab === 'profile') {
      setConfirm({
        title: '清空长期画像？',
        description: '画像条目会被全部删除，不可恢复。情景记忆与归档不受影响。',
        confirmText: '清空画像',
        run: async () => { await clearMemoryKind('profile') },
      })
      return
    }
    if (tab === 'episodes') {
      setConfirm({
        title: '清空情景记忆？',
        description: '情景记忆会被全部删除，不可恢复。长期画像与归档不受影响。',
        confirmText: '清空情景',
        run: async () => { await clearMemoryKind('episodes') },
      })
      return
    }
    setConfirm({
      title: '清除全部记忆？',
      description: '画像、情景、候选与归档会被全部删除，不可恢复。',
      confirmText: '全部清除',
      run: async () => { await clearAllMemory() },
    })
  }

  function goPrev() {
    const offsets = navByTab[tab].offsets
    if (offsets.length <= 1) return
    const next = offsets.slice(0, -1)
    setNavByTab((prev) => ({ ...prev, [tab]: { offsets: next } }))
    setOffset(next[next.length - 1])
    setPageNo(next.length - 1)
  }

  function goNext() {
    if (nextOffset === null) return
    setNavByTab((prev) => ({
      ...prev,
      [tab]: { offsets: [...prev[tab].offsets, nextOffset] },
    }))
    setOffset(nextOffset)
    setPageNo(navByTab[tab].offsets.length)
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
  const canClear = tab !== 'archive'
  const clearLabel = tab === 'profile' ? '清空画像' : '清空情景'

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
        <header className="memory-head">
          <div className="memory-head-text">
            <h3 id="memory-dialog-title">记忆</h3>
            <p className="memory-subtitle">管理 AI 记住的关于你的内容</p>
          </div>
          <button type="button" className="memory-close" aria-label="关闭" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        {/* 开关收进头部一行，不再独占一块卡片——它是低频设置，
            不该比内容本身更抢眼。 */}
        <div className="memory-switch-row">
          <label className="memory-switch-label" htmlFor="memory-switch">
            记忆功能
            <span>{enabled ? '已开启，会写入并注入上下文' : '已关闭，不再写入或注入，已有内容保留'}</span>
          </label>
          <button
            id="memory-switch"
            type="button"
            role="switch"
            aria-checked={enabled}
            className={`memory-switch${enabled ? ' on' : ''}`}
            disabled={busy}
            onClick={() => void toggleEnabled()}
          >
            <span />
          </button>
        </div>

        <nav className="memory-tabs" role="tablist" aria-label="记忆分类">
          {TABS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              id={`memory-tab-${entry.key}`}
              aria-selected={tab === entry.key}
              aria-controls="memory-panel"
              tabIndex={tab === entry.key ? 0 : -1}
              className={`memory-tab${tab === entry.key ? ' active' : ''}`}
              onClick={() => switchTab(entry.key)}
            >
              {/* ::before 放一份加粗副本占位，保证标签宽度恒定不抖动 */}
              <span className="memory-tab-label" data-label={entry.label}>
                <span>{entry.label}</span>
              </span>
            </button>
          ))}
        </nav>

        <div className="memory-panel" id="memory-panel" role="tabpanel" aria-labelledby={`memory-tab-${tab}`}>

        <div className="memory-toolbar">
          <span className="memory-hint">{activeTab?.hint}</span>
          <div className="memory-toolbar-actions">
            {tab === 'profile' ? (
              <button
                type="button"
                className="memory-link"
                disabled={busy}
                onClick={() => setComposing((value) => !value)}
              >
                <EditIcon /> {composing ? '收起' : '修改'}
              </button>
            ) : null}
            <button
              type="button"
              className="memory-link"
              disabled={busy}
              onClick={() => void run(exportMemory)}
            >
              <DownloadIcon /> 导出
            </button>
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
            <div className="memory-compose-actions">
              <span className="memory-compose-tip">说得越具体判断越准；含数字的事实建议注明出处</span>
              <button
                type="button"
                className="memory-btn text"
                disabled={busy}
                onClick={() => { setComposing(false); setInputText('') }}
              >
                取消
              </button>
              <button
                type="button"
                className="memory-btn primary"
                disabled={busy || !inputText.trim()}
                onClick={() => void submitText()}
              >
                提交
              </button>
            </div>
          </div>
        ) : null}

        {notice ? <div className="memory-notice" role="status">{notice}</div> : null}

        <div className={`memory-list${loading && !initialLoading ? ' is-loading' : ''}`} aria-busy={loading}>
          {initialLoading ? (
            <div className="memory-empty">正在加载…</div>
          ) : items.length === 0 ? (
            <div className="memory-empty">
              {tab === 'profile' ? '还没有长期画像' : tab === 'episodes' ? '还没有情景记忆' : '还没有归档'}
            </div>
          ) : (
            items.map((item) => (
              <div className="memory-item" key={item.id}>
                <p className="memory-item-text">{item.text}</p>
                <span className="memory-item-meta">{metaOf(item)}</span>
              </div>
            ))
          )}
        </div>

        {error ? <div className="memory-error" role="alert">{error}</div> : null}

        </div>

        <footer className="memory-footer">
          <div className="memory-pager">
            <button
              type="button"
              className="memory-page-btn"
              disabled={busy || pageNo === 0}
              aria-label="上一页"
              onClick={goPrev}
            >
              ‹
            </button>
            <span className="memory-page-no">第 {pageNo + 1} 页</span>
            <button
              type="button"
              className="memory-page-btn"
              disabled={busy || !hasMore}
              aria-label="下一页"
              onClick={goNext}
            >
              ›
            </button>
          </div>
          {/* 全弹窗唯一的清空入口：文案写明当前分类会删掉什么 */}
          <button
            type="button"
            className="memory-clear"
            disabled={busy}
            onClick={askClear}
          >
            {canClear ? clearLabel : '清除全部记忆'}
          </button>
        </footer>
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