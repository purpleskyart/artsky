import { useState, useEffect, useMemo, useRef } from 'react'
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

export function useColumnCount(viewMode: ViewMode, debounceMs = 150): number {
  const width = useViewportWidth(debounceMs)
  const stableAutoRef = useRef(0)
  const lastViewModeRef = useRef<ViewMode>(viewMode)

  return useMemo(() => {
    if (lastViewModeRef.current !== viewMode) {
      if (viewMode === 'a') stableAutoRef.current = 0
      lastViewModeRef.current = viewMode
    }

    if (viewMode !== 'a') {
      const c = getColumnCountForViewMode(viewMode, width)
      stableAutoRef.current = c
      return c
    }

    const stable = getStableAutoColumnCount(width, stableAutoRef.current)
    stableAutoRef.current = stable
    return stable
  }, [viewMode, width])
}
