import { useRef, useState, useCallback, useEffect } from 'react'

/** Visual offset (px) past which releasing triggers refresh — tuned to match iOS with rubber-band mapping. */
export const PULL_THRESHOLD_PX = 62
export const PULL_COMMIT_PX = 8
/** Offset (px) to hold content at while refreshing (iPhone-style). */
export const PULL_REFRESH_HOLD_PX = 56

/** Stricter defaults for modal scroll: require a deliberate pull, not a small nudge at scroll top. */
export const MODAL_PULL_COMMIT_PX = 28
export const MODAL_PULL_THRESHOLD_PX = 88
export const MODAL_RUBBER_BAND_SCALE = 0.68

/** Finger delta → on-screen pull (iOS UIScrollView-style rubber band, not 1:1). */
function fingerDeltaToPullOffset(dy: number, rubberBandScale = 1): number {
  if (dy <= 0) return 0
  const maxVisual = 100
  return maxVisual * (1 - Math.exp(-dy * 0.0173 * rubberBandScale))
}

export interface UsePullToRefreshOptions {
  /** Scroll container ref. When null, use window/document for scroll position. */
  scrollRef: React.RefObject<HTMLElement | null> | null
  /** Element to attach touch listeners to (for pull detection). When null, use scrollRef. Required when scrollRef is null (e.g. window scroll). */
  touchTargetRef: React.RefObject<HTMLElement | null> | null
  /** Called when user completes a pull-to-refresh. May return a Promise; isRefreshing stays true until it resolves. */
  onRefresh: () => void | Promise<void>
  /** When false, touch handlers are no-ops. Use to disable when e.g. a nested scroll is active. */
  enabled?: boolean
  /** When set, only arm pull when touch starts with clientY <= this value (viewport top). Use to restrict pull to a top strip and avoid triggering under buttons. */
  maxTouchStartY?: number
  /** Vertical finger travel (px) at scroll top before pull arms (default `PULL_COMMIT_PX`). */
  pullCommitPx?: number
  /** Release distance to trigger refresh (default `PULL_THRESHOLD_PX`). */
  pullThresholdPx?: number
  /** Multiplier on rubber-band curve; below 1 = stiffer pull for the same finger travel (default 1). */
  rubberBandScale?: number
}

export interface UsePullToRefreshResult {
  onTouchStart: (e: React.TouchEvent) => void
  onTouchMove: (e: React.TouchEvent) => void
  onTouchEnd: (e: React.TouchEvent) => void
  /** Current pull distance in px (0 when not pulling). Use for indicator transform. */
  pullDistance: number
  /** True while onRefresh is in progress (after trigger until Promise resolves). */
  isRefreshing: boolean
}

function getScrollTop(scrollRef: React.RefObject<HTMLElement | null> | null): number {
  if (scrollRef?.current) return scrollRef.current.scrollTop
  if (typeof window === 'undefined') return 0
  return window.scrollY ?? document.documentElement.scrollTop
}

/**
 * Pull-to-refresh for installed PWAs: at scroll top, pull down triggers onRefresh with iOS-like rubber banding.
 * In mobile browsers, disable this hook so the system pull-to-refresh can reload the page.
 */
