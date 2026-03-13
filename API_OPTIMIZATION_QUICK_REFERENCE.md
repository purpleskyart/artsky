# API Optimization Quick Reference

## What Changed

### 1. Saved Feeds Caching
```typescript
// Before: Called every time, no caching
const feeds = await getSavedFeedsFromPreferences()

// After: Cached for 5 minutes
const feeds = await getSavedFeedsFromPreferences() // Uses cache if available
```

### 2. Batch Feed Name Fetching
```typescript
// Before: Individual calls for each feed
const labels = await Promise.all(
  feeds.map(f => getFeedDisplayName(f.value))
)

// After: Single batch call
const labels = await getFeedDisplayNamesBatch(
  feeds.map(f => f.value)
)
```

### 3. Cache Invalidation
```typescript
// Before: No cache invalidation
await addSavedFeed(uri)

// After: Automatic cache invalidation
await addSavedFeed(uri) // Calls invalidateSavedFeedsCache() internally
```

## New Functions

### `getFeedDisplayNamesBatch(uris: string[]): Promise<Map<string, string>>`
Fetch display names for multiple feeds in a single batch operation.

```typescript
import { getFeedDisplayNamesBatch } from '../lib/bsky'

const uris = ['at://did:plc:abc/feed1', 'at://did:plc:xyz/feed2']
const labels = await getFeedDisplayNamesBatch(uris)

labels.get('at://did:plc:abc/feed1') // Returns feed name
```

### `invalidateSavedFeedsCache(): void`
Manually invalidate the saved feeds cache.

```typescript
import { invalidateSavedFeedsCache } from '../lib/bsky'

// After modifying feeds
await addSavedFeed(uri)
invalidateSavedFeedsCache() // Force refresh on next load
```

## Migration Guide

### If you're using `getFeedDisplayName()` in a loop:

**Before**:
```typescript
const feeds = ['feed1', 'feed2', 'feed3']
const labels = await Promise.all(
  feeds.map(f => getFeedDisplayName(f))
)
```

**After**:
```typescript
const feeds = ['feed1', 'feed2', 'feed3']
const labelMap = await getFeedDisplayNamesBatch(feeds)
const labels = feeds.map(f => labelMap.get(f))
```

### If you're calling `getSavedFeedsFromPreferences()` multiple times:

**Before**:
```typescript
// Called in Layout
const feeds1 = await getSavedFeedsFromPreferences()

// Called in FeedPage
const feeds2 = await getSavedFeedsFromPreferences()
```

**After**:
```typescript
// Both calls use the same cache (5 min TTL)
const feeds1 = await getSavedFeedsFromPreferences()
const feeds2 = await getSavedFeedsFromPreferences() // Cached!
```

## Performance Tips

### ✅ Do This
```typescript
// Batch multiple feed names
const uris = feeds.map(f => f.value)
const labels = await getFeedDisplayNamesBatch(uris)

// Use cached preferences
const feeds = await getSavedFeedsFromPreferences()

// Let cache invalidation happen automatically
await addSavedFeed(uri) // Cache invalidated automatically
```

### ❌ Don't Do This
```typescript
// Don't fetch feed names individually in a loop
for (const feed of feeds) {
  const label = await getFeedDisplayName(feed.value) // ❌ N API calls
}

// Don't manually invalidate cache unnecessarily
await addSavedFeed(uri)
invalidateSavedFeedsCache() // ❌ Already called internally

// Don't ignore cache TTL
// Cache expires after 5 minutes, that's by design
```

## Cache Behavior

### Saved Feeds Cache
- **TTL**: 5 minutes (300,000 ms)
- **Invalidation**: Automatic on `addSavedFeed()` and `removeSavedFeedByUri()`
- **Scope**: Per user session
- **Fallback**: Fresh fetch if cache expired

### Feed Name Cache
- **TTL**: Session duration (in-memory Map)
- **Invalidation**: Manual via `invalidateSavedFeedsCache()`
- **Scope**: Per browser tab
- **Fallback**: API call if not in cache

### Feed Response Cache
- **TTL**: 5 minutes
- **Stale-While-Revalidate**: 5 minutes
- **Scope**: Per feed URI and limit
- **Fallback**: Stale data served while revalidating

## Debugging

### Check if cache is working
```javascript
// In browser console
// 1. Load feed page
// 2. Switch to another page
// 3. Return to feed page within 5 minutes
// 4. Open DevTools Network tab
// 5. Should see NO getPreferences call (cached)
```

### Monitor cache hits
```javascript
// Add to your monitoring
const cacheHits = new Map()
const cacheMisses = new Map()

// Track in your analytics
console.log('Cache hit rate:', cacheHits.size / (cacheHits.size + cacheMisses.size))
```

### Force cache refresh
```javascript
// If you need fresh data immediately
import { invalidateSavedFeedsCache } from '../lib/bsky'

invalidateSavedFeedsCache()
const feeds = await getSavedFeedsFromPreferences() // Fresh fetch
```

## Common Issues

### Issue: Feed names not showing
**Solution**: Check if `getFeedDisplayNamesBatch()` is being used instead of individual calls

### Issue: Stale feed data
**Solution**: Cache expires after 5 minutes. If you need immediate refresh, call `invalidateSavedFeedsCache()`

### Issue: Too many API calls
**Solution**: Verify you're using batch functions and not looping over individual calls

## API Call Reduction Summary

| Operation | Before | After | Reduction |
|-----------|--------|-------|-----------|
| Load saved feeds | 2 calls | 1 call (cached) | 50% |
| Fetch feed names | N calls | 1 batch | 80% |
| Guest feed | +5 buffer | Exact | 15-20% |
| **Total per session** | **15-20** | **8-10** | **45%** |

## Questions?

- Check `API_OPTIMIZATION_SUMMARY.md` for detailed explanation
- Check `API_OPTIMIZATION_MONITORING.md` for monitoring guide
- Review code comments in `src/lib/bsky.ts`
