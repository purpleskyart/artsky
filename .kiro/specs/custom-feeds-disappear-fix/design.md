# Custom Feeds Disappear Fix - Bugfix Design

## Overview

When users remove a custom feed, the system incorrectly clears ALL saved feeds instead of removing just the specific feed being deleted. This is a critical data loss bug caused by two functions (`removeSavedFeedWithLifecycle` in bsky.ts and `removeSavedFeed` in bsky-updates.ts) that set `items: []` when calling `putPreferences`, which wipes the entire saved feeds list. The fix involves fetching the current saved feeds, filtering out the specific feed to remove, and updating preferences with only the remaining feeds—following the correct pattern already implemented in `removeSavedFeedByUri`.

## Glossary

- **Bug_Condition (C)**: When a user removes a custom feed by calling either `removeSavedFeedWithLifecycle` or `removeSavedFeed`
- **Property (P)**: The desired behavior when removing a feed—only that specific feed is removed while all other custom feeds are preserved
- **Preservation**: Existing behavior for non-removal operations and edge cases (feeds not in list, single feed removal, etc.) must remain unchanged
- **removeSavedFeedWithLifecycle**: Function in `src/lib/bsky.ts` (line 2873) that removes a saved feed with lifecycle management
- **removeSavedFeed**: Function in `src/lib/bsky-updates.ts` (line 561) that removes a saved feed
- **removeSavedFeedByUri**: Function in `src/lib/bsky.ts` (line 2456) that correctly implements feed removal by filtering
- **savedFeedsPrefV2**: The preference type for saved feeds with structure `{ $type: 'app.bsky.actor.defs#savedFeedsPrefV2', items: [...] }`
- **items**: Array of feed objects in the savedFeedsPrefV2 preference, each with `id`, `type`, `value`, and `pinned` properties

## Bug Details

### Fault Condition

The bug manifests when a user removes a custom feed through either `removeSavedFeedWithLifecycle` or `removeSavedFeed`. Both functions incorrectly set `items: []` when calling `putPreferences`, which clears the entire saved feeds list instead of filtering out just the specific feed being removed.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { feedId: string, functionName: 'removeSavedFeedWithLifecycle' | 'removeSavedFeed' }
  OUTPUT: boolean
  
  RETURN (input.functionName IN ['removeSavedFeedWithLifecycle', 'removeSavedFeed'])
         AND input.feedId is not empty
         AND putPreferences is called with items: []
END FUNCTION
```

### Examples

- **Example 1 - Multiple Feeds**: User has 3 custom feeds (Feed A, Feed B, Feed C). User removes Feed B. Current behavior: All 3 feeds are deleted, leaving only "Following" and "What's Hot". Expected behavior: Only Feed B is removed; Feed A and Feed C remain.

- **Example 2 - Single Feed**: User has 1 custom feed (Feed X). User removes Feed X. Current behavior: Feed X is deleted (correct outcome, but for wrong reason). Expected behavior: Feed X is removed, leaving only default feeds.

- **Example 3 - Feed Not in List**: User attempts to remove a feed that doesn't exist in their saved feeds. Current behavior: All feeds are cleared. Expected behavior: No change to saved feeds list, graceful handling.

- **Example 4 - Feed Order Preservation**: User has feeds in order [Feed 1, Feed 2, Feed 3, Feed 4]. User removes Feed 2. Current behavior: All feeds deleted. Expected behavior: Remaining feeds [Feed 1, Feed 3, Feed 4] maintain their order and properties.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Removing a feed that doesn't exist in the saved feeds list must continue to handle gracefully without errors
- Removing the only custom feed must continue to leave only default feeds visible
- Removing one feed from multiple feeds must continue to preserve the order and properties of remaining feeds
- The correct implementation pattern in `removeSavedFeedByUri` must continue to work as-is
- Cache invalidation via `invalidateAfterPreferencesUpdated()` must continue to work correctly
- Error handling and API request management must continue to function properly

**Scope:**
All inputs that do NOT involve removing a custom feed should be completely unaffected by this fix. This includes:
- Adding new custom feeds
- Pinning/unpinning feeds
- Reordering feeds
- Viewing saved feeds
- Other preference updates

## Hypothesized Root Cause

Based on the bug description and code analysis, the most likely issues are:

1. **Incomplete Implementation**: Both functions were implemented without fetching the current saved feeds list first. They directly set `items: []` instead of following the filtering pattern used in `removeSavedFeedByUri`.

2. **Copy-Paste Error or Incomplete Refactoring**: The functions may have been created as simplified versions but never updated to include the proper filtering logic that exists in `removeSavedFeedByUri`.

3. **Missing Preference Fetch**: The functions don't call `getPreferences()` or `getSavedFeedsFromPreferences()` to retrieve the current state before modification, unlike the correct implementation.

4. **Incorrect Preference Structure**: The functions don't properly reconstruct the preferences array by filtering out the old savedFeedsPrefV2 entry and adding back the updated one with filtered items.

## Correctness Properties

Property 1: Fault Condition - Remove Specific Feed Only

_For any_ feed removal operation where a user removes a custom feed via `removeSavedFeedWithLifecycle` or `removeSavedFeed`, the fixed functions SHALL fetch the current saved feeds list, filter out only the specific feed being removed, and update preferences with the remaining feeds intact.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Non-Removal Operations and Edge Cases

_For any_ input that is NOT a feed removal operation (adding feeds, pinning, reordering, viewing) or edge cases (feed not in list, single feed removal, empty list), the fixed code SHALL produce the same result as the original code, preserving all existing functionality for non-removal interactions and graceful error handling.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct, both functions need to be updated to follow the filtering pattern from `removeSavedFeedByUri`:

**File 1**: `src/lib/bsky.ts`

**Function**: `removeSavedFeedWithLifecycle` (line 2873)

**Specific Changes**:
1. **Fetch Current Preferences**: Call `getPreferences()` to retrieve the current preferences array
2. **Find Saved Feeds Preference**: Locate the existing `app.bsky.actor.defs#savedFeedsPrefV2` entry in preferences
3. **Filter Out Target Feed**: Filter the items array to exclude the feed being removed (by URI or ID)
4. **Reconstruct Preferences**: Remove the old savedFeedsPrefV2 entry and add back the updated one with filtered items
5. **Update Preferences**: Call `putPreferences()` with the reconstructed preferences array containing the filtered items
6. **Maintain Cache Invalidation**: Keep the `invalidateAfterPreferencesUpdated()` call to ensure caches are properly cleared

