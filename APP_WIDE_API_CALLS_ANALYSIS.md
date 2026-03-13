# App-Wide API Calls Analysis

## Overview
This document analyzes ALL API calls made throughout the application to identify optimization opportunities.

---

## 1. Feed Page (Main Timeline)

### Initial Load
**File:** `src/pages/FeedPage.tsx`

#### API Calls:
1. **Timeline/Custom Feed** - `agent.getTimeline()` or `agent.app.bsky.feed.getFeed()`
   - **Limit:** 30 posts per feed
   - **When:** On page load
   - **Frequency:** Once per feed source
   - **Caching:** Yes (via apiRequestManager)
   - **Status:** ✅ Optimized

2. **Feed Display Names Batch** - `getFeedDisplayNamesBatch()`
   - **When:** When loading saved feeds list
   - **Batching:** Yes (fetches all feed names in one call)
   - **Status:** ✅ Already batched

3. **Mixed Feed Mode** - Multiple feed calls when mixing feeds
   - **When:** User has multiple feeds selected in mix mode
   - **Limit:** 30 posts per feed
   - **Status:** ⚠️ Can make 2-3+ API calls if mixing multiple feeds

### Recommendations:
- **Consider:** Reduce timeline limit from 30 to 20 posts
- **Consider:** Limit mixed feed mode to max 2 feeds at once

---

## 2. Post Detail Page

### Initial Load
**File:** `src/pages/PostDetailPage.tsx`

#### API Calls:
1. **Post Thread** - `getPostThreadCached()`
   - **Endpoint:** `app.bsky.feed.getPostThread`
   - **When:** Opening any post
   - **Data:** Post + parent + replies
   - **Caching:** Yes (10 min TTL)
   - **Status:** ✅ Cached

2. **Profile Batch for Account Switcher** - `getProfilesBatch()`
   - **When:** User has multiple accounts
   - **Limit:** Number of accounts (typically 1-3)
   - **Batching:** Yes (single API call for all accounts)
   - **Status:** ✅ Already batched

3. **Downvote Counts** - `getDownvoteCounts()` (Constellation)
   - **When:** Post detail loads
   - **External API:** Yes (not Bluesky)
   - **Status:** ⚠️ Optional feature

4. **Reply As Profile** - `getProfileCached()`
   - **When:** Opening reply composer
   - **Caching:** Yes
   - **Status:** ✅ Cached

### Recommendations:
- **Consider:** Make downvote counts lazy-loaded (only fetch when user scrolls to actions)
- **Keep:** Thread caching is working well

---

## 3. Profile Page

### Initial Load
**File:** `src/pages/ProfilePage.tsx`

#### API Calls (Already Analyzed):
1. ✅ Profile data - `getProfileCached()` - KEEP
2. ❌ Notification subscription - `listActivitySubscriptions()` - OPTIONAL
3. ❌ "Followed by" preview - ALREADY REMOVED
4. ✅ Author feed - `getAuthorFeed()` (limit: 30) - REDUCE TO 15-20?

### Status: See PROFILE_API_CALLS_ANALYSIS.md

---

## 4. Tag Page

### Initial Load
**File:** `src/pages/TagPage.tsx`

#### API Calls:
1. **Search Posts by Tag** - `searchPostsByTag()`
   - **Endpoint:** `app.bsky.feed.searchPosts`
   - **When:** Opening a tag page
   - **Limit:** Not explicitly set (likely 25-50)
   - **Caching:** No
   - **Status:** ⚠️ No limit specified, no caching

### Recommendations:
- **Add:** Explicit limit (e.g., 20 posts)
- **Add:** Response caching (5 min TTL)

---

## 5. Follow List Modal

### Initial Load
**File:** `src/components/FollowListModal.tsx`

#### API Calls:
1. **Followers List** - `getFollowers()`
   - **Limit:** 50 per page
   - **When:** Clicking "Followers" button
   - **Pagination:** Yes
   - **Status:** ⚠️ High limit

2. **Following List** - `getFollowsList()`
   - **Limit:** 50 per page
   - **When:** Clicking "Following" button
   - **Pagination:** Yes
   - **Status:** ⚠️ High limit

3. **Mutuals List** - `getMutualsList()`
   - **When:** Clicking "Mutuals" button
   - **Fetches:** All mutuals at once
   - **Status:** ⚠️ No pagination

4. **Followed By Follows** - `getFolloweesWhoFollowTarget()`
   - **When:** Clicking "Followed by X you follow" button
   - **Fetches:** All at once
   - **Status:** ⚠️ No pagination

### Recommendations:
- **Reduce:** Followers/Following page size from 50 to 25
- **Add:** Pagination for Mutuals and FollowedByFollows

---

## 6. Layout / Navigation

