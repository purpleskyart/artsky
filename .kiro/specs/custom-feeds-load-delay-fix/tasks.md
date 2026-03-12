# Implementation Plan

## Phase 1: Exploration - Understand the Bug

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Saved Feeds Load on Initial Page Load
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: For deterministic bugs, scope the property to the concrete failing case(s) to ensure reproducibility
  - Test implementation details from Bug Condition in design:
    - Simulate page load with logged-in user (session available)
    - User has saved custom feeds in preferences
    - Assert that `savedFeedSources` is populated immediately on initial render
    - Assert that saved feeds appear in feed selector without requiring Feeds button click
    - Test cases: Initial load with 1 saved feed, 3 saved feeds, mixed feed types
  - The test assertions should match the Expected Behavior Properties from design:
    - Saved feeds are available and displayed in feed selector immediately on initial render
    - No user interaction (button click) required to see saved feeds
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found to understand root cause:
    - Observe when `savedFeedSources` becomes populated (after mount vs. on mount)
    - Observe feed selector state on initial render vs. after async load
    - Identify timing gap between render and feed availability
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 2.1, 2.2_

## Phase 2: Preservation - Verify Non-Buggy Behavior

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Buggy Input Behavior
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy inputs:
    - Guest user page load (no session)
    - Logged-in user with no saved feeds
    - Manual feed additions via Feeds dropdown
    - Account switching after page load
    - Feed mix state persistence and restoration
  - Write property-based tests capturing observed behavior patterns from Preservation Requirements:
    - Guest users see only preset feeds on page load
    - Users with no saved feeds see only preset feeds
    - Manual feed additions display immediately
    - Account switching loads correct feeds for each account
    - Feed mix percentages and enabled status persist correctly
  - Property-based testing generates many test cases for stronger guarantees:
    - Generate random session states (logged in, guest, switching accounts)
    - Generate random saved feed configurations (0, 1, 3+ feeds)
    - Generate random feed mix operations (add, remove, rebalance)
    - Verify behavior is consistent across all generated cases
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

## Phase 3: Implementation - Apply the Fix

- [-] 3. Fix for custom feeds load delay

  - [x] 3.1 Implement the fix
    - Move feed loading earlier in component lifecycle to ensure feeds are available before or immediately after initial render
    - **File**: `src/components/Layout.tsx`
    - **Function**: `Layout` component
    - **Changes**:
      1. Create early useEffect for feed loading that runs with `[session]` dependency
         - This effect should trigger when session becomes available
         - Load feeds as soon as session is available, not waiting for other effects
         - Maintain `savedFeedsLoadedRef` to prevent duplicate loads
      2. Ensure feed loading happens synchronously or very early asynchronously
         - Check if session exists before first render
         - Initiate feed loading as early as possible in component initialization
      3. Handle account switching by reloading feeds when session changes
         - Verify `[session, loadSavedFeeds]` dependency triggers reload on account switch
      4. Optimize feed loading order
         - Move feed loading to higher priority in effect execution order
         - Ensure feeds load in parallel with other initialization tasks
    - _Bug_Condition: isBugCondition(input) where input.isLoggedIn == true AND input.hasSavedCustomFeeds == true AND input.isInitialPageLoad == true_
    - _Expected_Behavior: Saved feeds are available and displayed in feed selector immediately on initial render without requiring user interaction_
    - _Preservation: Guest users see only preset feeds; users with no saved feeds see only preset feeds; manual feed additions work immediately; account switching loads correct feeds; feed mix state persists_
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 3.4_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Saved Feeds Load on Initial Page Load
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - Verify that:
      - `savedFeedSources` is populated immediately on initial render
      - Saved feeds appear in feed selector without button click
      - All test cases pass (1 saved feed, 3 saved feeds, mixed feed types)
    - _Requirements: 2.1, 2.2_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Buggy Input Behavior
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix:
      - Guest users see only preset feeds
      - Users with no saved feeds see only preset feeds
      - Manual feed additions display immediately
      - Account switching loads correct feeds
      - Feed mix state persists correctly
    - Verify no regressions in existing functionality
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

## Phase 4: Validation

- [x] 4. Checkpoint - Ensure all tests pass
  - Verify all exploration tests pass (Property 1: Expected Behavior)
  - Verify all preservation tests pass (Property 2: Preservation)
  - Verify no new test failures introduced
  - Verify no regressions in existing test suite
  - Ensure all tests pass, ask the user if questions arise
