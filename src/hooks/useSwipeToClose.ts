import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

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
/** Duration of the snap-back transition after a cancelled/aborted swipe. */
const SWIPE_RETURN_MS = 220

let cachedSafeAreaInsetBottomPx: number | null = null

/* Rotating the device changes the inset; drop the cache so the home-bar zone re-reads it. */
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('orientationchange', () => {
    cachedSafeAreaInsetBottomPx = null
  })
}

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

/** Minimal touch shape shared by React synthetic and native touch events. */
type TouchPoint = { identifier: number; clientX: number; clientY: number }

interface TouchEventLike {
  touches: ArrayLike<TouchPoint>
  changedTouches: ArrayLike<TouchPoint>
  preventDefault(): void
}

function singleTouch(list: ArrayLike<TouchPoint>): TouchPoint | null {
  return list && list.length === 1 ? list[0] : null
}

function findTouch(list: ArrayLike<TouchPoint>, identifier: number): TouchPoint | null {
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].identifier === identifier) return list[i]
  }
  return null
}

export interface UseSwipeToCloseOptions {
  /** When false, touch handlers are no-ops and translateX stays 0 */
  enabled: boolean
  /** Optional: called when user completes a swipe to the right (go back / close) */
  onSwipeRight?: () => void
  /** Optional: called when user completes a swipe to the left (e.g. open profile) */
  onSwipeLeft?: () => void
  /**
   * Element to bind native (non-passive) touch listeners to. React’s root touchmove
   * listeners are passive, so `preventDefault()` inside onTouchMove props is a no-op and
   * the browser can steal the drag mid-gesture (firing touchcancel and leaving the pane
   * stuck offset). When provided, the hook binds native listeners and the returned React
   * handlers are unnecessary.
   */
  targetRef?: RefObject<HTMLElement | null>
}

export interface UseSwipeToCloseResult {
  onTouchStart: (e: React.TouchEvent) => void
  onTouchMove: (e: React.TouchEvent) => void
  onTouchEnd: (e: React.TouchEvent) => void
  /** Reset the drag (e.g. the OS/browser cancelled the gesture mid-swipe). */
  onTouchCancel: (e: React.TouchEvent) => void
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
 * Pass `targetRef` so the drag can preventDefault native touchmove (see UseSwipeToCloseOptions).
 */
export function useSwipeToClose({
  enabled,
  onSwipeRight,
  onSwipeLeft,
  targetRef,
}: UseSwipeToCloseOptions): UseSwipeToCloseResult {
  /** Start point of the in-progress gesture; null when no gesture started on this element. */
  const touchStartRef = useRef<{ x: number; y: number; id: number } | null>(null)
  const horizontalSwipeRef = useRef(false)
  const swipeDirectionRef = useRef<'left' | 'right' | null>(null)
  const [translateX, setTranslateX] = useState(0)
  const [isReturning, setIsReturning] = useState(false)
  const returnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Latest callbacks/flags for native listeners (which bind once per element). */
  const optionsRef = useRef({ enabled, onSwipeRight, onSwipeLeft })
  optionsRef.current = { enabled, onSwipeRight, onSwipeLeft }

  const clearReturnTimer = useCallback(() => {
    if (returnTimerRef.current != null) {
      clearTimeout(returnTimerRef.current)
      returnTimerRef.current = null
    }
  }, [])

  const startReturning = useCallback(() => {
    setIsReturning(true)
    clearReturnTimer()
    returnTimerRef.current = setTimeout(() => {
      returnTimerRef.current = null
      setIsReturning(false)
    }, SWIPE_RETURN_MS)
  }, [clearReturnTimer])

  useEffect(() => clearReturnTimer, [clearReturnTimer])

  const handleStart = useCallback((touch: TouchPoint) => {
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, id: touch.identifier }
    horizontalSwipeRef.current = false
    swipeDirectionRef.current = null
  }, [])

