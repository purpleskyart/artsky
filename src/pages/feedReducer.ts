import type { TimelineItem } from '../lib/bsky'

/** Max posts kept in memory to limit DOM, React work, and OOM risk on long sessions. */
export const MAX_FEED_ITEMS = 600

function capFeedItems(items: TimelineItem[]): { items: TimelineItem[]; trimmed: boolean } {
  if (items.length <= MAX_FEED_ITEMS) return { items, trimmed: false }
  return { items: items.slice(-MAX_FEED_ITEMS), trimmed: true }
}

export type FeedState = {
  items: TimelineItem[]
  cursor: string | undefined
  loading: boolean
  loadingMore: boolean
  error: string | null
  keyboardFocusIndex: number
  actionsMenuOpenForIndex: number | null
  seenUris: Set<string>
  seenUrisAtReset: Set<string>
}

export type FeedAction =
  | { type: 'SET_ITEMS'; items: TimelineItem[]; cursor?: string }
  | { type: 'APPEND_ITEMS'; items: TimelineItem[]; cursor?: string }
  | { type: 'UPDATE_ITEMS'; updater: (items: TimelineItem[]) => TimelineItem[] }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_LOADING_MORE'; loadingMore: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_KEYBOARD_FOCUS'; index: number }
  | { type: 'SET_ACTIONS_MENU_OPEN'; index: number | null }
  | { type: 'MARK_SEEN'; uris: string[] }
  | { type: 'RESET_SEEN_SNAPSHOT' }
  | { type: 'CLEAR_SEEN' }

export function feedReducer(state: FeedState, action: FeedAction): FeedState {
  switch (action.type) {
    case 'SET_ITEMS': {
      const { items, trimmed } = capFeedItems(action.items)
      return {
        ...state,
        items,
        cursor: action.cursor,
        loading: false,
        error: null,
        ...(trimmed
          ? { keyboardFocusIndex: -1, actionsMenuOpenForIndex: null }
          : {}),
      }
    }

    case 'APPEND_ITEMS': {
      const { items, trimmed } = capFeedItems([...state.items, ...action.items])
      return {
        ...state,
        items,
        cursor: action.cursor,
        loadingMore: false,
        error: null,
        ...(trimmed
          ? { keyboardFocusIndex: -1, actionsMenuOpenForIndex: null }
          : {}),
      }
    }

    case 'UPDATE_ITEMS': {
      const { items, trimmed } = capFeedItems(action.updater(state.items))
      return {
        ...state,
        items,
        ...(trimmed
          ? { keyboardFocusIndex: -1, actionsMenuOpenForIndex: null }
          : {}),
      }
    }

    case 'SET_LOADING':
      return {
        ...state,
        loading: action.loading,
      }

    case 'SET_LOADING_MORE':
      return {
        ...state,
        loadingMore: action.loadingMore,
      }

    case 'SET_ERROR':
      return {
        ...state,
        error: action.error,
        loading: false,
        loadingMore: false,
      }

    case 'SET_KEYBOARD_FOCUS':
      return {
        ...state,
        keyboardFocusIndex: action.index,
      }

    case 'SET_ACTIONS_MENU_OPEN':
      return {
        ...state,
        actionsMenuOpenForIndex: action.index,
      }

    case 'MARK_SEEN': {
      const newSeenUris = new Set(state.seenUris)
      action.uris.forEach((uri) => newSeenUris.add(uri))
      
      // Prune old URIs if Set grows too large (keep most recent 2500)
      if (newSeenUris.size > 2500) {
        const urisArray = Array.from(newSeenUris)
        const pruned = new Set(urisArray.slice(-2000))
        return {
          ...state,
          seenUris: pruned,
        }
      }
      
      return {
        ...state,
        seenUris: newSeenUris,
      }
    }

    case 'RESET_SEEN_SNAPSHOT':
      return {
        ...state,
        seenUrisAtReset: new Set(state.seenUris),
      }

    case 'CLEAR_SEEN':
      return {
        ...state,
        seenUris: new Set(),
        seenUrisAtReset: new Set(),
      }

    default:
      return state
  }
}
