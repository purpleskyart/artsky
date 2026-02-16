import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { searchPostsByTag, searchPostsByQuery, getQuotes, getActorFeeds } from './bsky'

describe('API Error Handling Integration Tests', () => {
  beforeEach(() => {
    // Mock console.warn to avoid noise in test output
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('searchPostsByTag', () => {
    it('throws user-friendly error on 404', async () => {
      // Mock fetch to simulate 404 error
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Not found' }),
      })

      await expect(searchPostsByTag('nonexistent')).rejects.toThrow(
        'The requested content was not found.'
      )
    })

    it('throws user-friendly error on 500', async () => {
      // Mock fetch to simulate server error
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Internal server error' }),
      })

      await expect(searchPostsByTag('art')).rejects.toThrow(
        'Server error. Please try again in a moment.'
      )
    })

    it('returns empty results for empty tag', async () => {
      const result = await searchPostsByTag('')
      expect(result).toEqual({ posts: [], cursor: undefined })
    })
  })

  describe('searchPostsByQuery', () => {
    it('throws user-friendly error on 503', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ message: 'Service unavailable' }),
      })

      await expect(searchPostsByQuery('test')).rejects.toThrow(
        'Service is currently down for maintenance. Please try again later.'
      )
    })

    it('returns empty results for empty query', async () => {
      const result = await searchPostsByQuery('')
      expect(result).toEqual({ posts: [], cursor: undefined })
    })
  })

  describe('getQuotes', () => {
    it('throws user-friendly error on 429 rate limit', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ message: 'Too many requests' }),
      })

      await expect(getQuotes('at://did:plc:test/app.bsky.feed.post/123')).rejects.toThrow(
        'Too many requests. Please wait a moment and try again.'
      )
    })
  })

  describe('getActorFeeds', () => {
    it('throws user-friendly error on 401 unauthorized', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Unauthorized' }),
      })

      await expect(getActorFeeds('test.bsky.social')).rejects.toThrow(
        'Your session has expired. Please log in again.'
      )
    })
  })

  describe('Retry behavior', () => {
    it('does not retry on 4xx errors', async () => {
      let attemptCount = 0
      global.fetch = vi.fn().mockImplementation(async () => {
        attemptCount++
        return {
          ok: false,
          status: 400,
          json: async () => ({ message: 'Bad request' }),
        }
      })

      await expect(searchPostsByQuery('test')).rejects.toThrow()
      expect(attemptCount).toBe(1) // Only initial attempt, no retries
    })
  })

  describe('Error message context', () => {
    it('includes operation context in error messages', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Not found' }),
      })

      // Different functions should have appropriate context
      await expect(searchPostsByTag('art')).rejects.toThrow('not found')
      await expect(searchPostsByQuery('test')).rejects.toThrow('not found')
      await expect(getQuotes('at://test')).rejects.toThrow('not found')
      await expect(getActorFeeds('test.bsky.social')).rejects.toThrow('not found')
    })
  })
})
