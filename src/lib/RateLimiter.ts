/**
 * RateLimiter - Advanced rate limiting with per-agent tracking and Retry-After support
 * 
 * Improvements:
 * 1. Respects server's Retry-After header instead of fixed backoff
 * 2. Separate rate limit windows per agent (credential vs public)
 * 3. Tracks request timestamps per agent for accurate rate limiting
 */

export interface RateLimitConfig {
  maxRequestsPerWindow: number
  windowMs: number
  defaultBackoffMs: number
}

export interface RateLimitState {
  requestTimestamps: number[]
  rateLimitUntil: number
}

export class RateLimiter {
  private states = new Map<string, RateLimitState>()
  private config: RateLimitConfig

  constructor(config: RateLimitConfig) {
    this.config = config
  }

  /**
   * Get or create rate limit state for an agent
   */
  private getState(agentId: string): RateLimitState {
    let state = this.states.get(agentId)
    if (!state) {
      state = {
        requestTimestamps: [],
        rateLimitUntil: 0,
      }
      this.states.set(agentId, state)
    }
    return state
  }

  /**
   * Check if request should be allowed and update state
   * Returns null if allowed, or error with backoff time if rate limited
   */
  checkRateLimit(agentId: string): { allowed: false; backoffMs: number } | { allowed: true } {
    const state = this.getState(agentId)
    const now = Date.now()

    // Check if we're in a backoff period
    if (now < state.rateLimitUntil) {
      return {
        allowed: false,
        backoffMs: state.rateLimitUntil - now,
      }
    }

    // Remove timestamps outside the current window
    while (
      state.requestTimestamps.length > 0 &&
      state.requestTimestamps[0] < now - this.config.windowMs
    ) {
      state.requestTimestamps.shift()
    }

    // Check if we've exceeded the rate limit
    if (state.requestTimestamps.length >= this.config.maxRequestsPerWindow) {
      state.rateLimitUntil = now + 10_000 // 10s local backoff
      return {
        allowed: false,
        backoffMs: 10_000,
      }
    }

    // Allow the request and record timestamp
    state.requestTimestamps.push(now)
    return { allowed: true }
  }

  /**
   * Handle 429 response by parsing Retry-After header and setting backoff
   */
  handle429Response(agentId: string, response: Response): void {
    const state = this.getState(agentId)
    const retryAfter = this.parseRetryAfter(response)
    
    // Use server's Retry-After if available, otherwise use default backoff
    const backoffMs = retryAfter ?? this.config.defaultBackoffMs
    state.rateLimitUntil = Date.now() + backoffMs
  }

  /**
   * Parse Retry-After header from response
   * Returns backoff time in milliseconds, or null if header not present
   */
  private parseRetryAfter(response: Response): number | null {
    const retryAfter = response.headers.get('Retry-After')
    if (!retryAfter) return null

    // Retry-After can be either seconds (number) or HTTP date
    const seconds = parseInt(retryAfter, 10)
    if (!isNaN(seconds)) {
      return seconds * 1000
    }

    // Try parsing as HTTP date
    const date = new Date(retryAfter)
    if (!isNaN(date.getTime())) {
      return Math.max(0, date.getTime() - Date.now())
    }

    return null
  }

  /**
   * Get current backoff time remaining for an agent
   */
  getBackoffMs(agentId: string): number {
    const state = this.getState(agentId)
    const now = Date.now()
    return Math.max(0, state.rateLimitUntil - now)
  }

  /**
   * Clear rate limit state for an agent (useful for testing)
   */
  clearState(agentId: string): void {
    this.states.delete(agentId)
  }

  /**
   * Get statistics for monitoring
   */
  getStats(agentId: string): {
    requestsInWindow: number
    backoffMs: number
    rateLimitUntil: number
  } {
    const state = this.getState(agentId)
    const now = Date.now()

    // Clean up old timestamps
    while (
      state.requestTimestamps.length > 0 &&
      state.requestTimestamps[0] < now - this.config.windowMs
    ) {
      state.requestTimestamps.shift()
    }

    return {
      requestsInWindow: state.requestTimestamps.length,
      backoffMs: this.getBackoffMs(agentId),
      rateLimitUntil: state.rateLimitUntil,
    }
  }
}

// Singleton instance with default config
export const rateLimiter = new RateLimiter({
  maxRequestsPerWindow: 55,
  windowMs: 60_000, // 1 minute
  defaultBackoffMs: 30_000, // 30 seconds
})
