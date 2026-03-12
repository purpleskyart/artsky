# API Rate Limit Fix - Bugfix Design

## Overview

The application is experiencing HTTP 429 (Too Many Requests) errors from the Bluesky/ATProto API due to inefficient request patterns. Four critical issues have been identified:

1. **Uncached Profile Fetches**: Components like PostActionsMenu and ProfileActionsMenu call `agent.getProfile()` directly without leveraging the existing `getProfileCached()` function
2. **Sequential Profile Fetches**: Layout and PostDetailPage loop through session lists and fetch profiles one-by-one sequentially
3. **Missing Request Deduplication**: FeedPage uses `Promise.all()` with `getFeedDisplayName()` without deduplication, causing duplicate concurrent requests
4. **No Profile Batching**: Unlike posts (which have `getPostsBatch()`), profiles are fetched individually instead of batched

The fix will leverage existing infrastructure (RateLimiter, RequestDeduplicator, ResponseCache, getProfileCached) and introduce a new `getProfilesBatch()` function following the established `getPostsBatch()` pattern.

## Glossary

- **Bug_Condition (C)**: The condition that triggers rate limit errors - when components make uncached, sequential, or duplicate profile/feed API requests
- **Property (P)**: The desired behavior - all profile requests should use caching, batching, and deduplication to minimize API calls
- **Preservation**: Existing functionality (profile display, UI behavior, error handling) must remain unchanged
- **getProfileCached()**: Function in `src/lib/bsky.ts` that fetches profiles with 10-minute TTL + 5-minute stale-while-revalidate caching
- **getPostsBatch()**: Function in `src/lib/bsky.ts` that batches up to 25 post fetches per API call (pattern to replicate for profiles)
- **requestDeduplicator**: Utility in `src/lib/RequestDeduplicator.ts` that prevents duplicate concurrent requests
- **RateLimiter**: Utility in `src/lib/RateLimiter.ts` that tracks per-agent rate limits and handles Retry-After headers
- **ResponseCache**: Utility in `src/lib/ResponseCache.ts` that provides TTL-based caching with stale-while-revalidate support

## Bug Details

### Fault Condition

The bug manifests when components fetch profile or feed data using inefficient patterns that bypass existing caching and batching infrastructure. This causes excessive API requests that trigger rate limiting.

**Formal Specification:**
```
FUNCTION isBugCondition(request)
  INPUT: request of type APIRequest
  OUTPUT: boolean
  
  RETURN (request.type == 'profile' AND request.method == 'agent.getProfile' AND NOT request.usesCaching)
         OR (request.type == 'profile' AND request.pattern == 'sequential' AND request.count > 1)
         OR (request.type == 'feedDisplayName' AND request.pattern == 'concurrent' AND NOT request.usesDeduplication)
         OR (request.type == 'profile' AND request.count > 1 AND NOT request.usesBatching)
END FUNCTION
```

### Examples

**Issue 1: Uncached Profile Fetches**
- **Location**: `src/components/PostActionsMenu.tsx` line 191
- **Current**: `agent.getProfile({ actor: authorDid }).then(...)`
- **Problem**: Bypasses 10-minute cache, makes fresh API call every time menu opens
- **Expected**: Use `getProfileCached(authorDid)` to leverage existing cache

**Issue 2: Uncached Profile Fetches**
- **Location**: `src/components/ProfileActionsMenu.tsx` line 50
- **Current**: `client.getProfile({ actor: profileDid }).then(...)`
- **Problem**: Bypasses 10-minute cache, makes fresh API call every time menu opens
- **Expected**: Use `getProfileCached(profileDid, !getSession())` to leverage existing cache

**Issue 3: Sequential Profile Fetches**
- **Location**: `src/components/Layout.tsx` line 371
- **Current**: `sessionsList.forEach((s) => { publicAgent.getProfile({ actor: s.did }).then(...) })`
- **Problem**: Loops through sessions and fetches profiles one-by-one, creating burst of sequential requests
- **Expected**: Collect all DIDs, call `getProfilesBatch(dids)` once, then update state

