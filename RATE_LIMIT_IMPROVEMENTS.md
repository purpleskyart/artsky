# Rate Limit Improvements

This document describes the comprehensive improvements made to handle rate limiting more effectively.

## Overview

The following improvements have been implemented to address rate limit exceeded (429) errors:

1. ✅ Respect server's Retry-After header
2. ✅ Increase cache TTLs with stale-while-revalidate
3. ✅ Separate rate-limit state per agent
4. ✅ Batch API calls where possible
5. ✅ Global request queue with priority
6. ✅ Stale-while-revalidate caching

## 1. Retry-After Header Support

### Implementation: `src/lib/RateLimiter.ts`

The new `RateLimiter` class parses the `Retry-After` header from 429 responses instead of using a fixed 30-second backoff.

**Key Features:**
- Parses `Retry-After` as seconds (number) or HTTP date
- Falls back to default backoff (30s) if header not present
- More respectful of server's rate limit guidance

**Usage:**
```typescript
// Automatically handled in fetch handlers
const response = await fetch(url)
if (response.status === 429) {
  rateLimiter.handle429Response(agentId, response)
}
```

## 2. Increased Cache TTLs

### Updated Cache Durations:

| Resource Type | Old TTL | New TTL | Stale-While-Revalidate |
|--------------|---------|---------|------------------------|
| Feeds | 5 min | 5 min | +5 min |
| Profiles | None | 10 min | +5 min |
| Guest Feed | 5 min | 5 min | +5 min |
| Post Threads | Varies | Varies | N/A |

**Rationale:**
- Feeds change frequently, so 5 min is reasonable
- Profiles rarely change, so 10 min + 5 min stale is safe
- Stale-while-revalidate serves cached data immediately while refreshing in background

## 3. Separate Rate-Limit State Per Agent

### Implementation: `src/lib/RateLimiter.ts`

Previously, `credentialAgent` and `publicAgent` shared the same global rate limit counter. Now each agent has its own state.

**Key Features:**
- Separate request timestamp tracking per agent
- Separate backoff timers per agent
- Prevents one agent from blocking the other

**Agent IDs:**
- `'credential'` - For authenticated requests (credentialAgent)
- `'public'` - For unauthenticated requests (publicAgent)

**Benefits:**
- If public API hits rate limit, authenticated requests can still proceed
- More accurate rate limiting per endpoint

## 4. Batch API Calls

### Implementation: `src/lib/bsky.ts` - `getPostsBatch()`

New helper function to batch fetch posts using `app.bsky.feed.getPosts` (up to 25 posts per call).

**Usage:**
```typescript
// Instead of:
const posts = await Promise.all(
  uris.map(uri => agent.app.bsky.feed.getPostThread({ uri }))
)

// Use:
const postsMap = await getPostsBatch(uris)
```

**Benefits:**
- Reduces API calls by 25x for bulk post fetching
- Faster response times
- Lower rate limit consumption

## 5. Global Request Queue with Priority

### Implementation: `src/lib/RequestQueue.ts`

New priority queue system that defers low-priority requests when rate limited.

**Priority Levels:**
```typescript
enum RequestPriority {
  LOW = 0,      // Prefetching, background refreshes
  MEDIUM = 1,   // Visible content (timeline, profiles)
  HIGH = 2,     // User actions (like, repost, post, follow)
}
```

**Usage:**
```typescript
import { requestQueue, RequestPriority } from './RequestQueue'

// High priority user action
await requestQueue.enqueue(
  'like-post-123',
  () => agent.like(uri, cid),
  RequestPriority.HIGH
)

// Low priority prefetch
await requestQueue.enqueue(
  'prefetch-feed',
  () => agent.getTimeline({ limit: 50 }),
  RequestPriority.LOW
)
```

**Features:**
- Processes high-priority requests first
- Can drop low-priority requests when rate limited
- Limits concurrent requests (max 6)
- Automatic queue processing

## 6. Stale-While-Revalidate Caching

### Implementation: `src/lib/ResponseCache.ts`

Enhanced cache with stale-while-revalidate support.

**How It Works:**
1. Fresh data (within TTL): Served immediately
2. Stale data (within stale window): Served immediately + background refresh triggered
3. Expired data (beyond stale window): Cache miss, fetch fresh data

**Usage:**
```typescript
// Set with stale-while-revalidate
responseCache.set(key, data, 300_000, 300_000) // 5 min TTL + 5 min stale

// Get with automatic revalidation
const data = responseCache.get(key, () => fetchFreshData())
```

**Benefits:**
- Instant response for users (serves stale data)
- Reduces perceived latency
- Avoids bursts of requests on cache expiry
- Background refresh keeps data fresh

## Migration Guide

### For Existing Code

Most improvements are transparent and require no code changes. However, you can optimize further:

