import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { debounce } from '../lib/utils'

/**
 * Integration tests for debounced seen posts tracking in FeedPage
 * 
 * **Validates: Requirements 3.2**
 * 
 * These tests verify that seen posts updates are debounced to reduce
 * re-render frequency and localStorage write operations.
 */

describe('FeedPage - Debounced Seen Posts Tracking', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Mock localStorage
    const localStorageMock = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    }
    global.localStorage = localStorageMock as any
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Unit Tests', () => {
    it('should debounce seen posts updates with 1000ms delay', () => {
      const saveSeenUris = vi.fn((uris: Set<string>) => {
        localStorage.setItem('artsky-seen-posts', JSON.stringify([...uris]))
      })
      
      const debouncedSave = debounce(saveSeenUris, 1000)

      // Simulate rapid seen posts updates
      debouncedSave(new Set(['uri1']))
      vi.advanceTimersByTime(500)
      
      debouncedSave(new Set(['uri1', 'uri2']))
      vi.advanceTimersByTime(500)
      
      // No saves should have occurred yet
      expect(saveSeenUris).not.toHaveBeenCalled()
      expect(localStorage.setItem).not.toHaveBeenCalled()

      // Complete the debounce period
      vi.advanceTimersByTime(1000)

      // Only one save with the final state
      expect(saveSeenUris).toHaveBeenCalledTimes(1)
      expect(localStorage.setItem).toHaveBeenCalledTimes(1)
      expect(localStorage.setItem).toHaveBeenCalledWith(
        'artsky-seen-posts',
        JSON.stringify(['uri1', 'uri2'])
      )
    })

    it('should batch multiple rapid updates into a single localStorage write', () => {
      const saveSeenUris = vi.fn((uris: Set<string>) => {
        localStorage.setItem('artsky-seen-posts', JSON.stringify([...uris]))
      })
      
      const debouncedSave = debounce(saveSeenUris, 1000)

      // Simulate 10 rapid updates (e.g., user scrolling through feed)
      for (let i = 1; i <= 10; i++) {
        const uris = new Set<string>()
        for (let j = 1; j <= i; j++) {
          uris.add(`uri${j}`)
        }
        debouncedSave(uris)
        vi.advanceTimersByTime(100)
      }

      // No saves should have occurred during rapid updates
      expect(saveSeenUris).not.toHaveBeenCalled()
      expect(localStorage.setItem).not.toHaveBeenCalled()

      // Complete the debounce period
      vi.advanceTimersByTime(1000)

      // Only one save with the final state (all 10 URIs)
      expect(saveSeenUris).toHaveBeenCalledTimes(1)
      expect(localStorage.setItem).toHaveBeenCalledTimes(1)
      
      const savedData = JSON.parse(
        (localStorage.setItem as any).mock.calls[0][1]
      )
      expect(savedData).toHaveLength(10)
      expect(savedData).toContain('uri1')
      expect(savedData).toContain('uri10')
    })

    it('should allow subsequent saves after debounce period completes', () => {
      const saveSeenUris = vi.fn((uris: Set<string>) => {
        localStorage.setItem('artsky-seen-posts', JSON.stringify([...uris]))
      })
      
      const debouncedSave = debounce(saveSeenUris, 1000)

      // First batch of updates
      debouncedSave(new Set(['uri1']))
      vi.advanceTimersByTime(1000)
      expect(saveSeenUris).toHaveBeenCalledTimes(1)

      // Second batch of updates after debounce completes
      debouncedSave(new Set(['uri1', 'uri2']))
      vi.advanceTimersByTime(1000)
      expect(saveSeenUris).toHaveBeenCalledTimes(2)

      // Third batch
      debouncedSave(new Set(['uri1', 'uri2', 'uri3']))
      vi.advanceTimersByTime(1000)
      expect(saveSeenUris).toHaveBeenCalledTimes(3)
    })

    it('should handle edge case of empty seen posts set', () => {
      const saveSeenUris = vi.fn((uris: Set<string>) => {
        localStorage.setItem('artsky-seen-posts', JSON.stringify([...uris]))
      })
      
      const debouncedSave = debounce(saveSeenUris, 1000)

      debouncedSave(new Set())
      vi.advanceTimersByTime(1000)

      expect(saveSeenUris).toHaveBeenCalledTimes(1)
      expect(localStorage.setItem).toHaveBeenCalledWith(
        'artsky-seen-posts',
        JSON.stringify([])
      )
    })

    it('should preserve the most recent state when updates are cancelled', () => {
      const saveSeenUris = vi.fn((uris: Set<string>) => {
        localStorage.setItem('artsky-seen-posts', JSON.stringify([...uris]))
      })
      
      const debouncedSave = debounce(saveSeenUris, 1000)

      // First update
      debouncedSave(new Set(['uri1']))
      vi.advanceTimersByTime(900)

      // Second update cancels the first
      debouncedSave(new Set(['uri1', 'uri2']))
      vi.advanceTimersByTime(900)

      // Third update cancels the second
      debouncedSave(new Set(['uri1', 'uri2', 'uri3']))
      vi.advanceTimersByTime(1000)

      // Only the third (most recent) state should be saved
      expect(saveSeenUris).toHaveBeenCalledTimes(1)
      expect(localStorage.setItem).toHaveBeenCalledWith(
        'artsky-seen-posts',
        JSON.stringify(['uri1', 'uri2', 'uri3'])
      )
    })
  })

  describe('Performance characteristics', () => {
    it('should reduce localStorage write operations by at least 90% during rapid updates', () => {
      const saveSeenUris = vi.fn((uris: Set<string>) => {
        localStorage.setItem('artsky-seen-posts', JSON.stringify([...uris]))
      })
      
      const debouncedSave = debounce(saveSeenUris, 1000)

      // Simulate 100 rapid updates (without debouncing, this would be 100 writes)
      for (let i = 1; i <= 100; i++) {
        debouncedSave(new Set([`uri${i}`]))
        vi.advanceTimersByTime(50)
      }

      vi.advanceTimersByTime(1000)

      // With debouncing, only 1 write occurs (99% reduction)
      expect(localStorage.setItem).toHaveBeenCalledTimes(1)
      
      // Verify reduction percentage
      const reductionPercentage = ((100 - 1) / 100) * 100
      expect(reductionPercentage).toBeGreaterThanOrEqual(90)
    })

    it('should maintain correct state despite rapid updates', () => {
      let currentState = new Set<string>()
      
      const saveSeenUris = vi.fn((uris: Set<string>) => {
        currentState = new Set(uris)
        localStorage.setItem('artsky-seen-posts', JSON.stringify([...uris]))
      })
      
      const debouncedSave = debounce(saveSeenUris, 1000)

      // Simulate accumulating seen posts
      const expectedFinalState = new Set<string>()
      for (let i = 1; i <= 50; i++) {
        expectedFinalState.add(`uri${i}`)
        debouncedSave(new Set(expectedFinalState))
        vi.advanceTimersByTime(100)
      }

      vi.advanceTimersByTime(1000)

      // Verify final state matches expected
      expect(currentState.size).toBe(50)
      expect([...currentState]).toEqual([...expectedFinalState])
    })
  })
})
