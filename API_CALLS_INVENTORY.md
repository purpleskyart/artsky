# API Calls Inventory (Most → Least)

Everything in the app that performs API/network calls, ordered from **highest to lowest** call volume per typical invocation or user action. *Updated after removing heavy mutuals, suggested-follows, and forum-replies implementations.*

---

## 1. **getFeedDisplayNamesBatch**

- **Where:** `src/lib/bsky.ts`; called from **Layout** and **FeedPage** when loading saved feed list.
- **Calls:** **N × app.bsky.feed.getFeedGenerator** for N uncached feed URIs (Promise.all per URI). With 8 saved feeds = **up to 8 calls** (then cached).
- **Trigger:** Opening app or feed selector when logged in.

---

## 2. **getMixedFeed** (main feed)

- **Where:** `src/lib/bsky.ts`; called from **FeedPage**.
- **Calls:** **1 call per feed source** (getTimeline or getFeed per mix entry). 1 timeline + 4 custom feeds = **up to 5 calls** (cached 5 min).
- **Trigger:** Loading or refreshing main feed.

---

## 3. **FeedPage** (initial load when logged in)

- **Where:** `src/pages/FeedPage.tsx`.
- **Calls:** **getSavedFeedsFromPreferences** (1) + **getFeedDisplayNamesBatch**(saved feed URIs) + **getMixedFeed**(sources) = **1 + N feed names + 1 per feed source**.
- **Trigger:** Opening feed tab.

---

## 4. **Layout** (session load / feed selector)

- **Where:** `src/components/Layout.tsx`.
- **Calls:** **getSavedFeedsFromPreferences**, **getFeedDisplayNamesBatch**, **getNotifications**, **getUnreadNotificationCount**, **getFeedDisplayName** (per feed when adding/resolving), **getProfilesBatch** (notification authors), **resolveFeedUri** (when adding feed).
- **Trigger:** App load, opening feed dropdown, opening notifications, adding a feed.

---

## 5. **listBlockedAccounts** (Blocked & Muted modal)

- **Where:** `src/lib/bsky.ts`; called from **BlockedAndMutedModal**.
- **Calls:** **1 listRecords** (blocks) + **getProfilesBatch(dids)** = **1 + ceil(N/25)** (batched profiles).
- **Trigger:** Opening Blocked & Muted modal.

---

## 6. **BlockedAndMutedModal** (open modal)

- **Where:** `src/components/BlockedAndMutedModal.tsx`.
- **Calls:** **listBlockedAccounts** + **listMutedAccounts** (1 getMutes) + **getMutedWords** (1 getPreferences) = **3** top-level; listBlockedAccounts does batch profiles.
- **Trigger:** Opening Blocked & Muted from settings.

---

## 7. **listStandardSiteDocumentsForAuthor** (profile blog tab)

- **Where:** `src/lib/bsky.ts`; called from **ProfilePage** (blog tab).
- **Calls:** **1 listRecords** (site.standard.document) + **1 getStandardSitePublicationBaseUrl** (listRecords for publication) = **2**.
- **Trigger:** Opening profile and switching to blog tab, or loading more.

---

## 8. **getStandardSiteDocument** (single doc)

- **Where:** `src/lib/bsky.ts`; called from **ForumPostDetailPage** and internally (e.g. after creating/updating a doc).
- **Calls:** **1 getRecord** + **1 getStandardSitePublicationBaseUrl** (listRecords) + **1 getProfile** = **3**.
- **Trigger:** Opening a forum post (standard.site document) detail page.

---

## 9. **FollowListModal** (followers / following)

- **Where:** `src/components/FollowListModal.tsx`.
- **Calls:** For **followers** or **following**: **getFollowers** or **getFollowsList** with limit 25 = **1 call per page**. For **mutuals** or **followed by X you follow**: **0** (empty list; heavy APIs removed).
- **Trigger:** Clicking Followers/Following on a profile; Mutuals/Followed-by-X show empty.

---

## 10. **PostDetailPage** (open thread)

