import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { feedReducer, type FeedState, type FeedAction } from './feedReducer'
import type { TimelineItem } from '../lib/bsky'
import { debounce } from '../lib/utils'

/**
 * Unit tests for FeedPage state management
 * 
 * **Validates: Requirements 3.2, 3.4**
 * 
 * These tests verify that:
 * 1. The reducer handles all action types correctly
 * 2. Debouncing batches rapid updates to reduce re-renders
 */

describe('feedReducer', () => {
  let initialState: FeedState

  beforeEach(() => {
    initialState = {
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
  })

  describe('SET_ITEMS action', () => {
    it('should set items and cursor', () => {
      const mockItems: TimelineItem[] = [
        { post: { uri: 'uri1' } } as TimelineItem,
        { post: { uri: 'uri2' } } as TimelineItem,
      ]
      const action: FeedAction = {
        type: 'SET_ITEMS',
        items: mockItems,
        cursor: 'cursor123',
      }

      const newState = feedReducer(initialState, action)

      expect(newState.items).toEqual(mockItems)
      expect(newState.cursor).toBe('cursor123')
      expect(newState.loading).toBe(false)
      expect(newState.error).toBe(null)
    })

    it('should clear loading and error states', () => {
      const stateWithLoadingAndError: FeedState = {
        ...initialState,
        loading: true,
        error: 'Previous error',
      }
      const action: FeedAction = {
        type: 'SET_ITEMS',
        items: [],
      }

      const newState = feedReducer(stateWithLoadingAndError, action)

      expect(newState.loading).toBe(false)
      expect(newState.error).toBe(null)
    })

    it('should handle undefined cursor', () => {
      const action: FeedAction = {
        type: 'SET_ITEMS',
        items: [],
      }

      const newState = feedReducer(initialState, action)

      expect(newState.cursor).toBeUndefined()
    })
  })

  describe('APPEND_ITEMS action', () => {
    it('should append items to existing items', () => {
      const existingItems: TimelineItem[] = [
        { post: { uri: 'uri1' } } as TimelineItem,
      ]
      const stateWithItems: FeedState = {
        ...initialState,
        items: existingItems,
      }
      const newItems: TimelineItem[] = [
        { post: { uri: 'uri2' } } as TimelineItem,
        { post: { uri: 'uri3' } } as TimelineItem,
      ]
      const action: FeedAction = {
        type: 'APPEND_ITEMS',
        items: newItems,
        cursor: 'cursor456',
      }

      const newState = feedReducer(stateWithItems, action)

      expect(newState.items).toHaveLength(3)
      expect(newState.items[0]).toEqual(existingItems[0])
      expect(newState.items[1]).toEqual(newItems[0])
      expect(newState.items[2]).toEqual(newItems[1])
      expect(newState.cursor).toBe('cursor456')
    })

    it('should clear loadingMore and error states', () => {
      const stateWithLoadingMore: FeedState = {
        ...initialState,
        loadingMore: true,
        error: 'Load more error',
      }
      const action: FeedAction = {
        type: 'APPEND_ITEMS',
        items: [],
      }

      const newState = feedReducer(stateWithLoadingMore, action)

      expect(newState.loadingMore).toBe(false)
      expect(newState.error).toBe(null)
    })
  })

  describe('SET_LOADING action', () => {
    it('should set loading to true', () => {
      const action: FeedAction = {
        type: 'SET_LOADING',
        loading: true,
      }

      const newState = feedReducer(initialState, action)

      expect(newState.loading).toBe(true)
    })

    it('should set loading to false', () => {
      const stateWithLoading: FeedState = {
        ...initialState,
        loading: true,
      }
      const action: FeedAction = {
        type: 'SET_LOADING',
        loading: false,
      }

      const newState = feedReducer(stateWithLoading, action)

      expect(newState.loading).toBe(false)
    })

    it('should not affect other state properties', () => {
      const stateWithData: FeedState = {
        ...initialState,
        items: [{ post: { uri: 'uri1' } } as TimelineItem],
        cursor: 'cursor123',
        error: 'Some error',
      }
      const action: FeedAction = {
        type: 'SET_LOADING',
        loading: true,
      }

      const newState = feedReducer(stateWithData, action)

      expect(newState.items).toEqual(stateWithData.items)
      expect(newState.cursor).toBe(stateWithData.cursor)
      expect(newState.error).toBe(stateWithData.error)
    })
  })

  describe('SET_LOADING_MORE action', () => {
    it('should set loadingMore to true', () => {
      const action: FeedAction = {
        type: 'SET_LOADING_MORE',
        loadingMore: true,
      }

      const newState = feedReducer(initialState, action)

      expect(newState.loadingMore).toBe(true)
    })

    it('should set loadingMore to false', () => {
      const stateWithLoadingMore: FeedState = {
        ...initialState,
        loadingMore: true,
      }
      const action: FeedAction = {
        type: 'SET_LOADING_MORE',
        loadingMore: false,
      }

      const newState = feedReducer(stateWithLoadingMore, action)

      expect(newState.loadingMore).toBe(false)
    })
  })

  describe('SET_ERROR action', () => {
    it('should set error message', () => {
      const action: FeedAction = {
        type: 'SET_ERROR',
        error: 'Network error',
      }

      const newState = feedReducer(initialState, action)

      expect(newState.error).toBe('Network error')
    })

    it('should clear loading and loadingMore states', () => {
      const stateWithLoading: FeedState = {
        ...initialState,
        loading: true,
        loadingMore: true,
      }
      const action: FeedAction = {
        type: 'SET_ERROR',
        error: 'Error occurred',
      }

      const newState = feedReducer(stateWithLoading, action)

      expect(newState.loading).toBe(false)
      expect(newState.loadingMore).toBe(false)
      expect(newState.error).toBe('Error occurred')
    })

    it('should clear error when set to null', () => {
      const stateWithError: FeedState = {
        ...initialState,
        error: 'Previous error',
      }
      const action: FeedAction = {
        type: 'SET_ERROR',
        error: null,
      }

      const newState = feedReducer(stateWithError, action)

      expect(newState.error).toBe(null)
    })
  })

  describe('SET_KEYBOARD_FOCUS action', () => {
    it('should set keyboard focus index', () => {
      const action: FeedAction = {
        type: 'SET_KEYBOARD_FOCUS',
        index: 5,
      }

      const newState = feedReducer(initialState, action)

      expect(newState.keyboardFocusIndex).toBe(5)
    })

    it('should update keyboard focus index', () => {
      const stateWithFocus: FeedState = {
        ...initialState,
        keyboardFocusIndex: 3,
      }
      const action: FeedAction = {
        type: 'SET_KEYBOARD_FOCUS',
        index: 10,
      }

      const newState = feedReducer(stateWithFocus, action)

      expect(newState.keyboardFocusIndex).toBe(10)
    })

    it('should handle zero index', () => {
      const action: FeedAction = {
        type: 'SET_KEYBOARD_FOCUS',
        index: 0,
      }

      const newState = feedReducer(initialState, action)

      expect(newState.keyboardFocusIndex).toBe(0)
    })
  })

  describe('SET_ACTIONS_MENU_OPEN action', () => {
    it('should set actions menu open index', () => {
      const action: FeedAction = {
        type: 'SET_ACTIONS_MENU_OPEN',
        index: 7,
      }

      const newState = feedReducer(initialState, action)

      expect(newState.actionsMenuOpenForIndex).toBe(7)
    })

    it('should close actions menu when set to null', () => {
      const stateWithMenuOpen: FeedState = {
        ...initialState,
        actionsMenuOpenForIndex: 5,
      }
      const action: FeedAction = {
        type: 'SET_ACTIONS_MENU_OPEN',
        index: null,
      }

      const newState = feedReducer(stateWithMenuOpen, action)

      expect(newState.actionsMenuOpenForIndex).toBe(null)
    })
  })

  describe('MARK_SEEN action', () => {
    it('should add URIs to seenUris set', () => {
      const action: FeedAction = {
        type: 'MARK_SEEN',
        uris: ['uri1', 'uri2', 'uri3'],
      }

      const newState = feedReducer(initialState, action)

      expect(newState.seenUris.size).toBe(3)
      expect(newState.seenUris.has('uri1')).toBe(true)
      expect(newState.seenUris.has('uri2')).toBe(true)
      expect(newState.seenUris.has('uri3')).toBe(true)
    })

    it('should merge with existing seenUris', () => {
      const stateWithSeen: FeedState = {
        ...initialState,
        seenUris: new Set(['uri1', 'uri2']),
      }
      const action: FeedAction = {
        type: 'MARK_SEEN',
        uris: ['uri3', 'uri4'],
      }

      const newState = feedReducer(stateWithSeen, action)

      expect(newState.seenUris.size).toBe(4)
      expect(newState.seenUris.has('uri1')).toBe(true)
      expect(newState.seenUris.has('uri2')).toBe(true)
      expect(newState.seenUris.has('uri3')).toBe(true)
      expect(newState.seenUris.has('uri4')).toBe(true)
    })

    it('should handle duplicate URIs', () => {
      const stateWithSeen: FeedState = {
        ...initialState,
        seenUris: new Set(['uri1', 'uri2']),
      }
      const action: FeedAction = {
        type: 'MARK_SEEN',
        uris: ['uri2', 'uri3'],
      }

      const newState = feedReducer(stateWithSeen, action)

      expect(newState.seenUris.size).toBe(3)
      expect(newState.seenUris.has('uri1')).toBe(true)
      expect(newState.seenUris.has('uri2')).toBe(true)
      expect(newState.seenUris.has('uri3')).toBe(true)
    })

    it('should handle empty URIs array', () => {
      const action: FeedAction = {
        type: 'MARK_SEEN',
        uris: [],
      }

      const newState = feedReducer(initialState, action)

      expect(newState.seenUris.size).toBe(0)
    })

    it('should create a new Set instance', () => {
      const stateWithSeen: FeedState = {
        ...initialState,
        seenUris: new Set(['uri1']),
      }
      const action: FeedAction = {
        type: 'MARK_SEEN',
        uris: ['uri2'],
      }

      const newState = feedReducer(stateWithSeen, action)

      // Verify immutability - new Set instance created
      expect(newState.seenUris).not.toBe(stateWithSeen.seenUris)
    })
  })

  describe('RESET_SEEN_SNAPSHOT action', () => {
    it('should snapshot current seenUris to seenUrisAtReset', () => {
      const stateWithSeen: FeedState = {
        ...initialState,
        seenUris: new Set(['uri1', 'uri2', 'uri3']),
      }
      const action: FeedAction = {
        type: 'RESET_SEEN_SNAPSHOT',
      }

      const newState = feedReducer(stateWithSeen, action)

      expect(newState.seenUrisAtReset.size).toBe(3)
      expect(newState.seenUrisAtReset.has('uri1')).toBe(true)
      expect(newState.seenUrisAtReset.has('uri2')).toBe(true)
      expect(newState.seenUrisAtReset.has('uri3')).toBe(true)
      // Original seenUris should remain unchanged
      expect(newState.seenUris).toEqual(stateWithSeen.seenUris)
    })

    it('should handle empty seenUris', () => {
      const action: FeedAction = {
        type: 'RESET_SEEN_SNAPSHOT',
      }

      const newState = feedReducer(initialState, action)

      expect(newState.seenUrisAtReset.size).toBe(0)
    })
  })

  describe('CLEAR_SEEN action', () => {
    it('should clear both seenUris and seenUrisAtReset', () => {
      const stateWithSeen: FeedState = {
        ...initialState,
        seenUris: new Set(['uri1', 'uri2']),
        seenUrisAtReset: new Set(['uri3', 'uri4']),
      }
      const action: FeedAction = {
        type: 'CLEAR_SEEN',
      }

      const newState = feedReducer(stateWithSeen, action)

      expect(newState.seenUris.size).toBe(0)
      expect(newState.seenUrisAtReset.size).toBe(0)
    })

    it('should create new empty Set instances', () => {
      const stateWithSeen: FeedState = {
        ...initialState,
        seenUris: new Set(['uri1']),
        seenUrisAtReset: new Set(['uri2']),
      }
      const action: FeedAction = {
        type: 'CLEAR_SEEN',
      }

      const newState = feedReducer(stateWithSeen, action)

      // Verify immutability - new Set instances created
      expect(newState.seenUris).not.toBe(stateWithSeen.seenUris)
      expect(newState.seenUrisAtReset).not.toBe(stateWithSeen.seenUrisAtReset)
    })
  })

  describe('Reducer immutability', () => {
    it('should not mutate original state', () => {
      const originalState: FeedState = {
        ...initialState,
        items: [{ post: { uri: 'uri1' } } as TimelineItem],
        seenUris: new Set(['uri1']),
      }
      const stateCopy = JSON.parse(JSON.stringify({
        ...originalState,
        seenUris: [...originalState.seenUris],
      }))

      const action: FeedAction = {
        type: 'MARK_SEEN',
        uris: ['uri2'],
      }

      feedReducer(originalState, action)

      // Original state should remain unchanged
      expect(originalState.items).toHaveLength(1)
      expect([...originalState.seenUris]).toEqual(stateCopy.seenUris)
    })

    it('should return new state object for all actions', () => {
      const actions: FeedAction[] = [
        { type: 'SET_LOADING', loading: true },
        { type: 'SET_ERROR', error: 'error' },
        { type: 'MARK_SEEN', uris: ['uri1'] },
        { type: 'SET_KEYBOARD_FOCUS', index: 5 },
      ]

      actions.forEach((action) => {
        const newState = feedReducer(initialState, action)
        expect(newState).not.toBe(initialState)
      })
    })
  })
})

describe('Debouncing for state updates', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should batch rapid MARK_SEEN dispatches with debouncing', () => {
    const dispatchFn = vi.fn()
    const debouncedDispatch = debounce(dispatchFn, 1000)

    // Simulate rapid seen posts updates
    debouncedDispatch({ type: 'MARK_SEEN', uris: ['uri1'] })
    vi.advanceTimersByTime(200)
    debouncedDispatch({ type: 'MARK_SEEN', uris: ['uri1', 'uri2'] })
    vi.advanceTimersByTime(200)
    debouncedDispatch({ type: 'MARK_SEEN', uris: ['uri1', 'uri2', 'uri3'] })

    // Before debounce completes, no dispatches should occur
    expect(dispatchFn).not.toHaveBeenCalled()

    // Complete debounce period
    vi.advanceTimersByTime(1000)

    // Only one dispatch with the final state
    expect(dispatchFn).toHaveBeenCalledTimes(1)
    expect(dispatchFn).toHaveBeenCalledWith({
      type: 'MARK_SEEN',
      uris: ['uri1', 'uri2', 'uri3'],
    })
  })

  it('should reduce re-renders by batching multiple state updates', () => {
    let renderCount = 0
    const mockDispatch = vi.fn((action: FeedAction) => {
      renderCount++
      return action
    })
    const debouncedDispatch = debounce(mockDispatch, 1000)

    // Simulate 20 rapid updates
    for (let i = 1; i <= 20; i++) {
      const uris = Array.from({ length: i }, (_, j) => `uri${j + 1}`)
      debouncedDispatch({ type: 'MARK_SEEN', uris })
      vi.advanceTimersByTime(50)
    }

    // Before debounce completes
    expect(renderCount).toBe(0)

    // Complete debounce
    vi.advanceTimersByTime(1000)

    // Only 1 render instead of 20 (95% reduction)
    expect(renderCount).toBe(1)
    const reductionPercentage = ((20 - 1) / 20) * 100
    expect(reductionPercentage).toBe(95)
  })

  it('should preserve the most recent state when debouncing', () => {
    const states: FeedAction[] = []
    const mockDispatch = vi.fn((action: FeedAction) => {
      states.push(action)
    })
    const debouncedDispatch = debounce(mockDispatch, 1000)

    // Multiple updates with different data
    debouncedDispatch({ type: 'SET_KEYBOARD_FOCUS', index: 1 })
    vi.advanceTimersByTime(100)
    debouncedDispatch({ type: 'SET_KEYBOARD_FOCUS', index: 5 })
    vi.advanceTimersByTime(100)
    debouncedDispatch({ type: 'SET_KEYBOARD_FOCUS', index: 10 })

    vi.advanceTimersByTime(1000)

    // Only the last state should be dispatched
    expect(states).toHaveLength(1)
    expect(states[0]).toEqual({ type: 'SET_KEYBOARD_FOCUS', index: 10 })
  })

  it('should allow subsequent updates after debounce completes', () => {
    const mockDispatch = vi.fn()
    const debouncedDispatch = debounce(mockDispatch, 1000)

    // First batch
    debouncedDispatch({ type: 'MARK_SEEN', uris: ['uri1'] })
    vi.advanceTimersByTime(1000)
    expect(mockDispatch).toHaveBeenCalledTimes(1)

    // Second batch
    debouncedDispatch({ type: 'MARK_SEEN', uris: ['uri2'] })
    vi.advanceTimersByTime(1000)
    expect(mockDispatch).toHaveBeenCalledTimes(2)

    // Third batch
    debouncedDispatch({ type: 'MARK_SEEN', uris: ['uri3'] })
    vi.advanceTimersByTime(1000)
    expect(mockDispatch).toHaveBeenCalledTimes(3)
  })

  it('should handle mixed action types with debouncing', () => {
    const dispatches: FeedAction[] = []
    const mockDispatch = vi.fn((action: FeedAction) => {
      dispatches.push(action)
    })
    const debouncedDispatch = debounce(mockDispatch, 1000)

    // Mix different action types
    debouncedDispatch({ type: 'MARK_SEEN', uris: ['uri1'] })
    vi.advanceTimersByTime(100)
    debouncedDispatch({ type: 'SET_KEYBOARD_FOCUS', index: 5 })
    vi.advanceTimersByTime(100)
    debouncedDispatch({ type: 'SET_ACTIONS_MENU_OPEN', index: 3 })

    vi.advanceTimersByTime(1000)

    // Only the last action should be dispatched
    expect(dispatches).toHaveLength(1)
    expect(dispatches[0]).toEqual({ type: 'SET_ACTIONS_MENU_OPEN', index: 3 })
  })
})
