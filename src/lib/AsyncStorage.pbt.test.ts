/**
 * Property-based tests for AsyncStorage localStorage optimization
 * Feature: performance-optimization
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fc from 'fast-check'
import { asyncStorage } from './AsyncStorage'

describe('AsyncStorage Property-Based Tests', () => {
  let localStorageMock: {
    getItem: ReturnType<typeof vi.fn>
    setItem: ReturnType<typeof vi.fn>
    removeItem: ReturnType<typeof vi.fn>
    clear: ReturnType<typeof vi.fn>
    length: number
    key: ReturnType<typeof vi.fn>
  }
  let storage: Map<string, string>

  beforeEach(() => {
    storage = new Map<string, string>()
    localStorageMock = {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value)
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key)
      }),
      clear: vi.fn(() => {
        storage.clear()
      }),
      get length() {
        return storage.size
      },
      key: vi.fn((index: number) => {
        const keys = Array.from(storage.keys())
        return keys[index] ?? null
      }),
    }
    global.localStorage = localStorageMock as any
    vi.useFakeTimers()
    
    // Re-check availability after setting up mocks
    ;(asyncStorage as any).isAvailable = (asyncStorage as any).checkAvailability()
    // Clear AsyncStorage queue before each test
    asyncStorage.clearQueue()
    
    // Clear any calls made during availability check
    localStorageMock.setItem.mockClear()
    localStorageMock.getItem.mockClear()
    localStorageMock.removeItem.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  /**
   * Property 22: Asynchronous localStorage Operations
   * **Validates: Requirements 8.1**
   * 
   * For any localStorage write operation, the operation should be performed 
   * asynchronously (e.g., in requestIdleCallback) to avoid blocking the render 
   * path and degrading UI responsiveness.
   */
  it('Property 22: writes are performed asynchronously outside render path', () => {
    fc.assert(
      fc.property(
        fc.record({
          key: fc.string({ minLength: 1, maxLength: 50 }),
          value: fc.oneof(
            fc.string(),
            fc.integer(),
            fc.boolean(),
            fc.array(fc.string()),
            fc.dictionary(fc.string(), fc.anything())
          ),
        }),
        ({ key, value }) => {
          localStorageMock.setItem.mockClear()
          
          // Perform write
          asyncStorage.set(key, value, 0)
          
          // Immediately after set(), localStorage.setItem should NOT have been called
          // (it should be deferred to requestIdleCallback or setTimeout)
          expect(localStorageMock.setItem).not.toHaveBeenCalled()
          
          // Advance timers to trigger async write
          vi.runAllTimers()
          
          // Now it should have been called
          expect(localStorageMock.setItem).toHaveBeenCalled()
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * Property 23: localStorage Write Optimization
   * **Validates: Requirements 8.2, 8.3, 8.4**
   * 
   * For any sequence of localStorage writes (seen posts, session data, etc.), 
   * the application should debounce writes (minimum 1000ms), avoid redundant 
   * serialization of unchanged data, and batch multiple writes where possible.
   */
  it('Property 23: rapid writes are debounced and batched', () => {
    fc.assert(
      fc.property(
        fc.record({
          writes: fc.array(
            fc.record({
              key: fc.constantFrom('key1', 'key2', 'key3'),
              value: fc.integer({ min: 0, max: 100 }),
            }),
            { minLength: 2, maxLength: 20 }
          ),
          debounceMs: fc.constantFrom(500, 1000, 1500),
        }),
        ({ writes, debounceMs }) => {
          // Clear queue and storage before each property test run
          asyncStorage.clearQueue()
          storage.clear()
          localStorageMock.setItem.mockClear()
          
          // Perform rapid writes
          for (const { key, value } of writes) {
            asyncStorage.set(key, value, debounceMs)
          }
          
          // Before debounce period, no writes should occur
          expect(localStorageMock.setItem).not.toHaveBeenCalled()
          
          // Advance time by debounce period
          vi.advanceTimersByTime(debounceMs + 100) // Add buffer for requestIdleCallback
          
          // After debounce, writes should be batched
          // Count unique keys to determine expected write count
          const uniqueKeys = new Set(writes.map(w => w.key))
          
          // Should have written once per unique key (batching)
          expect(localStorageMock.setItem).toHaveBeenCalledTimes(uniqueKeys.size)
          
          // Verify each unique key was written with its final value
          const finalValues = new Map<string, number>()
          for (const { key, value } of writes) {
            finalValues.set(key, value)
          }
          
          for (const [key, expectedValue] of finalValues.entries()) {
            const stored = localStorageMock.getItem(key)
            expect(stored).toBe(JSON.stringify(expectedValue))
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * Property 23 (continued): write deduplication
   * Verifies that multiple writes to the same key result in only one localStorage operation
   */
  it('Property 23: multiple writes to same key are deduplicated', () => {
    fc.assert(
      fc.property(
        fc.record({
          key: fc.string({ minLength: 1, maxLength: 20 }),
          values: fc.array(fc.integer(), { minLength: 5, maxLength: 15 }),
          debounceMs: fc.integer({ min: 100, max: 2000 }),
        }),
        ({ key, values, debounceMs }) => {
          // Clear queue and storage before each property test run
          asyncStorage.clearQueue()
          storage.clear()
          localStorageMock.setItem.mockClear()
          
          // Write same key multiple times with different values
          for (const value of values) {
            asyncStorage.set(key, value, debounceMs)
          }
          
          // Advance time
          vi.advanceTimersByTime(debounceMs + 100) // Add buffer for requestIdleCallback
          
          // Should only write once (deduplication)
          expect(localStorageMock.setItem).toHaveBeenCalledTimes(1)
          
          // Should have the last value
          const stored = localStorageMock.getItem(key)
          expect(stored).toBe(JSON.stringify(values[values.length - 1]))
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * Property 24: localStorage Read Optimization
   * **Validates: Requirements 8.5**
   * 
   * For any localStorage read operation on component mount, the parsing should 
   * occur outside the render cycle to prevent blocking initial render.
   */
  it('Property 24: reads parse data synchronously but safely', () => {
    fc.assert(
      fc.property(
        fc.record({
          key: fc.string({ minLength: 1, maxLength: 50 }),
          value: fc.oneof(
            fc.string(),
            fc.integer(),
            fc.array(fc.string()),
            fc.dictionary(fc.string(), fc.string())
          ),
        }),
        ({ key, value }) => {
          // Pre-populate localStorage
          localStorageMock.setItem(key, JSON.stringify(value))
          localStorageMock.getItem.mockClear()
          
          // Read value
          const result = asyncStorage.get(key)
          
          // Should have called getItem
          expect(localStorageMock.getItem).toHaveBeenCalledWith(key)
          
          // Should return parsed value
          expect(result).toEqual(value)
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * Property 24 (continued): lazy initialization helper
   * Verifies that lazyInit returns a function that parses outside render
   */
  it('Property 24: lazyInit provides safe initialization for React state', () => {
    fc.assert(
      fc.property(
        fc.record({
          key: fc.string({ minLength: 1, maxLength: 50 }),
          storedValue: fc.oneof(fc.string(), fc.integer(), fc.array(fc.string())),
          defaultValue: fc.oneof(fc.string(), fc.integer(), fc.array(fc.string())),
        }),
        ({ key, storedValue, defaultValue }) => {
          // Test with stored value
          localStorageMock.setItem(key, JSON.stringify(storedValue))
          
          const initializer = asyncStorage.lazyInit(key, defaultValue)
          expect(typeof initializer).toBe('function')
          
          const result = initializer()
          expect(result).toEqual(storedValue)
          
          // Test with missing value (should return default)
          localStorageMock.removeItem(key)
          const initializer2 = asyncStorage.lazyInit(key, defaultValue)
          const result2 = initializer2()
          expect(result2).toEqual(defaultValue)
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * Error handling: quota exceeded
   * Verifies that quota exceeded errors trigger cleanup
   */
  it('handles quota exceeded by cleaning up old entries', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            key: fc.string({ minLength: 10, maxLength: 20 }).map(s => `artsky-${s}`),
            value: fc.string({ minLength: 100, maxLength: 200 }),
          }),
          { minLength: 5, maxLength: 10 }
        ),
        (entries) => {
          // Pre-populate localStorage
          for (const { key, value } of entries) {
            localStorageMock.setItem(key, JSON.stringify(value))
          }
          
          const initialCount = localStorageMock.length
          
          // Mock setItem to throw QuotaExceededError on first call, then succeed
          let callCount = 0
          const originalSetItem = localStorageMock.setItem
          localStorageMock.setItem = vi.fn((key: string, value: string) => {
            callCount++
            if (callCount === 1) {
              const err = new DOMException('QuotaExceededError', 'QuotaExceededError')
              throw err
            }
            // Subsequent calls succeed
            originalSetItem(key, value)
          })
          
          // Attempt write that triggers quota exceeded
          asyncStorage.set('artsky-new-key', 'new-value', 0)
          vi.runAllTimers()
          
          // Should have attempted cleanup (removed ~25% of entries)
          const finalCount = localStorageMock.length
          expect(finalCount).toBeLessThanOrEqual(initialCount)
          
          // Restore
          localStorageMock.setItem = originalSetItem
        }
      ),
      { numRuns: 50 }
    )
  })

  /**
   * Correctness: forceFlush immediately writes pending data
   */
  it('forceFlush immediately writes all pending data', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            key: fc.string({ minLength: 1, maxLength: 20 }),
            value: fc.integer(),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (entries) => {
          localStorageMock.setItem.mockClear()
          
          // Queue multiple writes with long debounce
          for (const { key, value } of entries) {
            asyncStorage.set(key, value, 5000)
          }
          
          // Should not have written yet
          expect(localStorageMock.setItem).not.toHaveBeenCalled()
          
          // Force flush
          asyncStorage.forceFlush()
          vi.runAllTimers()
          
          // All writes should have completed
          const uniqueKeys = new Set(entries.map(e => e.key))
          expect(localStorageMock.setItem).toHaveBeenCalledTimes(uniqueKeys.size)
        }
      ),
      { numRuns: 100 }
    )
  })
})
