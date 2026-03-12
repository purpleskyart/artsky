# Custom Feeds Load Delay Bugfix Design

## Overview

Custom feeds that have been previously saved by the user are not displayed on initial page load. Instead, they only appear after the user clicks the Feeds button. This creates a poor user experience where saved feeds are hidden until explicitly accessed, even though they should be immediately visible as part of the feed mix.

The root cause is that custom feeds are loaded asynchronously in a `useEffect` hook that runs after the component mounts, creating a timing gap between initial render and when the feeds become available. The fix ensures saved feeds are loaded and available before or immediately after the initial render without requiring a button click.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug - when a logged-in user with saved custom feeds loads the page, the feeds are not visible until the Feeds button is clicked
- **Property (P)**: The desired behavior when the bug condition is met - saved feeds should be immediately visible in the feed selector on initial page load
- **Preservation**: Existing behavior for guest users, users with no saved feeds, and manual feed additions that must remain unchanged
- **FeedMixContext**: React context in `src/context/FeedMixContext.tsx` that manages the feed mix state (entries, enabled status, and operations)
- **Layout**: Main component in `src/components/Layout.tsx` that manages feed loading and display
- **loadSavedFeeds**: Async function that fetches saved feeds from server preferences and updates `setSavedFeedSources`
- **savedFeedsLoadedRef**: Ref used to prevent duplicate feed loading, currently only triggers after mount

## Bug Details

### Bug Condition

The bug manifests when a logged-in user with previously saved custom feeds loads the page. The `loadSavedFeeds` function is called asynchronously in a `useEffect` hook that runs after the component mounts, creating a timing gap where the initial render displays an empty feed list before the saved feeds are fetched and populated.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type PageLoadEvent
  OUTPUT: boolean
  
  RETURN input.isLoggedIn == true
         AND input.hasSavedCustomFeeds == true
         AND input.isInitialPageLoad == true
         AND savedFeedsNotYetLoaded(input.currentTime)
