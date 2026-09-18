/**
 * Examples of using the new rate limiting improvements
 * 
 * This file demonstrates best practices for using:
 * - Profile caching
 * - Batch post fetching
 * - Request queue with priorities
 * - Stale-while-revalidate caching
 */

import { agent, getProfileCached, getPostsBatch } from './bsky'
import { requestQueue, RequestPriority } from './RequestQueue'
import { responseCache } from './ResponseCache'

/**
 * Example 1: Fetch multiple profiles efficiently
 * Uses cached profiles with 10 min TTL + 5 min stale-while-revalidate
 */
export async function fetchMultipleProfiles(dids: string[]) {
  // Old way: Multiple uncached requests
  // const profiles = await Promise.all(
  //   dids.map(did => agent.getProfile({ actor: did }))
  // )

  // New way: Cached with longer TTL
  const profiles = await Promise.all(
    dids.map(did => getProfileCached(did))
  )

  return profiles
}

/**
 * Example 2: Fetch multiple posts in batches
 * Uses app.bsky.feed.getPosts (25 posts per call) instead of individual getPostThread calls
 */
export async function fetchMultiplePosts(uris: string[]) {
  // Old way: One request per post
  // const posts = await Promise.all(
  //   uris.map(uri => agent.app.bsky.feed.getPostThread({ uri }))
  // )

  // New way: Batched requests (25 posts per call)
  const postsMap = await getPostsBatch(uris)
  const posts = uris.map(uri => postsMap.get(uri)).filter(Boolean)

  return posts
}

/**
 * Example 3: User action with high priority
 * Ensures user actions go through even when rate limited
 */
export async function likePostWithPriority(uri: string, cid: string) {
  // Old way: Direct call (might be blocked by rate limit)
  // await agent.like(uri, cid)

  // New way: High priority queue
  await requestQueue.enqueue(
    `like-${uri}`,
    () => agent.like(uri, cid),
    RequestPriority.HIGH
  )
}

/**
 * Example 4: Background prefetch with low priority
 * Prefetches data without blocking user actions
 */
export async function prefetchFeedInBackground(feedUri: string) {
  // Low priority - will be deferred if rate limited
  await requestQueue.enqueue(
    `prefetch-${feedUri}`,
    () => agent.app.bsky.feed.getFeed({ feed: feedUri, limit: 50 }),
    RequestPriority.LOW
  )
}

/**
 * Example 5: Custom caching with stale-while-revalidate
 * Serves stale data immediately while refreshing in background
 */
export async function getCustomFeedWithStaleSupport(feedUri: string) {
  const cacheKey = `custom-feed:${feedUri}`

  // Try to get from cache (with automatic background revalidation)
  const cached = responseCache.get(
    cacheKey,
    // Revalidation function (called in background if data is stale)
    () => agent.app.bsky.feed.getFeed({ feed: feedUri, limit: 50 })
      .then(res => res.data)
  )

  if (cached) {
    return cached
  }

  // Cache miss - fetch fresh data
  const res = await agent.app.bsky.feed.getFeed({ feed: feedUri, limit: 50 })
  
  // Cache with 5 min TTL + 5 min stale-while-revalidate
  responseCache.set(cacheKey, res.data, 300_000, 300_000)
  
  return res.data
}

/**
 * Example 6: Combining multiple optimizations
 * Fetches timeline with caching, batching, and priority
 */
export async function getOptimizedTimeline(limit: number, cursor?: string) {
  const cacheKey = `timeline:${limit}:${cursor ?? 'initial'}`

  // Check cache first (with stale-while-revalidate)
  const cached = responseCache.get(
    cacheKey,
    // Background revalidation
    () => agent.getTimeline({ limit, cursor }).then(res => res.data)
  )

  if (cached) {
    return cached
  }

  // Queue with medium priority (visible content)
  const data = await requestQueue.enqueue(
    cacheKey,
    () => agent.getTimeline({ limit, cursor }).then(res => res.data),
    RequestPriority.MEDIUM
  )

  // Cache with stale-while-revalidate
  responseCache.set(cacheKey, data, 300_000, 300_000)

  return data
}

/**
 * Example 7: Monitoring rate limit status
 * Check current rate limit state before making requests
 */
export async function checkRateLimitStatus() {
  // Dynamic import to avoid circular dependency
  const { rateLimiter } = await import('./RateLimiter')

  const credentialStats = rateLimiter.getStats('credential')
  const publicStats = rateLimiter.getStats('public')

  return {
    credential: {
      requestsInWindow: credentialStats.requestsInWindow,
      backoffMs: credentialStats.backoffMs,
      isRateLimited: credentialStats.backoffMs > 0,
    },
    public: {
      requestsInWindow: publicStats.requestsInWindow,
      backoffMs: publicStats.backoffMs,
      isRateLimited: publicStats.backoffMs > 0,
    },
  }
}

/**
 * Example 8: Clearing low-priority requests when rate limited
 * Useful for recovering from rate limit situations
 */
export async function handleRateLimitRecovery() {
  const status = await checkRateLimitStatus()

  if (status.credential.isRateLimited || status.public.isRateLimited) {
    // Drop low-priority requests to free up capacity
    requestQueue.clearLowPriority()
    
    console.log('Rate limited - cleared low priority requests')
    console.log(`Credential backoff: ${status.credential.backoffMs}ms`)
    console.log(`Public backoff: ${status.public.backoffMs}ms`)
  }
}