  const handleMove = useCallback((e: TouchEventLike, touch: TouchPoint) => {
    const start = touchStartRef.current
    if (!start) return
    const { enabled: isEnabled, onSwipeRight: swipeRight, onSwipeLeft: swipeLeft } = optionsRef.current
    if (!isEnabled) return
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
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
        swipeRight &&
        start.x < SWIPE_RIGHT_MIN_START_X_PX
      ) {
        return
      }
      if (touchYInHomeBarZone(start.y)) {
        return
      }
      const canSwipeDirection =
        (direction === 'right' && !!swipeRight) ||
        (direction === 'left' && !!swipeLeft)
      if (!canSwipeDirection) return
      horizontalSwipeRef.current = true
      swipeDirectionRef.current = direction
    }
    // Only effective on native non-passive listeners; stops the browser stealing the drag.
    e.preventDefault()
    const dragDx =
      swipeDirectionRef.current === 'left'
        ? Math.min(0, dx)
        : swipeDirectionRef.current === 'right'
          ? Math.max(0, dx)
          : dx
    const capped = Math.max(-SWIPE_DRAG_CAP_PX, Math.min(SWIPE_DRAG_CAP_PX, dragDx))
    setTranslateX(capped)
  }, [])

  const resetGesture = useCallback(() => {
    touchStartRef.current = null
    horizontalSwipeRef.current = false
    swipeDirectionRef.current = null
    setTranslateX(0)
  }, [])

  const handleEnd = useCallback((touch: TouchPoint) => {
    const start = touchStartRef.current
    const { enabled: isEnabled, onSwipeRight: swipeRight, onSwipeLeft: swipeLeft } = optionsRef.current
    const dx = start ? touch.clientX - start.x : 0
    const triggered =
      !!start &&
      isEnabled &&
      horizontalSwipeRef.current &&
      Math.abs(dx) > SWIPE_TRIGGER_PX &&
      (dx > 0 ? !!swipeRight : dx < 0 && !!swipeLeft)
    if (triggered) {
      if (dx > 0 && swipeRight) swipeRight()
      else if (swipeLeft) swipeLeft()
    } else {
      startReturning()
    }
    resetGesture()
  }, [resetGesture, startReturning])

  /** touchcancel (OS gesture takeover etc.): snap back without triggering. */
  const handleCancel = useCallback(() => {
    if (touchStartRef.current != null) {
      startReturning()
      resetGesture()
    }
  }, [resetGesture, startReturning])

  /* Native listeners: touchmove must be non-passive for preventDefault to work. */
  useEffect(() => {
    const el = targetRef?.current
    if (!targetRef || !el) return
    const onStart = (e: TouchEvent) => {
      const touch = singleTouch(e.touches)
      if (!touch || !optionsRef.current.enabled) return
      handleStart(touch)
    }
    const onMove = (e: TouchEvent) => {
      const start = touchStartRef.current
      const touch = start ? findTouch(e.touches, start.id) : null
      if (!touch) return
      handleMove(e as TouchEventLike, touch)
    }
    const onEnd = (e: TouchEvent) => {
      const start = touchStartRef.current
      const touch = start ? findTouch(e.changedTouches, start.id) : null
      if (!touch) return
      handleEnd(touch)
    }
    const onCancel = () => handleCancel()
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onCancel, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onCancel)
    }
  }, [targetRef, enabled, handleStart, handleMove, handleEnd, handleCancel])

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = singleTouch(e.touches)
      if (!touch || !enabled) return
      handleStart(touch)
    },
    [enabled, handleStart]
  )

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const start = touchStartRef.current
      const touch = start ? findTouch(e.touches, start.id) : null
      if (!touch) return
      handleMove(e as unknown as TouchEventLike, touch)
    },
    [handleMove]
  )

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const start = touchStartRef.current
      const touch = start ? findTouch(e.changedTouches, start.id) : null
      if (!touch) {
        resetGesture()
        return
      }
      handleEnd(touch)
    },
    [handleEnd, resetGesture]
  )

  const onTouchCancel = useCallback(() => {
    handleCancel()
  }, [handleCancel])

  const style: React.CSSProperties | undefined =
    translateX !== 0 ? { transform: `translateX(${translateX}px)` } : undefined

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
    translateX,
    isReturning,
    style,
  }
}
