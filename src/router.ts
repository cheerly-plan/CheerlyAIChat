import { useSyncExternalStore } from 'react'

/**
 * 极简路由：只区分「对话」和「知识库」两个页面。
 *
 * 用 hash（#/kb）而不是真实路径，是为了刷新/直接打开链接时无需服务端配置
 * SPA fallback 也能落到同一页面；页面状态全部由 URL 决定，不额外保存。
 */
export type Route = 'chat' | 'kb'

function routeFromHash(): Route {
  return window.location.hash.replace(/^#\/?/, '').toLowerCase() === 'kb' ? 'kb' : 'chat'
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

export function navigate(route: Route) {
  if (routeFromHash() === route) return
  if (route === 'kb') {
    window.history.pushState({ route }, '', '#/kb')
  } else if ((window.history.state as { route?: Route } | null)?.route === 'kb') {
    // 从知识库返回：回退上个记录而不是再压一条，避免浏览器后退在 chat/kb 之间来回弹
    window.history.back()
    return
  } else {
    // 直接以 #/kb 打开（刷新、分享链接）时没有站内历史可回退，就地替换 URL
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}`,
    )
  }
  emit()
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, routeFromHash, () => 'chat' as Route)
}
