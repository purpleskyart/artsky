# Post Double-Open Fix Bugfix Design

## Overview

When a user clicks a post card on the homepage, the post opens in a modal AND the page simultaneously navigates to the `/post/:uri` route, causing the post to display twice. This double-open behavior is caused by the Link component in PostCard.tsx having a `to` attribute that points to `/post/{uri}`, which triggers React Router navigation even though `preventDefault()` is called in the click handler. The fix is to change the Link's `to` attribute from `/post/{encodeURIComponent(post.uri)}` to `#` so it doesn't navigate anywhere, allowing only the modal to open. Profile clicks work correctly because they don't have this dual navigation issue.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug - when a user clicks a post card on the homepage
- **Property (P)**: The desired behavior when a post card is clicked - the post should open only in a modal without triggering a route navigation
- **Preservation**: Existing mouse-click behavior on other elements and UI display that must remain unchanged by the fix
- **Link component**: The React Router Link component in `src/components/PostCard.tsx` (line 625) that wraps the post card
- **handleCardClick**: The click handler function in PostCard.tsx that calls `onPostClick` or navigates to `/feed?post=...`
- **PostDetailPage**: The full-page view component that renders when navigating to `/post/:uri`

## Bug Details

### Fault Condition

The bug manifests when a user clicks a post card on the homepage. The Link component has a `to` attribute pointing to `/post/{uri}` which causes React Router to navigate to that route, while simultaneously the modal also opens from the query parameter `?post=...`. This creates a conflicting display state where both the full-page PostDetailPage and the modal are rendered.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type ClickEvent on PostCard
  OUTPUT: boolean
  
  RETURN input.target is PostCard Link element
         AND Link.to = `/post/{encodeURIComponent(post.uri)}`
         AND preventDefault() is called in handleCardClick
         AND React Router still navigates to /post/:uri route
         AND modal also opens from query parameter
END FUNCTION
```

### Examples

- **Example 1**: User clicks a post card on the homepage → post opens in modal AND page navigates to `/post/at://...` → PostDetailPage renders as full page while modal is also open (double-open)
- **Example 2**: User clicks a profile link → profile opens correctly without double-opening (works as expected)
- **Example 3**: User clicks post card, then clicks back button → returns to homepage but post is still open in modal (state mismatch)
- **Edge case**: User clicks post card very quickly multiple times → multiple route navigations stack up, causing navigation history issues

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Mouse clicks on profile links must continue to work correctly without double-opening
- Button display and styling must remain unchanged
- Game state transitions between UI contexts must remain unchanged
- Modal open/close functionality must continue to work as expected
- Other navigation elements must continue to function as expected
- Touch interactions and double-tap like functionality must continue to work

**Scope:**
All interactions that do NOT involve clicking a post card should be completely unaffected by this fix. This includes:
- Clicking profile links
- Clicking other navigation elements
- Keyboard interactions
- Touch interactions on non-post elements
- Modal close button functionality

## Hypothesized Root Cause

Based on the bug description, the root cause is:

1. **Link Navigation Override**: The Link component's `to` attribute is set to `/post/{encodeURIComponent(post.uri)}`, which causes React Router to navigate to that route regardless of the `preventDefault()` call in the click handler. React Router's Link component processes the `to` attribute before the click handler can fully prevent the navigation.

2. **Dual Navigation Paths**: The click handler calls `onPostClick` or navigates to `/feed?post=...` (modal), but the Link component simultaneously navigates to `/post/:uri` (full page), creating two competing navigation paths.

3. **Route Matching**: When the `/post/:uri` route is matched, PostDetailPage renders as a full-page view, while the modal is also open from the query parameter, causing the double-open display.

## Correctness Properties

Property 1: Fault Condition - Post Card Click Opens Modal Only

_For any_ click event on a post card on the homepage, the fixed PostCard component SHALL open the post only in a modal without triggering a route navigation to `/post/:uri`, and the page SHALL remain on the current route.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation - Non-Post-Card Click Behavior

_For any_ click event that is NOT on a post card (profile links, other navigation elements, buttons), the fixed code SHALL produce exactly the same behavior as the original code, preserving all existing functionality for non-post-card interactions.

**Validates: Requirements 3.1, 3.2, 3.3**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `src/components/PostCard.tsx`

**Component**: `PostCard`

**Specific Changes**:

1. **Change Link `to` Attribute**: Change the Link component's `to` attribute from `/post/{encodeURIComponent(post.uri)}` to `#` (line 625)
   - This prevents React Router from navigating to the `/post/:uri` route
   - The `#` value is a no-op navigation target that doesn't trigger route changes
   - Similar to how ForumPage handles post links

2. **Verify Click Handler**: Ensure `handleCardClick` is properly calling `onPostClick` or navigating to `/feed?post=...` (already correct)
   - The click handler already has `preventDefault()` and `stopPropagation()`
   - The handler already calls `onPostClick(post.uri, { initialItem: item })` or navigates to the modal

3. **Verify Touch Handlers**: Ensure touch event handlers continue to work correctly
   - Touch handlers already call `openPost()` which uses `onPostClick` or modal navigation
   - No changes needed to touch handling logic

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Fault Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that simulate click events on post cards and assert that the page does NOT navigate to `/post/:uri` route. Run these tests on the UNFIXED code to observe failures and understand the root cause.

**Test Cases**:
1. **Post Card Click Test**: Simulate clicking a post card on the homepage and verify that the route does NOT change to `/post/:uri` (will fail on unfixed code)
2. **Modal Open Test**: Simulate clicking a post card and verify that the modal opens with the correct post (will fail on unfixed code due to double-open)
3. **Route Navigation Test**: Simulate clicking a post card and verify that React Router does NOT navigate to `/post/:uri` (will fail on unfixed code)
4. **History Stack Test**: Simulate clicking a post card multiple times and verify that the browser history does NOT accumulate `/post/:uri` entries (will fail on unfixed code)

**Expected Counterexamples**:
- Route changes to `/post/:uri` when clicking post card
- PostDetailPage renders while modal is also open
- Browser history accumulates `/post/:uri` entries
- Possible causes: Link component's `to` attribute overrides click handler, React Router processes Link before click handler completes

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := PostCard_fixed(input)
  ASSERT modal opens with correct post
  ASSERT route does NOT change to /post/:uri
  ASSERT page remains on current route
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT PostCard_original(input) = PostCard_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for profile clicks and other interactions, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Profile Click Preservation**: Verify clicking profile links continues to work correctly without double-opening
2. **Modal Close Preservation**: Verify modal close button continues to work correctly
3. **Touch Interaction Preservation**: Verify touch interactions and double-tap like functionality continue to work
4. **Keyboard Navigation Preservation**: Verify keyboard interactions continue to work correctly

### Unit Tests

- Test that clicking a post card opens the modal without navigating to `/post/:uri`
- Test that the Link component's `to` attribute is set to `#`
- Test that `handleCardClick` is called and processes the click correctly
- Test that profile links continue to work correctly
- Test that modal open/close functionality continues to work

### Property-Based Tests

- Generate random post URIs and verify that clicking post cards opens modals without route navigation
- Generate random click events and verify that non-post-card clicks continue to work as before
- Test that all non-post-card interactions continue to work across many scenarios

### Integration Tests

- Test full flow of clicking a post card and verifying modal opens without route change
- Test switching between posts and verifying each opens in modal without route change
- Test that browser back button works correctly after clicking post cards
- Test that profile links continue to work correctly in the same context
