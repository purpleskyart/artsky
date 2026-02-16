import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { debounce } from './utils'

describe('debounce utility', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Unit Tests', () => {
    it('should delay function execution by the specified wait time', () => {
      const mockFn = vi.fn()
      const debouncedFn = debounce(mockFn, 1000)

      debouncedFn('test')
      expect(mockFn).not.toHaveBeenCalled()

      vi.advanceTimersByTime(999)
      expect(mockFn).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)
      expect(mockFn).toHaveBeenCalledTimes(1)
      expect(mockFn).toHaveBeenCalledWith('test')
    })

    it('should cancel previous timeout when called multiple times', () => {
      const mockFn = vi.fn()
      const debouncedFn = debounce(mockFn, 1000)

      debouncedFn('first')
      vi.advanceTimersByTime(500)
      
      debouncedFn('second')
      vi.advanceTimersByTime(500)
      
      // First call should be cancelled, function not called yet
      expect(mockFn).not.toHaveBeenCalled()

      vi.advanceTimersByTime(500)
      
      // Only the second call should execute
      expect(mockFn).toHaveBeenCalledTimes(1)
      expect(mockFn).toHaveBeenCalledWith('second')
    })

    it('should handle multiple arguments correctly', () => {
      const mockFn = vi.fn()
      const debouncedFn = debounce(mockFn, 1000)

      debouncedFn('arg1', 'arg2', 'arg3')
      vi.advanceTimersByTime(1000)

      expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2', 'arg3')
    })

    it('should allow multiple executions after wait time', () => {
      const mockFn = vi.fn()
      const debouncedFn = debounce(mockFn, 1000)

      debouncedFn('first')
      vi.advanceTimersByTime(1000)
      expect(mockFn).toHaveBeenCalledTimes(1)

      debouncedFn('second')
      vi.advanceTimersByTime(1000)
      expect(mockFn).toHaveBeenCalledTimes(2)
    })

    it('should handle rapid successive calls correctly', () => {
      const mockFn = vi.fn()
      const debouncedFn = debounce(mockFn, 1000)

      // Simulate rapid calls
      for (let i = 0; i < 10; i++) {
        debouncedFn(`call-${i}`)
        vi.advanceTimersByTime(100)
      }

      // Function should not have been called yet
      expect(mockFn).not.toHaveBeenCalled()

      // Advance to complete the debounce period from the last call
      vi.advanceTimersByTime(1000)

      // Only the last call should execute
      expect(mockFn).toHaveBeenCalledTimes(1)
      expect(mockFn).toHaveBeenCalledWith('call-9')
    })

    it('should work with zero wait time', () => {
      const mockFn = vi.fn()
      const debouncedFn = debounce(mockFn, 0)

      debouncedFn('test')
      expect(mockFn).not.toHaveBeenCalled()

      vi.advanceTimersByTime(0)
      expect(mockFn).toHaveBeenCalledTimes(1)
    })

    it('should preserve function context and arguments', () => {
      const mockFn = vi.fn()
      const debouncedFn = debounce(mockFn, 1000)

      const obj = { value: 42 }
      debouncedFn(obj)
      vi.advanceTimersByTime(1000)

      expect(mockFn).toHaveBeenCalledWith(obj)
      expect(mockFn.mock.calls[0][0]).toBe(obj)
    })
  })

  describe('Integration with seen posts tracking', () => {
    it('should debounce localStorage writes for seen posts', () => {
      const saveToStorage = vi.fn()
      const debouncedSave = debounce(saveToStorage, 1000)

      // Simulate rapid seen post updates
      const seenUris1 = new Set(['uri1'])
      const seenUris2 = new Set(['uri1', 'uri2'])
      const seenUris3 = new Set(['uri1', 'uri2', 'uri3'])

      debouncedSave(seenUris1)
      vi.advanceTimersByTime(300)
      
      debouncedSave(seenUris2)
      vi.advanceTimersByTime(300)
      
      debouncedSave(seenUris3)
      vi.advanceTimersByTime(300)

      // No saves should have occurred yet
      expect(saveToStorage).not.toHaveBeenCalled()

      // Complete the debounce period
      vi.advanceTimersByTime(1000)

      // Only one save with the final state
      expect(saveToStorage).toHaveBeenCalledTimes(1)
      expect(saveToStorage).toHaveBeenCalledWith(seenUris3)
    })
  })
})