export function usePullToRefresh({
  scrollRef,
  touchTargetRef,
  onRefresh,
  enabled = true,
  maxTouchStartY,
  pullCommitPx = PULL_COMMIT_PX,
  pullThresholdPx = PULL_THRESHOLD_PX,
  rubberBandScale = 1,
}: UsePullToRefreshOptions): UsePullToRefreshResult {
  const startXRef = useRef(0)
  const startYRef = useRef(0)
  const startScrollTopRef = useRef(0)
  const pullingRef = useRef(false)
  const pullDistanceRef = useRef(0)
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const isRefreshingRef = useRef(false)
  const onRefreshRef = useRef(onRefresh)
  const snapRafRef = useRef<number | null>(null)
  onRefreshRef.current = onRefresh

  useEffect(() => {
    isRefreshingRef.current = isRefreshing
  }, [isRefreshing])

  const cancelSnap = useCallback(() => {
    if (snapRafRef.current != null) {
      cancelAnimationFrame(snapRafRef.current)
      snapRafRef.current = null
    }
  }, [])

  const snapBackToZero = useCallback(
    (from: number) => {
      cancelSnap()
      if (from <= 0) return
      const start = performance.now()
      const duration = 280
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration)
        const eased = 1 - (1 - t) ** 3
        const v = from * (1 - eased)
        pullDistanceRef.current = v
        setPullDistance(v)
        if (t < 1) {
          snapRafRef.current = requestAnimationFrame(tick)
        } else {
          snapRafRef.current = null
          pullDistanceRef.current = 0
          setPullDistance(0)
        }
      }
      snapRafRef.current = requestAnimationFrame(tick)
    },
    [cancelSnap]
  )

  const runRefresh = useCallback(async () => {
    cancelSnap()
    setIsRefreshing(true)
    setPullDistance(PULL_REFRESH_HOLD_PX)
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(10)
      }
      await Promise.resolve(onRefreshRef.current())
    } finally {
      setIsRefreshing(false)
      setPullDistance(0)
    }
  }, [cancelSnap])

  const applyPullFromDy = useCallback(
    (dy: number) => {
      const visual = fingerDeltaToPullOffset(dy, rubberBandScale)
      pullDistanceRef.current = visual
      setPullDistance(visual)
    },
    [rubberBandScale]
  )

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || e.touches.length !== 1) return
      cancelSnap()
      pullingRef.current = false
      setPullDistance(0)
      const x = e.touches[0].clientX
      const y = e.touches[0].clientY
      if (maxTouchStartY != null && y > maxTouchStartY) return
      startXRef.current = x
      startYRef.current = y
      startScrollTopRef.current = getScrollTop(scrollRef)
    },
    [enabled, scrollRef, maxTouchStartY, cancelSnap]
  )

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || e.touches.length !== 1) return
      const scrollTop = getScrollTop(scrollRef)
      const dx = e.touches[0].clientX - startXRef.current
      const dy = e.touches[0].clientY - startYRef.current

      if (Math.abs(dx) > Math.abs(dy) * 2) {
        return
      }

      if (!pullingRef.current) {
        if (scrollTop <= 2 && dy > pullCommitPx) {
          pullingRef.current = true
        } else {
          return
        }
      }

      if (pullingRef.current && scrollTop <= 2 && dy > 0) {
        e.preventDefault()
        applyPullFromDy(dy)
      }
    },
    [enabled, scrollRef, applyPullFromDy, pullCommitPx]
  )

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || e.changedTouches.length !== 1) {
        pullingRef.current = false
        cancelSnap()
        setPullDistance(0)
        return
      }
      if (pullingRef.current) {
        const distance = pullDistanceRef.current
        if (distance >= pullThresholdPx && !isRefreshingRef.current) {
          void runRefresh()
        } else {
          snapBackToZero(distance)
        }
        pullingRef.current = false
      }
    },
    [enabled, runRefresh, snapBackToZero, cancelSnap, pullThresholdPx]
  )

  /* touchmove with passive: false so preventDefault() works when pulling at top. */
  useEffect(() => {
    const el = touchTargetRef?.current ?? scrollRef?.current
    if (!enabled || !el) return
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      cancelSnap()
      pullingRef.current = false
      pullDistanceRef.current = 0
      setPullDistance(0)
      startXRef.current = e.touches[0].clientX
      startYRef.current = e.touches[0].clientY
    }
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const scrollTop = getScrollTop(scrollRef)
      const dx = e.touches[0].clientX - startXRef.current
      const dy = e.touches[0].clientY - startYRef.current

      if (Math.abs(dx) > Math.abs(dy) * 2) {
        return
      }

      if (maxTouchStartY != null && startYRef.current > maxTouchStartY) return
      if (!pullingRef.current) {
        if (scrollTop <= 2 && dy > pullCommitPx) pullingRef.current = true
        else return
      }
      if (pullingRef.current && scrollTop <= 2 && dy > 0) {
        e.preventDefault()
        applyPullFromDy(dy)
      }
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
    }
  }, [enabled, scrollRef, touchTargetRef, maxTouchStartY, applyPullFromDy, cancelSnap, pullCommitPx])

  useEffect(() => {
    return () => cancelSnap()
  }, [cancelSnap])

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    pullDistance,
    isRefreshing,
  }
}
