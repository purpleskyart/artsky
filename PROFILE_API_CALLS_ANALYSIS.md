# Profile Page API Calls Analysis

## Summary
When opening a user profile, the following API calls are made. This document helps you decide which to keep, reduce, or remove.

---

## API Calls Made on Profile Open

### 1. ✅ **ESSENTIAL - Profile Data** 
**Function:** `getProfileCached(handle, !session)`  
**Endpoint:** `app.bsky.actor.getProfile`  
**When:** Immediately when profile opens  
**Data:** Display name, avatar, bio, DID, following status, verification  
**Caching:** Yes (10 min TTL + 5 min stale-while-revalidate)  
**Status:** **KEEP** - Required to show profile header

---

### 2. ⚠️ **OPTIONAL - Notification Subscription Status**
**Function:** `listActivitySubscriptions()`  
**Endpoint:** Custom subscription endpoint  
**When:** After profile data loads (only for other users, not own profile)  
**Data:** Whether you have notifications enabled for this user  
**Caching:** No  
**Status:** **CONSIDER REMOVING** - Only shows bell icon state, not critical

**To Remove:** Comment out lines 256-263 in ProfilePage.tsx

---

### 3. ❌ **REMOVED - "Followed by" Preview**
**Function:** `getFolloweesWhoFollowTarget()` ~~(was limit: 30)~~  
**Endpoint:** `app.bsky.graph.getFollows` (multiple calls)  
**When:** After profile data loads  
**Data:** Shows "Followed by @user1, @user2 you follow"  
**Status:** **ALREADY REMOVED** ✓

---

### 4. ✅ **ESSENTIAL - Author Feed (Posts)**
**Function:** `readAgent.getAuthorFeed()`  
**Endpoint:** `app.bsky.feed.getAuthorFeed`  
**When:** Immediately when profile opens  
**Limit:** 30 posts  
**Data:** User's posts (with media, reposts, etc.)  
**Status:** **KEEP** - This is the main content

**Options to reduce:**
- Reduce limit from 30 to 15 or 20
- Only load on "Posts" tab (lazy load)

---

### 5. ⚠️ **CONDITIONAL - User Feeds List**
**Function:** `getActorFeeds(handle, 50)`  
**Endpoint:** `app.bsky.feed.getActorFeeds`  
**When:** Only when user clicks "Feeds" tab  
**Limit:** 50 feeds  
**Data:** Custom feeds created by this user  
**Status:** **ALREADY LAZY LOADED** - Only loads when tab is clicked

**Options to reduce:**
- Reduce limit from 50 to 20

---

### 6. ⚠️ **CONDITIONAL - Blog Posts**
**Function:** `listStandardSiteDocumentsForAuthor()`  
**Endpoint:** Custom blog endpoint  
**When:** Only when user clicks "Blog" tab  
**Data:** Blog posts/documents  
**Status:** **ALREADY LAZY LOADED** - Only loads when tab is clicked

---

### 7. ⚠️ **CONDITIONAL - Liked Posts**
**Function:** `agent.getActorLikes()`  
**Endpoint:** `app.bsky.feed.getActorLikes`  
**When:** Only when viewing own profile + "Liked" filter selected  
**Limit:** 30 posts  
**Data:** Posts you've liked  
**Status:** **ALREADY LAZY LOADED** - Only loads when filter is selected

---

## Current Status After Fixes

### Removed (1 call):
- ❌ `getFolloweesWhoFollowTarget()` - "Followed by X you follow" preview

### Always Called (2 calls):
1. ✅ `getProfileCached()` - Profile data (ESSENTIAL)
2. ✅ `getAuthorFeed()` - User's posts (ESSENTIAL)

### Conditionally Called (1 call):
- ⚠️ `listActivitySubscriptions()` - Notification bell status (OPTIONAL)

### Lazy Loaded (3 calls):
- `getActorFeeds()` - Only on "Feeds" tab
- `listStandardSiteDocumentsForAuthor()` - Only on "Blog" tab  
- `getActorLikes()` - Only on own profile + "Liked" filter

---

## Recommendations

### High Impact - Remove These:
1. **Notification subscription check** - Saves 1 API call per profile open
   - Most users don't use this feature
   - Can be loaded on-demand when clicking the bell icon

### Medium Impact - Reduce These:
1. **Author feed limit** - Change from 30 to 15 posts
   - Still shows plenty of content
   - Loads faster, uses less bandwidth
   - Infinite scroll will load more as needed

2. **Feeds list limit** - Change from 50 to 20 feeds
   - Most users have < 20 custom feeds
   - Only affects "Feeds" tab (already lazy loaded)

### Already Optimized:
- ✅ Profile data is cached (10 min TTL)
- ✅ Feeds/Blog/Liked are lazy loaded
- ✅ "Followed by" preview removed

---

## Code Locations

**File:** `src/pages/ProfilePage.tsx`

- **Lines 234-250:** Profile data fetch (KEEP)
- **Lines 252-263:** Notification subscription (REMOVE?)
- **Lines 265-269:** Followed by preview (ALREADY REMOVED)
- **Lines 271-284:** Author feed fetch (REDUCE LIMIT?)
- **Lines 286-297:** Feeds list (REDUCE LIMIT?)
- **Lines 299-312:** Blog posts (ALREADY LAZY)
- **Lines 314-329:** Liked posts (ALREADY LAZY)

---

## Next Steps

Choose which optimizations to apply:

```bash
# Option 1: Remove notification subscription check
# Edit lines 252-263 in src/pages/ProfilePage.tsx

# Option 2: Reduce author feed limit
# Change line 279: limit: 30 → limit: 15

# Option 3: Reduce feeds list limit  
# Change line 291: limit: 50 → limit: 20
```
