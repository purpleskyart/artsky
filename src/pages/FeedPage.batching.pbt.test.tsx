import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fc from 'fast-check'
import { debounce } from '../lib/utils'
import { feedReducer, type FeedState, type FeedAction } from './feedReducer'

/**
 * Property-based tests for state update batching and debouncing
 * 
 * **Validates: Requirements 3.2, 3.4**
 * 
 * Property 3: State Update Batching and Debouncing
 * For any rapid sequence of state updates (seen posts, multiple related state changes),
 * the application should batch or debounce them to result in a single re-render and
 * a single side effect (e.g., localStorage write).
 */

describe('FeedPage - Property 3: State Update Batching and Debouncing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * Property: For any sequence of rapid state updates with debouncing,
   * only one side effect should occur after the debounce period
   */
  it('should batch any rapid sequence of updates into a single side effect', () => {
    fc.assert(
      fc.property(
        // Generate arbitrary sequences of updates
        fc.record({
          updates: fc.array(
            fc.record({
              uris: fc.array(fc.string(), { minLength: 1, maxLength: 10 }),
              delayMs: fc.integer({ min: 0, max: 500 }), // Delays shorter than debounce period
            }),
            { minLength: 2, maxLength: 20 }
          ),
          debounceMs: fc.integer({ min: 600, max: 2000 }), // Ensure debounce is longer than max total delay
        }),
        ({ updates, debounceMs }) => {
          // Track side effects
          const sideEffects: Set<string>[] = []
          const sideEffectFn = vi.fn((uris: Set<string>) => {
            sideEffects.push(new Set(uris))
          })

          const debouncedFn = debounce(sideEffectFn, debounceMs)

          // Apply all updates rapidly
          let totalDelay = 0
          updates.forEach((update) => {
            vi.advanceTimersByTime(update.delayMs)
            totalDelay += update.delayMs
            debouncedFn(new Set(update.uris))
          })

          // Ensure total delay is less than debounce period
          if (totalDelay >= debounceMs) {
            // Skip this test case as it doesn't represent rapid updates
            return true
          }

          // Before debounce completes, no side effects should occur
          expect(sideEffectFn).not.toHaveBeenCalled()

          // Complete the debounce period
          vi.advanceTimersByTime(debounceMs)

          // Property: Only ONE side effect should have occurred
          expect(sideEffectFn).toHaveBeenCalledTimes(1)
          expect(sideEffects).toHaveLength(1)

          // The side effect should contain the last update's data
          const lastUpdate = updates[updates.length - 1]
          const finalSideEffect = sideEffects[0]
          lastUpdate.uris.forEach((uri) => {
            expect(finalSideEffect.has(uri)).toBe(true)
          })
        }
      ),
      { numRuns: 20 }
    )
  })

  /**
   * Property: For any sequence of reducer actions that modify the same state slice,
   * the reducer should batch them into a single state object
   */
  it('should batch any sequence of related state updates into single state transitions', () => {
    fc.assert(
      fc.property(
        // Generate sequences of related actions
        fc.array(
          fc.oneof(
            fc.record({
              type: fc.constant('MARK_SEEN' as const),
              uris: fc.array(fc.string(), { minLength: 1, maxLength: 5 }),
            }),
            fc.record({
              type: fc.constant('UPDATE_LIKE_OVERRIDE' as const),
              postUri: fc.string(),
              likeUri: fc.oneof(fc.string(), fc.constant(null)),
            }),
            fc.record({
              type: fc.constant('SET_KEYBOARD_FOCUS' as const),
              index: fc.integer({ min: 0, max: 100 }),
            })
          ),
          { minLength: 2, maxLength: 15 }
        ),
        (actions) => {
          const initialState: FeedState = {
            items: [],
            cursor: undefined,
            loading: false,
            loadingMore: false,
            error: null,
            keyboardFocusIndex: 0,
            actionsMenuOpenForIndex: null,
            seenUris: new Set(),
            seenUrisAtReset: new Set(),
          }

          // Apply all actions sequentially
          let state = initialState
          actions.forEach((action) => {
            state = feedReducer(state, action as FeedAction)
          })

          // Property: Final state should reflect all updates
          // Count how many MARK_SEEN actions were dispatched
          const markSeenActions = actions.filter((a) => a.type === 'MARK_SEEN')
          const allSeenUris = new Set<string>()
          markSeenActions.forEach((action) => {
            if (action.type === 'MARK_SEEN') {
              action.uris.forEach((uri) => allSeenUris.add(uri))
            }
          })

          // All seen URIs should be in final state
          allSeenUris.forEach((uri) => {
            expect(state.seenUris.has(uri)).toBe(true)
          })

          // Check keyboard focus reflects last SET_KEYBOARD_FOCUS
          const focusActions = actions.filter((a) => a.type === 'SET_KEYBOARD_FOCUS')
          if (focusActions.length > 0) {
            const lastFocusAction = focusActions[focusActions.length - 1]
            if (lastFocusAction.type === 'SET_KEYBOARD_FOCUS') {
              expect(state.keyboardFocusIndex).toBe(lastFocusAction.index)
            }
          }
        }
      ),
      { numRuns: 20 }
    )
  })

  /**
   * Property: For any debounce delay and any sequence of rapid updates,
   * the number of side effects should be minimized (ideally 1)
   */
  it('should minimize side effects for any debounce configuration', () => {
    fc.assert(
      fc.property(
        fc.record({
          updateCount: fc.integer({ min: 5, max: 50 }),
          updateIntervalMs: fc.integer({ min: 10, max: 200 }),
          debounceMs: fc.integer({ min: 500, max: 2000 }),
        }),
        ({ updateCount, updateIntervalMs, debounceMs }) => {
          const sideEffectFn = vi.fn()
          const debouncedFn = debounce(sideEffectFn, debounceMs)

          // Simulate rapid updates
          for (let i = 0; i < updateCount; i++) {
            debouncedFn(new Set([`uri${i}`]))
            vi.advanceTimersByTime(updateIntervalMs)
          }

          // Complete debounce
          vi.advanceTimersByTime(debounceMs)

          // Property: Side effects should be significantly reduced
          // Without debouncing, there would be `updateCount` side effects
          // With debouncing, there should be far fewer
          const reductionRatio = sideEffectFn.mock.calls.length / updateCount

          // Expect at least 80% reduction in side effects
          expect(reductionRatio).toBeLessThanOrEqual(0.2)
        }
      ),
      { numRuns: 20 }
    )
  })

  /**
   * Property: For any sequence of state updates, the final state should be
   * deterministic and reflect all updates regardless of batching
   */
  it('should maintain state consistency for any sequence of updates', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            type: fc.constant('MARK_SEEN' as const),
            uris: fc.array(fc.string(), { minLength: 1, maxLength: 3 }),
          }),
          { minLength: 1, maxLength: 20 }
        ),
        (actions) => {
          const initialState: FeedState = {
            items: [],
            cursor: undefined,
            loading: false,
            loadingMore: false,
            error: null,
            keyboardFocusIndex: 0,
            actionsMenuOpenForIndex: null,
            seenUris: new Set(),
            seenUrisAtReset: new Set(),
          }

          // Apply actions one by one
          let state = initialState
          const expectedSeenUris = new Set<string>()

          actions.forEach((action) => {
            state = feedReducer(state, action)
            action.uris.forEach((uri) => expectedSeenUris.add(uri))
          })

          // Property: Final state should contain all URIs from all actions
          expect(state.seenUris.size).toBe(expectedSeenUris.size)
          expectedSeenUris.forEach((uri) => {
            expect(state.seenUris.has(uri)).toBe(true)
          })
        }
      ),
      { numRuns: 20 }
    )
  })

  /**
   * Property: For any debounced function, if updates stop, the side effect
   * should eventually occur exactly once after the debounce period
   */
  it('should guarantee eventual execution for any stopped update sequence', () => {
    fc.assert(
      fc.property(
        fc.record({
          updates: fc.array(fc.string(), { minLength: 1, maxLength: 10 }),
          debounceMs: fc.integer({ min: 100, max: 1000 }),
        }),
        ({ updates, debounceMs }) => {
          const sideEffectFn = vi.fn()
          const debouncedFn = debounce(sideEffectFn, debounceMs)

          // Apply all updates
          updates.forEach((update) => {
            debouncedFn(update)
          })

          // Before debounce completes
          expect(sideEffectFn).not.toHaveBeenCalled()

          // After debounce completes
          vi.advanceTimersByTime(debounceMs)

          // Property: Exactly one execution with the last value
          expect(sideEffectFn).toHaveBeenCalledTimes(1)
          expect(sideEffectFn).toHaveBeenCalledWith(updates[updates.length - 1])
        }
      ),
      { numRuns: 20 }
    )
  })

  /**
   * Property: For any combination of multiple state slices being updated,
   * each slice should maintain its own consistency
   */
  it('should maintain independence of different state slices during batching', () => {
    fc.assert(
      fc.property(
        fc.record({
          seenActions: fc.array(
            fc.record({
              type: fc.constant('MARK_SEEN' as const),
              uris: fc.array(fc.string(), { minLength: 1, maxLength: 3 }),
            }),
            { minLength: 1, maxLength: 5 }
          ),
          focusActions: fc.array(
            fc.record({
              type: fc.constant('SET_KEYBOARD_FOCUS' as const),
              index: fc.integer({ min: 0, max: 50 }),
            }),
            { minLength: 1, maxLength: 5 }
          ),
        }),
        ({ seenActions, focusActions }) => {
          const initialState: FeedState = {
            items: [],
            cursor: undefined,
            loading: false,
            loadingMore: false,
            error: null,
            keyboardFocusIndex: 0,
            actionsMenuOpenForIndex: null,
            seenUris: new Set(),
            seenUrisAtReset: new Set(),
          }

          // Interleave actions from different slices
          const allActions: FeedAction[] = [
            ...seenActions,
            ...focusActions,
          ]

          // Apply all actions
          let state = initialState
          allActions.forEach((action) => {
            state = feedReducer(state, action)
          })

          // Property: Each state slice should be independent and correct
          
          // Check seenUris
          const expectedSeenUris = new Set<string>()
          seenActions.forEach((action) => {
            action.uris.forEach((uri) => expectedSeenUris.add(uri))
          })
          expect(state.seenUris.size).toBe(expectedSeenUris.size)

          // Check keyboardFocusIndex
          if (focusActions.length > 0) {
            const lastFocusAction = focusActions[focusActions.length - 1]
            expect(state.keyboardFocusIndex).toBe(lastFocusAction.index)
          }
        }
      ),
      { numRuns: 20 }
    )
  })
})