**Issue 4: Sequential Profile Fetches**
- **Location**: `src/pages/PostDetailPage.tsx` line 81
- **Current**: `sessionsList.forEach((s) => { publicAgent.getProfile({ actor: s.did }).then(...) })`
- **Problem**: Same sequential loop pattern as Layout
- **Expected**: Use `getProfilesBatch(dids)` to fetch all profiles in one batched call

**Issue 5: Missing Request Deduplication**
- **Location**: `src/pages/FeedPage.tsx` line 472
- **Current**: `Promise.all(feeds.map(async (f) => { const label = await getFeedDisplayName(f.value) }))`
- **Problem**: If multiple feeds have same URI, makes duplicate concurrent requests
- **Expected**: Wrap `getFeedDisplayName()` calls with `requestDeduplicator.dedupe()`

**Issue 6: No Profile Batching**
- **Location**: `src/lib/bsky.ts` (missing function)
- **Problem**: No `getProfilesBatch()` function exists (unlike `getPostsBatch()`)
- **Expected**: Create `getProfilesBatch()` that batches up to 25 profiles per API call using `app.bsky.actor.getProfiles`

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Profile data display (avatar, handle, displayName) must remain identical
- UI rendering and component behavior must be unchanged
- Error handling and fallback behavior must continue to work
- Existing cache TTL (10 min + 5 min stale) must remain the same
- RateLimiter, RequestDeduplicator, and ResponseCache infrastructure must continue functioning as designed
- All other API calls (posts, feeds, notifications) must be unaffected

**Scope:**
All API requests that do NOT involve profile fetching or feed display name fetching should be completely unaffected by this fix. This includes:
- Post fetching (already uses `getPostsBatch()`)
- Feed content fetching
- Notification fetching
- Follow/block/mute operations
- Post creation and deletion

## Hypothesized Root Cause

Based on the bug description and code analysis, the root causes are:

1. **Inconsistent Use of Caching Infrastructure**: The `getProfileCached()` function exists but is not consistently used across components. Developers are calling `agent.getProfile()` directly, bypassing the cache.

2. **Lack of Batching Function**: Unlike posts (which have `getPostsBatch()`), there is no `getProfilesBatch()` function. This forces developers to fetch profiles individually in loops.

3. **Missing Deduplication Pattern**: The `requestDeduplicator` utility exists but is not applied to `getFeedDisplayName()` calls, allowing duplicate concurrent requests.

4. **Sequential Loop Pattern**: Components use `forEach` loops to fetch profiles, creating sequential request waterfalls instead of parallel batched requests.

## Correctness Properties

Property 1: Fault Condition - Profile Requests Use Caching and Batching

_For any_ profile fetch request where the bug condition holds (uncached, sequential, or unbatched profile requests), the fixed code SHALL use `getProfileCached()` for single profiles or `getProfilesBatch()` for multiple profiles, ensuring all requests leverage caching and batching infrastructure to minimize API calls.

**Validates: Requirements 2.1, 2.2, 2.4**

Property 2: Fault Condition - Feed Display Name Requests Use Deduplication

_For any_ feed display name fetch request where duplicate concurrent requests occur, the fixed code SHALL use `requestDeduplicator.dedupe()` to ensure only one actual API call is made per unique feed URI.

**Validates: Requirements 2.3**

Property 3: Preservation - Profile Data Display

_For any_ profile fetch request where the bug condition does NOT hold (already using proper patterns), the fixed code SHALL produce exactly the same profile data (avatar, handle, displayName) as the original code, preserving all existing display behavior.

**Validates: Requirements 3.2, 3.5, 3.6**

Property 4: Preservation - Infrastructure Behavior

_For any_ API request using RateLimiter, RequestDeduplicator, or ResponseCache, the fixed code SHALL produce exactly the same behavior as the original code, preserving per-agent tracking, Retry-After support, and cache TTL behavior.

**Validates: Requirements 3.1, 3.3, 3.4**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File 1**: `src/lib/bsky.ts`

**Function**: New `getProfilesBatch()` function

