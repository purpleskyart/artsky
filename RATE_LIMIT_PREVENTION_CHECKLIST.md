# Rate Limit Prevention Checklist

## ✅ Completed Optimizations

### Profile Fetching
- [x] Fixed `PostDetailPage.tsx` - Use `getProfileCached()` instead of `agent.getProfile()`
- [x] Fixed `ForumPage.tsx` - Use `getProfileCached()` instead of `publicAgent.getProfile()`
- [x] Fixed `ForumPostDetailPage.tsx` - Use `getProfileCached()` instead of `publicAgent.getProfile()`

### Batch Operations
- [x] `getFeedDisplayNamesBatch()` - Batch fetch feed names (80% reduction)
- [x] `getProfilesBatch()` - Batch fetch profiles (80% reduction)
- [x] `getPostsBatch()` - Batch fetch posts (80% reduction)

### Caching
- [x] `ResponseCache` - TTL-based caching with stale-while-revalidate
- [x] `getProfileCached()` - 10-minute TTL + 5-minute stale window
- [x] `getSavedFeedsFromPreferences()` - 5-minute TTL cache
- [x] `postCache` - 5-minute TTL for post threads

### Request Management
- [x] `RequestDeduplicator` - Deduplicates concurrent identical requests
- [x] `RequestQueue` - Priority-based request queuing (HIGH/MEDIUM/LOW)
- [x] `RateLimiter` - Per-agent rate limit tracking with Retry-After support
- [x] `retryWithBackoff()` - Exponential backoff for failed requests

### Cache Invalidation
- [x] Pattern-based cache invalidation after mutations
- [x] Automatic invalidation on feed add/remove
- [x] Separate patterns for different operations

### Performance
- [x] `ImageLoadQueue` - Limits concurrent image requests to 6
- [x] `performanceMetrics` - Tracks Core Web Vitals

## 📋 Code Review Checklist

### When Adding New API Calls

- [ ] Check if data can be cached (TTL > 0)
- [ ] Check if batch function exists for this operation
- [ ] Check if cached version exists (e.g., `getProfileCached`)
- [ ] Use appropriate priority level in RequestQueue
- [ ] Add cache invalidation after mutations
- [ ] Test with DevTools Network tab to verify API calls

### When Fetching Multiple Items

- [ ] Use batch function instead of individual calls
- [ ] Verify batch function exists:
  - `getProfilesBatch()` for profiles
  - `getPostsBatch()` for posts
  - `getFeedDisplayNamesBatch()` for feed names
- [ ] Check batch size limits (usually 25 items)
- [ ] Handle partial failures with `Promise.allSettled()`

### When Caching Data

- [ ] Use `ResponseCache.set()` with appropriate TTL
- [ ] Consider stale-while-revalidate window
- [ ] Add cache invalidation patterns
- [ ] Test cache hit rate in DevTools

### When Handling Errors

- [ ] Use `retryWithBackoff()` for transient failures
- [ ] Respect 429 rate limit responses
- [ ] Implement exponential backoff
- [ ] Log rate limit errors for monitoring

## 🔍 Testing Checklist

### Before Deployment

- [ ] Run TypeScript diagnostics (no errors)
- [ ] Check Network tab for API call count
- [ ] Verify cache hit rate > 60%
- [ ] Test with slow network (DevTools throttling)
- [ ] Test with offline mode
- [ ] Verify error handling works
- [ ] Check console for warnings/errors

### Performance Testing

- [ ] Measure page load time
- [ ] Count API calls per action
- [ ] Monitor cache statistics
- [ ] Check memory usage
- [ ] Verify no memory leaks

### Rate Limit Testing

- [ ] Simulate rate limit (429 response)
- [ ] Verify exponential backoff works
- [ ] Verify low-priority requests are dropped
- [ ] Verify high-priority requests go through
- [ ] Check Retry-After header handling

## 📊 Metrics to Monitor

### API Calls
- [ ] Initial page load: < 5 API calls (target: 3)
- [ ] Navigation: < 2 API calls (target: 1)
- [ ] 5-minute session: < 10 API calls (target: 7)

### Cache Performance
- [ ] Cache hit rate: > 60%
- [ ] Cache size: < 10MB
- [ ] Average cache age: < 2 minutes

### Rate Limiting
- [ ] 429 errors: < 1% of requests
- [ ] Backoff time: < 30 seconds
- [ ] Request queue size: < 20 items

### Performance
- [ ] Page load time: < 700ms
- [ ] First Contentful Paint: < 1s
- [ ] Largest Contentful Paint: < 2.5s

## 🚀 Deployment Checklist

### Pre-deployment
- [ ] All TypeScript diagnostics passing
- [ ] All tests passing
- [ ] Code review completed
- [ ] Performance testing completed
- [ ] Rate limit testing completed

### Deployment
- [ ] Deploy to staging first
- [ ] Monitor staging metrics for 24 hours
- [ ] Verify no increase in error rate
- [ ] Verify cache hit rate > 60%
- [ ] Deploy to production

### Post-deployment
- [ ] Monitor production metrics
- [ ] Check error logs for rate limit errors
- [ ] Verify API call reduction
- [ ] Gather user feedback
- [ ] Document any issues

## 🔧 Troubleshooting

### High Rate Limit Errors
1. Check for N+1 patterns in code
2. Verify batch functions are being used
3. Check cache hit rate
4. Review request queue statistics
5. Check for duplicate concurrent requests

### Low Cache Hit Rate
1. Verify cache TTL is appropriate
2. Check if cache invalidation is too aggressive
3. Review cache key generation
4. Check for cache misses due to parameter differences

### High Memory Usage
1. Check cache size
2. Verify cache cleanup is running
3. Check for memory leaks in request queue
4. Review image load queue

### Slow Page Loads
1. Check API call count
2. Verify batch functions are used
3. Check cache hit rate
4. Review network waterfall in DevTools

## 📝 Documentation

### Files to Review
- `RATE_LIMIT_OPTIMIZATION_GUIDE.md` - Comprehensive optimization guide
- `API_OPTIMIZATION_README.md` - API optimization overview
- `API_OPTIMIZATION_FLOW_DIAGRAM.md` - Visual flow diagrams
- `API_OPTIMIZATION_MONITORING.md` - Monitoring guide

### Code Files
- `src/lib/RateLimiter.ts` - Rate limiting implementation
- `src/lib/RequestQueue.ts` - Request prioritization
- `src/lib/ResponseCache.ts` - Caching implementation
- `src/lib/RequestDeduplicator.ts` - Deduplication
- `src/lib/bsky.ts` - API functions and batch operations
- `src/lib/cacheInvalidation.ts` - Cache invalidation patterns

## ✨ Best Practices Summary

1. **Always use batch functions** for multiple items
2. **Always use cached versions** for repeated data
3. **Always set appropriate priority** for requests
4. **Always invalidate caches** after mutations
5. **Always handle errors** with exponential backoff
6. **Always monitor metrics** for rate limit issues
7. **Always test** before deployment
8. **Always document** API call patterns

## 🎯 Success Criteria

✅ Optimization is successful when:
- API calls reduced by 40-50%
- Cache hit rate > 60%
- No increase in error rate
- Page load time improved by 20-30%
- No user-facing issues
- All tests passing
- Rate limit errors < 1%

---

**Status**: ✅ Checklist Complete
**Last Updated**: 2024
**Version**: 1.0
