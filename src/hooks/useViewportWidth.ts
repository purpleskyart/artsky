import { useState, useEffect, useMemo } from 'react'
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

export function getColumnCountForViewMode(viewMode: ViewMode, width: number): number {
  if (viewMode === '1') return 1
  if (viewMode === '2') return 2
  if (viewMode === '3') return 3
  if (width < DESKTOP_BREAKPOINT) return 1
  return Math.max(1, Math.min(AUTO_MAX_COLUMNS, Math.floor(width / AUTO_MIN_COLUMN_WIDTH)))
}

export function useColumnCount(viewMode: ViewMode, debounceMs = 150): number {
  const width = useViewportWidth(debounceMs)
  
  return useMemo(() => {
    return getColumnCountForViewMode(viewMode, width)
  }, [viewMode, width])
}
