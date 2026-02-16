/**
 * Unit tests for AsyncStorage localStorage optimization
 * Requirements: 8.1, 8.2, 8.5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { asyncStorage } from './AsyncStorage'

describe('AsyncStorage Unit Tests', () => {
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
   * Requirement 8.2: Writes are debounced
   */
  it('debounces writes with 1000ms default delay', () => {
    asyncStorage.set('test-key', 'value1')
    asyncStorage.set('test-key', 'value2')
    asyncStorage.set('test-key', 'value3')

    // No writes should have occurred yet
    expect(localStorageMock.setItem).not.toHaveBeenCalled()

    // Advance time by 999ms - still no write
    vi.advanceTimersByTime(999)
    expect(localStorageMock.setItem).not.toHaveBeenCalled()

    // Advance to 1000ms + buffer
    vi.advanceTimersByTime(101)

    // Should have written once with the last value
    expect(localStorageMock.setItem).toHaveBeenCalledTimes(1)
    expect(localStorageMock.setItem).toHaveBeenCalledWith('test-key', JSON.stringify('value3'))
  })

  /**
   * Requirement 8.2: Custom debounce delay
   */
  it('respects custom debounce delay', () => {
    asyncStorage.set('test-key', 'value', 500)

    vi.advanceTimersByTime(499)
    expect(localStorageMock.setItem).not.toHaveBeenCalled()

    vi.advanceTimersByTime(101)
    expect(localStorageMock.setItem).toHaveBeenCalledTimes(1)
  })

  /**
   * Requirement 8.2: Immediate write with 0ms debounce
   */
  it('writes immediately when debounce is 0ms', () => {
    asyncStorage.set('test-key', 'value', 0)

    expect(localStorageMock.setItem).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(localStorageMock.setItem).toHaveBeenCalledTimes(1)
  })

  /**
   * Requirement 8.5: Reads occur outside render cycle
   */
  it('reads data synchronously from localStorage', () => {
    storage.set('test-key', JSON.stringify({ foo: 'bar' }))

    const result = asyncStorage.get<{ foo: string }>('test-key')

    expect(result).toEqual({ foo: 'bar' })
    expect(localStorageMock.getItem).toHaveBeenCalledWith('test-key')
  })

  /**
   * Requirement 8.5: Returns null for missing keys
   */
  it('returns null for missing keys', () => {
    const result = asyncStorage.get('nonexistent')
    expect(result).toBeNull()
  })

  /**
   * Requirement 8.5: Handles parse errors gracefully
   */
  it('returns null on parse errors', () => {
    storage.set('bad-key', 'invalid json{')

    const result = asyncStorage.get('bad-key')
    expect(result).toBeNull()
  })

  /**
   * Requirement 8.1: Quota exceeded triggers cleanup
   */
  it('handles quota exceeded by cleaning up old entries', () => {
    // Pre-populate with artsky-* entries
    storage.set('artsky-old-1', JSON.stringify({ timestamp: 1000 }))
    storage.set('artsky-old-2', JSON.stringify({ timestamp: 2000 }))
    storage.set('artsky-old-3', JSON.stringify({ timestamp: 3000 }))
    storage.set('artsky-old-4', JSON.stringify({ timestamp: 4000 }))

    // Mock setItem to throw QuotaExceededError on first call, then succeed
    let callCount = 0
    const originalSetItem = localStorageMock.setItem
    localStorageMock.setItem = vi.fn((key: string, value: string) => {
      callCount++
      if (callCount === 1) {
        const err = new DOMException('QuotaExceededError', 'QuotaExceededError')
        throw err
      }
      // Subsequent calls succeed (including cleanup and retry)
      storage.set(key, value)
    })

    asyncStorage.set('artsky-new', 'value', 0)
    vi.advanceTimersByTime(100)

    // Should have attempted multiple writes (cleanup + retry)
    expect(callCount).toBeGreaterThan(1)
    // The new key should eventually be written
    expect(storage.has('artsky-new')).toBe(true)
  })

  /**
   * Requirement 8.2: forceFlush immediately writes pending data
   */
  it('forceFlush immediately writes all pending data', () => {
    asyncStorage.set('key1', 'value1', 5000)
    asyncStorage.set('key2', 'value2', 5000)

    expect(localStorageMock.setItem).not.toHaveBeenCalled()

    asyncStorage.forceFlush()
    vi.advanceTimersByTime(100)

    expect(localStorageMock.setItem).toHaveBeenCalledTimes(2)
  })

  /**
   * Requirement 8.2: remove() clears pending writes
   */
  it('remove() clears pending writes for the key', () => {
    asyncStorage.set('test-key', 'value', 1000)

    asyncStorage.remove('test-key')

    vi.advanceTimersByTime(1100)

    // Should not have written the value
    expect(storage.has('test-key')).toBe(false)
  })

  /**
   * Requirement 8.5: lazyInit provides initializer function
   */
  it('lazyInit returns initializer function for React state', () => {
    storage.set('test-key', JSON.stringify('stored-value'))

    const initializer = asyncStorage.lazyInit('test-key', 'default-value')

    expect(typeof initializer).toBe('function')
    expect(initializer()).toBe('stored-value')
  })

  /**
   * Requirement 8.5: lazyInit returns default when key missing
   */
  it('lazyInit returns default value when key is missing', () => {
    const initializer = asyncStorage.lazyInit('missing-key', 'default-value')

    expect(initializer()).toBe('default-value')
  })

  /**
   * Requirement 8.2: Batching multiple writes
   */
  it('batches multiple writes to different keys', () => {
    asyncStorage.set('key1', 'value1', 1000)
    asyncStorage.set('key2', 'value2', 1000)
    asyncStorage.set('key3', 'value3', 1000)

    vi.advanceTimersByTime(1100)

    expect(localStorageMock.setItem).toHaveBeenCalledTimes(3)
    expect(storage.get('key1')).toBe(JSON.stringify('value1'))
    expect(storage.get('key2')).toBe(JSON.stringify('value2'))
    expect(storage.get('key3')).toBe(JSON.stringify('value3'))
  })

  /**
   * Requirement 8.2: Debounce resets on new write
   */
  it('debounce timer resets on each new write', () => {
    asyncStorage.set('test-key', 'value1', 1000)

    vi.advanceTimersByTime(500)
    asyncStorage.set('test-key', 'value2', 1000)

    vi.advanceTimersByTime(500)
    // Should not have written yet (timer was reset)
    expect(localStorageMock.setItem).not.toHaveBeenCalled()

    vi.advanceTimersByTime(600)
    // Now it should write
    expect(localStorageMock.setItem).toHaveBeenCalledTimes(1)
    expect(storage.get('test-key')).toBe(JSON.stringify('value2'))
  })

  /**
   * Requirement 8.1, 8.2: Gracefully degrades when localStorage is unavailable
   */
  it('uses in-memory fallback when localStorage is unavailable', () => {
    // Mock localStorage to throw on access (simulating private browsing)
    const unavailableStorage = {
      getItem: vi.fn(() => {
        throw new Error('localStorage is not available')
      }),
      setItem: vi.fn(() => {
        throw new Error('localStorage is not available')
      }),
      removeItem: vi.fn(() => {
        throw new Error('localStorage is not available')
      }),
      clear: vi.fn(),
      length: 0,
      key: vi.fn(() => null),
    }
    global.localStorage = unavailableStorage as any

    // Force re-check of availability
    ;(asyncStorage as any).isAvailable = (asyncStorage as any).checkAvailability()

    // Should report as unavailable
    expect(asyncStorage.isStorageAvailable()).toBe(false)

    // Should still be able to set and get values using memory fallback
    asyncStorage.set('test-key', 'test-value', 0)
    vi.advanceTimersByTime(100)

    const result = asyncStorage.get('test-key')
    expect(result).toBe('test-value')
  })

  /**
   * Requirement 8.1: Falls back to memory when write fails
   */
  it('falls back to memory storage when localStorage write fails', () => {
    // Mock setItem to always throw (not quota exceeded)
    localStorageMock.setItem = vi.fn(() => {
      throw new Error('Write failed')
    })

    asyncStorage.set('test-key', 'test-value', 0)
    vi.advanceTimersByTime(100)

    // Should have attempted to write
    expect(localStorageMock.setItem).toHaveBeenCalled()

    // Should still be able to read from memory fallback
    const result = asyncStorage.get('test-key')
    expect(result).toBe('test-value')
  })

  /**
   * Requirement 8.1: Quota exceeded with no entries to clean falls back to memory
   */
  it('falls back to memory when quota exceeded and no entries to clean', () => {
    // Empty storage (no artsky-* entries to clean)
    storage.clear()

    // Mock setItem to throw QuotaExceededError
    localStorageMock.setItem = vi.fn(() => {
      const err = new DOMException('QuotaExceededError', 'QuotaExceededError')
      throw err
    })

    asyncStorage.set('artsky-new', 'value', 0)
    vi.advanceTimersByTime(100)

    // Should still be able to read from memory fallback
    const result = asyncStorage.get('artsky-new')
    expect(result).toBe('value')
  })

  /**
   * Requirement 8.1: isStorageAvailable reports correct status
   */
  it('isStorageAvailable returns true when localStorage is available', () => {
    expect(asyncStorage.isStorageAvailable()).toBe(true)
  })
})

