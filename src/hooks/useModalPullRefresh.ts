import { useCallback, useEffect, useRef, useState } from 'react'

/** Register a refresh callback from grid content and expose it for modal pull-to-refresh. */
export function useModalPullRefresh() {
  const refreshRef = useRef<(() => void | Promise<void>) | null>(null)
  const [pullReady, setPullReady] = useState(false)
  const handleRegisterRefresh = useCallback((fn: () => void | Promise<void>) => {
    refreshRef.current = fn
    setPullReady(true)
  }, [])
  const onPullToRefresh = pullReady ? () => refreshRef.current?.() : undefined
  return { handleRegisterRefresh, onPullToRefresh }
}

/** Call onRegisterRefresh prop when refresh function changes. */
export function useRegisterGridRefresh(
  onRegisterRefresh: ((refresh: () => void | Promise<void>) => void) | undefined,
  refresh: () => void | Promise<void>,
) {
  useEffect(() => {
    onRegisterRefresh?.(() => refresh())
  }, [onRegisterRefresh, refresh])
}