- **Where:** `src/pages/PostDetailPage.tsx`.
- **Calls:** **getPostThreadCached** (1 getPostThread) + **getProfilesBatch**(reply authors) = **1 + 1 batch**. Plus **getProfileCached** for reply-as row; **listMyDownvotes** when needed.
- **Trigger:** Opening a post thread.

---

## 11. **searchPostsByPhraseAndTags** (Search modal)

- **Where:** `src/lib/bsky.ts`; called from **SearchModal**.
- **Calls:** **2× searchPosts** in parallel (phrase + tags).
- **Trigger:** Searching from search modal.

---

## 12. **ProfilePage** (open profile)

- **Where:** `src/pages/ProfilePage.tsx`.
- **Calls:** **getProfileCached** (1) + **getActorFeeds** (1 public fetch) + **listStandardSiteDocumentsForAuthor** (2 when blog tab) + **listActivitySubscriptions** (1) = **up to 5**.
- **Trigger:** Opening a profile.

---

## 13. **resolveFeedUri** (adding feed by URL)

- **Where:** `src/lib/bsky.ts`; called from **Layout** when user adds feed by URL.
- **Calls:** **1–2 getFeedGenerator** + **1 getProfile** (if bsky.app URL form).
- **Trigger:** Adding a custom feed by paste/link.

---

## 14. **listForumPosts** (Forum Artsky tab)

- **Where:** `src/lib/forum.ts`; called from **ForumPage** (Artsky tab).
- **Calls:** **1 listRecords** (app.artsky.forum.post) per user DID.
- **Trigger:** Opening Forum and switching to Artsky tab.

---

## 15. **getQuotes** (Quotes modal)

- **Where:** `src/lib/bsky.ts`; called from **QuotesModal** / PostDetailPage.
- **Calls:** **1** public fetch to getQuotes endpoint.
- **Trigger:** Opening “Quotes” on a post.

---

## 16. **searchPostsByTag** (TagPage / # in composer)

