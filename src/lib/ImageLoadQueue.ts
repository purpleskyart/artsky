/**
 * ImageLoadQueue - Manages concurrent image loading to prevent network congestion
 * 
 * Limits concurrent image requests to a maximum threshold (default: 6) to optimize
 * network performance and prevent browser connection pool exhaustion.
 * 
 * Requirements: 5.6
 */
export class ImageLoadQueue {
  private queue: Array<() => void> = []
  private active = 0
  private readonly maxConcurrent: number

  constructor(maxConcurrent = 6) {
    this.maxConcurrent = maxConcurrent
  }

  /**
   * Enqueue an image load function
   * If under the concurrent limit, execute immediately
   * Otherwise, add to queue for later execution
   */
  enqueue(loadFn: () => void): void {
    if (this.active < this.maxConcurrent) {
      this.active++
      loadFn()
    } else {
      this.queue.push(loadFn)
    }
  }

  /**
   * Mark a load operation as complete and process next queued item
   */
  complete(): void {
    if (this.active > 0) {
      this.active--
    }
    this.dequeue()
  }

  /**
   * Process next item in queue if available and under concurrent limit
   */
  private dequeue(): void {
    if (this.queue.length > 0 && this.active < this.maxConcurrent) {
      const next = this.queue.shift()
      if (next) {
        this.active++
        next()
      }
    }
  }

  /**
   * Get current queue length (for testing/monitoring)
   */
  getQueueLength(): number {
    return this.queue.length
  }

  /**
   * Get current active count (for testing/monitoring)
   */
  getActiveCount(): number {
    return this.active
  }

  /**
   * Clear the queue (useful for cleanup)
   */
  clear(): void {
    this.queue = []
    this.active = 0
  }
}

// Global singleton instance for application-wide image load management
export const imageLoadQueue = new ImageLoadQueue()
