import { createContext, useCallback, useRef, useContext, useEffect, useState, type ReactNode } from 'react'

export type SeenPostsAnnouncement = {
  text: string
  anchorRect: { top: number; left: number; width: number; height: number; bottom: number }
}

type SeenPostsContextValue = {
  /** Register (or unregister with null) the handler that clears seen state and shows all posts. Called when user long-presses Home. */
  setClearSeenHandler: (fn: (() => void) | null) => void
  /** Invoke the registered clear handler (e.g. on Home long-press). No-op if none registered. */
  clearSeenAndShowAll: () => void
  /** Register (or unregister with null) the handler run when Home is clicked while already on feed (hide seen posts + scroll to top). */
  setHomeClickHandler: (fn: (() => void) | null) => void
  /** Invoke the registered Home-click handler. No-op if none registered. */
  onHomeClick: () => void
  /** Register (or unregister with null) the handler for "hide seen posts" only (no scroll). Used by the eye button. */
  setHideSeenOnlyHandler: (fn: (() => void) | null) => void
  /** Invoke the hide-seen-only handler. Pass anchor element to show a toast. No-op if none registered. */
  onHideSeenOnly: (anchor?: HTMLElement) => void
  /** Show a toast "Show seen posts" at the given anchor (e.g. when user long-presses the eye button). */
  announceShowSeen: (anchor?: HTMLElement) => void
  /** Brief tooltip shown when hide/show seen is triggered. */
  seenPostsAnnouncement: SeenPostsAnnouncement | null
}

const SeenPostsContext = createContext<SeenPostsContextValue | null>(null)

const SEEN_POSTS_TOAST_HIDDEN = 'Hide seen posts'
const SEEN_POSTS_TOAST_SHOW = 'Show seen posts'

export function SeenPostsProvider({ children }: { children: ReactNode }) {
  const handlerRef = useRef<(() => void) | null>(null)
  const homeClickRef = useRef<(() => void) | null>(null)
  const hideSeenOnlyRef = useRef<(() => void) | null>(null)
  const [seenPostsAnnouncement, setSeenPostsAnnouncement] = useState<SeenPostsAnnouncement | null>(null)

  useEffect(() => {
    if (!seenPostsAnnouncement) return
    const t = setTimeout(() => setSeenPostsAnnouncement(null), 1200)
    return () => clearTimeout(t)
  }, [seenPostsAnnouncement])

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

  const setHideSeenOnlyHandler = useCallback((fn: (() => void) | null) => {
    hideSeenOnlyRef.current = fn
  }, [])

  const onHideSeenOnly = useCallback((anchor?: HTMLElement) => {
    hideSeenOnlyRef.current?.()
    const rect = anchor?.getBoundingClientRect()
    setSeenPostsAnnouncement({
      text: SEEN_POSTS_TOAST_HIDDEN,
      anchorRect: rect
        ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom }
        : { top: 48, left: typeof window !== 'undefined' ? window.innerWidth / 2 : 0, width: 0, height: 0, bottom: 48 },
    })
  }, [])

  const announceShowSeen = useCallback((anchor?: HTMLElement) => {
    const rect = anchor?.getBoundingClientRect()
    setSeenPostsAnnouncement({
      text: SEEN_POSTS_TOAST_SHOW,
      anchorRect: rect
        ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom }
        : { top: 48, left: typeof window !== 'undefined' ? window.innerWidth / 2 : 0, width: 0, height: 0, bottom: 48 },
    })
  }, [])

  const value: SeenPostsContextValue = {
    setClearSeenHandler,
    clearSeenAndShowAll,
    setHomeClickHandler,
    onHomeClick,
    setHideSeenOnlyHandler,
    onHideSeenOnly,
    announceShowSeen,
    seenPostsAnnouncement,
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
