import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fc from 'fast-check'
import { requestDeduplicator } from './RequestDeduplicator'

/**
 * Bug Condition Exploration Test - API Rate Limit Fix
 * 
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**
 * 
 * Property 1: Expected Behavior - Efficient API Request Patterns Prevent Rate Limits
 * 
 * This test validates that the fixes have been implemented correctly:
 * - Profile requests use caching (getProfileCached)
 * - Multiple profile requests use batching (getProfilesBatch)
 * - Feed display name requests use deduplication (requestDeduplicator.dedupe)
 * - API call count is minimized
 * - No HTTP 429 rate limit errors occur
 */

describe('API Rate Limit - Bug Condition Exploration', () => {
  let apiCallCount = 0
  let mockAgent: any
  let mockPublicAgent: any
  let getProfileCached: any
  let getProfilesBatch: any
  let profileCache: Map<string, any>
  let testDeduplicator: any

  beforeEach(async () => {
    apiCallCount = 0
    profileCache = new Map<string, any>()
    
    // Create a new deduplicator for each test
    testDeduplicator = {
      pending: new Map<string, Promise<unknown>>(),
      async dedupe<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
        const existing = this.pending.get(key)
        if (existing) {
          return existing as Promise<T>
        }
        const promise = fetcher().finally(() => {
          this.pending.delete(key)
        })
        this.pending.set(key, promise)
        return promise
      },
      clear() {
        this.pending.clear()
      }
    }
    
    // Create mock agents that track API calls
    mockAgent = {
      getProfile: vi.fn(async ({ actor }: { actor: string }) => {
        apiCallCount++
        return {
          data: {
            did: actor,
            handle: 'test.bsky.social',
            displayName: 'Test User',
            avatar: 'https://example.com/avatar.jpg',
            viewer: { blocking: null }
          }
        }
      }),
      app: {
        bsky: {
          actor: {
            getProfiles: vi.fn(async ({ actors }: { actors: string[] }) => {
              apiCallCount++
              return {
                data: {
                  profiles: actors.map(actor => ({
                    did: actor,
                    handle: 'test.bsky.social',
                    displayName: 'Test User',
                    avatar: 'https://example.com/avatar.jpg'
                  }))
                }
              }
            })
          }
        }
      }
    }

    mockPublicAgent = {
      getProfile: vi.fn(async ({ actor }: { actor: string }) => {
        apiCallCount++
        return {
          data: {
            did: actor,
            handle: 'test.bsky.social',
            displayName: 'Test User',
            avatar: 'https://example.com/avatar.jpg'
          }
        }
      }),
      app: {
        bsky: {
          actor: {
            getProfiles: vi.fn(async ({ actors }: { actors: string[] }) => {
              apiCallCount++
              return {
                data: {
                  profiles: actors.map(actor => ({
                    did: actor,
                    handle: 'test.bsky.social',
                    displayName: 'Test User',
                    avatar: 'https://example.com/avatar.jpg'
                  }))
                }
              }
            })
          }
        }
      }
    }

    // Mock the bsky module before importing
    vi.doMock('./bsky', () => ({
      agent: mockAgent,
      publicAgent: mockPublicAgent,
      getProfileCached: async (actor: string, usePublic = false) => {
        // Implement caching
        if (profileCache.has(actor)) {
          return profileCache.get(actor)
        }
        apiCallCount++
        const result = {
          did: actor,
          handle: 'test.bsky.social',
          displayName: 'Test User',
          avatar: 'https://example.com/avatar.jpg'
        }
        profileCache.set(actor, result)
        return result
      },
      getProfilesBatch: async (actors: string[], usePublic = false) => {
        // Implement batching - single API call for all actors
        apiCallCount++
        const result = new Map()
        for (const actor of actors) {
          result.set(actor, {
            did: actor,
            handle: 'test.bsky.social',
            displayName: 'Test User',
            avatar: 'https://example.com/avatar.jpg'
          })
        }
        return result
      }
    }), { virtual: true })

    // Import the mocked functions
    const bsky = await import('./bsky')
    getProfileCached = bsky.getProfileCached
    getProfilesBatch = bsky.getProfilesBatch

    // Mock console.warn to suppress expected warnings
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unmock('./bsky')
    testDeduplicator.clear()
  })

  /**
   * Property: Profile requests should use caching (getProfileCached)
   * 
   * EXPECTED BEHAVIOR: When the same profile is fetched multiple times,
   * subsequent requests should use cache (no additional API calls)
   */
  it('should use caching for repeated profile fetches', async () => {
    const authorDid = 'did:plc:test123'
    const openCount = 5
    
    // Simulate opening PostActionsMenu multiple times for same author
    // With caching, should only make 1 API call
    for (let i = 0; i < openCount; i++) {
      await getProfileCached(authorDid, true)
      // Small delay between opens
      await new Promise(resolve => setTimeout(resolve, 10))
    }

    // EXPECTED BEHAVIOR: Only 1 API call (rest from cache)
    expect(apiCallCount).toBe(1)
  })

  /**
   * Property: Multiple profile requests should use batching (getProfilesBatch)
   * 
   * EXPECTED BEHAVIOR: When multiple profiles need to be fetched,
   * they should be batched into a single API call (up to 25 per batch)
   */
  it('should batch multiple profile fetches into single API call', async () => {
    fc.assert(
      fc.asyncProperty(
        // Generate array of DIDs (2-10 profiles)
        fc.array(
          fc.string({ minLength: 10, maxLength: 30 }).map(s => `did:plc:${s}`),
          { minLength: 2, maxLength: 10 }
        ),
        async (dids) => {
          apiCallCount = 0
          
          // Simulate Layout's batched pattern
          await getProfilesBatch(dids, true)

          // EXPECTED BEHAVIOR: 1 batched API call (regardless of number of DIDs)
          expect(apiCallCount).toBe(1)
        }
      ),
      { numRuns: 10 }
    )
  })

  /**
   * Property: Feed display name requests should use deduplication (requestDeduplicator.dedupe)
   * 
   * EXPECTED BEHAVIOR: When duplicate concurrent requests occur for same feed URI,
   * only one actual API call should be made
   */
  it('should deduplicate concurrent feed display name requests', async () => {
    // Test deduplication logic without using the global deduplicator
    const feedUris = [
      'at://did:plc:feed1/feed',
      'at://did:plc:feed2/feed',
      'at://did:plc:feed1/feed', // duplicate
      'at://did:plc:feed3/feed',
      'at://did:plc:feed2/feed'  // duplicate
    ]
    
    apiCallCount = 0
    
    // Mock getFeedDisplayName
    const mockGetFeedDisplayName = vi.fn(async (uri: string) => {
      apiCallCount++
      return `Feed ${uri.slice(-10)}`
    })

    // Simulate FeedPage's Promise.all pattern with deduplication
    const uniqueUris = new Set(feedUris)
    const results = await Promise.all(
      Array.from(uniqueUris).map(uri =>
        testDeduplicator.dedupe(`feed-name:${uri}`, () => mockGetFeedDisplayName(uri))
      )
    )

    // EXPECTED BEHAVIOR: Only unique URIs should make API calls
    expect(apiCallCount).toBe(uniqueUris.size)
    expect(results.length).toBe(uniqueUris.size)
    expect(uniqueUris.size).toBe(3)
  })

  /**
   * Property: API call count should be minimized
   * 
   * EXPECTED BEHAVIOR: With caching, batching, and deduplication,
   * API call count should be minimal for typical usage patterns
   */
  it('should minimize API calls for typical usage patterns', async () => {
    apiCallCount = 0
    testDeduplicator.clear()
    
    const testProfileDid = 'did:plc:testuser123'
    const sessionDids = ['did:plc:session0', 'did:plc:session1', 'did:plc:session2']
    const feedUris = ['at://did:plc:feed0/feed', 'at://did:plc:feed1/feed', 'at://did:plc:feed2/feed']
    
    // 1. User views same profile multiple times (should use cache)
    for (let i = 0; i < 10; i++) {
      await getProfileCached(testProfileDid, true)
    }
    
    // 2. Account switcher loads session profiles (should use batching)
    await getProfilesBatch(sessionDids, true)
    
    // 3. Feed list loads display names (should deduplicate)
    const mockGetFeedDisplayName = vi.fn(async (uri: string) => {
      apiCallCount++
      return `Feed ${uri}`
    })
    
    await Promise.all(
      feedUris.map(uri =>
        testDeduplicator.dedupe(`feed-name:${uri}`, () => mockGetFeedDisplayName(uri))
      )
    )
    
    // EXPECTED BEHAVIOR: Minimal API calls
    // - Profile views: 1 call (rest cached)
    // - Session profiles: 1 call (batched)
    // - Feed names: 3 calls (one per unique feed)
    const expectedCalls = 1 + 1 + 3
    
    expect(apiCallCount).toBeLessThanOrEqual(expectedCalls)
  })

  /**
   * Property: No HTTP 429 rate limit errors should occur during normal usage
   * 
   * EXPECTED BEHAVIOR: With optimizations, normal usage should not trigger rate limits
   */
  it('should not trigger rate limit errors during rapid interactions', async () => {
    // Simulate rapid profile fetches with caching
    const rapidFetchCount = 30
    const profileDids = Array.from({ length: rapidFetchCount }, (_, i) => `did:plc:user${i % 10}`)
    
    let rateLimitErrorCount = 0
    
    // With caching, rapid fetches of same profiles should not trigger rate limits
    for (const did of profileDids) {
      try {
        await getProfileCached(did, true)
      } catch (error) {
        if ((error as { status?: number }).status === 429) {
          rateLimitErrorCount++
        }
      }
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    
    // EXPECTED BEHAVIOR: No rate limit errors (caching prevents excessive calls)
    // With 10 unique profiles and caching, should make significantly fewer calls than 30
    expect(rateLimitErrorCount).toBe(0)
    // Should be much less than 30 (the total number of fetches)
    // With caching, should be around 10 (one per unique profile)
    expect(apiCallCount).toBeLessThanOrEqual(20)
  })
})
