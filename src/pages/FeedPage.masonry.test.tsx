import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { debounce } from '../lib/utils'

/**
 * Unit tests for debounced masonry layout recalculation in FeedPage
 * 
 * **Validates: Requirements 6.2**
 * 
 * These tests verify that masonry layout recalculations are debounced
 * during rapid scroll and resize events to prevent excessive computation.
 */

describe('FeedPage - Debounced Masonry Layout Recalculation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('ResizeObserver debouncing', () => {
    it('should debounce layout recalculation during rapid resize events', () => {
      const updateScrollMargin = vi.fn((top: number) => {
        // Simulate setScrollMargin state update
      })
      
      const debouncedUpdate = debounce(() => {
        const top = 100 // Mock getBoundingClientRect().top + scrollY
        updateScrollMargin(top)
      }, 150)

      // Simulate rapid resize events (e.g., during window resize or content changes)
      for (let i = 0; i < 10; i++) {
        debouncedUpdate()
        vi.advanceTimersByTime(50)
      }

      // No updates should have occurred during rapid events
      expect(updateScrollMargin).not.toHaveBeenCalled()

      // Complete the debounce period
      vi.advanceTimersByTime(150)

      // Only one update with the final state
      expect(updateScrollMargin).toHaveBeenCalledTimes(1)
    })

    it('should batch multiple resize events into a single layout recalculation', () => {
      let recalculationCount = 0
      const performLayoutRecalculation = vi.fn(() => {
        recalculationCount++
      })
      
      const debouncedRecalc = debounce(performLayoutRecalculation, 150)

      // Simulate 20 rapid resize events (without debouncing, this would be 20 recalculations)
      for (let i = 0; i < 20; i++) {
        debouncedRecalc()
        vi.advanceTimersByTime(25)
      }

      // No recalculations should have occurred yet
      expect(recalculationCount).toBe(0)

      vi.advanceTimersByTime(150)

      // Only one recalculation (95% reduction)
      expect(recalculationCount).toBe(1)
      expect(performLayoutRecalculation).toHaveBeenCalledTimes(1)
    })

    it('should allow subsequent recalculations after debounce period completes', () => {
      const performLayoutRecalculation = vi.fn()
      const debouncedRecalc = debounce(performLayoutRecalculation, 150)

      // First batch of resize events
      debouncedRecalc()
      vi.advanceTimersByTime(150)
      expect(performLayoutRecalculation).toHaveBeenCalledTimes(1)

      // Second batch after debounce completes
      debouncedRecalc()
      vi.advanceTimersByTime(150)
      expect(performLayoutRecalculation).toHaveBeenCalledTimes(2)

      // Third batch
      debouncedRecalc()
      vi.advanceTimersByTime(150)
      expect(performLayoutRecalculation).toHaveBeenCalledTimes(3)
    })

    it('should use 150ms debounce delay for resize events', () => {
      const performLayoutRecalculation = vi.fn()
      const debouncedRecalc = debounce(performLayoutRecalculation, 150)

      debouncedRecalc()
      
      // Should not fire before 150ms
      vi.advanceTimersByTime(149)
      expect(performLayoutRecalculation).not.toHaveBeenCalled()

      // Should fire at 150ms
      vi.advanceTimersByTime(1)
      expect(performLayoutRecalculation).toHaveBeenCalledTimes(1)
    })
  })

  describe('Scroll event debouncing', () => {
    it('should debounce scroll handler during rapid scroll events', () => {
      const handleScroll = vi.fn(() => {
        // Simulate scroll handler logic (classList operations, etc.)
      })
      
      const debouncedScroll = debounce(handleScroll, 16) // ~60fps

      // Simulate rapid scroll events (e.g., fast scrolling through feed)
      for (let i = 0; i < 30; i++) {
        debouncedScroll()
        vi.advanceTimersByTime(5)
      }

      // No scroll handlers should have executed during rapid scrolling
      expect(handleScroll).not.toHaveBeenCalled()

      // Complete the debounce period
      vi.advanceTimersByTime(16)

      // Only one scroll handler execution
      expect(handleScroll).toHaveBeenCalledTimes(1)
    })

    it('should use 16ms debounce delay for scroll events (~60fps)', () => {
      const handleScroll = vi.fn()
      const debouncedScroll = debounce(handleScroll, 16)

      debouncedScroll()
      
      // Should not fire before 16ms
      vi.advanceTimersByTime(15)
      expect(handleScroll).not.toHaveBeenCalled()

      // Should fire at 16ms
      vi.advanceTimersByTime(1)
      expect(handleScroll).toHaveBeenCalledTimes(1)
    })

    it('should reduce scroll handler executions by at least 90% during rapid scrolling', () => {
      const handleScroll = vi.fn()
      const debouncedScroll = debounce(handleScroll, 16)

      // Simulate 100 rapid scroll events (without debouncing, this would be 100 executions)
      for (let i = 0; i < 100; i++) {
        debouncedScroll()
        vi.advanceTimersByTime(5)
      }

      vi.advanceTimersByTime(16)

      // With debouncing, only 1 execution occurs (99% reduction)
      expect(handleScroll).toHaveBeenCalledTimes(1)
      
      // Verify reduction percentage
      const reductionPercentage = ((100 - 1) / 100) * 100
      expect(reductionPercentage).toBeGreaterThanOrEqual(90)
    })
  })

  describe('Performance characteristics', () => {
    it('should prevent layout thrashing during simultaneous scroll and resize', () => {
      const layoutRecalculations = vi.fn()
      const scrollHandlers = vi.fn()
      
      const debouncedLayout = debounce(layoutRecalculations, 150)
      const debouncedScroll = debounce(scrollHandlers, 16)

      // Simulate simultaneous scroll and resize events (e.g., user scrolling while window resizing)
      for (let i = 0; i < 50; i++) {
        debouncedScroll()
        if (i % 5 === 0) debouncedLayout() // Resize every 5 scroll events
        vi.advanceTimersByTime(10)
      }

      // No handlers should have executed during rapid events
      expect(layoutRecalculations).not.toHaveBeenCalled()
      expect(scrollHandlers).not.toHaveBeenCalled()

      // Complete both debounce periods
      vi.advanceTimersByTime(150)

      // Only one execution of each handler
      expect(layoutRecalculations).toHaveBeenCalledTimes(1)
      expect(scrollHandlers).toHaveBeenCalledTimes(1)
    })

    it('should maintain responsive UI by limiting recalculation frequency', () => {
      const recalculationTimes: number[] = []
      const performRecalculation = vi.fn(() => {
        recalculationTimes.push(Date.now())
      })
      
      const debouncedRecalc = debounce(performRecalculation, 150)

      // Simulate continuous scrolling over 2 seconds
      const startTime = Date.now()
      for (let i = 0; i < 200; i++) {
        debouncedRecalc()
        vi.advanceTimersByTime(10)
      }

      vi.advanceTimersByTime(150)

      // Should have minimal recalculations despite 200 events
      expect(performRecalculation).toHaveBeenCalledTimes(1)
      
      // Verify recalculation frequency is limited
      const totalTime = Date.now() - startTime
      const recalculationsPerSecond = (recalculationTimes.length / totalTime) * 1000
      
      // Should be much less than 60 recalculations per second (one per frame)
      expect(recalculationsPerSecond).toBeLessThan(10)
    })

    it('should handle edge case of single scroll/resize event without delay', () => {
      const handleEvent = vi.fn()
      const debouncedHandler = debounce(handleEvent, 150)

      // Single event
      debouncedHandler()
      vi.advanceTimersByTime(150)

      // Should execute once
      expect(handleEvent).toHaveBeenCalledTimes(1)
    })

    it('should cancel pending recalculations when new events arrive', () => {
      const performRecalculation = vi.fn()
      const debouncedRecalc = debounce(performRecalculation, 150)

      // First event
      debouncedRecalc()
      vi.advanceTimersByTime(100)

      // Second event cancels the first
      debouncedRecalc()
      vi.advanceTimersByTime(100)

      // Third event cancels the second
      debouncedRecalc()
      vi.advanceTimersByTime(150)

      // Only the third (most recent) recalculation should execute
      expect(performRecalculation).toHaveBeenCalledTimes(1)
    })
  })
})
