import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useViewportWidth, useColumnCount } from '../hooks/useViewportWidth'

/**
 * Unit tests for viewport resize handling optimization
 * 
 * **Validates: Requirements 6.5**
 * 
 * These tests verify that viewport resize recalculations are debounced
 * and that re-renders are minimized during resize events.
 */
describe('FeedPage - Viewport Resize Optimization', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Set initial window size
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('useViewportWidth', () => {
    it('should return initial viewport width', () => {
      const { result } = renderHook(() => useViewportWidth(150))
      expect(result.current).toBe(1024)
    })

    it('should debounce viewport width updates on resize', () => {
      const { result } = renderHook(() => useViewportWidth(150))
      
      // Initial width
      expect(result.current).toBe(1024)
      
      // Trigger multiple rapid resize events
      act(() => {
        Object.defineProperty(window, 'innerWidth', { value: 800, writable: true, configurable: true })
        window.dispatchEvent(new Event('resize'))
      })
      
      // Width should not update immediately (debounced)
      expect(result.current).toBe(1024)
      
      act(() => {
        Object.defineProperty(window, 'innerWidth', { value: 600, writable: true, configurable: true })
        window.dispatchEvent(new Event('resize'))
      })
      
      // Still should not update (debounced)
      expect(result.current).toBe(1024)
      
      // Fast-forward past debounce delay
      act(() => {
        vi.advanceTimersByTime(150)
      })
      
      // Now width should update to the last value
      expect(result.current).toBe(600)
    })

    it('should only trigger one update after multiple rapid resizes', () => {
      const { result } = renderHook(() => useViewportWidth(150))
      
      // Trigger 10 rapid resize events
      act(() => {
        for (let i = 0; i < 10; i++) {
          Object.defineProperty(window, 'innerWidth', { 
            value: 1024 - (i * 10), 
            writable: true, 
            configurable: true 
          })
          window.dispatchEvent(new Event('resize'))
        }
      })
      
      // Width should still be initial (debounced)
      expect(result.current).toBe(1024)
      
      // Fast-forward past debounce delay
      act(() => {
        vi.advanceTimersByTime(150)
      })
      
      // Width should update to the final value (1024 - 9*10 = 934)
      expect(result.current).toBe(934)
    })

    it('should cleanup resize listener on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')
      const { unmount } = renderHook(() => useViewportWidth(150))
      
      unmount()
      
      expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function))
    })
  })

  describe('useColumnCount', () => {
    it('should calculate correct column count for view mode 1', () => {
      const { result } = renderHook(() => useColumnCount('1', 150))
      expect(result.current).toBe(1)
    })

    it('should calculate correct column count for view mode 2', () => {
      const { result } = renderHook(() => useColumnCount('2', 150))
      expect(result.current).toBe(2)
    })

    it('should calculate correct column count for view mode 3', () => {
      const { result } = renderHook(() => useColumnCount('3', 150))
      expect(result.current).toBe(3)
    })

    it('should memoize column count when viewport width changes but view mode stays same', () => {
      const { result } = renderHook(
        ({ viewMode }) => useColumnCount(viewMode, 150),
        { initialProps: { viewMode: '2' as '1' | '2' | '3' } }
      )
      
      const initialCols = result.current
      expect(initialCols).toBe(2)
      
      // Trigger resize
      act(() => {
        Object.defineProperty(window, 'innerWidth', { value: 800, writable: true, configurable: true })
        window.dispatchEvent(new Event('resize'))
        vi.advanceTimersByTime(150)
      })
      
      // Column count should remain the same (view mode didn't change)
      expect(result.current).toBe(2)
    })

    it('should update column count when view mode changes', () => {
      const { result, rerender } = renderHook(
        ({ viewMode }) => useColumnCount(viewMode, 150),
        { initialProps: { viewMode: '2' as '1' | '2' | '3' } }
      )
      
      expect(result.current).toBe(2)
      
      // Change view mode
      rerender({ viewMode: '3' })
      
      expect(result.current).toBe(3)
    })

    it('should debounce column recalculation during rapid viewport changes', () => {
      const { result } = renderHook(() => useColumnCount('3', 150))
      
      expect(result.current).toBe(3)
      
      // Trigger multiple rapid resize events
      act(() => {
        for (let i = 0; i < 5; i++) {
          Object.defineProperty(window, 'innerWidth', { 
            value: 1024 - (i * 50), 
            writable: true, 
            configurable: true 
          })
          window.dispatchEvent(new Event('resize'))
        }
      })
      
      // Column count should remain stable during debounce period
      expect(result.current).toBe(3)
      
      // Fast-forward past debounce delay
      act(() => {
        vi.advanceTimersByTime(150)
      })
      
      // Column count should still be 3 (view mode didn't change)
      expect(result.current).toBe(3)
    })
  })

  describe('Integration - Resize Performance', () => {
    it('should minimize re-renders during viewport resize', () => {
      let renderCount = 0
      renderHook(() => {
        renderCount++
        return useViewportWidth(150)
      })
      
      const initialRenderCount = renderCount
      
      // Trigger 20 rapid resize events
      act(() => {
        for (let i = 0; i < 20; i++) {
          Object.defineProperty(window, 'innerWidth', { 
            value: 1024 - (i * 10), 
            writable: true, 
            configurable: true 
          })
          window.dispatchEvent(new Event('resize'))
        }
      })
      
      // Should not have re-rendered yet (debounced)
      expect(renderCount).toBe(initialRenderCount)
      
      // Fast-forward past debounce delay
      act(() => {
        vi.advanceTimersByTime(150)
      })
      
      // Should have re-rendered only once
      expect(renderCount).toBe(initialRenderCount + 1)
    })

    it('should handle multiple debounce periods correctly', () => {
      const { result } = renderHook(() => useViewportWidth(150))
      
      // First batch of resizes
      act(() => {
        Object.defineProperty(window, 'innerWidth', { value: 800, writable: true, configurable: true })
        window.dispatchEvent(new Event('resize'))
        vi.advanceTimersByTime(150)
      })
      
      expect(result.current).toBe(800)
      
      // Second batch of resizes
      act(() => {
        Object.defineProperty(window, 'innerWidth', { value: 600, writable: true, configurable: true })
        window.dispatchEvent(new Event('resize'))
        vi.advanceTimersByTime(150)
      })
      
      expect(result.current).toBe(600)
      
      // Third batch of resizes
      act(() => {
        Object.defineProperty(window, 'innerWidth', { value: 1200, writable: true, configurable: true })
        window.dispatchEvent(new Event('resize'))
        vi.advanceTimersByTime(150)
      })
      
      expect(result.current).toBe(1200)
    })
  })
})
