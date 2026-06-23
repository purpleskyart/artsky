import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react'
import { resetMobileViewportAfterKeyboard } from '../lib/mobileViewportSettle'

type ScrollLockContextValue = {
  lockScroll: () => void
  unlockScroll: () => void
  /** Feed scroll position captured when scroll lock was first acquired. */
  getLockedScrollY: () => number
}

const ScrollLockContext = createContext<ScrollLockContextValue | null>(null)

function isDialogEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (!target.closest('[role="dialog"]')) return false
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  )
}

export function ScrollLockProvider({ children }: { children: ReactNode }) {
  const countRef = useRef(0)
  const scrollPositionRef = useRef(0)
  const scrollGuardRef = useRef<(() => void) | null>(null)
  const focusGuardRef = useRef<((e: FocusEvent) => void) | null>(null)

  const attachScrollGuard = useCallback(() => {
    const guard = () => {
      const target = scrollPositionRef.current
      if (window.scrollY !== target) {
        window.scrollTo({ top: target, left: 0, behavior: 'instant' })
        document.documentElement.scrollTop = target
        document.body.scrollTop = target
      }
    }
    const onFocus = (e: FocusEvent) => {
      if (!isDialogEditable(e.target)) return
      guard()
      requestAnimationFrame(guard)
      requestAnimationFrame(() => requestAnimationFrame(guard))
    }
    scrollGuardRef.current = guard
    focusGuardRef.current = onFocus
    guard()
    window.addEventListener('scroll', guard, { passive: true })
    window.visualViewport?.addEventListener('scroll', guard, { passive: true })
    window.visualViewport?.addEventListener('resize', guard, { passive: true })
    document.addEventListener('focusin', onFocus, true)
    document.addEventListener('focusout', onFocus, true)
  }, [])

  const detachScrollGuard = useCallback(() => {
    const guard = scrollGuardRef.current
    const onFocus = focusGuardRef.current
    if (guard) {
      window.removeEventListener('scroll', guard)
      window.visualViewport?.removeEventListener('scroll', guard)
      window.visualViewport?.removeEventListener('resize', guard)
    }
    if (onFocus) {
      document.removeEventListener('focusin', onFocus, true)
      document.removeEventListener('focusout', onFocus, true)
    }
    scrollGuardRef.current = null
    focusGuardRef.current = null
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
      const scrollY = scrollPositionRef.current
      detachScrollGuard()
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
      document.documentElement.style.overscrollBehavior = ''
      document.body.style.overscrollBehavior = ''
      resetMobileViewportAfterKeyboard(scrollY)
    }
  }, [detachScrollGuard])

  const getLockedScrollY = useCallback(() => scrollPositionRef.current, [])

  const value: ScrollLockContextValue = useMemo(
    () => ({ lockScroll, unlockScroll, getLockedScrollY }),
    [lockScroll, unlockScroll, getLockedScrollY]
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
