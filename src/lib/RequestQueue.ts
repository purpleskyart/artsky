/**
 * RequestQueue - Priority queue for API requests with rate limit handling
 * 
 * Improvements:
 * 5. Global request queue with priority
 * - High priority: user actions (like, repost, post)
 * - Medium priority: visible content (timeline, profiles)
 * - Low priority: prefetching, background refreshes
 * 
 * When rate limited, low-priority requests are deferred while high-priority ones go through first
 */

export const RequestPriority = {
  LOW: 0,      // Prefetching, background refreshes
  MEDIUM: 1,   // Visible content (timeline, profiles)
  HIGH: 2,     // User actions (like, repost, post, follow)
} as const

export type RequestPriority = typeof RequestPriority[keyof typeof RequestPriority]

interface QueuedRequest<T> {
  id: string
  priority: RequestPriority
  fetcher: () => Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
  timestamp: number
}

export class RequestQueue {
  private queue: QueuedRequest<unknown>[] = []
  private processing = false
  private maxConcurrent = 6 // Max concurrent requests
  private activeRequests = 0

  /**
   * Enqueue a request with priority
   * 
   * @param id - Unique identifier for the request
   * @param fetcher - Function that performs the request
   * @param priority - Request priority (default: MEDIUM)
   * @returns Promise that resolves with the request result
   */
  enqueue<T>(
    id: string,
    fetcher: () => Promise<T>,
    priority: RequestPriority = RequestPriority.MEDIUM
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      // Check if request is already queued
      const existing = this.queue.find((req) => req.id === id)
      if (existing) {
        // Piggyback on existing promise by wrapping resolve/reject
        const originalResolve = existing.resolve
        const originalReject = existing.reject
        existing.resolve = (value: unknown) => {
          originalResolve(value)
          resolve(value as T)
        }
        existing.reject = (error: unknown) => {
          originalReject(error)
          reject(error)
        }
        return
      }

      // Add to queue
      this.queue.push({
        id,
        priority,
        fetcher: fetcher as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        timestamp: Date.now(),
      })

      // Sort by priority (high to low), then by timestamp (FIFO within same priority)
      this.queue.sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority // Higher priority first
        }
        return a.timestamp - b.timestamp // Earlier timestamp first
      })

      // Start processing if not already
      if (!this.processing) {
        this.processQueue()
      }
    })
  }

  /**
   * Process queued requests
   */
  private processQueue(): void {
    if (this.processing) return
    this.processing = true

    // Use setImmediate or setTimeout to avoid blocking
    const processNext = () => {
      if (this.queue.length === 0 || this.activeRequests >= this.maxConcurrent) {
        this.processing = false
        return
      }

      const request = this.queue.shift()
      if (!request) {
        this.processing = false
        return
      }

      this.activeRequests++

      // Execute request
      request
        .fetcher()
        .then((result) => {
          request.resolve(result)
        })
        .catch((error) => {
          request.reject(error)
        })
        .finally(() => {
          this.activeRequests--
          // Continue processing queue
          if (this.queue.length > 0) {
            processNext()
          } else {
            this.processing = false
          }
        })

      // Process more if we have capacity
      if (this.activeRequests < this.maxConcurrent && this.queue.length > 0) {
        processNext()
      }
    }

    processNext()
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    queueSize: number
    activeRequests: number
    priorityCounts: Record<RequestPriority, number>
  } {
    const priorityCounts: Record<RequestPriority, number> = {
      [RequestPriority.LOW]: 0,
      [RequestPriority.MEDIUM]: 0,
      [RequestPriority.HIGH]: 0,
    }

    for (const req of this.queue) {
      priorityCounts[req.priority]++
    }

    return {
      queueSize: this.queue.length,
      activeRequests: this.activeRequests,
      priorityCounts,
    }
  }

  /**
   * Clear all queued requests
   */
  clear(): void {
    // Reject all pending requests
    for (const req of this.queue) {
      req.reject(new Error('Queue cleared'))
    }
    this.queue = []
  }

  /**
   * Remove low-priority requests from queue (useful when rate limited)
   */
  clearLowPriority(): void {
    const removed = this.queue.filter((req) => req.priority === RequestPriority.LOW)
    this.queue = this.queue.filter((req) => req.priority !== RequestPriority.LOW)
    
    // Reject removed requests
    for (const req of removed) {
      req.reject(new Error('Low priority request dropped due to rate limiting'))
    }
  }
}

// Singleton instance
export const requestQueue = new RequestQueue()