**Specific Changes**:
1. **Add Profile Batching Function**: Create `getProfilesBatch(actors: string[]): Promise<Map<string, ProfileView>>` following the `getPostsBatch()` pattern
   - Accept array of actor identifiers (DIDs or handles)
   - Use `app.bsky.actor.getProfiles` API endpoint
   - Batch up to 25 profiles per API call (API limit)
   - Return Map<actor, profile> for easy lookup
   - Handle errors gracefully (log warning, continue with partial results)
   - Use appropriate client (authenticated agent or publicAgent)

2. **Export New Function**: Add `getProfilesBatch` to module exports

**File 2**: `src/components/PostActionsMenu.tsx`

**Function**: `useEffect` hook (line 191)

**Specific Changes**:
1. **Replace Direct API Call**: Change `agent.getProfile({ actor: authorDid })` to `getProfileCached(authorDid)`
2. **Import Function**: Add `getProfileCached` to imports from `../lib/bsky`
3. **Maintain Error Handling**: Keep existing try-catch and cancellation logic

**File 3**: `src/components/ProfileActionsMenu.tsx`

**Function**: `useEffect` hook (line 50)

**Specific Changes**:
1. **Replace Direct API Call**: Change `client.getProfile({ actor: profileDid })` to `getProfileCached(profileDid, !getSession())`
2. **Import Function**: Add `getProfileCached` to imports from `../lib/bsky`
3. **Pass usePublic Parameter**: Use `!getSession()` to determine if public agent should be used
4. **Maintain Error Handling**: Keep existing try-catch and cancellation logic

**File 4**: `src/components/Layout.tsx`

**Function**: `useEffect` hook for account profiles (line 370)

**Specific Changes**:
1. **Replace Sequential Loop**: Remove `sessionsList.forEach((s) => { publicAgent.getProfile(...) })` pattern
2. **Collect DIDs**: Extract all DIDs from sessionsList: `const dids = sessionsList.map(s => s.did)`
3. **Batch Fetch**: Call `getProfilesBatch(dids)` once to fetch all profiles
4. **Update State**: Map results to `accountProfiles` state object
5. **Import Function**: Add `getProfilesBatch` to imports from `../lib/bsky`
6. **Maintain Cancellation**: Keep existing cancellation logic with `cancelled` flag

**File 5**: `src/pages/PostDetailPage.tsx`

**Function**: `useEffect` hook for account profiles (line 81)

**Specific Changes**:
1. **Replace Sequential Loop**: Remove `sessionsList.forEach((s) => { publicAgent.getProfile(...) })` pattern
2. **Collect DIDs**: Extract all DIDs from sessionsList: `const dids = sessionsList.map(s => s.did)`
3. **Batch Fetch**: Call `getProfilesBatch(dids)` once to fetch all profiles
4. **Update State**: Map results to `accountProfiles` state object
5. **Import Function**: Add `getProfilesBatch` to imports from `../lib/bsky`
6. **Maintain Cancellation**: Keep existing cancellation logic with `cancelled` flag

**File 6**: `src/pages/FeedPage.tsx`

**Function**: Feed display name fetching (line 472)

**Specific Changes**:
1. **Wrap with Deduplication**: Change `await getFeedDisplayName(f.value)` to `await requestDeduplicator.dedupe(\`feed-name:\${f.value}\`, () => getFeedDisplayName(f.value))`
2. **Import Utility**: Add `requestDeduplicator` to imports from `../lib/RequestDeduplicator`
3. **Maintain Error Handling**: Keep existing try-catch logic

**File 7**: `src/components/Layout.tsx`

**Function**: Multiple `getFeedDisplayName()` calls (lines 687, 722, 1670, 1738, 1932, 2109)

**Specific Changes**:
1. **Wrap with Deduplication**: For each `getFeedDisplayName(uri)` call, wrap with `requestDeduplicator.dedupe(\`feed-name:\${uri}\`, () => getFeedDisplayName(uri))`
2. **Import Utility**: Add `requestDeduplicator` to imports from `../lib/RequestDeduplicator`
3. **Maintain Error Handling**: Keep existing `.catch()` fallback logic

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code (excessive API calls, rate limit errors), then verify the fix works correctly (reduced API calls, no rate limits) and preserves existing behavior (same profile data displayed).

