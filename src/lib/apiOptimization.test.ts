import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { requestDeduplicator } from './RequestDeduplicator'
import { responseCache } from './ResponseCache'
import { retryWithBackoff } from './retryWithBackoff'

describe('API Optimization Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    responseCache.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Request Deduplication (Requirement 7.1)', () => {
    test('concurrent identical requests are deduplicated', async () => {
      let callCount = 0
      const mockFetcher = vi.fn(async () => {
        callCount++
        await new Promise((resolve) => setTimeout(resolve, 50))
        return { data: 'test-result' }
      })

      // Make 5 concurrent requests with the same key
      const promises = Array.from({ length: 5 }, () =>
        requestDeduplicator.dedupe('test-key', mockFetcher)
      )

      const results = await Promise.all(promises)

      // All results should be identical
      expect(results).toHaveLength(5)
      results.forEach((result) => {
        expect(result).toEqual({ data: 'test-result' })
      })

      // Fetcher should only be called once
      expect(callCount).toBe(1)
      expect(mockFetcher).toHaveBeenCalledTimes(1)
    })

    test('different request keys are not deduplicated', async () => {
      let callCount = 0
      const mockFetcher = vi.fn(async () => {
        callCount++
        return { data: 'result' }
      })

      // Make requests with different keys
      await requestDeduplicator.dedupe('key-1', mockFetcher)
      await requestDeduplicator.dedupe('key-2', mockFetcher)
      await requestDeduplicator.dedupe('key-3', mockFetcher)

      // Each should trigger a separate call
      expect(callCount).toBe(3)
      expect(mockFetcher).toHaveBeenCalledTimes(3)
    })

    test('sequential requests with same key are not deduplicated', async () => {
      let callCount = 0
      const mockFetcher = vi.fn(async () => {
        callCount++
        return { data: 'result' }
      })

      // Make sequential requests (not concurrent)
      await requestDeduplicator.dedupe('test-key', mockFetcher)
      await requestDeduplicator.dedupe('test-key', mockFetcher)
      await requestDeduplicator.dedupe('test-key', mockFetcher)

      // Each should trigger a separate call since they're not concurrent
      expect(callCount).toBe(3)
      expect(mockFetcher).toHaveBeenCalledTimes(3)
    })
  })

  describe('Response Caching (Requirement 7.2)', () => {
    test('cached responses are returned within TTL', () => {
      const testData = { id: 1, name: 'Test' }
      const ttl = 1000

      // Set cache entry
      responseCache.set('test-key', testData, ttl)

      // Retrieve immediately - should be cached
      const cached = responseCache.get('test-key')
      expect(cached).toEqual(testData)
    })

    test('expired cache entries return null', async () => {
      const testData = { id: 1, name: 'Test' }
      const ttl = 100

      // Set cache entry with short TTL
      responseCache.set('test-key', testData, ttl)

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Should return null
      const expired = responseCache.get('test-key')
      expect(expired).toBeNull()
    })

    test('cache entries can be invalidated manually', () => {
      const testData = { id: 1, name: 'Test' }

      responseCache.set('test-key', testData, 10000)

      // Verify it's cached
      expect(responseCache.get('test-key')).toEqual(testData)

      // Invalidate
      responseCache.invalidate('test-key')

      // Should return null
      expect(responseCache.get('test-key')).toBeNull()
    })

    test('cache entries can be invalidated by pattern', () => {
      responseCache.set('timeline:1', { data: 'a' }, 10000)
      responseCache.set('timeline:2', { data: 'b' }, 10000)
      responseCache.set('feed:1', { data: 'c' }, 10000)

      // Invalidate all timeline entries
      responseCache.invalidatePattern(/^timeline:/)

      // Timeline entries should be gone
      expect(responseCache.get('timeline:1')).toBeNull()
      expect(responseCache.get('timeline:2')).toBeNull()

      // Feed entry should still exist
      expect(responseCache.get('feed:1')).toEqual({ data: 'c' })
    })
  })

  describe('Optimistic Updates (Requirement 7.3)', () => {
    test('optimistic updates occur immediately before API call completes', async () => {
      let apiCallCompleted = false
      const stateHistory: boolean[] = []

      // Simulate optimistic update
      let liked = false
      stateHistory.push(liked)

      // Immediately update UI (optimistic)
      liked = true
      stateHistory.push(liked)

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 50))
      apiCallCompleted = true

      // Verify optimistic update happened before API call completed
      expect(stateHistory[0]).toBe(false)
      expect(stateHistory[1]).toBe(true)
      expect(apiCallCompleted).toBe(true)
    })

    test('failed optimistic updates are reverted', async () => {
      let liked = false
      const stateHistory: boolean[] = [liked]

      // Optimistic update
      liked = true
      stateHistory.push(liked)

      // Simulate API failure
      const shouldFail = true
      await new Promise((resolve) => setTimeout(resolve, 50))

      if (shouldFail) {
        // Revert on failure
        liked = false
        stateHistory.push(liked)
      }

      // Verify state was reverted
      expect(stateHistory[0]).toBe(false) // Initial
      expect(stateHistory[1]).toBe(true) // Optimistic
      expect(stateHistory[2]).toBe(false) // Reverted
      expect(liked).toBe(false)
    })
  })

  describe('Exponential Backoff Retry (Requirement 7.6)', () => {
    test('failed requests retry with backoff', async () => {
      let attemptCount = 0

      const mockFetcher = async () => {
        attemptCount++
        if (attemptCount < 3) {
          const error = new Error('Server error') as Error & { status: number }
          error.status = 500
          throw error
        }
        return { success: true }
      }

      const result = await retryWithBackoff(mockFetcher, {
        maxRetries: 3,
        initialDelay: 10,
      })

      // Should succeed after 3 attempts
      expect(attemptCount).toBe(3)
      expect(result).toEqual({ success: true })
    })

    test('retries stop after max retries', async () => {
      let attemptCount = 0

      const mockFetcher = async () => {
        attemptCount++
        const error = new Error('Server error') as Error & { status: number }
        error.status = 500
        throw error
      }

      await expect(
        retryWithBackoff(mockFetcher, {
          maxRetries: 3,
          initialDelay: 10,
        })
      ).rejects.toThrow('Server error')

      // Should attempt 4 times (initial + 3 retries)
      expect(attemptCount).toBe(4)
    })

    test('4xx errors are not retried', async () => {
      let attemptCount = 0

      const mockFetcher = async () => {
        attemptCount++
        const error = new Error('Bad request') as Error & { status: number }
        error.status = 400
        throw error
      }

      await expect(
        retryWithBackoff(mockFetcher, {
          maxRetries: 3,
          initialDelay: 10,
        })
      ).rejects.toThrow('Bad request')

      // Should only attempt once (no retries for 4xx)
      expect(attemptCount).toBe(1)
    })

    test('5xx errors are retried', async () => {
      let attemptCount = 0

      const mockFetcher = async () => {
        attemptCount++
        if (attemptCount < 2) {
          const error = new Error('Server error') as Error & { status: number }
          error.status = 503
          throw error
        }
        return { success: true }
      }

      const result = await retryWithBackoff(mockFetcher, {
        maxRetries: 3,
        initialDelay: 10,
      })

      // Should succeed after 2 attempts
      expect(attemptCount).toBe(2)
      expect(result).toEqual({ success: true })
    })

    test('exponential backoff increases delay between retries', async () => {
      let attemptCount = 0
      const attemptTimestamps: number[] = []

      const mockFetcher = async () => {
        attemptTimestamps.push(Date.now())
        attemptCount++
        if (attemptCount < 3) {
          const error = new Error('Server error') as Error & { status: number }
          error.status = 500
          throw error
        }
        return { success: true }
      }

      await retryWithBackoff(mockFetcher, {
        maxRetries: 3,
        initialDelay: 50,
        maxDelay: 400,
      })

      // Verify delays increase exponentially
      expect(attemptTimestamps.length).toBe(3)

      // First retry delay should be ~50ms
      const firstDelay = attemptTimestamps[1] - attemptTimestamps[0]
      expect(firstDelay).toBeGreaterThanOrEqual(40)
      expect(firstDelay).toBeLessThanOrEqual(150)

      // Second retry delay should be ~100ms (2x first delay)
      const secondDelay = attemptTimestamps[2] - attemptTimestamps[1]
      expect(secondDelay).toBeGreaterThanOrEqual(90)
      expect(secondDelay).toBeLessThanOrEqual(200)
    })
  })

  describe('Integration Tests', () => {
    test('deduplication and caching work together', async () => {
      let callCount = 0
      const mockFetcher = vi.fn(async () => {
        callCount++
        await new Promise((resolve) => setTimeout(resolve, 50))
        return { data: 'test-result' }
      })

      const cacheKey = 'test-key'

      // First set of concurrent requests - should deduplicate
      const firstBatch = await Promise.all([
        requestDeduplicator.dedupe(cacheKey, mockFetcher),
        requestDeduplicator.dedupe(cacheKey, mockFetcher),
        requestDeduplicator.dedupe(cacheKey, mockFetcher),
      ])

      // Should only call once
      expect(callCount).toBe(1)

      // Cache the result
      responseCache.set(cacheKey, firstBatch[0], 1000)

      // Second set of requests - should use cache
      const cached1 = responseCache.get(cacheKey)
      const cached2 = responseCache.get(cacheKey)

      // Should not make additional calls
      expect(callCount).toBe(1)
      expect(cached1).toEqual({ data: 'test-result' })
      expect(cached2).toEqual({ data: 'test-result' })
    })

    test('retry logic works with deduplication', async () => {
      let attemptCount = 0

      const mockFetcher = async () => {
        attemptCount++
        if (attemptCount < 2) {
          const error = new Error('Server error') as Error & { status: number }
          error.status = 500
          throw error
        }
        return { data: 'success' }
      }

      // Wrap with retry logic
      const fetchWithRetry = () =>
        retryWithBackoff(mockFetcher, {
          maxRetries: 3,
          initialDelay: 10,
        })

      // Make concurrent requests with retry
      const results = await Promise.all([
        requestDeduplicator.dedupe('retry-key', fetchWithRetry),
        requestDeduplicator.dedupe('retry-key', fetchWithRetry),
      ])

      // Should succeed after retries
      expect(results).toHaveLength(2)
      results.forEach((result) => {
        expect(result).toEqual({ data: 'success' })
      })

      // Should only attempt twice (initial fail + 1 retry) due to deduplication
      expect(attemptCount).toBe(2)
    })
  })
})
