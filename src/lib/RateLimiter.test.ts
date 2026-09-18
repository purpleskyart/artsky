import { describe, it, expect, beforeEach } from 'vitest'
import { RateLimiter } from './RateLimiter'

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter

  beforeEach(() => {
    rateLimiter = new RateLimiter({
      maxRequestsPerWindow: 5,
      windowMs: 1000,
      defaultBackoffMs: 5000,
    })
  })

  it('allows requests within rate limit', () => {
    for (let i = 0; i < 5; i++) {
      const result = rateLimiter.checkRateLimit('test-agent')
      expect(result.allowed).toBe(true)
    }
  })

  it('blocks requests when rate limit exceeded', () => {
    // Fill up the rate limit
    for (let i = 0; i < 5; i++) {
      rateLimiter.checkRateLimit('test-agent')
    }

    // Next request should be blocked
    const result = rateLimiter.checkRateLimit('test-agent')
    expect(result.allowed).toBe(false)
    expect(result.backoffMs).toBeGreaterThan(0)
  })

  it('separates rate limits per agent', () => {
    // Fill up agent1
    for (let i = 0; i < 5; i++) {
      rateLimiter.checkRateLimit('agent1')
    }

    // agent1 should be blocked
    const result1 = rateLimiter.checkRateLimit('agent1')
    expect(result1.allowed).toBe(false)

    // agent2 should still be allowed
    const result2 = rateLimiter.checkRateLimit('agent2')
    expect(result2.allowed).toBe(true)
  })

  it('parses Retry-After header as seconds', () => {
    const response = new Response(null, {
      status: 429,
      headers: { 'Retry-After': '60' },
    })

    rateLimiter.handle429Response('test-agent', response)

    const backoff = rateLimiter.getBackoffMs('test-agent')
    expect(backoff).toBeGreaterThan(59000) // ~60 seconds
    expect(backoff).toBeLessThan(61000)
  })

  it('parses Retry-After header as HTTP date', () => {
    const futureDate = new Date(Date.now() + 30000) // 30 seconds from now
    const response = new Response(null, {
      status: 429,
      headers: { 'Retry-After': futureDate.toUTCString() },
    })

    rateLimiter.handle429Response('test-agent', response)

    const backoff = rateLimiter.getBackoffMs('test-agent')
    expect(backoff).toBeGreaterThan(29000) // ~30 seconds
    expect(backoff).toBeLessThan(31000)
  })

  it('uses default backoff when Retry-After not present', () => {
    const response = new Response(null, {
      status: 429,
    })

    rateLimiter.handle429Response('test-agent', response)

    const backoff = rateLimiter.getBackoffMs('test-agent')
    expect(backoff).toBeGreaterThan(4900) // ~5 seconds (default)
    expect(backoff).toBeLessThan(5100)
  })

  it('clears state for an agent', () => {
    // Fill up rate limit
    for (let i = 0; i < 5; i++) {
      rateLimiter.checkRateLimit('test-agent')
    }

    // Should be blocked
    let result = rateLimiter.checkRateLimit('test-agent')
    expect(result.allowed).toBe(false)

    // Clear state
    rateLimiter.clearState('test-agent')

    // Should be allowed again
    result = rateLimiter.checkRateLimit('test-agent')
    expect(result.allowed).toBe(true)
  })

  it('provides accurate stats', () => {
    // Make 3 requests
    for (let i = 0; i < 3; i++) {
      rateLimiter.checkRateLimit('test-agent')
    }

    const stats = rateLimiter.getStats('test-agent')
    expect(stats.requestsInWindow).toBe(3)
    expect(stats.backoffMs).toBe(0)
  })

  it('cleans up old timestamps from window', async () => {
    // Make 3 requests
    for (let i = 0; i < 3; i++) {
      rateLimiter.checkRateLimit('test-agent')
    }

    // Wait for window to expire
    await new Promise(resolve => setTimeout(resolve, 1100))

    // Old requests should be cleaned up
    const stats = rateLimiter.getStats('test-agent')
    expect(stats.requestsInWindow).toBe(0)

    // Should be able to make new requests
    const result = rateLimiter.checkRateLimit('test-agent')
    expect(result.allowed).toBe(true)
  })
})
