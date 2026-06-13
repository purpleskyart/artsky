import { useRef, useState, useCallback } from 'react'

/** Thresholds: require clearly horizontal gesture to avoid accidental triggers when scrolling */
const SWIPE_COMMIT_PX = 28
const SWIPE_HORIZONTAL_RATIO = 2
const SWIPE_TRIGGER_PX = 80
const SWIPE_DRAG_CAP_PX = 140
/**
 * Swipe-right-to-close only when the gesture did not start in the OS/browser “back from edge” zone.
 * Otherwise WebKit may also pop history → double back.
 */
const SWIPE_RIGHT_MIN_START_X_PX = 44
/** Extra slop above env(safe-area-inset-bottom) for the home-indicator app-switcher zone. */
const SWIPE_HOME_BAR_EXTRA_PX = 12

let cachedSafeAreaInsetBottomPx: number | null = null

/** @internal Clears cached safe-area read (tests only). */
export function resetSwipeToCloseSafeAreaCacheForTests(): void {
  cachedSafeAreaInsetBottomPx = null
}

/** Read bottom safe-area inset once (0 on devices without a home indicator). */
export function getSafeAreaInsetBottomPx(): number {
  if (cachedSafeAreaInsetBottomPx !== null) return cachedSafeAreaInsetBottomPx
  if (typeof document === 'undefined') return 0
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;visibility:hidden;padding-bottom:env(safe-area-inset-bottom);'
  document.documentElement.appendChild(probe)
  cachedSafeAreaInsetBottomPx = parseFloat(getComputedStyle(probe).paddingBottom) || 0
  document.documentElement.removeChild(probe)
  return cachedSafeAreaInsetBottomPx
}

/** Height of the bottom zone where iOS treats horizontal swipes as app switcher gestures. */
export function getHomeBarGestureZonePx(): number {
  const inset = getSafeAreaInsetBottomPx()
  return inset > 0 ? inset + SWIPE_HOME_BAR_EXTRA_PX : 0
}

/** True when a touch starts in the home-indicator band (horizontal swipe switches apps). */
export function touchYInHomeBarZone(clientY: number): boolean {
  const zonePx = getHomeBarGestureZonePx()
  if (zonePx <= 0 || typeof window === 'undefined') return false
  const vv = window.visualViewport
  const viewportBottom = vv ? vv.offsetTop + vv.height : window.innerHeight
  return clientY >= viewportBottom - zonePx
}

export interface UseSwipeToCloseOptions {
  /** When false, touch handlers are no-ops and translateX stays 0 */
  enabled: boolean
  /** Optional: called when user completes a swipe to the right (go back / close) */
  onSwipeRight?: () => void
  /** Optional: called when user completes a swipe to the left (e.g. open profile) */
  onSwipeLeft?: () => void
}

export interface UseSwipeToCloseResult {
  onTouchStart: (e: React.TouchEvent) => void
  onTouchMove: (e: React.TouchEvent) => void
  onTouchEnd: (e: React.TouchEvent) => void
  /** Current drag offset in px (positive = dragging right). Apply as transform: translateX(...) */
  translateX: number
  /** True briefly after a cancelled swipe for snap-back transition */
  isReturning: boolean
  /** Inline style for the swiping element (transform when dragging, undefined when 0) */
  style: React.CSSProperties | undefined
}

/**
 * Reusable swipe-to-close/back gesture for modals and overlays.
 * Use on the pane/content element: attach handlers and style, add a class when isReturning for transition.
 */
export function useSwipeToClose({
  enabled,
  onSwipeRight,
  onSwipeLeft,
}: UseSwipeToCloseOptions): UseSwipeToCloseResult {
  const touchStartXRef = useRef(0)
  const touchStartYRef = useRef(0)
  const horizontalSwipeRef = useRef(false)
  const swipeDirectionRef = useRef<'left' | 'right' | null>(null)
  const [translateX, setTranslateX] = useState(0)
  const [isReturning, setIsReturning] = useState(false)

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || e.touches.length !== 1) return
      touchStartXRef.current = e.touches[0].clientX
      touchStartYRef.current = e.touches[0].clientY
      horizontalSwipeRef.current = false
      swipeDirectionRef.current = null
    },
    [enabled]
  )

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || e.touches.length !== 1) return
      const dx = e.touches[0].clientX - touchStartXRef.current
      const dy = e.touches[0].clientY - touchStartYRef.current
      if (!horizontalSwipeRef.current) {
        const canCommitHorizontal =
          Math.abs(dx) > SWIPE_COMMIT_PX &&
          Math.abs(dx) > Math.abs(dy) * SWIPE_HORIZONTAL_RATIO
        if (!canCommitHorizontal) {
          return
        }
        const direction: 'left' | 'right' = dx < 0 ? 'left' : 'right'
        if (
          direction === 'right' &&
          onSwipeRight &&
          touchStartXRef.current < SWIPE_RIGHT_MIN_START_X_PX
        ) {
          return
        }
        if (touchYInHomeBarZone(touchStartYRef.current)) {
          return
        }
        const canSwipeDirection =
          (direction === 'right' && !!onSwipeRight) ||
          (direction === 'left' && !!onSwipeLeft)
        if (!canSwipeDirection) return
        horizontalSwipeRef.current = true
        swipeDirectionRef.current = direction
      }
      e.preventDefault()
      const dragDx =
        swipeDirectionRef.current === 'left'
          ? Math.min(0, dx)
          : swipeDirectionRef.current === 'right'
            ? Math.max(0, dx)
            : dx
      const capped = Math.max(-SWIPE_DRAG_CAP_PX, Math.min(SWIPE_DRAG_CAP_PX, dragDx))
      setTranslateX(capped)
    },
    [enabled, onSwipeRight, onSwipeLeft]
  )

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || e.changedTouches.length !== 1) {
        setTranslateX(0)
        setIsReturning(false)
        return
      }
      const dx = e.changedTouches[0].clientX - touchStartXRef.current
      const triggered =
        horizontalSwipeRef.current &&
        Math.abs(dx) > SWIPE_TRIGGER_PX &&
        (dx > 0 ? !!onSwipeRight : dx < 0 && !!onSwipeLeft)
      if (triggered) {
        if (dx > 0 && onSwipeRight) onSwipeRight()
        else if (onSwipeLeft) onSwipeLeft()
      } else {
        setIsReturning(true)
        setTimeout(() => setIsReturning(false), 220)
      }
      horizontalSwipeRef.current = false
      swipeDirectionRef.current = null
      setTranslateX(0)
    },
    [enabled, onSwipeRight, onSwipeLeft]
  )

  const style: React.CSSProperties | undefined =
    translateX !== 0 ? { transform: `translateX(${translateX}px)` } : undefined

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    translateX,
    isReturning,
    style,
  }
}