END FUNCTION
```

### Examples

- **Example 1**: User logs in with 3 saved custom feeds. Page loads, FeedSelector shows only preset feeds. After clicking Feeds button, the 3 custom feeds appear. Expected: Custom feeds visible immediately on page load.

- **Example 2**: User has saved "Art Feed" and "Photography Feed". Page loads, neither feed appears in the selector. After clicking Feeds button, both feeds appear. Expected: Both feeds visible immediately without clicking.

- **Example 3**: User with no saved feeds loads page. Preset feeds display correctly. Expected: Behavior unchanged (no regression).

- **Edge Case**: User switches between accounts. Each account's saved feeds should load immediately for that account. Expected: Correct feeds for each account visible on load.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Guest users (no session) must continue to display only preset feeds without attempting to load custom feeds
- Logged-in users with no saved custom feeds must continue to display only preset feeds
- Manual feed additions via the Feeds dropdown must continue to work and display immediately
- Account switching must continue to load the correct custom feeds for each account
- Feed mix state (percentages, enabled status) must continue to be persisted and restored correctly

**Scope:**
All inputs that do NOT involve a logged-in user with saved custom feeds on initial page load should be completely unaffected by this fix. This includes:
- Guest user page loads
- Logged-in users with no saved feeds
- Manual feed additions after page load
- Account switching after page load
- Feed mix operations (adding, removing, rebalancing)

## Hypothesized Root Cause

Based on the bug description and code analysis, the most likely issues are:

1. **Async Loading After Mount**: The `loadSavedFeeds` function is called in a `useEffect` hook that runs after the component mounts, creating a timing gap where the initial render happens before feeds are fetched.
   - The `savedFeedsLoadedRef` prevents duplicate loads but doesn't help with the initial timing
   - The async fetch operation takes time, and the UI renders before the response arrives

2. **No Synchronous Initialization**: The `savedFeedSources` state is initialized as an empty array with no attempt to load from cache or server synchronously.
   - Unlike `FeedMixContext` which loads from localStorage synchronously, custom feeds are only loaded asynchronously
   - This creates an inconsistency in how different feed types are initialized

3. **Dependency on Session Context**: The feed loading depends on the session being available, but the timing of when the session becomes available vs. when the component renders is not guaranteed.
   - If the session is available before the component mounts, we could load feeds earlier
   - The current implementation waits for the `useEffect` to run, which is always after the initial render

## Correctness Properties

Property 1: Bug Condition - Saved Feeds Load on Initial Page Load

_For any_ page load where a logged-in user with saved custom feeds accesses the application, the fixed implementation SHALL ensure that saved feeds are available and displayed in the feed selector immediately on initial render, without requiring the user to click the Feeds button.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation - Non-Buggy Input Behavior

_For any_ page load where the bug condition does NOT hold (guest user, no saved feeds, or non-initial load), the fixed implementation SHALL produce exactly the same behavior as the original code, preserving all existing functionality for feed display, account switching, and manual feed additions.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct, the fix involves moving feed loading earlier in the initialization process to ensure feeds are available before or immediately after the initial render.

**File**: `src/components/Layout.tsx`

**Function**: `Layout` component

**Specific Changes**:

1. **Synchronous Initialization from Session**: When a session is available and the component initializes, immediately attempt to load saved feeds synchronously from cache or trigger an early async load that completes before render.
   - Check if session exists before the first render
   - If session exists, initiate feed loading as early as possible (potentially in a synchronous initializer or very early useEffect)

2. **Early useEffect for Feed Loading**: Create a separate, higher-priority `useEffect` that runs before other effects to load feeds as soon as the session is available.
   - This effect should run with `[session]` as dependency to trigger when session changes
   - It should load feeds immediately when session becomes available, not waiting for other effects

3. **Prevent Duplicate Loads**: Maintain the `savedFeedsLoadedRef` mechanism to prevent duplicate loads while ensuring the first load happens as early as possible.
   - Keep the ref but ensure it doesn't prevent the early load
   - Ensure account switching still triggers a reload

4. **Optimize Feed Loading Order**: Ensure feed loading happens in parallel with other initialization tasks rather than sequentially after mount.
   - Move feed loading to a higher priority in the effect execution order
   - Consider using a separate effect that runs earlier than other effects

5. **Handle Session Changes**: Ensure that when the session changes (account switching), feeds are reloaded immediately.
   - The current implementation already handles this via the `[session, loadSavedFeeds]` dependency
   - Verify this continues to work with the new implementation

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that simulate page load with a logged-in user who has saved custom feeds. Assert that the saved feeds are available in the `savedFeedSources` state immediately after the component mounts (or very shortly after). Run these tests on the UNFIXED code to observe failures and understand the root cause.

**Test Cases**:
1. **Initial Load with Saved Feeds**: Simulate page load with session and saved feeds in preferences. Assert that `savedFeedSources` is populated immediately (will fail on unfixed code).
2. **Feed Visibility on Mount**: Render Layout component with session and verify saved feeds appear in the feed selector on initial render (will fail on unfixed code).
3. **Feed Availability Before Button Click**: Verify that saved feeds are available before the Feeds button is clicked (will fail on unfixed code).
4. **Account Switch Feed Loading**: Simulate account switching and verify new account's feeds load immediately (may fail on unfixed code).

**Expected Counterexamples**:
- `savedFeedSources` is empty on initial render, populated only after async load completes
- Feed selector shows only preset feeds initially, custom feeds appear after Feeds button click
- Possible causes: async loading after mount, no synchronous initialization, timing gap between render and fetch

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := Layout_fixed(input)
  ASSERT expectedBehavior(result)
    // Saved feeds are available immediately on initial render
    // Saved feeds appear in feed selector without button click
    // Feed mix includes saved feeds on initial load
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT Layout_original(input) = Layout_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for guest users, users with no saved feeds, and manual feed additions. Then write property-based tests capturing that behavior to ensure the fix doesn't change it.

**Test Cases**:
1. **Guest User Preservation**: Verify guest users see only preset feeds on page load, both before and after fix.
2. **No Saved Feeds Preservation**: Verify users with no saved feeds see only preset feeds, both before and after fix.
3. **Manual Feed Addition Preservation**: Verify manually adding feeds via Feeds dropdown works the same way before and after fix.
4. **Account Switching Preservation**: Verify switching between accounts loads the correct feeds for each account, both before and after fix.
5. **Feed Mix State Preservation**: Verify feed mix percentages and enabled status are persisted and restored correctly, both before and after fix.

### Unit Tests

- Test that `loadSavedFeeds` is called when session becomes available
- Test that `savedFeedSources` is populated with correct feeds from server
- Test that feed loading doesn't happen for guest users
- Test that account switching triggers feed reload
- Test that duplicate loads are prevented

### Property-Based Tests

- Generate random session states and verify feeds load correctly for each
- Generate random saved feed configurations and verify they appear immediately on load
- Generate random account switches and verify correct feeds load for each account
- Test that all non-buggy inputs produce identical behavior before and after fix

### Integration Tests

- Test full page load flow with logged-in user and saved feeds
- Test account switching and feed loading for each account
- Test that feed selector displays saved feeds immediately on page load
- Test that feed mix includes saved feeds without requiring button click
- Test that visual feedback occurs when feeds are loaded
