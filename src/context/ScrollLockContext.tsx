import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react'

type ScrollLockContextValue = {
  lockScroll: () => void
  unlockScroll: () => void
}

const ScrollLockContext = createContext<ScrollLockContextValue | null>(null)

export function ScrollLockProvider({ children }: { children: ReactNode }) {
  const countRef = useRef(0)
  const scrollPositionRef = useRef(0)

  const lockScroll = useCallback(() => {
    countRef.current += 1
    if (countRef.current === 1) {
      scrollPositionRef.current = window.scrollY
      // Use overflow only so the viewport doesn't change on mobile (position:fixed + top:-scrollY
      // causes the layout viewport to resize and the bottom navbar to move up). Do not set
      // touch-action: none on body — it blocks touch scrolling inside modals (e.g. post from profile).
      document.body.style.overflow = 'hidden'
      document.documentElement.style.overflow = 'hidden'
    }
  }, [])

  const unlockScroll = useCallback(() => {
    if (countRef.current > 0) countRef.current -= 1
    if (countRef.current === 0) {
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
      window.scrollTo({ top: scrollPositionRef.current, left: 0, behavior: 'instant' })
    }
  }, [])

  const value: ScrollLockContextValue = useMemo(
    () => ({ lockScroll, unlockScroll }),
    [lockScroll, unlockScroll]
  )

  return (
    <ScrollLockContext.Provider value={value}>
      {children}
    </ScrollLockContext.Provider>
  )
}

export function useScrollLock(): ScrollLockContextValue | null {
  return useContext(ScrollLockContext)
}
