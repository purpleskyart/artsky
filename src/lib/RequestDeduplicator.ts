/**
 * RequestDeduplicator - Deduplicates concurrent identical API requests
 * 
 * **Validates: Requirement 7.1**
 * 
 * When identical API requests are made concurrently (same endpoint, same parameters),
 * this class deduplicates them into a single network request and shares the response.
 * 
 * This prevents unnecessary network overhead and improves performance when multiple
 * components request the same data simultaneously.
 */

export class RequestDeduplicator {
  private pending = new Map<string, Promise<unknown>>()
  
  /**
   * Deduplicate a request by key
   * 
   * If a request with the same key is already pending, returns the existing promise.
   * Otherwise, executes the fetcher and caches the promise until it resolves/rejects.
   * 
   * @param key - Unique identifier for the request (e.g., "timeline:50:cursor123")
   * @param fetcher - Function that performs the actual API request
   * @returns Promise that resolves with the API response
   */
  async dedupe<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    // Check if request is already pending
    const existing = this.pending.get(key)
    if (existing) {
      return existing as Promise<T>
    }
    
    // Execute the fetcher and cache the promise
    const promise = fetcher().finally(() => {
      // Remove from pending map when complete (success or failure)
      this.pending.delete(key)
    })
    
    this.pending.set(key, promise)
    return promise
  }
  
  /**
   * Check if a request is currently pending
   * 
   * @param key - Request key to check
   * @returns true if request is pending, false otherwise
   */
  isPending(key: string): boolean {
    return this.pending.has(key)
  }
  
  /**
   * Get the number of pending requests
   * 
   * @returns Number of requests currently in flight
   */
  getPendingCount(): number {
    return this.pending.size
  }
  
  /**
   * Clear all pending requests
   * 
   * This does not cancel the requests, but removes them from the deduplication cache.
   * Useful for cleanup or testing.
   */
  clear(): void {
    this.pending.clear()
  }
}

// Singleton instance for global use
export const requestDeduplicator = new RequestDeduplicator()
