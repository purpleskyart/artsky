import { useState, useEffect, useMemo } from 'react'
import { debounce } from '../lib/utils'

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
 * @param viewMode - View mode ('1', '2', or '3' columns)
 * @param debounceMs - Milliseconds to debounce resize events (default: 150ms)
 * @returns Number of columns (1-3)
 */
export function useColumnCount(viewMode: '1' | '2' | '3', debounceMs = 150): number {
  const width = useViewportWidth(debounceMs)
  
  return useMemo(() => {
    const cols = viewMode === '1' ? 1 : viewMode === '2' ? 2 : 3
    return Math.min(3, Math.max(1, cols))
  }, [viewMode, width])
}
