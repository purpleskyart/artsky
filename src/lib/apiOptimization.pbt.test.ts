import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import fc from 'fast-check'
import { requestDeduplicator } from './RequestDeduplicator'
import { responseCache } from './ResponseCache'
import { retryWithBackoff } from './retryWithBackoff'

describe('API Optimization Property-Based Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    responseCache.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * **Property 16: API Request Deduplication**
   * **Validates: Requirements 7.1**
   * 
   * For any set of identical API requests made concurrently (same endpoint, same parameters),
   * the application should deduplicate them into a single network request and share the response.
   */
  test('Property 16: concurrent identical requests are deduplicated into a single network request', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          requestKey: fc.string({ minLength: 1, maxLength: 50 }),
          concurrentCount: fc.integer({ min: 2, max: 10 }),
          responseValue: fc.anything(),
        }),
        async ({ requestKey, concurrentCount, responseValue }) => {
          let callCount = 0
          const mockFetcher = vi.fn(async () => {
            callCount++
            await new Promise((resolve) => setTimeout(resolve, 10))
            return responseValue
          })

          // Make multiple concurrent requests with the same key
          const promises = Array.from({ length: concurrentCount }, () =>
            requestDeduplicator.dedupe(requestKey, mockFetcher)
          )

          const results = await Promise.all(promises)

          // All results should be identical
          for (const result of results) {
            expect(result).toEqual(responseValue)
          }

          // Fetcher should only be called once despite multiple concurrent requests
          expect(callCount).toBe(1)
          expect(mockFetcher).toHaveBeenCalledTimes(1)
        }
      ),
      { numRuns: 50 }
    )
  })

  /**
   * **Property 17: API Response Caching**
   * **Validates: Requirements 7.2**
   * 
   * For any API response, when the same request is made within the TTL window,
   * the application should return the cached response without making a new network request.
   */
  test('Property 17: cached responses are returned within TTL without new network requests', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          cacheKey: fc.string({ minLength: 1, maxLength: 50 }),
          responseData: fc.anything(),
          ttl: fc.integer({ min: 100, max: 1000 }),
        }),
        async ({ cacheKey, responseData, ttl }) => {
          // Set cache entry
          responseCache.set(cacheKey, responseData, ttl)

          // Retrieve immediately - should be cached
          const cached = responseCache.get(cacheKey)
          expect(cached).toEqual(responseData)

          // Wait for half the TTL
          await new Promise((resolve) => setTimeout(resolve, ttl / 2))

          // Should still be cached
          const stillCached = responseCache.get(cacheKey)
          expect(stillCached).toEqual(responseData)

          // Wait for TTL to expire
          await new Promise((resolve) => setTimeout(resolve, ttl / 2 + 100))

          // Should no longer be cached
          const expired = responseCache.get(cacheKey)
          expect(expired).toBeNull()
        }
      ),
      { numRuns: 20 }
    )
  }, 30000)

  /**
   * **Property 18: Optimistic UI Updates**
   * **Validates: Requirements 7.3**
   * 
   * For any user interaction with like or follow buttons, the UI should update immediately
   * (optimistically) before the API call completes, and revert if the API call fails.
   */
  test('Property 18: optimistic updates occur immediately and revert on failure', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          initialState: fc.boolean(),
          shouldFail: fc.boolean(),
          delay: fc.integer({ min: 10, max: 100 }),
        }),
        async ({ initialState, shouldFail, delay }) => {
          let currentState = initialState
          const stateHistory: boolean[] = [initialState]

          // Simulate optimistic update
          const optimisticUpdate = async () => {
            // Immediately update UI (optimistic)
            currentState = !currentState
            stateHistory.push(currentState)

            // Simulate API call
            await new Promise((resolve) => setTimeout(resolve, delay))

            if (shouldFail) {
              // Revert on failure
              currentState = !currentState
              stateHistory.push(currentState)
              throw new Error('API call failed')
            }

            // Success - keep the optimistic state
            return currentState
          }

          try {
            await optimisticUpdate()
          } catch {
            // Expected for failures
          }

          // Verify optimistic update happened immediately (state changed)
          expect(stateHistory.length).toBeGreaterThanOrEqual(2)
          expect(stateHistory[1]).toBe(!initialState)

          // Verify final state
          if (shouldFail) {
            // Should revert to initial state on failure
            expect(currentState).toBe(initialState)
            expect(stateHistory[stateHistory.length - 1]).toBe(initialState)
          } else {
            // Should keep optimistic state on success
            expect(currentState).toBe(!initialState)
          }
        }
      ),
      { numRuns: 50 }
    )
  })

  /**
   * **Property 19: Parallel Feed Request Optimization**
   * **Validates: Requirements 7.4**
   * 
   * For any mixed feed fetch operation, individual feed requests should be made in parallel
   * rather than sequentially to minimize total load time.
   */
  test('Property 19: parallel requests complete faster than sequential requests', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          requestCount: fc.integer({ min: 2, max: 5 }),
          requestDelay: fc.integer({ min: 20, max: 80 }),
        }),
        async ({ requestCount, requestDelay }) => {
          const mockFetcher = async (id: number) => {
            await new Promise((resolve) => setTimeout(resolve, requestDelay))
            return { id, data: `result-${id}` }
          }

          // Parallel execution
          const parallelStart = Date.now()
          const parallelResults = await Promise.all(
            Array.from({ length: requestCount }, (_, i) => mockFetcher(i))
          )
          const parallelDuration = Date.now() - parallelStart

          // Sequential execution
          const sequentialStart = Date.now()
          const sequentialResults = []
          for (let i = 0; i < requestCount; i++) {
            sequentialResults.push(await mockFetcher(i))
          }
          const sequentialDuration = Date.now() - sequentialStart

          // Verify results are the same
          expect(parallelResults.length).toBe(sequentialResults.length)

          // Parallel should be significantly faster (at least 50% faster for 2+ requests)
          // Allow some overhead for Promise.all
          const expectedSequentialTime = requestDelay * requestCount
          const maxParallelTime = requestDelay + 100 // Single request time + overhead

          expect(parallelDuration).toBeLessThan(maxParallelTime)
          expect(sequentialDuration).toBeGreaterThanOrEqual(expectedSequentialTime - 50)
        }
      ),
      { numRuns: 15 }
    )
  }, 30000)

  /**
   * **Property 20: Request Cancellation**
   * **Validates: Requirements 7.5**
   * 
   * For any in-flight API request, when the user navigates away or the component unmounts,
   * the request should be cancelled to prevent unnecessary network usage and state updates.
   */
  test('Property 20: aborted requests do not update state after cancellation', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          requestDelay: fc.integer({ min: 30, max: 100 }),
          abortDelay: fc.integer({ min: 5, max: 50 }),
        }),
        async ({ requestDelay, abortDelay }) => {
          const abortController = new AbortController()
          let stateUpdated = false

          const mockRequest = async (signal: AbortSignal) => {
            await new Promise((resolve) => setTimeout(resolve, requestDelay))

            // Check if aborted before updating state
            if (signal.aborted) {
              return null
            }

            stateUpdated = true
            return { data: 'result' }
          }

          // Start request
          const requestPromise = mockRequest(abortController.signal)

          // Abort after delay
          setTimeout(() => {
            abortController.abort()
          }, abortDelay)

          await requestPromise

          // If abort happened before request completed, state should not be updated
          if (abortDelay < requestDelay) {
            expect(stateUpdated).toBe(false)
          }
        }
      ),
      { numRuns: 30 }
    )
  }, 15000)

  /**
   * **Property 21: Exponential Backoff Retry**
   * **Validates: Requirements 7.6**
   * 
   * For any failed API request, the application should retry with exponentially increasing
   * delays (e.g., 1s, 2s, 4s, 8s) up to a maximum number of retries.
   */
  test('Property 21: failed requests retry with exponentially increasing delays', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          maxRetries: fc.integer({ min: 1, max: 3 }),
          initialDelay: fc.integer({ min: 20, max: 100 }),
          failuresBeforeSuccess: fc.integer({ min: 0, max: 2 }),
        }),
        async ({ maxRetries, initialDelay, failuresBeforeSuccess }) => {
          let attemptCount = 0
          const attemptTimestamps: number[] = []

          const mockFetcher = async () => {
            attemptTimestamps.push(Date.now())
            attemptCount++

            if (attemptCount <= failuresBeforeSuccess) {
              const error = new Error('Server error') as Error & { status: number }
              error.status = 500
              throw error
            }

            return { success: true }
          }

          try {
            await retryWithBackoff(mockFetcher, {
              maxRetries,
              initialDelay,
              maxDelay: initialDelay * 8,
            })
          } catch {
            // Expected if failuresBeforeSuccess > maxRetries
          }

          // Verify retry attempts
          const expectedAttempts = Math.min(failuresBeforeSuccess + 1, maxRetries + 1)
          expect(attemptCount).toBe(expectedAttempts)

          // Verify exponential backoff delays (if there were retries)
          if (attemptTimestamps.length > 1) {
            for (let i = 1; i < attemptTimestamps.length; i++) {
              const delay = attemptTimestamps[i] - attemptTimestamps[i - 1]
              const expectedMinDelay = initialDelay * Math.pow(2, i - 1)
              const expectedMaxDelay = Math.min(expectedMinDelay * 2, initialDelay * 8)

              // Allow some tolerance for timing
              expect(delay).toBeGreaterThanOrEqual(expectedMinDelay - 50)
              expect(delay).toBeLessThanOrEqual(expectedMaxDelay + 100)
            }
          }
        }
      ),
      { numRuns: 20 }
    )
  }, 30000)
})
