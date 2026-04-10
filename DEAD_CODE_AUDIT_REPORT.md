# Dead Code Audit Report

**Project:** artsky  
**Date:** April 10, 2026  
**Tools Used:** ESLint, knip, depcheck

---

## Executive Summary

This audit identified significant dead code across the project:
- **ESLint:** 235 problems (202 errors, 33 warnings)
- **knip:** 12 unused files, 72 unused exports, 45 unused types
- **depcheck:** 3 unused devDependencies, 1 missing dependency

**Total Estimated Dead Code:** ~130+ items across files, exports, types, and dependencies

---

## 1. ESLint Findings (Unused Imports & Locals)

### Summary
- **Total Issues:** 235 (202 errors, 33 warnings)
- **Confidence:** HIGH
- **False Positive Rate:** LOW (~5-10%)

### High-Confidence Unused Variables/Imports

#### Test Files (High Confidence)
- `src/components/Layout.bugCondition.pbt.test.tsx`: `vi`, `beforeAll`, `afterEach`, `effectPromise` (multiple instances), `renderCount`, `session`
- `src/components/Layout.preservation.pbt.test.tsx`: `mockSessions`, `attemptedCustomFeedLoad`, `loadSavedFeeds` (multiple), `serverFeeds`, `currentSession`, `i` (multiple loop variables)
- `src/components/PostCard.bug-condition.test.tsx`: `beforeEach`
- `src/components/PostCard.preservation.test.tsx`: `beforeEach`
- `src/components/PostCard.test.tsx`: `clickHandler1`, `clickHandler2`, `_parentState`
- `src/context/CoreProvidersGroup.property.test.tsx`: `expect`, `renderHook`, `themeChanges`, `initialRenderCounts`
- `src/context/LikeOverridesContext.test.tsx`: `getLikeOverride1`
- `src/context/ModalLazyLoading.test.tsx`: `screen`
- `src/lib/AsyncStorage.test.ts`: `originalSetItem`
- `src/lib/apiRateLimit.bugCondition.pbt.test.ts`: `requestDeduplicator`, `usePublic` (multiple)
- `src/lib/apiRateLimit.preservation.pbt.test.ts`: `actor` (multiple)
- `src/lib/lazyLoading.pbt.test.ts`: `originalImport`, `error`
- `src/lib/errorHandling.integration.test.tsx`: `chunkContainer`, `imageContainer`

#### Production Code (High Confidence)
- `src/components/SuggestedFollows.tsx`: `_handle` (line 42)
- `src/components/FollowListModal.tsx`: `out` (should be const)
- `src/context/SeenPostsContext.tsx`: `_anchor` (multiple instances)
- `src/lib/bsky.ts`: `_` (line 1626)
- `src/lib/downloadImage.ts`: `_reject`
- `src/pages/ProfilePage.tsx`: `_openProfileModal`
- `src/pages/FeedPage.tsx`: `_` (line 1518) with empty block
- `src/test/bundleSizeTracker.ts`: `distPath`, `outputPath`, `inputPath`
- `src/test/stubs/virtual-pwa-register.ts`: `_options`, `_reloadPage`

#### Medium Confidence (Potential False Positives)
- Variables prefixed with `_` are intentionally marked as unused in TypeScript convention
- Some test utilities may be used indirectly or for future test cases

### Other ESLint Issues (Not Dead Code)
- React Hooks violations (set-state-in-effect, exhaustive-deps)
- React ref access during render (intentional optimization patterns)
- Fast refresh warnings (architectural, not dead code)
- `any` type usage (type safety, not dead code)

---

## 2. knip Findings (Unused Exports & Files)

### Summary
- **Confidence:** MEDIUM-HIGH
- **False Positive Rate:** MEDIUM (~20-30%)

### Unused Files (12) - HIGH CONFIDENCE

These files are completely unused:
1. `scripts/validate-performance.js` - Script not referenced
2. `src/components/Avatar.example.tsx` - Example file
3. `src/components/Avatar.tsx` - Component not imported
4. `src/components/SuggestedFollows.tsx` - Component not imported
5. `src/hooks/useListKeyboardNav.ts` - Hook not imported
6. `src/lib/bsky-updates.ts` - Module not imported
7. `src/lib/downloadImage.ts` - Module not imported
8. `src/lib/rateLimitExamples.ts` - Example file
9. `src/lib/recommendationStorage.ts` - Module not imported
10. `src/test/bundleSizeTracker.ts` - Test utility not used
11. `src/test/index.ts` - Test barrel file not used
12. `src/test/renderCounter.tsx` - Test utility not used

**False Positive Notes:**
- `Avatar.tsx` may be used dynamically or via string imports
- Test utilities might be used in test files not analyzed by knip
- Example files (`.example.tsx`) are intentionally unused

### Unused Exports (72) - MEDIUM CONFIDERENCE

#### Context Exports
- `loadModeForDid` (ArtOnlyContext)
- `useIsPostSavedToActiveCollection` (CollectionSaveContext)
- `NSFW_CYCLE` (ModerationContext)

