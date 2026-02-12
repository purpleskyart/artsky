import { createContext, useCallback, useRef, useContext, type ReactNode } from 'react'
import { useToast } from './ToastContext'

type SeenPostsContextValue = {
  /** Register (or unregister with null) the handler that clears seen state and shows all posts. Called when user long-presses Home. */
  setClearSeenHandler: (fn: (() => void) | null) => void
  /** Invoke the registered clear handler (e.g. on Home long-press). No-op if none registered. */
  clearSeenAndShowAll: () => void
  /** Register (or unregister with null) the handler run when Home is clicked while already on feed (hide seen posts + scroll to top). */
  setHomeClickHandler: (fn: (() => void) | null) => void
  /** Invoke the registered Home-click handler. No-op if none registered. */
  onHomeClick: () => void
  /** Register (or unregister with null) the handler for "hide seen posts" only (no scroll). Handler receives showToast to display count. */
  setHideSeenOnlyHandler: (fn: ((showToast: (msg: string) => void) => void) | null) => void
  /** Invoke the hide-seen-only handler. Shows toast. No-op if none registered. */
  onHideSeenOnly: (anchor?: HTMLElement) => void
  /** Show toast "Seen posts restored" (e.g. when user long-presses the eye button). */
  announceShowSeen: (anchor?: HTMLElement) => void
}

const SeenPostsContext = createContext<SeenPostsContextValue | null>(null)

export function SeenPostsProvider({ children }: { children: ReactNode }) {
  const toast = useToast()
  const handlerRef = useRef<(() => void) | null>(null)
  const homeClickRef = useRef<(() => void) | null>(null)
  const hideSeenOnlyRef = useRef<((showToast: (msg: string) => void) => void) | null>(null)

  const setClearSeenHandler = useCallback((fn: (() => void) | null) => {
    handlerRef.current = fn
  }, [])

  const clearSeenAndShowAll = useCallback(() => {
    handlerRef.current?.()
  }, [])

  const setHomeClickHandler = useCallback((fn: (() => void) | null) => {
    homeClickRef.current = fn
  }, [])

  const onHomeClick = useCallback(() => {
    homeClickRef.current?.()
  }, [])

  const setHideSeenOnlyHandler = useCallback((fn: ((showToast: (msg: string) => void) => void) | null) => {
    hideSeenOnlyRef.current = fn
  }, [])

  const onHideSeenOnly = useCallback((_anchor?: HTMLElement) => {
    if (!hideSeenOnlyRef.current) return
    hideSeenOnlyRef.current((msg) => toast?.showToast(msg))
  }, [toast])

  const announceShowSeen = useCallback((_anchor?: HTMLElement) => {
    toast?.showToast('Seen posts restored')
  }, [toast])

  const value: SeenPostsContextValue = {
    setClearSeenHandler,
    clearSeenAndShowAll,
    setHomeClickHandler,
    onHomeClick,
    setHideSeenOnlyHandler,
    onHideSeenOnly,
    announceShowSeen,
  }

  return (
    <SeenPostsContext.Provider value={value}>
      {children}
    </SeenPostsContext.Provider>
  )
}

export function useSeenPosts(): SeenPostsContextValue | null {
  return useContext(SeenPostsContext)
}
