/**
 * ResponseCache - Caches API responses with TTL (Time To Live) support
 * 
 * **Validates: Requirement 7.2**
 * 
 * When API responses are received, this class caches them with appropriate TTL values.
 * Subsequent requests within the TTL window return the cached response without making
 * a new network request, improving performance and reducing server load.
 */

export interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number
  hits: number
  staleWhileRevalidate?: number // Additional time to serve stale data while revalidating
  revalidating?: boolean // Flag to prevent duplicate revalidation requests
}

export class ResponseCache {
  private cache = new Map<string, CacheEntry<unknown>>()
  
  /**
   * Get a cached response with stale-while-revalidate support
   * 
   * Returns the cached data if it exists and hasn't expired.
   * If data is stale but within staleWhileRevalidate window, returns stale data
   * and triggers revalidation in the background.
   * Returns null if the cache entry doesn't exist or is beyond stale window.
   * 
   * @param key - Cache key (e.g., "feed:at://did:plc:xyz/app.bsky.feed.generator/abc:50:cursor123")
   * @param revalidate - Optional function to revalidate stale data in background
   * @returns Cached data or null if not found/expired
   */
  get<T>(key: string, revalidate?: () => Promise<T>): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined
    if (!entry) return null
    
    const now = Date.now()
    const age = now - entry.timestamp
    
    // Check if entry is fresh
    if (age <= entry.ttl) {
      entry.hits++
      return entry.data
    }
    
    // Check if entry is stale but within staleWhileRevalidate window
    const staleWindow = entry.staleWhileRevalidate ?? 0
    if (staleWindow > 0 && age <= entry.ttl + staleWindow) {
      entry.hits++
      
      // Trigger background revalidation if not already revalidating
      if (revalidate && !entry.revalidating) {
        entry.revalidating = true
        revalidate()
          .then((freshData) => {
            // Update cache with fresh data
            this.set(key, freshData, entry.ttl, staleWindow)
          })
          .catch(() => {
            // Keep stale data on revalidation failure
            entry.revalidating = false
          })
      }
      
      return entry.data
    }
    
    // Entry expired beyond stale window, remove it
    this.cache.delete(key)
    return null
  }
  
  /**
   * Set a cache entry with optional stale-while-revalidate support
   * 
   * Stores the data with the specified TTL (in milliseconds).
   * 
   * @param key - Cache key
   * @param data - Data to cache
   * @param ttl - Time to live in milliseconds (default: 60000 = 1 minute)
   * @param staleWhileRevalidate - Additional time to serve stale data while revalidating (default: 0)
   */
  set<T>(key: string, data: T, ttl: number = 60000, staleWhileRevalidate: number = 0): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
      hits: 0,
      staleWhileRevalidate,
      revalidating: false,
    })
  }
  
  /**
   * Check if a cache entry exists and is valid
   * 
   * @param key - Cache key to check
   * @returns true if entry exists and hasn't expired, false otherwise
   */
  has(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false
    
    const now = Date.now()
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key)
      return false
    }
    
    return true
  }
  
  /**
   * Invalidate (delete) a cache entry
   * 
   * Useful when data is known to be stale (e.g., after a mutation).
   * 
   * @param key - Cache key to invalidate
   */
  invalidate(key: string): void {
    this.cache.delete(key)
  }
  
  /**
   * Invalidate all cache entries matching a pattern
   * 
   * Useful for invalidating related entries (e.g., all timeline entries).
   * 
   * @param pattern - RegExp pattern to match keys
   */
  invalidatePattern(pattern: RegExp): void {
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key)
      }
    }
  }
  
  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear()
  }
  
  /**
   * Get cache statistics
   * 
   * @returns Object with cache size, total hits, and entries
   */
  getStats(): {
    size: number
    totalHits: number
    entries: Array<{ key: string; age: number; hits: number; ttl: number }>
  } {
    const now = Date.now()
    const entries: Array<{ key: string; age: number; hits: number; ttl: number }> = []
    let totalHits = 0
    
    for (const [key, entry] of this.cache.entries()) {
      const age = now - entry.timestamp
      entries.push({
        key,
        age,
        hits: entry.hits,
        ttl: entry.ttl,
      })
      totalHits += entry.hits
    }
    
    return {
      size: this.cache.size,
      totalHits,
      entries,
    }
  }
  
  /**
   * Remove expired entries
   * 
   * Useful for periodic cleanup to prevent memory leaks.
   */
  prune(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key)
      }
    }
  }
  
  /**
   * Get the number of cached entries
   * 
   * @returns Number of entries in the cache
   */
  getSize(): number {
    return this.cache.size
  }
}

// Singleton instance for global use
export const responseCache = new ResponseCache()

// Periodic cleanup to prevent memory leaks
if (typeof window !== 'undefined') {
  setInterval(() => {
    responseCache.prune()
  }, 60000) // Prune every minute
}
