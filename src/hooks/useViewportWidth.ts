import { useState, useEffect, useMemo, useRef, useLayoutEffect, type RefObject } from 'react'
import { debounce } from '../lib/utils'
import type { ViewMode } from '../context/ViewModeContext'

/**
 * Hook to track viewport width with debouncing to minimize re-renders on resize.
 * 
 * @param debounceMs - Milliseconds to debounce resize events (default: 150ms)
 * @returns Current viewport width
 */
export function useViewportWidth(debounceMs = 150): number {
  const [width, setWidth] = useState(() => 
    typeof window !== 'undefined' ? window.innerWidth : 0
  )

  useEffect(() => {
    // Create debounced handler to update width
    const handleResize = debounce(() => {
      setWidth(window.innerWidth)
    }, debounceMs)

    // Set initial width
    setWidth(window.innerWidth)

    // Add event listener
    window.addEventListener('resize', handleResize, { passive: true })

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [debounceMs])

  return width
}

/**
 * Hook to calculate number of columns based on viewport width and view mode.
 * Memoizes the result to prevent unnecessary recalculations.
 * 
 * @param viewMode - View mode ('1', '2', '3', or auto/all columns)
 * @param debounceMs - Milliseconds to debounce resize events (default: 150ms)
 * @returns Number of columns (1+)
 */
const DESKTOP_BREAKPOINT = 768
/** Wider minimum than before so previews stay readable; full-width main makes room for more columns. */
const AUTO_MIN_COLUMN_WIDTH = 320
const AUTO_MAX_COLUMNS = 12
/**
 * Avoid flipping column count when width jitters by a few px (scrollbar gutter, mobile UI, subpixel).
 * Without this, cols can change → FeedPage clears column layout cache → posts jump between columns.
 */
const AUTO_COLUMN_HYSTERESIS_PX = 20

/** Raw auto column count from width (no stability). Exported for tests. */
export function getRawAutoColumnCount(width: number): number {
  if (width < DESKTOP_BREAKPOINT) return 1
  return Math.max(1, Math.min(AUTO_MAX_COLUMNS, Math.floor(width / AUTO_MIN_COLUMN_WIDTH)))
}

/**
 * Stable auto column count: only move up/down when width crosses bucket boundaries by more than
 * AUTO_COLUMN_HYSTERESIS_PX so small viewport jitter does not reshuffle multi-column grids.
 */
export function getStableAutoColumnCount(width: number, previousCount: number): number {
  const raw = getRawAutoColumnCount(width)
  if (previousCount < 1) return raw
  if (raw === previousCount) return previousCount

  const N = AUTO_MIN_COLUMN_WIDTH
  const H = AUTO_COLUMN_HYSTERESIS_PX

  if (raw > previousCount) {
    const thresholdUp = (previousCount + 1) * N
    return width >= thresholdUp + H ? raw : previousCount
  }

  // raw < previousCount
  return width < previousCount * N - H ? raw : previousCount
}

export function getColumnCountForViewMode(viewMode: ViewMode, width: number): number {
  if (viewMode === '1') return 1
  if (viewMode === '2') return 2
  if (viewMode === '3') return 3
  return getRawAutoColumnCount(width)
}

export type UseColumnCountOptions = {
  /**
   * For view mode "All Columns" (`a`): observe this element's clientWidth so column count matches
   * the real masonry width (main max-width, scrollbars, etc.), not only `window.innerWidth`.
   */
  measureRef?: RefObject<HTMLElement | null>
  /**
   * Bumps when the grid mounts/unmounts so we re-attach ResizeObserver (ref object identity is stable).
   * Feed: callback ref + useState counter.
   */
  measureLayoutKey?: number
}

export function useColumnCount(
  viewMode: ViewMode,
  debounceMs = 150,
  options?: UseColumnCountOptions
): number {
  const viewportWidth = useViewportWidth(debounceMs)
  const [measuredLayoutWidth, setMeasuredLayoutWidth] = useState(0)
  const stableAutoRef = useRef(0)
  const lastViewModeRef = useRef<ViewMode>(viewMode)
  const lastBasisKindRef = useRef<'viewport' | 'layout'>('viewport')

  const measureRef = options?.measureRef
  const measureLayoutKey = options?.measureLayoutKey ?? 0
  const shouldMeasure = viewMode === 'a' && measureRef != null

  useLayoutEffect(() => {
    if (!shouldMeasure) {
      setMeasuredLayoutWidth(0)
      return
    }
    const el = measureRef!.current
    if (typeof ResizeObserver === 'undefined') {
      setMeasuredLayoutWidth(0)
      return
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const flush = () => {
      const w = measureRef!.current?.clientWidth ?? 0
      setMeasuredLayoutWidth(w)
    }
    const scheduleFlush = () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      timeoutId = setTimeout(flush, debounceMs)
    }

    if (!el) {
      setMeasuredLayoutWidth(0)
      return () => {
        if (timeoutId !== undefined) clearTimeout(timeoutId)
      }
    }

    flush()
    const ro = new ResizeObserver(() => scheduleFlush())
    ro.observe(el)
    return () => {
      ro.disconnect()
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    }
  }, [shouldMeasure, measureRef, debounceMs, measureLayoutKey])

  return useMemo(() => {
    if (lastViewModeRef.current !== viewMode) {
      if (viewMode === 'a') stableAutoRef.current = 0
      lastViewModeRef.current = viewMode
      lastBasisKindRef.current = 'viewport'
    }

    if (viewMode !== 'a') {
      const c = getColumnCountForViewMode(viewMode, viewportWidth)
      stableAutoRef.current = c
      return c
    }

    const useLayout = shouldMeasure && measuredLayoutWidth > 0
    const basisWidth = useLayout ? measuredLayoutWidth : viewportWidth
    const basisKind: 'viewport' | 'layout' = useLayout ? 'layout' : 'viewport'
    if (basisKind !== lastBasisKindRef.current) {
      stableAutoRef.current = 0
      lastBasisKindRef.current = basisKind
    }

    const stable = getStableAutoColumnCount(basisWidth, stableAutoRef.current)
    stableAutoRef.current = stable
    return stable
  }, [viewMode, viewportWidth, measuredLayoutWidth, shouldMeasure])
}