### Exploratory Fault Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that monitor API call patterns and rate limit responses. Run these tests on the UNFIXED code to observe failures and understand the root cause.

**Test Cases**:
1. **Uncached Profile Menu Test**: Open PostActionsMenu multiple times for same author, monitor API calls (will show redundant calls on unfixed code)
2. **Sequential Profile Fetch Test**: Load Layout with 5 sessions, monitor API call timing (will show sequential waterfall on unfixed code)
3. **Duplicate Feed Name Test**: Load FeedPage with duplicate feed URIs, monitor concurrent requests (will show duplicate calls on unfixed code)
4. **Rate Limit Trigger Test**: Perform rapid profile fetches, monitor for HTTP 429 responses (will trigger rate limits on unfixed code)

**Expected Counterexamples**:
- PostActionsMenu makes fresh API call every time menu opens (no cache hit)
- Layout makes 5 sequential profile API calls instead of 1 batched call
- FeedPage makes duplicate concurrent requests for same feed URI
- Rapid profile fetching triggers HTTP 429 rate limit errors
- Possible causes: missing cache usage, missing batching, missing deduplication, sequential loops

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL request WHERE isBugCondition(request) DO
  result := handleRequest_fixed(request)
  ASSERT result.usesCache OR result.usesBatching OR result.usesDeduplication
  ASSERT result.apiCallCount < originalApiCallCount
  ASSERT NOT result.triggersRateLimit
END FOR
```

**Test Cases**:
1. **Cache Hit Test**: Open PostActionsMenu twice for same author, verify second call uses cache (no API call)
2. **Batch Fetch Test**: Load Layout with 5 sessions, verify single batched API call instead of 5 sequential calls
3. **Deduplication Test**: Load FeedPage with duplicate feed URIs, verify only one API call per unique URI
4. **Rate Limit Prevention Test**: Perform rapid profile fetches, verify no HTTP 429 responses
5. **Profile Data Correctness Test**: Verify all profile data (avatar, handle, displayName) matches expected values

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL request WHERE NOT isBugCondition(request) DO
  ASSERT handleRequest_original(request) = handleRequest_fixed(request)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for non-profile requests, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Profile Display Preservation**: Verify profile avatars, handles, and display names render identically after fix
2. **Post Fetching Preservation**: Verify `getPostsBatch()` continues to work unchanged
3. **Feed Content Preservation**: Verify feed content fetching continues to work unchanged
4. **Error Handling Preservation**: Verify error states (network errors, invalid actors) are handled identically
5. **Cache TTL Preservation**: Verify cache expiration (10 min + 5 min stale) works identically
6. **RateLimiter Preservation**: Verify rate limit tracking and Retry-After handling works identically

### Unit Tests

- Test `getProfilesBatch()` with various input sizes (0, 1, 25, 50, 100 profiles)
- Test `getProfilesBatch()` error handling (invalid actors, network errors)
- Test `getProfileCached()` cache hit/miss behavior
- Test `requestDeduplicator.dedupe()` with concurrent identical requests
- Test component behavior with mocked profile data
- Test edge cases (empty session lists, missing profile data)

### Property-Based Tests

- Generate random session lists and verify batched profile fetching works correctly
- Generate random feed URI lists and verify deduplication prevents duplicate requests
- Generate random profile data and verify display preservation across many scenarios
- Test that cache TTL behavior is preserved across many cache operations
- Test that rate limiter behavior is preserved across many API call patterns

### Integration Tests

- Test full user flow: login → view profile → open menu → verify cached profile used
- Test account switcher flow: switch accounts → verify batched profile fetch for session list
- Test feed management flow: add feeds → verify deduplicated display name fetches
- Test rapid interaction flow: quickly open multiple menus → verify no rate limit errors
- Test cache expiration flow: wait for cache expiry → verify revalidation works correctly


## Architecture Overview

### Current Architecture (Problematic)

```
Component Layer:
┌─────────────────────┐  ┌──────────────────────┐  ┌─────────────┐
│ PostActionsMenu     │  │ ProfileActionsMenu   │  │ Layout      │
│ agent.getProfile()  │  │ client.getProfile()  │  │ forEach loop│
└──────────┬──────────┘  └──────────┬───────────┘  └──────┬──────┘
           │                        │                      │
           │ Direct API Call        │ Direct API Call      │ Sequential Calls
           │ (no cache)             │ (no cache)           │ (no batching)
           ▼                        ▼                      ▼