### On Mount
**File:** `src/components/Layout.tsx`

#### API Calls:
1. **Account Profiles Batch** - `getProfilesBatch()`
   - **When:** User has multiple accounts
   - **Limit:** Number of accounts
   - **Batching:** Yes
   - **Status:** ✅ Already batched

2. **Saved Feeds from Preferences** - `getSavedFeedsFromPreferences()`
   - **When:** On app load
   - **Caching:** Yes
   - **Status:** ✅ Cached

### Status: ✅ Well optimized

---

## 7. Forum Pages

### Forum List Page
**File:** `src/pages/ForumPage.tsx`

#### API Calls:
1. **User Profile for Reply** - `getProfileCached()`
   - **When:** Opening reply composer
   - **Caching:** Yes
   - **Status:** ✅ Cached

### Forum Post Detail
**File:** `src/pages/ForumPostDetailPage.tsx`

#### API Calls:
1. **Forum Post Detail** - Custom endpoint
2. **User Profile for Reply** - `getProfileCached()`
   - **Caching:** Yes
   - **Status:** ✅ Cached

---

## 8. Search Modal

### Initial Load
**File:** `src/components/SearchModal.tsx`

#### API Calls:
1. **Search Posts** - `searchPostsByTag()` or similar
   - **When:** User types and submits search
   - **Limit:** Unknown
   - **Caching:** No
   - **Status:** ⚠️ Check limit

---

## 9. Edit Profile Modal

### Initial Load
**File:** `src/components/EditProfileModal.tsx`

#### API Calls:
1. **Get Current Profile** - `getProfileCached()`
   - **When:** Opening edit modal
   - **Caching:** Yes
   - **Status:** ✅ Cached

2. **Update Profile** - `agent.updateHandle()` / `agent.upsertProfile()`
   - **When:** Saving changes
   - **Status:** ✅ Necessary

---

## Summary of Issues Found

### 🔴 High Priority - Excessive Calls

1. **Mixed Feed Mode** (FeedPage)
   - Makes 2-3+ API calls when mixing feeds
   - **Fix:** Limit to max 2 feeds in mix mode

2. **Follow Lists** (FollowListModal)
   - Page size of 50 is high
   - **Fix:** Reduce to 25

3. **Tag Search** (TagPage)
   - No explicit limit
   - No caching
   - **Fix:** Add limit of 20, add 5-min cache

### 🟡 Medium Priority - Could Be Optimized

4. **Profile Page** (Already addressed)
   - Notification subscription check
   - Author feed limit of 30
   - **Fix:** Remove notification check, reduce feed to 15-20

5. **Timeline Limit** (FeedPage)
   - Limit of 30 posts
   - **Fix:** Reduce to 20

6. **Downvote Counts** (PostDetailPage)
   - Fetched immediately on post open
   - **Fix:** Lazy load when scrolling to actions

### ✅ Already Optimized

- Profile batching (getProfilesBatch)
- Profile caching (getProfileCached)
- Thread caching (getPostThreadCached)
- Feed display name batching
- Account switcher batching

---

## Recommended Action Plan

### Phase 1: Quick Wins (Reduce Limits)
```typescript
// 1. FeedPage.tsx - Reduce timeline limit
const limit = 20 // was 30

// 2. ProfilePage.tsx - Reduce author feed limit
limit: 20 // was 30

// 3. FollowListModal.tsx - Reduce page size
const PAGE_SIZE = 25 // was 50

// 4. TagPage.tsx - Add explicit limit
const TAG_SEARCH_LIMIT = 20
```

### Phase 2: Add Caching
```typescript
// 5. TagPage.tsx - Add response caching
// Use apiRequestManager with 5-min TTL

// 6. SearchModal.tsx - Add response caching
// Use apiRequestManager with 5-min TTL
```

### Phase 3: Lazy Loading
```typescript
// 7. PostDetailPage.tsx - Lazy load downvote counts
// Only fetch when user scrolls to action buttons

// 8. ProfilePage.tsx - Remove notification subscription check
// Or make it lazy-loaded on bell icon hover
```

### Phase 4: Limit Concurrent Requests
```typescript
// 9. FeedPage.tsx - Limit mixed feed mode
// Max 2 feeds at once in mix mode
```

---

## Estimated Impact

### Current State (Profile Open Example):
- Profile page: 2-3 API calls
- With notification check: +1 call
- With "followed by": +1 call (REMOVED ✓)

### After All Optimizations:
- Profile page: 2 API calls (profile + feed)
- Feed page: 1-2 calls (down from 2-3 in mix mode)
- Tag page: 1 call with caching
- Follow lists: 50% less data per page

### Total Reduction:
- **~30-40% fewer API calls** across the app
- **~40-50% less data transferred** per page load
- **Faster load times** due to smaller payloads
