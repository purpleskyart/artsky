# API Optimization Monitoring Guide

## How to Verify the Optimizations

### 1. Browser DevTools Network Monitoring

**Steps**:
1. Open DevTools (F12 or Cmd+Option+I)
2. Go to Network tab
3. Filter by XHR/Fetch requests
4. Perform these actions and count API calls:

**Test Scenario 1: Initial Load**
```
Action: Load app for first time
Expected API calls:
- 1x getPreferences (saved feeds)
- 1x getFeedGenerator (batch for all feed names)
- 1x getTimeline or getFeed (initial feed load)
Total: ~3 API calls (vs 5-7 before)
```

**Test Scenario 2: Page Navigation**
```
Action: Navigate away and back to feed page within 5 minutes
Expected API calls:
- 0x getPreferences (cached)
- 0x getFeedGenerator (cached)
- 1x getTimeline or getFeed (new feed load)
Total: ~1 API call (vs 3-4 before)
```

**Test Scenario 3: Add Feed**
```
Action: Add a new feed
Expected API calls:
- 1x putPreferences (save feed)
- 1x getFeedGenerator (get feed name)
- Cache invalidated for next load
Total: ~2 API calls
```

### 2. Console Logging for Debugging

Add this to your browser console to monitor cache hits:

```javascript
// Monitor saved feeds cache
const originalGetSavedFeeds = window.getSavedFeedsFromPreferences
let cacheHits = 0
let cacheMisses = 0

// Monitor feed name cache
const feedNameCacheHits = new Map()
```

### 3. Performance Metrics

**Measure these metrics before and after**:

```
1. Time to First Feed Render
   - Before: ~800-1200ms
   - After: ~600-900ms
   - Target: 20-30% improvement

2. API Call Count (per session)
   - Before: 15-20 calls
   - After: 8-10 calls
   - Target: 40-50% reduction

3. Network Data Transfer
   - Before: ~150-200KB
   - After: ~100-120KB
   - Target: 30-40% reduction

4. Cache Hit Rate
   - Target: 60-70% for saved feeds
   - Target: 80-90% for feed names
```

### 4. Specific API Endpoints to Monitor

**Track these endpoints**:

| Endpoint | Before | After | Cache |
|----------|--------|-------|-------|
| `app.bsky.actor.getPreferences` | 2+ | 1 per 5min | 5min TTL |
| `app.bsky.feed.getFeedGenerator` | N | 1 batch | Session |
| `app.bsky.feed.getTimeline` | 1+ | 1+ | 5min TTL |
| `app.bsky.feed.getFeed` | 1+ | 1+ | 5min TTL |

### 5. Cache Validation Checklist

- [ ] Saved feeds cache expires after 5 minutes
- [ ] Feed name cache persists during session
- [ ] Cache invalidates when feeds are added
- [ ] Cache invalidates when feeds are removed
- [ ] Concurrent requests are deduplicated
- [ ] Stale-while-revalidate works for feeds
- [ ] Guest feed fetches exact limit (no +5 buffer)

## Monitoring in Production

### Key Metrics to Track

1. **API Call Frequency**
   ```
   Metric: Average API calls per user session
   Target: < 10 calls for typical 5-minute session
   Alert: > 15 calls
   ```

2. **Cache Hit Rate**
   ```
   Metric: Percentage of requests served from cache
   Target: > 60% for saved feeds
   Alert: < 40%
   ```

3. **Response Time**
   ```
   Metric: Average API response time
   Target: < 500ms
   Alert: > 1000ms
   ```

4. **Error Rate**
   ```
   Metric: Percentage of failed API calls
   Target: < 1%
   Alert: > 5%
   ```

## Troubleshooting

### Issue: Cache not invalidating after adding feed

**Check**:
1. Verify `invalidateSavedFeedsCache()` is called in `addSavedFeed()`
2. Check browser console for errors
3. Verify cache TTL hasn't expired naturally

**Solution**:
```javascript
// Force cache invalidation
localStorage.clear() // if using localStorage
// Or reload the page
window.location.reload()
```

### Issue: Duplicate API calls still happening

**Check**:
1. Verify `getFeedDisplayNamesBatch()` is being used
2. Check if request deduplicator is working
3. Look for multiple component mounts

**Solution**:
```javascript
// Check pending requests
console.log(requestDeduplicator.getPendingCount())
```

### Issue: Feed names not loading

**Check**:
1. Verify batch function returns correct Map
2. Check for network errors in DevTools
3. Verify feed URIs are valid

**Solution**:
```javascript
// Test batch function
const uris = ['at://did:plc:abc/app.bsky.feed.generator/xyz']
const labels = await getFeedDisplayNamesBatch(uris)
console.log(labels) // Should be Map with URI -> name
```

## Performance Regression Detection

### Automated Checks

Add these checks to your CI/CD pipeline:

```javascript
// Check 1: API call count
if (apiCallCount > 15) {
  console.warn('API calls exceeded threshold')
}

// Check 2: Cache hit rate
if (cacheHitRate < 0.4) {
  console.warn('Cache hit rate below threshold')
}

// Check 3: Response time
if (avgResponseTime > 1000) {
  console.warn('Response time exceeded threshold')
}
```

## Rollback Plan

If optimizations cause issues:

1. **Disable cache**: Set `SAVED_FEEDS_CACHE_TTL = 0`
2. **Revert batch**: Use individual `getFeedDisplayName()` calls
3. **Restore buffer**: Change `perHandle = Math.ceil(need / GUEST_FEED_HANDLES.length)` to `+ 5`

## Success Criteria

✅ Optimization is successful when:
- [ ] API calls reduced by 40-50%
- [ ] Cache hit rate > 60%
- [ ] No increase in error rate
- [ ] Page load time improved by 20-30%
- [ ] No user-facing issues reported
- [ ] All tests passing