┌────────────────────────────────────────────────────────────────┐
│                    Bluesky/ATProto API                         │
│  Result: Redundant requests → Rate limit errors (HTTP 429)    │
└────────────────────────────────────────────────────────────────┘
```

### Fixed Architecture (Optimized)

```
Component Layer:
┌─────────────────────┐  ┌──────────────────────┐  ┌─────────────┐
│ PostActionsMenu     │  │ ProfileActionsMenu   │  │ Layout      │
│ getProfileCached()  │  │ getProfileCached()   │  │ batch DIDs  │
└──────────┬──────────┘  └──────────┬───────────┘  └──────┬──────┘
           │                        │                      │
           │                        │                      │
           ▼                        ▼                      ▼
┌────────────────────────────────────────────────────────────────┐
│                    Caching & Batching Layer                    │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │ getProfileCached │  │ getProfilesBatch │  │ dedupe()     │ │
│  │ (10min TTL)      │  │ (25 per call)    │  │ (concurrent) │ │
│  └────────┬─────────┘  └────────┬─────────┘  └──────┬───────┘ │
└───────────┼────────────────────┼────────────────────┼─────────┘
            │                    │                    │
            │ Cache miss         │ Batched request    │ Single request
            ▼                    ▼                    ▼
┌────────────────────────────────────────────────────────────────┐
│                    Bluesky/ATProto API                         │
│  Result: Minimal requests → No rate limit errors              │
└────────────────────────────────────────────────────────────────┘
```

### Data Flow Diagrams

#### Flow 1: Single Profile Fetch (PostActionsMenu, ProfileActionsMenu)

**Before Fix:**
```
User opens menu
    ↓
Component calls agent.getProfile(authorDid)
    ↓
Direct API call to Bluesky
    ↓
Profile data returned
    ↓
Component renders
    
Problem: Every menu open = new API call (no caching)
```

**After Fix:**
```
User opens menu
    ↓
Component calls getProfileCached(authorDid)
    ↓
Check ResponseCache
    ├─ Cache HIT (< 10 min) → Return cached data immediately
    │                          (Background revalidation if stale)
    └─ Cache MISS → API call to Bluesky
                    ↓
                    Cache result (10 min TTL + 5 min stale)
                    ↓
                    Return profile data
    ↓
Component renders

Benefit: Subsequent opens within 10 min = instant (no API call)
```

#### Flow 2: Multiple Profile Fetch (Layout, PostDetailPage)

**Before Fix:**
```
Component loads with sessionsList = [did1, did2, did3, did4, did5]
    ↓
forEach loop starts
    ↓
Call 1: publicAgent.getProfile(did1) → Wait for response
    ↓
Call 2: publicAgent.getProfile(did2) → Wait for response
    ↓
Call 3: publicAgent.getProfile(did3) → Wait for response
    ↓
Call 4: publicAgent.getProfile(did4) → Wait for response
    ↓
Call 5: publicAgent.getProfile(did5) → Wait for response
    ↓
All profiles loaded (sequential waterfall)

Problem: 5 sequential API calls = slow + rate limit risk
```

**After Fix:**
```
Component loads with sessionsList = [did1, did2, did3, did4, did5]
    ↓
Extract DIDs: const dids = sessionsList.map(s => s.did)
    ↓
Call getProfilesBatch(dids)
    ↓
Batch into chunks of 25 (API limit)
    ├─ Batch 1: [did1, did2, did3, did4, did5]
    │   ↓
    │   Single API call: app.bsky.actor.getProfiles({ actors: [...] })
    │   ↓
    │   Return Map<did, profile>
    ↓
All profiles loaded (single batched call)

Benefit: 1 API call instead of 5 = 5x faster + no rate limit risk
```

#### Flow 3: Feed Display Name Fetch (FeedPage, Layout)

**Before Fix:**
```
Component has feeds = [
  { value: 'at://did:plc:abc/feed1' },
  { value: 'at://did:plc:abc/feed1' },  // duplicate
  { value: 'at://did:plc:xyz/feed2' }
]
    ↓
