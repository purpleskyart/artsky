import { useRef, useState, useCallback, useEffect } from 'react'

const PULL_THRESHOLD_PX = 58
const PULL_COMMIT_PX = 8
const PULL_CAP_PX = 90
/** Offset (px) to hold content at while refreshing (iPhone-style). */
export const PULL_REFRESH_HOLD_PX = 56

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
 * Pull-to-refresh for mobile: when user is at top and pulls down, trigger onRefresh.
 * Attach returned handlers to the scroll container (or a wrapper); when scrollRef is null (window scroll), still attach to a root element so touch events are captured.
 */
export function usePullToRefresh({
  scrollRef,
  touchTargetRef,
  onRefresh,
  enabled = true,
  maxTouchStartY,
}: UsePullToRefreshOptions): UsePullToRefreshResult {
  const startXRef = useRef(0)
  const startYRef = useRef(0)
  const startScrollTopRef = useRef(0)
  const pullingRef = useRef(false)
  const pullDistanceRef = useRef(0)
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh

  const runRefresh = useCallback(async () => {
    setIsRefreshing(true)
    setPullDistance(PULL_REFRESH_HOLD_PX)
    try {
      await Promise.resolve(onRefreshRef.current())
    } finally {
      setIsRefreshing(false)
      setPullDistance(0)
    }
  }, [])

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || e.touches.length !== 1) return
      pullingRef.current = false
      setPullDistance(0)
      const x = e.touches[0].clientX
      const y = e.touches[0].clientY
      if (maxTouchStartY != null && y > maxTouchStartY) return
      startXRef.current = x
      startYRef.current = y
      startScrollTopRef.current = getScrollTop(scrollRef)
    },
    [enabled, scrollRef, maxTouchStartY]
  )

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || e.touches.length !== 1) return
      const scrollTop = getScrollTop(scrollRef)
      const dx = e.touches[0].clientX - startXRef.current
      const dy = e.touches[0].clientY - startYRef.current
      
      // Don't pull if this is clearly a horizontal swipe (swiping back)
      if (Math.abs(dx) > Math.abs(dy) * 2) {
        return
      }

      if (!pullingRef.current) {
        if (scrollTop <= 2 && dy > PULL_COMMIT_PX) {
          pullingRef.current = true
        } else {
          return
        }
      }

      if (pullingRef.current && scrollTop <= 2 && dy > 0) {
        e.preventDefault()
        const capped = Math.min(PULL_CAP_PX, dy)
        pullDistanceRef.current = capped
        setPullDistance(capped)
      }
    },
    [enabled, scrollRef]
  )

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || e.changedTouches.length !== 1) {
        pullingRef.current = false
        setPullDistance(0)
        return
      }
      if (pullingRef.current) {
        const distance = pullDistanceRef.current
        if (distance >= PULL_THRESHOLD_PX && !isRefreshing) {
          runRefresh()
        } else {
          pullDistanceRef.current = 0
          setPullDistance(0)
        }
        pullingRef.current = false
      }
    },
    [enabled, isRefreshing, runRefresh]
  )

  /* Attach touchstart/touchmove with passive: false so preventDefault() works when pulling at top. */
  useEffect(() => {
    const el = touchTargetRef?.current ?? scrollRef?.current
    if (!enabled || !el) return
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        startXRef.current = e.touches[0].clientX
        startYRef.current = e.touches[0].clientY
      }
    }
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const scrollTop = getScrollTop(scrollRef)
      const dx = e.touches[0].clientX - startXRef.current
      const dy = e.touches[0].clientY - startYRef.current
      
      // Don't pull if this is clearly a horizontal swipe (swiping back)
      if (Math.abs(dx) > Math.abs(dy) * 2) {
        return
      }
      
      if (maxTouchStartY != null && startYRef.current > maxTouchStartY) return
      if (!pullingRef.current) {
        if (scrollTop <= 2 && dy > PULL_COMMIT_PX) pullingRef.current = true
        else return
      }
      if (pullingRef.current && scrollTop <= 2 && dy > 0) {
        e.preventDefault()
        const capped = Math.min(PULL_CAP_PX, dy)
        pullDistanceRef.current = capped
        setPullDistance(capped)
      }
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
    }
  }, [enabled, scrollRef, touchTargetRef, maxTouchStartY])

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    pullDistance,
    isRefreshing,
  }
}