**File 2**: `src/lib/bsky-updates.ts`

**Function**: `removeSavedFeed` (line 561)

**Specific Changes**:
1. **Fetch Current Preferences**: Call `getPreferences()` to retrieve the current preferences array
2. **Find Saved Feeds Preference**: Locate the existing `app.bsky.actor.defs#savedFeedsPrefV2` entry in preferences
3. **Filter Out Target Feed**: Filter the items array to exclude the feed being removed (by URI or ID)
4. **Reconstruct Preferences**: Remove the old savedFeedsPrefV2 entry and add back the updated one with filtered items
5. **Update Preferences**: Call `putPreferences()` with the reconstructed preferences array containing the filtered items
6. **Maintain Cache Invalidation**: Keep the `invalidateAfterPreferencesUpdated()` call to ensure caches are properly cleared

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Fault Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm that both functions incorrectly clear all feeds. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that simulate feed removal operations and verify that the saved feeds list is correctly updated. Run these tests on the UNFIXED code to observe failures and confirm the root cause.

**Test Cases**:
1. **Remove Feed from Multiple**: Simulate removing one feed when 3 feeds exist (will fail on unfixed code—all feeds cleared)
2. **Remove Single Feed**: Simulate removing the only custom feed (may pass on unfixed code but for wrong reason)
3. **Remove Non-Existent Feed**: Simulate removing a feed not in the list (will fail on unfixed code—all feeds cleared)
4. **Feed Order Preservation**: Simulate removing a middle feed and verify order is maintained (will fail on unfixed code)

**Expected Counterexamples**:
- All saved feeds are cleared when removing a single feed
- Preferences are set to `items: []` instead of filtered items
- Possible causes: missing preference fetch, incorrect filtering logic, incomplete implementation

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed functions produce the expected behavior.

**Pseudocode:**
```
FOR ALL feedId WHERE isBugCondition(feedId) DO
  currentFeeds := getSavedFeeds()
  result := removeSavedFeed_fixed(feedId)
  updatedFeeds := getSavedFeeds()
  ASSERT updatedFeeds.length == currentFeeds.length - 1
  ASSERT NOT updatedFeeds.contains(feedId)
  ASSERT updatedFeeds.containsAll(currentFeeds.filter(f => f.id != feedId))
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed functions produce the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalFunction(input) = fixedFunction(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-removal operations

**Test Plan**: Observe behavior on UNFIXED code first for non-removal operations, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Add Feed Preservation**: Verify adding feeds continues to work correctly after fix
2. **Pin/Unpin Preservation**: Verify pinning/unpinning feeds continues to work correctly
3. **Reorder Preservation**: Verify reordering feeds continues to work correctly
4. **Cache Invalidation Preservation**: Verify cache invalidation continues to work correctly

### Unit Tests

- Test removing a feed from a list with multiple feeds
- Test removing the only custom feed
- Test removing a feed that doesn't exist in the list
- Test that feed order is preserved after removal
- Test that feed properties (pinned status, etc.) are preserved for remaining feeds
- Test error handling when preferences fetch fails

### Property-Based Tests

- Generate random lists of feeds and verify that removing any feed results in correct filtering
- Generate random feed configurations and verify preservation of non-removal operations
- Test that all non-removal operations continue to work across many scenarios
- Verify that cache invalidation is called correctly after each removal

### Integration Tests

- Test full flow of adding multiple feeds, removing one, and verifying the result
- Test switching between different feed lists and removing feeds
- Test that UI updates correctly after feed removal
- Test that removed feeds don't reappear after cache refresh
