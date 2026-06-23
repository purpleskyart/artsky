import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react'

type ScrollLockContextValue = {
  lockScroll: () => void
  unlockScroll: () => void
}

const ScrollLockContext = createContext<ScrollLockContextValue | null>(null)

export function ScrollLockProvider({ children }: { children: ReactNode }) {
  const countRef = useRef(0)
  const scrollPositionRef = useRef(0)
  const scrollGuardRef = useRef<(() => void) | null>(null)

  const attachScrollGuard = useCallback(() => {
    const guard = () => {
      const target = scrollPositionRef.current
      if (window.scrollY !== target) {
        window.scrollTo({ top: target, left: 0, behavior: 'instant' })
      }
    }
    scrollGuardRef.current = guard
    guard()
    window.addEventListener('scroll', guard, { passive: true })
  }, [])

  const detachScrollGuard = useCallback(() => {
    const guard = scrollGuardRef.current
    if (!guard) return
    window.removeEventListener('scroll', guard)
    scrollGuardRef.current = null
  }, [])

  const lockScroll = useCallback(() => {
    countRef.current += 1
    if (countRef.current === 1) {
      scrollPositionRef.current = window.scrollY
      // Use overflow only so the viewport doesn't change on mobile (position:fixed + top:-scrollY
      // causes the layout viewport to resize and the bottom navbar to move up). Do not set
      // touch-action: none on body — it blocks touch scrolling inside modals (e.g. post from profile).
      document.body.style.overflow = 'hidden'
      document.documentElement.style.overflow = 'hidden'
      // Stop overscroll / scroll chaining to the page behind overlays (feed stays mounted under modal routes).
      document.documentElement.style.overscrollBehavior = 'none'
      document.body.style.overscrollBehavior = 'none'
      attachScrollGuard()
    }
  }, [attachScrollGuard])

  const unlockScroll = useCallback(() => {
    if (countRef.current > 0) countRef.current -= 1
    if (countRef.current === 0) {
      detachScrollGuard()
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
      document.documentElement.style.overscrollBehavior = ''
      document.body.style.overscrollBehavior = ''
      window.scrollTo({ top: scrollPositionRef.current, left: 0, behavior: 'instant' })
    }
  }, [detachScrollGuard])

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