#### Hook Exports
- `PULL_COMMIT_PX`, `PULL_REFRESH_HOLD_PX` (usePullToRefresh)
- `getStableAutoColumnCount`, `getColumnCountForViewMode` (useViewportWidth)

#### BSKY API Functions (Many Lifecycle Variants)
- `removeOAuthDid`, `setActiveOAuthDid`, `getStoredSession`
- `getCredentialRateLimitedFetch`, `getAgent`
- `logout`, `getPostMediaUrl`, `getPostMediaUrlForDisplay`
- `getFollows`, `parseBskyFeedUrl`, `invalidateSavedFeedsCache`
- `getProfileWithLifecycle`, `getFollowersWithLifecycle`, `getFollowsWithLifecycle`
- `getNotificationsWithLifecycle`, `blockAccountWithLifecycle`
- `unblockAccountWithLifecycle`, `muteAccountWithLifecycle`, `unmuteAccountWithLifecycle`
- `createPostWithLifecycle`, `deletePostWithLifecycle`
- `updateMutedWordsWithLifecycle`, `addSavedFeedWithLifecycle`, `removeSavedFeedWithLifecycle`
- `cancelRequest`, `getRequestMetrics`, `resetRequestMetrics`, `invalidateCache`

#### Utility Functions
- `appAbsolutePath` (appUrl)
- `CACHE_KEYS`, `INVALIDATION_PATTERNS` (cacheInvalidation)
- `invalidateAfterProfileUpdated`, `invalidateAfterDownvoteCreated`, `invalidateAfterDownvoteDeleted`
- `COLLECTION_LEXICON`, `ACTIVE_COLLECTION_STORAGE_KEY` (collections)
- `readStoredActiveCollectionAtUri`, `MAX_COLLECTION_ITEMS`, `MAX_COLLECTION_SLUG_LENGTH`
- `compactCollectionRefFromAtUri`, `listMyCollectionAtUris`
- `getDownvoteCount` (constellation)
- `getRelativeTimeParts` (date)
- `resizedImageUrl`, `resizedAvatarUrl` (imageUtils)
- `getOAuthClient` (oauth)

#### Performance & Monitoring
- `measureCLS`, `measureFID`, `measureTTFB` (performanceMetrics)
- `RequestDeduplicator`, `ResponseCache`, `IMAGE_CACHE_NAME`
- `getLocalStorageUsage`, `getCacheUsage`, `clearAllCaches`
- All `measure*` functions in `src/test/performanceUtils.ts`

**False Positive Notes:**
- Lifecycle variants (e.g., `getFollowersWithLifecycle`) may be used for future features
- Performance monitoring functions might be used in production monitoring
- Cache utilities might be used in error handling or cleanup
- Some exports may be used dynamically or via string imports not detected by static analysis

### Unused Types (45) - MEDIUM CONFIDENCE

#### Component Props & Interfaces
- `ComposerSuggestionsProps`, `FeedColumnProps`, `FollowListSortBy`, `FollowListOrder`
- `FeedPullRefreshHandlers`, `LoginCardProps`, `PostTextFacet`, `PostTextProps`
- `ProfileColumnProps`, `SearchFilter`, `SearchModalGridContentProps`

#### Context Types
- `GuestFeedAccount`, `CardViewMode`, `ModalTopBarSlots`, `ModalItem`
- `ThemeResolved`, `ToastAnchorPosition`

#### Hook Types
- `CardHoverGateOptions`, `UsePullToRefreshOptions`, `UsePullToRefreshResult`
- `UseSwipeToCloseOptions`, `UseSwipeToCloseResult`, `UseColumnCountOptions`

#### Library Types
- `ApiError`, `RequestMetrics`, `FeedMixEntryInput`, `ThreadView`, `PostMediaInfo`
- `PostMediaUrlOptions`, `QuotedPostView`, `ActorFeedView`, `SuggestedFollow`
- `SuggestedFollowDetail`, `CollectionRecordValue`, `CollectionView`
- `RelativeTimeParts`, `ViewportRect`, `OAuthSession`
- `PerformanceMetrics`, `RateLimitConfig`, `RateLimitState`, `CacheEntry`
- `PostView`, `TimelineItem`

**False Positive Notes:**
- Types are often exported for public API even if not used internally
- Some types may be used in type-only imports not detected
- Future-proofing for planned features

### Unlisted Dependencies (2) - HIGH CONFIDENCE
- `@atproto/oauth-client` - Used in `src/lib/oauth.ts:69:35` but not in package.json
- `@vitest/coverage-v8` - Used in `vitest.config.ts` but not in package.json

### Unused devDependencies (1)
- `ts-prune` - Installed but knip was used instead

---

## 3. depcheck Findings (Unused Dependencies)

### Summary
- **Confidence:** HIGH for devDependencies, MEDIUM for missing
- **False Positive Rate:** LOW

### Unused devDependencies (3) - HIGH CONFIDENCE
1. `depcheck` - Tool used for this audit, can be removed after audit
2. `knip` - Tool used for this audit, can be removed after audit
3. `ts-prune` - Not used, knip was used instead

