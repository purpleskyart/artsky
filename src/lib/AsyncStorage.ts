/**
 * AsyncStorage - Optimized localStorage wrapper with async operations
 * 
 * Features:
 * - Async write queue to avoid blocking render
 * - Debouncing for writes (configurable, default 1000ms)
 * - Uses requestIdleCallback for async operations
 * - Write batching and deduplication
 * - Quota exceeded handling with automatic cleanup
 * - Graceful degradation when localStorage is unavailable
 */

interface WriteQueueEntry {
  value: unknown
  timestamp: number
  serialized?: string
}

class AsyncStorage {
  private writeQueue = new Map<string, WriteQueueEntry>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private readonly defaultDebounceMs = 1000
  private isAvailable: boolean
  private memoryFallback = new Map<string, string>()

  constructor() {
    // Check if localStorage is available
    this.isAvailable = this.checkAvailability()
    if (!this.isAvailable) {
      console.warn('AsyncStorage: localStorage is unavailable, using in-memory fallback')
    }
  }

  /**
   * Check if localStorage is available
   * Returns false in private browsing mode or when localStorage is disabled
   */
  private checkAvailability(): boolean {
    try {
      const testKey = '__asyncstorage_test__'
      localStorage.setItem(testKey, 'test')
      localStorage.removeItem(testKey)
      return true
    } catch {
      return false
    }
  }

  /**
   * Set a value in localStorage with optional debouncing
   * @param key - localStorage key
   * @param value - value to store (will be JSON.stringify'd)
   * @param debounceMs - debounce delay in ms (default: 1000ms)
   */
  set(key: string, value: unknown, debounceMs = this.defaultDebounceMs): void {
    // Add to write queue
    this.writeQueue.set(key, {
      value,
      timestamp: Date.now(),
    })

    // Clear existing timer and set new one
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
    }

    if (debounceMs > 0) {
      this.flushTimer = setTimeout(() => this.flush(), debounceMs)
    } else {
      // Immediate flush for debounceMs = 0
      this.flush()
    }
  }

  /**
   * Flush the write queue to localStorage
   * Uses requestIdleCallback to avoid blocking render
   */
  private flush(): void {
    if (this.writeQueue.size === 0) return

    // Batch serialize all pending writes
    const batch = new Map<string, string>()
    
    for (const [key, entry] of this.writeQueue.entries()) {
      try {
        // Avoid redundant serialization - check if value changed
        if (!entry.serialized) {
          entry.serialized = JSON.stringify(entry.value)
        }
        batch.set(key, entry.serialized)
      } catch (err) {
        console.error(`AsyncStorage: Failed to serialize key "${key}"`, err)
      }
    }

    this.writeQueue.clear()

    // Perform actual writes in idle callback
    const writeToStorage = () => {
      for (const [key, serialized] of batch.entries()) {
        try {
          if (this.isAvailable) {
            localStorage.setItem(key, serialized)
          } else {
            // Fallback to in-memory storage
            this.memoryFallback.set(key, serialized)
          }
        } catch (err) {
          // Handle quota exceeded
          if (err instanceof DOMException && err.name === 'QuotaExceededError') {
            this.handleQuotaExceeded(key, serialized)
          } else {
            console.error(`AsyncStorage: Failed to write key "${key}"`, err)
            // Fallback to in-memory storage on any error
            this.memoryFallback.set(key, serialized)
          }
        }
      }
    }

    // Use requestIdleCallback if available, otherwise setTimeout
    if ('requestIdleCallback' in window) {
      requestIdleCallback(writeToStorage)
    } else {
      setTimeout(writeToStorage, 0)
    }
  }

  /**
   * Handle quota exceeded by clearing old entries
   */
  private handleQuotaExceeded(key: string, value: string): void {
    console.warn('AsyncStorage: Quota exceeded, attempting cleanup...')
    
    try {
      // Try to clear some space by removing oldest artsky-* entries
      const keys: Array<{ key: string; timestamp: number }> = []
      
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith('artsky-')) {
          // Try to extract timestamp from value if it's JSON
          try {
            const val = localStorage.getItem(k)
            if (val) {
              const parsed = JSON.parse(val)
              const timestamp = parsed.timestamp || 0
              keys.push({ key: k, timestamp })
            }
          } catch {
            keys.push({ key: k, timestamp: 0 })
          }
        }
      }

      // Sort by timestamp (oldest first)
      keys.sort((a, b) => a.timestamp - b.timestamp)

      // Remove oldest 25% of entries
      const toRemove = Math.ceil(keys.length * 0.25)
      if (toRemove > 0) {
        console.log(`AsyncStorage: Removing ${toRemove} old entries to free space`)
        for (let i = 0; i < toRemove && i < keys.length; i++) {
          localStorage.removeItem(keys[i].key)
        }

        // Retry the write
        localStorage.setItem(key, value)
        console.log('AsyncStorage: Successfully wrote after cleanup')
      } else {
        // No entries to remove, fallback to memory
        console.warn('AsyncStorage: No entries to clean up, using memory fallback')
        this.memoryFallback.set(key, value)
      }
    } catch (err) {
      console.error('AsyncStorage: Failed to handle quota exceeded, using memory fallback', err)
      // Final fallback to in-memory storage
      this.memoryFallback.set(key, value)
    }
  }

  /**
   * Get a value from localStorage
   * @param key - localStorage key
   * @returns parsed value or null if not found/error
   */
  get<T>(key: string): T | null {
    try {
      let item: string | null = null
      
      if (this.isAvailable) {
        try {
          item = localStorage.getItem(key)
        } catch {
          // If localStorage fails, try memory fallback
          item = this.memoryFallback.get(key) ?? null
        }
      }
      
      // If not found in localStorage, check memory fallback
      if (!item) {
        item = this.memoryFallback.get(key) ?? null
      }
      
      return item ? JSON.parse(item) : null
    } catch (err) {
      console.error(`AsyncStorage: Failed to read key "${key}"`, err)
      return null
    }
  }

  /**
   * Remove a key from localStorage
   * @param key - localStorage key
   */
  remove(key: string): void {
    try {
      if (this.isAvailable) {
        localStorage.removeItem(key)
      }
      // Also remove from memory fallback and write queue
      this.memoryFallback.delete(key)
      this.writeQueue.delete(key)
    } catch (err) {
      console.error(`AsyncStorage: Failed to remove key "${key}"`, err)
      // Still try to remove from memory fallback
      this.memoryFallback.delete(key)
      this.writeQueue.delete(key)
    }
  }

  /**
   * Force flush all pending writes immediately
   */
  forceFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.flush()
  }

  /**
   * Clear all pending writes without flushing (for testing)
   */
  clearQueue(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.writeQueue.clear()
  }

  /**
   * Lazy initialization helper for React state
   * Parses localStorage outside render cycle
   * @param key - localStorage key
   * @param defaultValue - default value if key not found
   * @returns initializer function for useState
   */
  lazyInit<T>(key: string, defaultValue: T): () => T {
    return () => {
      const value = this.get<T>(key)
      return value !== null ? value : defaultValue
    }
  }

  /**
   * Check if localStorage is currently available
   * @returns true if localStorage is available, false if using memory fallback
   */
  isStorageAvailable(): boolean {
    return this.isAvailable
  }
}

// Export singleton instance
export const asyncStorage = new AsyncStorage()