### 1. Use Profile Caching

**Before:**
```typescript
const profile = await agent.getProfile({ actor: did })
const handle = profile.data.handle
```

**After:**
```typescript
const profile = await getProfileCached(did)
const handle = profile.handle
```

### 2. Use Batch Fetching

**Before:**
```typescript
const posts = await Promise.all(
  uris.map(uri => agent.app.bsky.feed.getPostThread({ uri }))
)
```

**After:**
```typescript
const postsMap = await getPostsBatch(uris)
const posts = uris.map(uri => postsMap.get(uri)).filter(Boolean)
```

### 3. Use Request Queue for User Actions

**Before:**
```typescript
await agent.like(uri, cid)
```

**After:**
```typescript
import { requestQueue, RequestPriority } from './RequestQueue'

await requestQueue.enqueue(
  `like-${uri}`,
  () => agent.like(uri, cid),
  RequestPriority.HIGH
)
```

## Monitoring

### Rate Limiter Stats

```typescript
import { rateLimiter } from './RateLimiter'

const stats = rateLimiter.getStats('credential')
console.log({
  requestsInWindow: stats.requestsInWindow,
  backoffMs: stats.backoffMs,
  rateLimitUntil: new Date(stats.rateLimitUntil)
})
```

### Cache Stats

```typescript
import { responseCache } from './ResponseCache'

const stats = responseCache.getStats()
console.log({
  size: stats.size,
  totalHits: stats.totalHits,
  entries: stats.entries
})
```

### Queue Stats

```typescript
import { requestQueue } from './RequestQueue'

const stats = requestQueue.getStats()
console.log({
  queueSize: stats.queueSize,
  activeRequests: stats.activeRequests,
  priorityCounts: stats.priorityCounts
})
```

## Testing

### Test Rate Limiter

```typescript
import { rateLimiter } from './RateLimiter'

// Clear state for testing
rateLimiter.clearState('test-agent')

// Simulate 429 response
const mockResponse = new Response(null, {
  status: 429,
  headers: { 'Retry-After': '60' }
})
rateLimiter.handle429Response('test-agent', mockResponse)

// Check backoff
const backoff = rateLimiter.getBackoffMs('test-agent')
console.log(`Backing off for ${backoff}ms`)
```

### Test Cache with Stale-While-Revalidate

```typescript
import { responseCache } from './ResponseCache'

// Set with 1s TTL + 2s stale
responseCache.set('test', { data: 'old' }, 1000, 2000)

// Wait 1.5s (stale but within window)
await new Promise(resolve => setTimeout(resolve, 1500))

// Should return stale data and trigger revalidation
const data = responseCache.get('test', async () => {
  console.log('Revalidating in background...')
  return { data: 'fresh' }
})

console.log(data) // { data: 'old' } (stale)
```

## Performance Impact

### Expected Improvements:

1. **Reduced 429 Errors**: 70-90% reduction by respecting Retry-After and separating agent limits
2. **Faster Response Times**: 30-50% improvement from stale-while-revalidate
3. **Lower API Usage**: 40-60% reduction from better caching and batching
4. **Better UX**: High-priority user actions always go through first

## Future Enhancements

Potential future improvements:

1. **Adaptive Rate Limiting**: Dynamically adjust request rate based on 429 frequency
2. **Request Coalescing**: Merge similar requests (e.g., multiple profile fetches)
3. **Predictive Prefetching**: Prefetch likely-needed data at low priority
4. **Circuit Breaker**: Temporarily disable non-critical features when rate limited
5. **Metrics Dashboard**: Real-time monitoring of rate limits and cache performance

## Troubleshooting

### Still Getting 429 Errors?

1. Check if you're making too many unique requests (cache misses)
2. Verify cache TTLs are appropriate for your use case
3. Consider increasing stale-while-revalidate window
4. Use request queue for all non-critical requests
5. Monitor rate limiter stats to identify bottlenecks

### Cache Not Working?

1. Verify cache keys are consistent
2. Check TTL values are reasonable
3. Ensure revalidation function is provided for stale-while-revalidate
4. Monitor cache stats to see hit rates

### Queue Not Processing?

1. Check queue stats to see if requests are stuck
2. Verify priority levels are set correctly
3. Ensure no requests are blocking (use async/await properly)
4. Consider increasing maxConcurrent if needed

## Summary

These improvements provide a robust, production-ready rate limiting solution that:

- Respects server guidance (Retry-After)
- Maximizes cache efficiency (longer TTLs, stale-while-revalidate)
- Prevents agent interference (separate state)
- Reduces API calls (batching)
- Prioritizes user experience (request queue)
- Serves data instantly (stale-while-revalidate)

The system is designed to be transparent to existing code while providing significant performance and reliability improvements.
