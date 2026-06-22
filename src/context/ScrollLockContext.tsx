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
      // iOS bypasses `overflow: hidden` when focusing a field (e.g. the comment box in a post
      // modal): it auto-scrolls the document behind the fixed overlay to reveal the input. That
      // leaves window.scrollY > 0 and puts Safari into the state where position:fixed elements
      // (the portaled homescreen nav/buttons) stop pinning to the viewport and scroll with the
      // page. Snap the document back to the locked position to neutralize that auto-scroll —
      // the field is brought into view by the modal's own scroll container instead.
      const guard = () => {
        if (countRef.current > 0 && window.scrollY !== scrollPositionRef.current) {
          window.scrollTo(0, scrollPositionRef.current)
        }
      }
      scrollGuardRef.current = guard
      window.addEventListener('scroll', guard, { passive: true })
    }
  }, [])

  const unlockScroll = useCallback(() => {
    if (countRef.current > 0) countRef.current -= 1
    if (countRef.current === 0) {
      if (scrollGuardRef.current) {
        window.removeEventListener('scroll', scrollGuardRef.current)
        scrollGuardRef.current = null
      }
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
      document.documentElement.style.overscrollBehavior = ''
      document.body.style.overscrollBehavior = ''
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