Promise.all(feeds.map(f => getFeedDisplayName(f.value)))
    ↓
Concurrent calls:
    ├─ Call 1: getFeedDisplayName('at://did:plc:abc/feed1')
    ├─ Call 2: getFeedDisplayName('at://did:plc:abc/feed1')  // duplicate!
    └─ Call 3: getFeedDisplayName('at://did:plc:xyz/feed2')
    ↓
3 API calls made (2 are duplicates)

Problem: Duplicate concurrent requests waste API quota
```

**After Fix:**
```
Component has feeds = [
  { value: 'at://did:plc:abc/feed1' },
  { value: 'at://did:plc:abc/feed1' },  // duplicate
  { value: 'at://did:plc:xyz/feed2' }
]
    ↓
Promise.all(feeds.map(f => 
  requestDeduplicator.dedupe(`feed-name:${f.value}`, () => getFeedDisplayName(f.value))
))
    ↓
Deduplication layer:
    ├─ Call 1: getFeedDisplayName('at://did:plc:abc/feed1') → Make API call
    ├─ Call 2: Same key detected → Wait for Call 1 result (no API call)
    └─ Call 3: getFeedDisplayName('at://did:plc:xyz/feed2') → Make API call
    ↓
2 API calls made (duplicate eliminated)

Benefit: Duplicate requests share single API call result
```

### API Function Signatures

#### New Function: getProfilesBatch

```typescript
/**
 * Batch fetch profiles using app.bsky.actor.getProfiles (up to 25 profiles per call)
 * More efficient than calling getProfile individually for each actor
 * 
 * @param actors - Array of actor identifiers (DIDs or handles)
 * @param usePublic - Whether to use public agent (default: false, uses authenticated agent if available)
 * @returns Map of actor identifier to profile data
 * 
 * @example
 * const profiles = await getProfilesBatch(['did:plc:abc123', 'did:plc:xyz789'])
 * const profile1 = profiles.get('did:plc:abc123')
 * console.log(profile1?.displayName, profile1?.avatar)
 */
export async function getProfilesBatch(
  actors: string[],
  usePublic = false
): Promise<Map<string, { handle?: string; displayName?: string; avatar?: string; did?: string }>>
```

**Implementation Pattern** (following getPostsBatch):
```typescript
export async function getProfilesBatch(
  actors: string[],
  usePublic = false
): Promise<Map<string, { handle?: string; displayName?: string; avatar?: string; did?: string }>> {
  if (actors.length === 0) return new Map()
  
  const result = new Map<string, { handle?: string; displayName?: string; avatar?: string; did?: string }>()
  const client = usePublic ? publicAgent : (getSession() ? agent : publicAgent)
  
  // Split into batches of 25 (API limit)
  const batches: string[][] = []
  for (let i = 0; i < actors.length; i += 25) {
    batches.push(actors.slice(i, i + 25))
  }
  
  // Fetch all batches in parallel
  await Promise.all(
    batches.map(async (batch) => {
      try {
        const res = await client.app.bsky.actor.getProfiles({ actors: batch })
        const profiles = res.data.profiles || []
        for (const profile of profiles) {
          result.set(profile.did, {
            handle: profile.handle,
            displayName: profile.displayName,
            avatar: profile.avatar,
            did: profile.did
          })
        }
      } catch (error) {
        console.warn('Failed to fetch profile batch:', error)
      }
    })
  )
  
  return result
}
```

#### Modified Usage: getProfileCached

**Current Signature** (unchanged):
```typescript
export async function getProfileCached(
  actor: string,
  usePublic = false
): Promise<{ handle?: string; displayName?: string; avatar?: string; did?: string }>
```

**New Usage in Components**:
```typescript
// PostActionsMenu.tsx - Before
agent.getProfile({ actor: authorDid }).then((res) => {
  const data = res.data as { viewer?: { blocking?: string }; handle?: string }
  // ...
})

