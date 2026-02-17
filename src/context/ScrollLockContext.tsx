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
      // Save current scroll position
      scrollPositionRef.current = window.scrollY
      
      // For mobile Safari: use position fixed to prevent scroll
      document.body.style.position = 'fixed'
      document.body.style.top = `-${scrollPositionRef.current}px`
      document.body.style.width = '100%'
      document.body.style.overflow = 'hidden'
      document.body.style.touchAction = 'none'
      document.documentElement.style.overflow = 'hidden'
    }
  }, [])

  const unlockScroll = useCallback(() => {
    if (countRef.current > 0) countRef.current -= 1
    if (countRef.current === 0) {
      // Restore scroll position
      const scrollY = scrollPositionRef.current
      
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.width = ''
      document.body.style.overflow = ''
      document.body.style.touchAction = ''
      document.documentElement.style.overflow = ''
      
      // Restore scroll position instantly (no smooth scrolling)
      window.scrollTo({ top: scrollY, left: 0, behavior: 'instant' })
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
