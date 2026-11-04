import { useSyncExternalStore } from 'react'

/**
 * 极简路由：看板、对话、知识库。
 *
 * 用 hash（#/board、#/chat、#/kb）而不是真实路径，是为了刷新/直接打开链接时
 * 无需服务端配置 SPA fallback 也能落到同一页面；页面状态全部由 URL 决定。
 * 空 hash 视为对话，管理员首次进入时再换成 #/board。
 */
export type Route = 'board' | 'chat' | 'kb'

function routeFromHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '').toLowerCase()
  if (raw === 'kb') return 'kb'
  if (raw === 'board') return 'board'
  return 'chat'
}

export function isBareHash(): boolean {
  return window.location.hash.replace(/^#\/?/, '') === ''
}

const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onChange = () => emit()
  window.addEventListener('popstate', onChange)
  window.addEventListener('hashchange', onChange)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', onChange)
    window.removeEventListener('hashchange', onChange)
  }
}

function hashFor(route: Route) {
  if (route === 'kb') return '#/kb'
  if (route === 'board') return '#/board'
  return '#/chat'
}

export function navigate(route: Route, opts?: { replace?: boolean }) {
  const next = `${window.location.pathname}${window.location.search}${hashFor(route)}`
  const here = `${window.location.pathname}${window.location.search}${window.location.hash}`
  if (!opts?.replace && here === next) return
  const state = { route }
  if (opts?.replace) window.history.replaceState(state, '', next)
  else window.history.pushState(state, '', next)
  emit()
}

/** 知识库页的返回：有站内上一页就退回去，否则回到 fallback。 */
export function goBack(fallback: Route) {
  if ((window.history.state as { route?: Route } | null)?.route) {
    window.history.back()
    return
  }
  navigate(fallback, { replace: true })
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, routeFromHash, () => 'chat' as Route)
}
