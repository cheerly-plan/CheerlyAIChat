import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { ChatSource } from '../../types'

export type ReportPreviewTarget = {
  path: string
  label?: string
}

export type SidePanelState =
  | { mode: 'report'; path: string; label?: string }
  | { mode: 'sources'; sources: ChatSource[] }
  | { mode: 'review'; reportId?: string }
  | null

type ChatSidePanelContextValue = {
  panel: SidePanelState
  /** 兼容旧名：研报预览目标 */
  target: ReportPreviewTarget | null
  open: (path: string, label?: string) => void
  openSources: (sources: ChatSource[]) => void
  /** 打开研报审核面板；带 reportId 直接进详情，不带则看待审队列 */
  openReview: (reportId?: string) => void
  close: () => void
}

const ChatSidePanelContext = createContext<ChatSidePanelContextValue | null>(null)

export function ReportPreviewProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<SidePanelState>(null)

  const open = useCallback((path: string, label?: string) => {
    if (!path.startsWith('/v1/report/files/')) return
    setPanel({ mode: 'report', path, label })
  }, [])

  const openSources = useCallback((sources: ChatSource[]) => {
    if (!sources.length) return
    setPanel({ mode: 'sources', sources })
  }, [])

  const openReview = useCallback((reportId?: string) => {
    setPanel({ mode: 'review', reportId })
  }, [])

  const close = useCallback(() => setPanel(null), [])

  const target =
    panel?.mode === 'report' ? { path: panel.path, label: panel.label } : null

  const value = useMemo(
    () => ({ panel, target, open, openSources, openReview, close }),
    [panel, target, open, openSources, openReview, close],
  )

  return (
    <ChatSidePanelContext.Provider value={value}>{children}</ChatSidePanelContext.Provider>
  )
}

export function useReportPreview(): ChatSidePanelContextValue {
  const ctx = useContext(ChatSidePanelContext)
  if (!ctx) {
    return {
      panel: null,
      target: null,
      open: () => undefined,
      openSources: () => undefined,
      openReview: () => undefined,
      close: () => undefined,
    }
  }
  return ctx
}

/** @deprecated 使用 useReportPreview；保留别名方便来源面板读取 */
export const useChatSidePanel = useReportPreview

export function isReportFilePath(href: string): boolean {
  return resolveReportFilePath(href) != null
}

/**
 * 从相对路径或绝对 URL 里抽出站内研报文件路径。
 * 模型有时会把 `/v1/report/files/...` 改成带域名的链接，甚至换成 example.com；
 * 只要路径段还在，就按站内预览处理。
 */
export function resolveReportFilePath(href: string): string | null {
  const raw = (href || '').trim()
  if (!raw) return null
  if (raw.startsWith('/v1/report/files/')) {
    return raw.split(/[\s#]/)[0] || null
  }
  const embedded = raw.match(/\/v1\/report\/files\/[^\s?#)]+/)
  if (embedded?.[0]) return embedded[0]
  try {
    const url = new URL(raw, window.location.origin)
    if (url.pathname.startsWith('/v1/report/files/')) {
      return `${url.pathname}${url.search}`
    }
  } catch {
    /* ignore */
  }
  return null
}

/** 链接文案看起来像研报下载，但 href 已被模型改坏（如 example.com） */
export function looksLikeBrokenReportLink(href: string, label: string): boolean {
  if (resolveReportFilePath(href)) return false
  const text = `${label} ${href}`.toLowerCase()
  if (!/(pdf|markdown|\.md|溯源|底稿|深度|研报|报告)/i.test(text)) return false
  return (
    /example\.(com|org|net)/i.test(href) ||
    /^https?:\/\//i.test(href) ||
    href === '#' ||
    href === ''
  )
}
