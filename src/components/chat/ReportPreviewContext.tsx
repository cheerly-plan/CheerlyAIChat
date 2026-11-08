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
  | null

type ChatSidePanelContextValue = {
  panel: SidePanelState
  /** 兼容旧名：研报预览目标 */
  target: ReportPreviewTarget | null
  open: (path: string, label?: string) => void
  openSources: (sources: ChatSource[]) => void
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

  const close = useCallback(() => setPanel(null), [])

  const target =
    panel?.mode === 'report' ? { path: panel.path, label: panel.label } : null

  const value = useMemo(
    () => ({ panel, target, open, openSources, close }),
    [panel, target, open, openSources, close],
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
      close: () => undefined,
    }
  }
  return ctx
}

/** @deprecated 使用 useReportPreview；保留别名方便来源面板读取 */
export const useChatSidePanel = useReportPreview

export function isReportFilePath(href: string): boolean {
  return href.startsWith('/v1/report/files/')
}