**Recommendation:** Keep one dead-code detection tool (knip is recommended) and remove the others after cleanup.

### Missing Dependencies (1) - MEDIUM CONFIDENCE
- `virtual:pwa-register` - Used in `./src/hooks/useSWUpdate.ts`

**False Positive Note:** This is a virtual module from Vite PWA plugin, which may not need to be in package.json as it's provided by the plugin at build time.

---

## 4. Recommendations by Priority

### HIGH PRIORITY (Safe to Remove)

#### Files (12)
- `scripts/validate-performance.js`
- `src/components/Avatar.example.tsx`
- `src/lib/rateLimitExamples.ts`
- `src/test/bundleSizeTracker.ts`
- `src/test/index.ts`
- `src/test/renderCounter.tsx`

#### Unused Variables (30+)
- All test file unused variables (marked with confidence above)
- Production code unused variables (marked with confidence above)

#### Dependencies (3)
- `depcheck` (after audit)
- `ts-prune` (after audit)
- `knip` (after audit cleanup, or keep for ongoing maintenance)

### MEDIUM PRIORITY (Review Before Removing)

#### Files (6)
- `src/components/Avatar.tsx` - Verify no dynamic imports
- `src/components/SuggestedFollows.tsx` - Verify not used in routes
- `src/hooks/useListKeyboardNav.ts` - Verify not used in keyboard navigation
- `src/lib/bsky-updates.ts` - Verify not used in update logic
- `src/lib/downloadImage.ts` - Verify not used in image handling
- `src/lib/recommendationStorage.ts` - Verify not used in recommendations

#### Exports (72)
- Review lifecycle variants - remove if no plans to use
- Review performance monitoring functions - remove if not used in prod
- Review cache utilities - verify no error handling usage

#### Types (45)
- Generally safe to remove unused types, but review public API implications

### LOW PRIORITY (Keep for Now)

- Types exported for public API
- Lifecycle functions for future features
- Performance monitoring utilities (may be added later)

---

## 5. False Positive Analysis

### ESLint False Positives (~5-10%)
- Variables prefixed with `_` (TypeScript convention for intentionally unused)
- Test utilities used indirectly
- Variables used in type annotations only

### knip False Positives (~20-30%)
- Dynamic imports (require(), string imports)
- Files used in build scripts or configuration
- Types exported for public API contracts
- Future-proofing exports for planned features
- Virtual modules (like `virtual:pwa-register`)

### depcheck False Positives (~10%)
- Virtual modules provided by build tools
- Peer dependencies used indirectly
- Dependencies used in configuration files only

---

## 6. Estimated Impact

### Code Reduction Potential
- **Files:** 12 files (~2,000-5,000 LOC estimated)
- **Exports:** 72 functions/constants (~1,500-3,000 LOC estimated)
- **Types:** 45 type definitions (~500-1,000 LOC estimated)
- **Variables:** 30+ unused variables (~100-300 LOC estimated)

**Total Potential Reduction:** ~4,000-9,000 lines of code (~5-10% of codebase)

### Bundle Size Impact
- Removing unused exports could reduce bundle size by ~50-200KB (depending on tree-shaking)
- Removing unused dependencies reduces install time and disk space

### Maintenance Impact
- Reduces cognitive load for developers
- Reduces surface area for bugs
- Improves build times slightly

---

## 7. Action Plan

### Phase 1: Quick Wins (1-2 hours)
1. Remove obviously unused test variables
2. Remove example files
3. Remove unused devDependencies after audit
4. Add missing `@atproto/oauth-client` to dependencies

### Phase 2: Medium Effort (2-4 hours)
1. Verify and remove unused files (check dynamic imports)
2. Remove unused exports after verifying no dynamic usage
3. Clean up unused types (review public API impact)

### Phase 3: Review & Future (Ongoing)
1. Set up pre-commit hooks with knip to prevent future dead code
2. Review lifecycle functions - keep or remove based on roadmap
3. Decide on performance monitoring strategy

---

## 8. Tool Configuration Recommendations

### knip Configuration
Create `knip.json` to reduce false positives:
```json
{
  "ignore": [
    "src/components/Avatar.tsx",
    "src/test/**"
  ],
  "ignoreBinaries": ["vitest"],
  "ignoreDependencies": ["virtual:pwa-register"]
}
```

### ESLint Configuration
Consider adding these rules to catch dead code earlier:
```javascript
{
  "rules": {
    "@typescript-eslint/no-unused-vars": "error",
    "no-unused-vars": "off"
  }
}
```

---

## Conclusion

The codebase has moderate amounts of dead code, primarily in:
1. Test utilities and example files
2. Unused exports from large utility modules (bsky.ts, collections.ts)
3. Type definitions exported for public API but not used internally

**Recommendation:** Clean up high-confidence items immediately, review medium-confidence items with team, and set up automated dead code detection going forward.

**Confidence Level:** Overall HIGH for actionable items, with clear false-positive notes for items requiring manual review.