- **Where:** `src/lib/bsky.ts`; called from **TagPage**, **ComposerSuggestions** (#).
- **Calls:** **1 searchPosts** (cached 5 min).
- **Trigger:** Visiting tag page or typing # in composer.

---

## 17. **searchPostsByQuery** (Search)

- **Where:** `src/lib/bsky.ts`.
- **Calls:** **1 searchPosts**.
- **Trigger:** Search by query.

---

## 18. **getProfileCached** (throughout app)

- **Where:** `src/lib/bsky.ts`; used by ProfilePage, PostActionsMenu, EditProfileModal, ProfileActionsMenu, SearchBar, ForumPage, PostDetailPage, etc.
- **Calls:** **1 getProfile** per unique actor (cached).
- **Trigger:** Any place that shows a profile (avatar, handle, etc.).

---

## 19. **getSuggestedFeeds** (SearchBar / FeedSelector)

- **Where:** `src/lib/bsky.ts`; called from **SearchBar**, **FeedSelector**.
- **Calls:** **1 getSuggestedFeeds**.
- **Trigger:** Opening search bar or feed selector.

---

## 20. **getActorFeeds** (ProfilePage feeds tab)

- **Where:** `src/lib/bsky.ts`; called from **ProfilePage**, **FeedSelector**.
- **Calls:** **1** public fetch (getActorFeeds).
- **Trigger:** Opening profile feeds or feed picker for an actor.

---

## 21. **getNotifications** (Layout)

- **Where:** `src/lib/bsky.ts`; called from **Layout**.
- **Calls:** **1 listNotifications**.
- **Trigger:** Opening notifications panel.

---

## 22. **getUnreadNotificationCount** (Layout)

- **Where:** `src/lib/bsky.ts`; called from **Layout**.
- **Calls:** **1 countUnreadNotifications**.
- **Trigger:** Layout load / polling for badge.

---

## 23. **getFeedDisplayName** (single feed label)

- **Where:** `src/lib/bsky.ts`; called from **Layout** for single feed name (e.g. add feed dropdown).
- **Calls:** **1 getFeedGenerator** (cached).
- **Trigger:** Resolving or displaying one feed name.

---

## 24. **listMutedAccounts**

- **Where:** `src/lib/bsky.ts`; called from **BlockedAndMutedModal**.
- **Calls:** **1 getMutes**.
- **Trigger:** Opening Blocked & Muted modal.

---

## 25. **getMutedWords**

- **Where:** `src/lib/bsky.ts`; called from **BlockedAndMutedModal**.
- **Calls:** **1 getPreferences**.
- **Trigger:** Opening Blocked & Muted modal.

---

## 26. **searchActorsTypeahead** (ComposerSuggestions @)

- **Where:** `src/lib/bsky.ts`; called from **ComposerSuggestions**, **SearchBar**.
- **Calls:** **1 searchActorsTypeahead**.
- **Trigger:** Typing @ in composer or search.

---

## 27. **getPostThreadCached** (single thread)

- **Where:** `src/lib/bsky.ts`; called from **PostDetailPage**.
- **Calls:** **1 getPostThread** (cached/deduplicated).
- **Trigger:** Opening a post thread.

---

## 28. **getPostsBatch** (batch posts by URI)

- **Where:** `src/lib/bsky.ts`; used where multiple posts are loaded by URI.
- **Calls:** **ceil(N/25) getPosts** (batched).
- **Trigger:** Loading multiple posts (e.g. quotes, search results).

---

## 29. **getProfilesBatch** (batch profiles by DID)

- **Where:** `src/lib/bsky.ts`; used by PostDetailPage (reply avatars), Layout (notification authors), listBlockedAccounts.
- **Calls:** **ceil(N/25) getProfiles** (batched).
- **Trigger:** Needing multiple profiles at once.

---

## 30. **searchForumDocuments** (ComposerSuggestions %)

- **Where:** `src/lib/bsky.ts`; called from **ComposerSuggestions** when user types `%`.
- **Calls:** **0** (returns empty array; heavy implementation removed).
- **Trigger:** Typing % in composer.

---

## 31. **listStandardSiteRepliesForDocument** (forum post replies)

- **Where:** `src/lib/bsky.ts`; called from **ForumPostDetailPage**.
- **Calls:** **0** (stub returns []; N+1 implementation removed).
- **Trigger:** Opening forum post detail (replies section empty).

---

## 32. **Single write / action APIs** (1–2 calls each)

- **blockAccount** – 1 block.create  
- **unblockAccount** – 1 block.delete  
- **muteThread** – 1 muteThread  
- **reportPost** – 1 createReport  
- **deletePost** – 1 deleteRecord  
- **createPost** / **createQuotePost** – 1 post  
- **postReply** – 1 post (after detectFacets)  
- **putMutedWords** – 1 getPreferences + 1 putPreferences  
- **addSavedFeed** / **removeSavedFeedByUri** – getPreferences + putPreferences  
- **updateSeenNotifications** – 1 updateSeen  
- **listActivitySubscriptions** – 1 listActivitySubscriptions  
- **putActivitySubscription** – 1 putActivitySubscription  
- **createDownvote** / **deleteDownvote** – 1 create/deleteRecord  
- **listMyDownvotes** – 1 listRecords (paginated)  
- **follow** / **unfollow** (agent.follow) – 1  
- **like** / **repost** – 1 each  

---

## Summary (by category)

| Category                    | Typical call count   | Notes                                  |
|----------------------------|----------------------|----------------------------------------|
| Feed names (batch)         | N (saved feeds)      | N getFeedGenerator; cache after first  |
| Mixed feed                 | 1 per source         | Cached 5 min                           |
| Blocked list               | 1 + batch            | listRecords + getProfilesBatch         |
| Standard.site (single doc) | 3                    | getRecord + baseUrl + getProfile       |
| Standard.site (author)     | 2                    | listRecords + baseUrl                  |
| Follow list (followers/following) | 1 per page   | getFollowers / getFollowsList          |
| Mutuals / Followed-by-X    | 0                    | Removed; modal shows empty              |
| Suggested follows          | 0                    | Removed; panel shows empty              |
| Forum replies              | 0                    | Stub returns []; no N+1                |
| Notifications / prefs      | 1–2 each             | Single calls                           |
| Search / tag / quotes      | 1–2                  | searchPosts or public fetch            |
| Profile / thread / batch   | 1 or batched         | getProfileCached, getPostThread, getProfilesBatch, getPostsBatch |
