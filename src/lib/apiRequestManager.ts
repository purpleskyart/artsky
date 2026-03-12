/**
 * API Request Manager - Centralized request lifecycle management
 * 
 * Features:
 * - Request cancellation with AbortController
 * - Request prioritization using RequestQueue
 * - Cache invalidation after mutations
 * - Request metrics collection
 * - Timeout handling
 */

import { requestQueue, RequestPriority } from './RequestQueue'
import { responseCache } from './ResponseCache'

// Request metrics
export interface RequestMetrics {
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  cachedRequests: number
  cancelledRequests: number
  averageDuration: number
  durationHistory: number[]
}

export class ApiRequestManager {
  private metrics: RequestMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    cachedRequests: 0,
    cancelledRequests: 0,
    averageDuration: 0,
    durationHistory: [],
  }

  private abortControllers = new Map<string, AbortController>()
  private durationHistorySize = 100

  /**
   * Execute a request with full lifecycle management
   */
  async execute<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: {
      priority?: RequestPriority
      ttl?: number
      staleWhileRevalidate?: number
      timeout?: number
      cacheKey?: string
      invalidateOnSuccess?: string[]
    } = {}
  ): Promise<T> {
    const {
      priority = RequestPriority.MEDIUM,
      ttl = 60000,
      staleWhileRevalidate = 0,
      timeout = 30000,
      cacheKey,
      invalidateOnSuccess = [],
    } = options

    this.metrics.totalRequests++

    // Check cache first
    if (cacheKey) {
      const cached = responseCache.get<T>(cacheKey)
      if (cached) {
        this.metrics.cachedRequests++
        return cached
      }
    }

    // Create AbortController for cancellation
    const abortController = new AbortController()
    this.abortControllers.set(key, abortController)

    const startTime = Date.now()

    // Wrap fetcher with timeout and cancellation
    const wrappedFetcher = async (): Promise<T> => {
      const timeoutId = setTimeout(() => {
        abortController.abort('Request timeout')
      }, timeout)

      try {
        const result = await fetcher()
        clearTimeout(timeoutId)
        return result
      } catch (error) {
        clearTimeout(timeoutId)
        throw error
      }
    }

    // Execute with queue priority
    let result: T
    try {
      result = await requestQueue.enqueue(key, wrappedFetcher, priority)
    } catch (error) {
      if (error instanceof Error && error.message === 'Request timeout') {
        this.metrics.cancelledRequests++
      }
      throw error
    } finally {
      this.abortControllers.delete(key)
    }

    const duration = Date.now() - startTime
    this.updateDurationMetrics(duration)

    // Update cache if cacheKey provided
    if (cacheKey) {
      responseCache.set(cacheKey, result, ttl, staleWhileRevalidate)
    }

    // Invalidate related caches on success
    if (invalidateOnSuccess.length > 0) {
      for (const pattern of invalidateOnSuccess) {
        responseCache.invalidatePattern(new RegExp(pattern))
      }
    }

    this.metrics.successfulRequests++
    return result
  }

  /**
   * Cancel a pending request
   */
  cancel(key: string): void {
    const controller = this.abortControllers.get(key)
    if (controller) {
      controller.abort('Request cancelled by user')
      this.abortControllers.delete(key)
      this.metrics.cancelledRequests++
    }
  }

  /**
   * Invalidate cache entries matching pattern
   */
  invalidateCache(pattern: string | RegExp): void {
    if (typeof pattern === 'string') {
      responseCache.invalidate(pattern)
    } else {
      responseCache.invalidatePattern(pattern)
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): RequestMetrics {
    return { ...this.metrics }
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      cachedRequests: 0,
      cancelledRequests: 0,
      averageDuration: 0,
      durationHistory: [],
    }
  }

  private updateDurationMetrics(duration: number): void {
    this.metrics.durationHistory.push(duration)
    if (this.metrics.durationHistory.length > this.durationHistorySize) {
      this.metrics.durationHistory.shift()
    }
    this.metrics.averageDuration = this.metrics.durationHistory.reduce((a, b) => a + b, 0) / this.metrics.durationHistory.length
  }
}

export const apiRequestManager = new ApiRequestManager()