// PostActionsMenu.tsx - After
getProfileCached(authorDid).then((data) => {
  // Note: viewer data (blocking status) requires fresh fetch
  // Need to call agent.getProfile for viewer-specific data
  // But basic profile data (handle, avatar) can use cache
})
```

#### Modified Usage: requestDeduplicator.dedupe

**Signature** (from RequestDeduplicator.ts):
```typescript
dedupe<T>(key: string, fn: () => Promise<T>): Promise<T>
```

**New Usage in Components**:
```typescript
// FeedPage.tsx - Before
const label = await getFeedDisplayName(f.value)

// FeedPage.tsx - After
const label = await requestDeduplicator.dedupe(
  `feed-name:${f.value}`,
  () => getFeedDisplayName(f.value)
)
```

### Error Handling Strategy

#### Principle: Graceful Degradation

All fixes must maintain existing error handling behavior while adding resilience:

1. **Cache Failures**: If cache read/write fails, fall back to direct API call
2. **Batch Failures**: If batch fetch fails, log warning and return partial results (don't throw)
3. **Deduplication Failures**: If deduplication fails, fall back to direct call
4. **Network Errors**: Maintain existing retry logic (retryWithBackoff)
5. **Rate Limit Errors**: Let RateLimiter handle 429 responses with backoff

#### Error Handling in getProfilesBatch

```typescript
// Individual batch failures don't fail entire operation
await Promise.all(
  batches.map(async (batch) => {
    try {
      const res = await client.app.bsky.actor.getProfiles({ actors: batch })
      // Process results...
    } catch (error) {
      console.warn('Failed to fetch profile batch:', error)
      // Continue with other batches - don't throw
    }
  })
)
```

#### Error Handling in Component Updates

```typescript
// Layout.tsx - Maintain existing error handling
try {
  const profiles = await getProfilesBatch(dids)
  if (cancelled) return
  
  const updated = { ...accountProfiles }
  for (const [did, profile] of profiles.entries()) {
    updated[did] = { avatar: profile.avatar, handle: profile.handle }
  }
  setAccountProfiles(updated)
} catch (error) {
  // Log error but don't break UI
  console.warn('Failed to fetch account profiles:', error)
}
```

### Performance Metrics

#### Expected Improvements

**Scenario 1: Opening PostActionsMenu 10 times for same author**
- Before: 10 API calls
- After: 1 API call (9 cache hits)
- Improvement: 90% reduction

**Scenario 2: Loading Layout with 5 sessions**
- Before: 5 sequential API calls (~500ms total with network latency)
- After: 1 batched API call (~100ms)
- Improvement: 80% faster, 80% fewer API calls

**Scenario 3: Loading FeedPage with 10 feeds (3 duplicates)**
- Before: 10 concurrent API calls
- After: 7 concurrent API calls (3 deduplicated)
- Improvement: 30% reduction

**Scenario 4: Rapid user interactions (20 profile views in 1 minute)**
- Before: 20 API calls → likely triggers rate limit (HTTP 429)
- After: ~5 API calls (15 cache hits) → no rate limit
- Improvement: 75% reduction, no rate limit errors

### Migration Path

#### Phase 1: Add Infrastructure (Low Risk)
1. Add `getProfilesBatch()` function to bsky.ts
2. Add unit tests for new function
3. Deploy (no behavior change yet)

#### Phase 2: Fix Uncached Calls (Medium Risk)
1. Update PostActionsMenu to use getProfileCached
2. Update ProfileActionsMenu to use getProfileCached
3. Test in staging environment
4. Deploy and monitor

#### Phase 3: Fix Sequential Calls (Medium Risk)
1. Update Layout to use getProfilesBatch
2. Update PostDetailPage to use getProfilesBatch
3. Test in staging environment
4. Deploy and monitor

#### Phase 4: Add Deduplication (Low Risk)
1. Update FeedPage to use requestDeduplicator
2. Update Layout feed name calls to use requestDeduplicator
3. Test in staging environment
4. Deploy and monitor

#### Rollback Strategy
- Each phase is independent and can be rolled back separately
- If issues arise, revert specific component changes while keeping infrastructure
- Monitor rate limit errors and API call metrics to validate improvements
