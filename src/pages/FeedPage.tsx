import { useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, startTransition, useSyncExternalStore } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import {
  agent,
  getPostMediaInfo,
  getPostAllMediaForDisplay,
  getGuestFeed,
  getSavedFeedsFromPreferences,
  getFeedDisplayName,
  getMixedFeed,
  isPostNsfw,
  type TimelineItem,
} from '../lib/bsky'
import type { FeedSource } from '../types'
import Layout, { FeedPullRefreshContext } from '../components/Layout'
import { useProfileModal } from '../context/ProfileModalContext'
import { useLoginModal } from '../context/LoginModalContext'
import { useSession } from '../context/SessionContext'
import { useMediaOnly } from '../context/MediaOnlyContext'
import { useFeedMix } from '../context/FeedMixContext'
import { useFeedSwipe } from '../context/FeedSwipeContext'
import { blockAccount } from '../lib/bsky'
import { useViewMode } from '../context/ViewModeContext'
import { useModeration } from '../context/ModerationContext'
import { useHideReposts } from '../context/HideRepostsContext'
import { useSeenPosts } from '../context/SeenPostsContext'
import { useLikeOverrides } from '../context/LikeOverridesContext'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import { useColumnCount } from '../hooks/useViewportWidth'
import SuggestedFollows from '../components/SuggestedFollows'
import FeedColumn from '../components/FeedColumn'
import { feedReducer, type FeedState } from './feedReducer'
import { debounce } from '../lib/utils'
import { asyncStorage } from '../lib/AsyncStorage'
import styles from './FeedPage.module.css'

/** Dedupe feed items by post URI (keep first). Stops the same post appearing as both original and repost. */
function dedupeFeedByPostUri(items: TimelineItem[]): TimelineItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const uri = item?.post?.uri
    if (!uri || seen.has(uri)) return false
    seen.add(uri)
    return true
  })
}

const SEEN_POSTS_KEY = 'artsky-seen-posts'
const SEEN_POSTS_MAX = 2000

function loadSeenUris(): Set<string> {
  const arr = asyncStorage.get<string[]>(SEEN_POSTS_KEY)
  return arr && Array.isArray(arr) ? new Set(arr) : new Set()
}

function saveSeenUris(uris: Set<string>) {
  const arr = [...uris]
  const toSave = arr.length > SEEN_POSTS_MAX ? arr.slice(-SEEN_POSTS_MAX) : arr
  // Use debounced async write (1000ms default)
  asyncStorage.set(SEEN_POSTS_KEY, toSave)
}

const PRESET_SOURCES: FeedSource[] = [
  { kind: 'timeline', label: 'Following' },
  { kind: 'custom', label: "What's Hot", uri: 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot' },
]

/** Nominal column width for height estimation (px). */
const ESTIMATE_COL_WIDTH = 280
const CARD_CHROME = 100
const REPOST_CAROUSEL_ESTIMATE_HEIGHT = 200

const REASON_REPOST = 'app.bsky.feed.defs#reasonRepost'
const REPOST_CAROUSEL_WINDOW_MS = 60 * 60 * 1000
const REPOST_CAROUSEL_MIN_COUNT = 4
const DESKTOP_BREAKPOINT = 768
function subscribeDesktop(cb: () => void) {
  if (typeof window === 'undefined') return () => {}
  const mq = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
function getDesktopSnapshot() {
  return typeof window !== 'undefined' ? window.innerWidth >= DESKTOP_BREAKPOINT : false
}

export type FeedDisplayEntry =
  | { type: 'post'; item: TimelineItem; entryIndex: number }
  | { type: 'carousel'; items: TimelineItem[]; entryIndex: number }

function isRepost(item: TimelineItem): boolean {
  return (item.reason as { $type?: string })?.$type === REASON_REPOST
}

function getItemTimestamp(item: TimelineItem): number {
  const createdAt = (item.post.record as { createdAt?: string })?.createdAt
  const indexedAt = (item.post as { indexedAt?: string }).indexedAt
  const s = createdAt ?? indexedAt ?? ''
  return s ? new Date(s).getTime() : 0
}

/** Group reposts: if more than 3 reposts fall within a 1-hour window, collapse into a carousel entry. */
export function buildDisplayEntries(items: TimelineItem[]): FeedDisplayEntry[] {
  const entries: FeedDisplayEntry[] = []
  let entryIndex = 0
  let repostWindow: TimelineItem[] = []
  let windowMin = 0
  let windowMax = 0

  function flushRepostWindow() {
    if (repostWindow.length >= REPOST_CAROUSEL_MIN_COUNT) {
      entries.push({ type: 'carousel', items: [...repostWindow], entryIndex: entryIndex++ })
    } else {
      for (const item of repostWindow) {
        entries.push({ type: 'post', item, entryIndex: entryIndex++ })
      }
    }
    repostWindow = []
  }

  for (const item of items) {
    if (!isRepost(item)) {
      flushRepostWindow()
      entries.push({ type: 'post', item, entryIndex: entryIndex++ })
      continue
    }
    const t = getItemTimestamp(item)
    if (repostWindow.length === 0) {
      repostWindow.push(item)
      windowMin = t
      windowMax = t
      continue
    }
    const newMin = Math.min(windowMin, t)
    const newMax = Math.max(windowMax, t)
    if (newMax - newMin <= REPOST_CAROUSEL_WINDOW_MS) {
      repostWindow.push(item)
      windowMin = newMin
      windowMax = newMax
    } else {
      flushRepostWindow()
      repostWindow = [item]
      windowMin = t
      windowMax = t
    }
  }
  flushRepostWindow()
  return entries
}

function estimateEntryHeight(entry: FeedDisplayEntry): number {
  if (entry.type === 'carousel') return REPOST_CAROUSEL_ESTIMATE_HEIGHT
  const media = getPostMediaInfo(entry.item.post)
  if (!media) return CARD_CHROME + 80
  if (media.aspectRatio != null && media.aspectRatio > 0) {
    return CARD_CHROME + ESTIMATE_COL_WIDTH / media.aspectRatio
  }
  return CARD_CHROME + 220
}

/** Distribute entries (posts and carousels) so no column is much longer than others. */
function distributeEntriesByHeight(
  entries: FeedDisplayEntry[],
  numCols: number,
  previousDistribution?: Array<Array<{ entry: FeedDisplayEntry; originalIndex: number }>>,
  previousEntryCount?: number
): Array<Array<{ entry: FeedDisplayEntry; originalIndex: number }>> {
  const cols = Math.min(3, Math.max(1, Math.floor(numCols)))
  if (cols < 1) return []
  
  // If we have a previous distribution and only new entries were added, preserve existing layout
  // BUT only if the column count hasn't changed
  if (previousDistribution && 
      previousDistribution.length === cols &&
      previousEntryCount !== undefined && 
      entries.length > previousEntryCount) {
    
    // Create a map of post URI to its column in previous distribution
    const uriToColumn = new Map<string, number>()
    previousDistribution.forEach((col, colIndex) => {
      col.forEach(({ entry }) => {
        const uri = entry.type === 'post' ? entry.item.post.uri : entry.items[0]?.post.uri
        if (uri) uriToColumn.set(uri, colIndex)
      })
    })
    
    // Start with empty columns
    const columns: Array<Array<{ entry: FeedDisplayEntry; originalIndex: number }>> = 
      Array.from({ length: cols }, () => [])
    const columnHeights: number[] = Array(cols).fill(0)
    
    // First pass: rebuild existing entries in their previous columns
    for (let i = 0; i < previousEntryCount; i++) {
      const entry = entries[i]
      const uri = entry.type === 'post' ? entry.item.post.uri : entry.items[0]?.post.uri
      
      if (uri) {
        const prevCol = uriToColumn.get(uri)
        if (prevCol !== undefined && prevCol < cols) {
          columns[prevCol].push({ entry, originalIndex: i })
          columnHeights[prevCol] += estimateEntryHeight(entry)
          continue
        }
      }
      
      // Fallback: if URI not found, add to shortest column
      const h = estimateEntryHeight(entry)
      let best = 0
      for (let c = 1; c < cols; c++) {
        if (columnHeights[c] < columnHeights[best]) {
          best = c
        }
      }
      columns[best].push({ entry, originalIndex: i })
      columnHeights[best] += h
    }
    
    // Second pass: append NEW entries to shortest columns (by height; tie-break by fewer items)
    for (let i = previousEntryCount; i < entries.length; i++) {
      const entry = entries[i]
      const h = estimateEntryHeight(entry)
      let best = 0
      for (let c = 1; c < cols; c++) {
        const shorter = columnHeights[c] < columnHeights[best]
        const sameHeight = Math.abs(columnHeights[c] - columnHeights[best]) < 2
        const fewerItems = columns[c].length < columns[best].length
        if (shorter || (sameHeight && fewerItems)) best = c
      }
      columns[best].push({ entry, originalIndex: i })
      columnHeights[best] += h
    }
    return columns
  }

  // Initial distribution or column count changed - redistribute everything
  const columns: Array<Array<{ entry: FeedDisplayEntry; originalIndex: number }>> = Array.from(
    { length: cols },
    () => []
  )
  const columnHeights: number[] = Array(cols).fill(0)
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const h = estimateEntryHeight(entry)
    const lengths = columns.map((col) => col.length)
    const minCount = lengths.length === 0 ? 0 : Math.min(...lengths)
    let best = -1
    for (let c = 0; c < cols; c++) {
      if (columns[c].length > minCount + 1) continue
      const shorter = best === -1 || columnHeights[c] < columnHeights[best]
      const sameHeight = best >= 0 && Math.abs(columnHeights[c] - columnHeights[best]) < 2
      const fewerItems = best >= 0 && columns[c].length < columns[best].length
      if (shorter || (sameHeight && fewerItems)) best = c
    }
    if (best === -1) best = 0
    columns[best].push({ entry, originalIndex: i })
    columnHeights[best] += h
  }
  return columns
}

/** Given columns from distributeEntriesByHeight, return the index of the card directly above or below. */
function indexAbove(
  columns: Array<Array<{ originalIndex: number }>>,
  currentIndex: number
): number {
  for (let c = 0; c < columns.length; c++) {
    const row = columns[c].findIndex((e) => e.originalIndex === currentIndex)
    if (row > 0) return columns[c][row - 1].originalIndex
    if (row === 0) return currentIndex
  }
  return currentIndex
}

function indexBelow(
  columns: Array<Array<{ originalIndex: number }>>,
  currentIndex: number
): number {
  for (let c = 0; c < columns.length; c++) {
    const row = columns[c].findIndex((e) => e.originalIndex === currentIndex)
    if (row >= 0 && row < columns[c].length - 1) return columns[c][row + 1].originalIndex
    if (row >= 0) return currentIndex
  }
  return currentIndex
}

/** Vertical overlap (shared space) between two rects in px. */
function verticalOverlap(a: DOMRect, b: DOMRect): number {
  const top = Math.max(a.top, b.top)
  const bottom = Math.min(a.bottom, b.bottom)
  return Math.max(0, bottom - top)
}

/**
 * Left nav: pick the card in the left column with the most vertical overlap.
 * If no card in that column has a valid rect (none loaded yet), stay put.
 */
function indexLeftClosest(
  columns: Array<Array<{ originalIndex: number }>>,
  currentIndex: number,
  getRect: (index: number) => DOMRect | undefined
): number {
  for (let c = 0; c < columns.length; c++) {
    if (columns[c].findIndex((e) => e.originalIndex === currentIndex) < 0) continue
    if (c === 0) return currentIndex
    const leftCol = columns[c - 1]
    const currentRect = getRect(currentIndex)
    if (!currentRect) return currentIndex
    let bestIndex = currentIndex
    let bestOverlap = -1
    for (const { originalIndex } of leftCol) {
      const r = getRect(originalIndex)
      if (!r) continue
      const overlap = verticalOverlap(currentRect, r)
      if (overlap > 0 && overlap > bestOverlap) {
        bestOverlap = overlap
        bestIndex = originalIndex
      }
    }
    return bestIndex
  }
  return currentIndex
}

/**
 * Right nav: pick the card in the right column with the most vertical overlap.
 * If no card in that column has a valid rect (none loaded yet), stay put.
 */
function indexRightClosest(
  columns: Array<Array<{ originalIndex: number }>>,
  currentIndex: number,
  getRect: (index: number) => DOMRect | undefined
): number {
  for (let c = 0; c < columns.length; c++) {
    if (columns[c].findIndex((e) => e.originalIndex === currentIndex) < 0) continue
    if (c === columns.length - 1) return currentIndex
    const rightCol = columns[c + 1]
    const currentRect = getRect(currentIndex)
    if (!currentRect) return currentIndex
    let bestIndex = currentIndex
    let bestOverlap = -1
    for (const { originalIndex } of rightCol) {
      const r = getRect(originalIndex)
      if (!r) continue
      const overlap = verticalOverlap(currentRect, r)
      if (overlap > 0 && overlap > bestOverlap) {
        bestOverlap = overlap
        bestIndex = originalIndex
      }
    }
    return bestIndex
  }
  return currentIndex
}

export default function FeedPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const isDesktop = useSyncExternalStore(subscribeDesktop, getDesktopSnapshot, () => false)
  const { openLoginModal } = useLoginModal()
  const { session } = useSession()
  const { viewMode } = useViewMode()
  const [source, setSource] = useState<FeedSource>(PRESET_SOURCES[0])
  const [, setSavedFeedSources] = useState<FeedSource[]>([])
  
  // Use the normalized like overrides cache from context
  const { likeOverrides, setLikeOverride } = useLikeOverrides()
  
  // Consolidated feed state using useReducer
  const [feedState, dispatch] = useReducer(feedReducer, {
    items: [],
    cursor: undefined,
    loading: true,
    loadingMore: false,
    error: null,
    keyboardFocusIndex: -1,
    actionsMenuOpenForIndex: null,
    seenUris: loadSeenUris(),
    seenUrisAtReset: new Set(),
  } as FeedState)
  
  /** One sentinel per column so we load more when the user nears the bottom of any column (avoids blank space in short columns). */
  const loadMoreSentinelRefs = useRef<(HTMLDivElement | null)[]>([])
  const loadingMoreRef = useRef(false)
  /** Cooldown after triggering load more so we don't fire again while sentinel stays in view (stops infinite load loop). */
  const lastLoadMoreAtRef = useRef(0)
  const [keyboardAddOpen, setKeyboardAddOpen] = useState(false)
  const { openPostModal, openForumPostModal, isModalOpen } = useProfileModal()
  const cardRefsRef = useRef<(HTMLDivElement | null)[]>([])
  /** Refs for focused media elements: [cardIndex][mediaIndex] for scroll-into-view on multi-image posts */
  const mediaRefsRef = useRef<Record<number, Record<number, HTMLElement | null>>>({})
  const mediaItemsRef = useRef<TimelineItem[]>([])
  const keyboardFocusIndexRef = useRef(-1)
  const actionsMenuOpenForIndexRef = useRef<number | null>(null)
  const lastScrollIntoViewIndexRef = useRef<number>(-1)
  /** Only scroll into view when focus was changed by keyboard (W/S/A/D), not by mouse hover */
  const scrollIntoViewFromKeyboardRef = useRef(false)
  /** Only update focus on mouse enter when the user has actually moved the mouse (not when scroll moved content under cursor) */
  const mouseMovedRef = useRef(false)
  /** True after W/S/A/D nav so we suppress hover outline on non-selected cards (focus is not moved to the card) */
  const [keyboardNavActive, setKeyboardNavActive] = useState(false)
  /** When true, focus was set by mouse hover – don’t lift one image in multi-image cards; only keyboard A/D should */
  const [focusSetByMouse, setFocusSetByMouse] = useState(false)
  const [blockConfirm, setBlockConfirm] = useState<{ did: string; handle: string; avatar?: string } | null>(null)
  const blockCancelRef = useRef<HTMLButtonElement>(null)
  const blockConfirmRef = useRef<HTMLButtonElement>(null)
  const prevPathnameRef = useRef(location.pathname)
  const seenUrisRef = useRef(feedState.seenUris)
  seenUrisRef.current = feedState.seenUris
  const seenPostsContext = useSeenPosts()
  const [suggestedFollowsOpen, setSuggestedFollowsOpen] = useState(false)
  const gridRef = useRef<HTMLDivElement | null>(null)

  // Register clear-seen handler so that long-press on Home can bring back all hidden (seen) items.
  useEffect(() => {
    if (!seenPostsContext) return
    seenPostsContext.setClearSeenHandler(() => {
      // Defer to next frame to batch DOM updates and reduce double-scrollbar flicker
      requestAnimationFrame(() => {
        asyncStorage.remove(SEEN_POSTS_KEY)
        seenUrisRef.current = new Set()
        dispatch({ type: 'CLEAR_SEEN' })
      })
    })
    return () => {
      seenPostsContext.setClearSeenHandler(null)
    }
  }, [seenPostsContext])

  // When Home/logo is clicked while already on feed: scroll to top (don't auto-hide read posts).
  // Defer to next frame so any IntersectionObserver callbacks from the same tick run first and seenUrisRef is up to date (fixes "two clicks" on logo/Home).
  useEffect(() => {
    if (!seenPostsContext) return
    seenPostsContext.setHomeClickHandler(() => {
      requestAnimationFrame(() => {
        window.scrollTo(0, 0)
      })
    })
    return () => {
      seenPostsContext.setHomeClickHandler(null)
    }
  }, [seenPostsContext])

  // When the eye (hide read) button is clicked: hide read posts only, no scroll. Show toast with count.
  useEffect(() => {
    if (!seenPostsContext) return
    seenPostsContext.setHideSeenOnlyHandler((showToast) => {
      requestAnimationFrame(() => {
        const count = seenUrisRef.current.size
        dispatch({ type: 'RESET_SEEN_SNAPSHOT' })
        showToast(count === 0 ? 'No read posts in feed' : `${count} read posts hidden`)
      })
    })
    return () => {
      seenPostsContext.setHideSeenOnlyHandler(null)
    }
  }, [seenPostsContext])

  const loadSavedFeeds = useCallback(async () => {
    if (!session) {
      setSavedFeedSources([])
      return
    }
    try {
      const list = await getSavedFeedsFromPreferences()
      const feeds = list.filter((f) => f.type === 'feed' && f.pinned)
      const withLabels = await Promise.all(
        feeds.map(async (f) => ({
          kind: 'custom' as const,
          label: await getFeedDisplayName(f.value).catch(() => f.value),
          uri: f.value,
        }))
      )
      setSavedFeedSources(withLabels)
    } catch {
      setSavedFeedSources([])
    }
  }, [session])

  useEffect(() => {
    loadSavedFeeds()
  }, [loadSavedFeeds])

  // Purplesky-style: hide floating buttons + nav when scrolling down; show on scroll up or stop
  // Debounce scroll handler to reduce layout work during rapid scroll events
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const stopScrollDelay = 200
    const scrollThreshold = 48
    let scrollYAtRest = typeof window !== 'undefined' ? window.scrollY : 0
    let lastY = scrollYAtRest
    const onScroll = () => {
      const y = window.scrollY
      const isHidden = document.body.classList.contains('feed-scrolling')
      const goingUp = y < lastY
      lastY = y

      if (goingUp) {
        if (isHidden) {
          document.body.classList.remove('feed-scrolling')
          if (timeoutId) {
            clearTimeout(timeoutId)
            timeoutId = undefined
          }
        }
        scrollYAtRest = y
        return
      }

      if (isHidden) {
        if (timeoutId) clearTimeout(timeoutId)
        timeoutId = setTimeout(() => {
          document.body.classList.remove('feed-scrolling')
          scrollYAtRest = window.scrollY
          timeoutId = undefined
        }, stopScrollDelay)
      } else if (y - scrollYAtRest >= scrollThreshold) {
        document.body.classList.add('feed-scrolling')
        if (timeoutId) clearTimeout(timeoutId)
        timeoutId = setTimeout(() => {
          document.body.classList.remove('feed-scrolling')
          scrollYAtRest = window.scrollY
          timeoutId = undefined
        }, stopScrollDelay)
      }
    }
    // Debounce scroll handler to reduce frequency of classList operations during rapid scrolling
    const debouncedOnScroll = debounce(onScroll, 16) // ~60fps
    window.addEventListener('scroll', debouncedOnScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', debouncedOnScroll)
      if (timeoutId) clearTimeout(timeoutId)
      document.body.classList.remove('feed-scrolling')
    }
  }, [])

  // When landing on the feed (refresh or logo/feed button): scroll to top. Don't auto-hide read posts.
  useEffect(() => {
    const pathnameChanged = prevPathnameRef.current !== location.pathname
    prevPathnameRef.current = location.pathname
    if (navigationType !== 'POP' && pathnameChanged) window.scrollTo(0, 0)
  }, [location.pathname, navigationType])

  useEffect(() => {
    const stateSource = (location.state as { feedSource?: FeedSource })?.feedSource
    if (stateSource) {
      setSource(stateSource)
      navigate(location.pathname, { replace: true })
    }
  }, [location.state, location.pathname, navigate])

  const {
    entries: mixEntries,
    totalPercent: mixTotalPercent,
  } = useFeedMix()
  const feedSwipe = useFeedSwipe()

  const swipeStartRef = useRef<{ x: number; y: number } | null>(null)
  const swipeGestureRef = useRef<'unknown' | 'swipe' | 'pull'>('unknown')
  const feedItemsRef = useRef<TimelineItem[]>([])
  feedItemsRef.current = feedState.items

  function sameFeedSource(a: FeedSource, b: FeedSource): boolean {
    return (a.uri ?? a.label) === (b.uri ?? b.label)
  }

  const FEED_LOAD_TIMEOUT_MS = 15_000

  const load = useCallback(async (nextCursor?: string, signal?: AbortSignal) => {
    const cols = Math.min(3, Math.max(1, viewMode === '1' ? 1 : viewMode === '2' ? 2 : 3))
    const limit = cols >= 2 ? cols * 10 : 30
    
    // Don't refresh feed (load new items at top) if user is scrolled down
    if (!nextCursor && window.scrollY > 100) {
      // Still need to clear loading state to prevent infinite loop
      dispatch({ type: 'SET_LOADING', loading: false })
      return
    }
    
    try {
      // Check if request was cancelled
      if (signal?.aborted) {
        return
      }
      
      if (nextCursor) dispatch({ type: 'SET_LOADING_MORE', loadingMore: true })
      else dispatch({ type: 'SET_LOADING', loading: true })
      dispatch({ type: 'SET_ERROR', error: null })

      const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
        Promise.race([
          p,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Request timed out. Check your network connection.')), ms),
          ),
        ])

      if (!session) {
        const { feed, cursor: next } = await withTimeout(getGuestFeed(limit, nextCursor), FEED_LOAD_TIMEOUT_MS)
        
        // Check if request was cancelled before updating state
        if (signal?.aborted) {
          return
        }
        
        const apply = () => {
          const items = dedupeFeedByPostUri(nextCursor ? [...feedItemsRef.current, ...feed] : feed)
          if (nextCursor) {
            dispatch({ type: 'APPEND_ITEMS', items: feed, cursor: next })
          } else {
            dispatch({ type: 'SET_ITEMS', items, cursor: next })
          }
        }
        if (nextCursor) startTransition(apply)
        else apply()
      } else if (mixEntries.length >= 2 && mixTotalPercent >= 99) {
        const isLoadMore = !!nextCursor
        let cursorsToUse: Record<string, string> | undefined
        if (isLoadMore && nextCursor) {
          try {
            cursorsToUse = JSON.parse(nextCursor) as Record<string, string>
          } catch {
            cursorsToUse = undefined
          }
        }
        const { feed, cursors: nextCursors } = await withTimeout(
          getMixedFeed(
            mixEntries.map((e) => ({ source: e.source, percent: e.percent })),
            limit,
            cursorsToUse,
            signal
          ),
          FEED_LOAD_TIMEOUT_MS
        )
        
        // Check if request was cancelled before updating state
        if (signal?.aborted) {
          return
        }
        
        const apply = () => {
          const items = dedupeFeedByPostUri(isLoadMore ? [...feedItemsRef.current, ...feed] : feed)
          const cursor = Object.keys(nextCursors).length > 0 ? JSON.stringify(nextCursors) : undefined
          if (isLoadMore) {
            dispatch({ type: 'APPEND_ITEMS', items: feed, cursor })
          } else {
            dispatch({ type: 'SET_ITEMS', items, cursor })
          }
        }
        if (isLoadMore) startTransition(apply)
        else apply()
      } else if (mixEntries.length === 1) {
        const single = mixEntries[0].source
        if (single.kind === 'timeline') {
          const res = await withTimeout(agent.getTimeline({ limit, cursor: nextCursor }), FEED_LOAD_TIMEOUT_MS)
          const apply = () => {
            const items = dedupeFeedByPostUri(nextCursor ? [...feedItemsRef.current, ...res.data.feed] : res.data.feed)
            if (nextCursor) {
              dispatch({ type: 'APPEND_ITEMS', items: res.data.feed, cursor: res.data.cursor })
            } else {
              dispatch({ type: 'SET_ITEMS', items, cursor: res.data.cursor })
            }
          }
          if (nextCursor) startTransition(apply)
          else apply()
        } else if (single.uri) {
          const res = await withTimeout(agent.app.bsky.feed.getFeed({ feed: single.uri, limit, cursor: nextCursor }), FEED_LOAD_TIMEOUT_MS)
          const apply = () => {
            const items = dedupeFeedByPostUri(nextCursor ? [...feedItemsRef.current, ...res.data.feed] : res.data.feed)
            if (nextCursor) {
              dispatch({ type: 'APPEND_ITEMS', items: res.data.feed, cursor: res.data.cursor })
            } else {
              dispatch({ type: 'SET_ITEMS', items, cursor: res.data.cursor })
            }
          }
          if (nextCursor) startTransition(apply)
          else apply()
        }
      } else if (source.kind === 'timeline') {
        const res = await withTimeout(agent.getTimeline({ limit, cursor: nextCursor }), FEED_LOAD_TIMEOUT_MS)
        const apply = () => {
          const items = dedupeFeedByPostUri(nextCursor ? [...feedItemsRef.current, ...res.data.feed] : res.data.feed)
          if (nextCursor) {
            dispatch({ type: 'APPEND_ITEMS', items: res.data.feed, cursor: res.data.cursor })
          } else {
            dispatch({ type: 'SET_ITEMS', items, cursor: res.data.cursor })
          }
        }
        if (nextCursor) startTransition(apply)
        else apply()
      } else if (source.uri) {
        const res = await withTimeout(agent.app.bsky.feed.getFeed({ feed: source.uri, limit, cursor: nextCursor }), FEED_LOAD_TIMEOUT_MS)
        const apply = () => {
          const items = dedupeFeedByPostUri(nextCursor ? [...feedItemsRef.current, ...res.data.feed] : res.data.feed)
          if (nextCursor) {
            dispatch({ type: 'APPEND_ITEMS', items: res.data.feed, cursor: res.data.cursor })
          } else {
            dispatch({ type: 'SET_ITEMS', items, cursor: res.data.cursor })
          }
        }
        if (nextCursor) startTransition(apply)
        else apply()
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load feed'
      dispatch({ type: 'SET_ERROR', error: msg })
    } finally {
      dispatch({ type: 'SET_LOADING', loading: false })
      dispatch({ type: 'SET_LOADING_MORE', loadingMore: false })
    }
  }, [source, session, mixEntries, mixTotalPercent])

  useEffect(() => {
    const abortController = new AbortController()
    load(undefined, abortController.signal)
    return () => {
      abortController.abort()
    }
  }, [load])

  // Infinite scroll: load more when sentinel enters view. Cooldown prevents re-triggering while sentinel stays in view (stops infinite load loop).
  // Large rootMargin so we load before the user reaches the end. After each load we also schedule a
  // fallback check: if any column's sentinel is above (viewport bottom + margin) we trigger another
  // load once the cooldown expires.
  const LOAD_MORE_COOLDOWN_MS = 1800
  /** Start loading when sentinel is within this distance below the viewport (load before user reaches end). */
  const LOAD_MORE_ROOT_MARGIN_PX = 1200
  /** Consider a column "short" when its sentinel is above this line (trigger load before blank space visible). */
  const LOAD_MORE_SHORT_MARGIN_PX = 600
  loadingMoreRef.current = feedState.loadingMore
  useEffect(() => {
    if (!feedState.cursor) return
    const refs = loadMoreSentinelRefs.current
    let rafId = 0
    let timeoutId = 0
    let retryId = 0
    const cols = Math.min(3, Math.max(1, viewMode === '1' ? 1 : viewMode === '2' ? 2 : 3))

    /** True when any column's sentinel is above (viewport bottom + margin) so we load before user reaches end. */
    const anyColumnShort = () => {
      const threshold = window.innerHeight + LOAD_MORE_SHORT_MARGIN_PX
      for (let c = 0; c < cols; c++) {
        const el = refs[c]
        if (!el) continue
        if (el.getBoundingClientRect().bottom < threshold) return true
      }
      return false
    }

    /** After cooldown, check for short columns and load more if needed. */
    const scheduleRetry = () => {
      clearTimeout(retryId)
      const wait = Math.max(50, LOAD_MORE_COOLDOWN_MS - (Date.now() - lastLoadMoreAtRef.current) + 50)
      retryId = window.setTimeout(() => {
        if (loadingMoreRef.current) return
        if (anyColumnShort()) {
          loadingMoreRef.current = true
          lastLoadMoreAtRef.current = Date.now()
          load(feedState.cursor)
        }
      }, wait)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting || loadingMoreRef.current) continue
          if (Date.now() - lastLoadMoreAtRef.current < LOAD_MORE_COOLDOWN_MS) {
            scheduleRetry()
            continue
          }
          loadingMoreRef.current = true
          const c = feedState.cursor
          rafId = requestAnimationFrame(() => {
            rafId = 0
            timeoutId = window.setTimeout(() => {
              timeoutId = 0
              lastLoadMoreAtRef.current = Date.now()
              load(c)
            }, 120)
          })
          break
        }
      },
      { rootMargin: `${LOAD_MORE_ROOT_MARGIN_PX}px`, threshold: 0 }
    )
    for (let c = 0; c < cols; c++) {
      const el = refs[c]
      if (el) observer.observe(el)
    }

    // After each cursor change (new posts loaded), schedule a fallback check for short columns
    // whose sentinels may have scrolled beyond rootMargin or been blocked by cooldown.
    if (cols > 1) scheduleRetry()

    return () => {
      observer.disconnect()
      if (rafId) cancelAnimationFrame(rafId)
      if (timeoutId) clearTimeout(timeoutId)
      clearTimeout(retryId)
    }
  }, [feedState.cursor, load, viewMode])

  const { mediaMode } = useMediaOnly()
  const { nsfwPreference, unblurredUris, setUnblurred } = useModeration()
  const { hideRepostsFromDids } = useHideReposts() ?? { hideRepostsFromDids: [] as string[] }
  const displayItems = useMemo(() =>
    feedState.items
      .filter((item) => (mediaMode === 'media' ? getPostMediaInfo(item.post) : true))
      .filter((item) => !feedState.seenUrisAtReset.has(item.post.uri))
      .filter((item) => nsfwPreference !== 'sfw' || !isPostNsfw(item.post))
      .filter((item) => {
        if (!isRepost(item)) return true
        const reposterDid = (item.reason as { by?: { did: string } })?.by?.did
        return !reposterDid || !hideRepostsFromDids.includes(reposterDid)
      }),
    [feedState.items, mediaMode, feedState.seenUrisAtReset, nsfwPreference, hideRepostsFromDids]
  )
  const displayEntries = useMemo(() => buildDisplayEntries(displayItems), [displayItems])
  const itemsAfterOtherFilters = useMemo(() =>
    feedState.items
      .filter((item) => (mediaMode === 'media' ? getPostMediaInfo(item.post) : true))
      .filter((item) => nsfwPreference !== 'sfw' || !isPostNsfw(item.post)),
    [feedState.items, mediaMode, nsfwPreference]
  )
  /** Only "seen all" when there's nothing more to load (no cursor). With mixed feeds, one feed can be exhausted while others still have posts. */
  const emptyBecauseAllSeen = displayEntries.length === 0 && itemsAfterOtherFilters.length > 0 && !feedState.cursor
  const canLoadMoreWhenEmpty = displayEntries.length === 0 && feedState.cursor != null
  
  // Use debounced column count to minimize re-renders on viewport resize
  const cols = useColumnCount(viewMode, 150)
  
  // Track previous distribution to avoid re-shuffling existing posts when new ones load
  const previousDistributionRef = useRef<Array<Array<{ entry: FeedDisplayEntry; originalIndex: number }>>>([])
  const previousEntryCountRef = useRef<number>(0)
  const previousColsRef = useRef<number>(0)
  
  // Reset distribution tracking when feed source changes or items are reset (not appended)
  useEffect(() => {
    previousDistributionRef.current = []
    previousEntryCountRef.current = 0
    previousColsRef.current = 0
  }, [source, mediaMode, nsfwPreference])
  
  // Memoize column distribution to prevent recalculation on every render
  const distributedColumns = useMemo(() => {
    // Reset if column count changed
    if (cols !== previousColsRef.current) {
      previousDistributionRef.current = []
      previousEntryCountRef.current = 0
    }
    
    const newDistribution = distributeEntriesByHeight(
      displayEntries, 
      cols,
      previousDistributionRef.current,
      previousEntryCountRef.current
    )
    previousDistributionRef.current = newDistribution
    previousEntryCountRef.current = displayEntries.length
    previousColsRef.current = cols
    return newDistribution
  }, [displayEntries, cols])
  
  /** Flat list of focus targets: one per media item per post (or one per card in text-only mode). */
  const focusTargets = useMemo(() => {
    const out: { cardIndex: number; mediaIndex: number }[] = []
    displayEntries.forEach((entry, cardIndex) => {
      if (entry.type === 'post') {
        const n = mediaMode === 'text' ? 1 : Math.max(1, getPostAllMediaForDisplay(entry.item.post).length)
        for (let m = 0; m < n; m++) out.push({ cardIndex, mediaIndex: m })
      } else {
        out.push({ cardIndex, mediaIndex: 0 })
      }
    })
    return out
  }, [displayEntries, mediaMode])
  /** First focus index for each card (top image; for S and A/D). */
  const firstFocusIndexForCard = useMemo(() => {
    const out: number[] = []
    let idx = 0
    displayEntries.forEach((_entry, cardIndex) => {
      out[cardIndex] = idx
      const entry = displayEntries[cardIndex]
      const n = entry.type === 'post' ? (mediaMode === 'text' ? 1 : Math.max(1, getPostAllMediaForDisplay(entry.item.post).length)) : 1
      idx += n
    })
    return out
  }, [displayEntries, mediaMode])
  /** Last focus index for each card (bottom image; for W when moving to card above). */
  const lastFocusIndexForCard = useMemo(() => {
    const out: number[] = []
    displayEntries.forEach((entry, cardIndex) => {
      const n = entry.type === 'post' ? (mediaMode === 'text' ? 1 : Math.max(1, getPostAllMediaForDisplay(entry.item.post).length)) : 1
      out[cardIndex] = firstFocusIndexForCard[cardIndex] + n - 1
    })
    return out
  }, [displayEntries, firstFocusIndexForCard, mediaMode])
  mediaItemsRef.current = displayItems
  keyboardFocusIndexRef.current = feedState.keyboardFocusIndex
  actionsMenuOpenForIndexRef.current = feedState.actionsMenuOpenForIndex

  // Stable callback refs to prevent unnecessary re-renders
  const handleCardRef = useCallback((index: number) => (el: HTMLDivElement | null) => {
    cardRefsRef.current[index] = el
  }, [])

  const handleMediaRef = useCallback((index: number, mediaIndex: number, el: HTMLElement | null) => {
    if (!mediaRefsRef.current[index]) mediaRefsRef.current[index] = {}
    mediaRefsRef.current[index][mediaIndex] = el
  }, [])

  const handleActionsMenuOpenChange = useCallback((index: number, open: boolean) => {
    dispatch({ type: 'SET_ACTIONS_MENU_OPEN', index: open ? index : null })
  }, [])

  const handleMouseEnter = useCallback((originalIndex: number) => {
    if (isDesktop && mouseMovedRef.current) {
      mouseMovedRef.current = false
      setKeyboardNavActive(false)
      setFocusSetByMouse(true)
      dispatch({ type: 'SET_KEYBOARD_FOCUS', index: firstFocusIndexForCard[originalIndex] ?? 0 })
    }
  }, [isDesktop, firstFocusIndexForCard])

  const handleAddClose = useCallback(() => {
    setKeyboardAddOpen(false)
  }, [])

  useEffect(() => {
    const currentIndex = feedState.keyboardFocusIndex
    if (currentIndex < 0) return
    if (focusTargets.length === 0) {
      dispatch({ type: 'SET_KEYBOARD_FOCUS', index: -1 })
      return
    }
    const newIndex = Math.min(currentIndex, focusTargets.length - 1)
    if (newIndex !== currentIndex) {
      dispatch({ type: 'SET_KEYBOARD_FOCUS', index: newIndex })
    }
  }, [focusTargets.length, feedState.keyboardFocusIndex])

  // Debounced save to localStorage to reduce write frequency (1000ms delay)
  const debouncedSaveSeenUris = useMemo(
    () => debounce((uris: Set<string>) => saveSeenUris(uris), 1000),
    []
  )

  useEffect(() => {
    debouncedSaveSeenUris(feedState.seenUris)
  }, [feedState.seenUris, debouncedSaveSeenUris])

  // Mark posts as seen when they scroll past the top of the viewport.
  // With virtualization, elements come and go from the DOM, so we use a MutationObserver
  // to detect when new elements are added and observe them dynamically.
  useEffect(() => {
    const pendingUris = new Set<string>()
    let flushRaf = 0
    let lastFlushTime = 0
    const SEEN_FLUSH_INTERVAL_MS = 400
    const observedElements = new WeakSet<Element>()

    const flushPending = () => {
      flushRaf = 0
      if (pendingUris.size === 0) return
      const now = Date.now()
      if (now - lastFlushTime < SEEN_FLUSH_INTERVAL_MS) {
        flushRaf = requestAnimationFrame(flushPending)
        return
      }
      lastFlushTime = now
      const toAdd = Array.from(pendingUris)
      pendingUris.clear()
      startTransition(() => {
        dispatch({ type: 'MARK_SEEN', uris: toAdd })
        seenUrisRef.current = new Set([...seenUrisRef.current, ...toAdd])
      })
    }

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting && entry.boundingClientRect.top < 0) {
            const uri = (entry.target as HTMLElement).getAttribute('data-post-uri')
            if (uri && !seenUrisRef.current.has(uri)) {
              pendingUris.add(uri)
            }
          }
        }
        if (pendingUris.size > 0 && !flushRaf) flushRaf = requestAnimationFrame(flushPending)
      },
      { threshold: 0, rootMargin: '0px' }
    )

    // Function to observe an element if it has data-post-uri and hasn't been observed yet
    const observeElement = (el: Element) => {
      if (el instanceof HTMLElement && 
          el.hasAttribute('data-post-uri') && 
          !observedElements.has(el)) {
        intersectionObserver.observe(el)
        observedElements.add(el)
      }
    }

    // Observe all existing elements with data-post-uri
    const gridEl = gridRef.current
    if (gridEl) {
      const existingElements = gridEl.querySelectorAll('[data-post-uri]')
      existingElements.forEach(observeElement)

      // Watch for new elements being added (virtualization adds/removes elements)
      const mutationObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof HTMLElement) {
              // Check the node itself
              observeElement(node)
              // Check children
              const children = node.querySelectorAll('[data-post-uri]')
              children.forEach(observeElement)
            }
          })
        }
      })

      mutationObserver.observe(gridEl, {
        childList: true,
        subtree: true,
      })

      return () => {
        intersectionObserver.disconnect()
        mutationObserver.disconnect()
        if (flushRaf) cancelAnimationFrame(flushRaf)
      }
    }

    return () => {
      intersectionObserver.disconnect()
      if (flushRaf) cancelAnimationFrame(flushRaf)
    }
  }, [displayEntries.length])

  useEffect(() => {
    const onMouseMove = () => { mouseMovedRef.current = true }
    window.addEventListener('mousemove', onMouseMove)
    return () => window.removeEventListener('mousemove', onMouseMove)
  }, [])

  // Scroll focused card/media into view only when focus was changed by keyboard (W/S/A/D), not on mouse hover
  useEffect(() => {
    if (!scrollIntoViewFromKeyboardRef.current) return
    scrollIntoViewFromKeyboardRef.current = false
    if (feedState.keyboardFocusIndex === lastScrollIntoViewIndexRef.current) return
    lastScrollIntoViewIndexRef.current = feedState.keyboardFocusIndex
    const target = focusTargets[feedState.keyboardFocusIndex]
    const raf = requestAnimationFrame(() => {
      const cardIndex = target?.cardIndex ?? feedState.keyboardFocusIndex
      const mediaIndex = target?.mediaIndex ?? 0
      const mediaEl = mediaRefsRef.current[cardIndex]?.[mediaIndex]
      const el = mediaEl ?? cardRefsRef.current[cardIndex]
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [feedState.keyboardFocusIndex, focusTargets])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      /* Never affect feed when a popup is open: check both context and URL (URL covers first render after open). */
      const hasContentModalInUrl = /[?&](post|profile|tag|forumPost|artboard)=/.test(location.search)
      if (isModalOpen || hasContentModalInUrl) return
      const eventTarget = e.target as HTMLElement
      if (eventTarget.tagName === 'INPUT' || eventTarget.tagName === 'TEXTAREA' || eventTarget.tagName === 'SELECT' || eventTarget.isContentEditable) {
        if (e.key === 'Escape') {
          e.preventDefault()
          eventTarget.blur()
        }
        return
      }
      if (e.ctrlKey || e.metaKey) return

      const i = keyboardFocusIndexRef.current
      if (displayEntries.length === 0 || focusTargets.length === 0) return

      setFocusSetByMouse(false)
      const focusTarget = focusTargets[i]
      const currentCardIndex = focusTarget?.cardIndex ?? 0
      const focusedEntry = displayEntries[currentCardIndex]
      const focusedItem = focusedEntry?.type === 'post' ? focusedEntry.item : focusedEntry?.type === 'carousel' ? focusedEntry.items[0] : null

      const key = e.key.toLowerCase()
      const focusInActionsMenu = (document.activeElement as HTMLElement)?.closest?.('[role="menu"]')
      const menuOpenForFocusedCard = feedState.actionsMenuOpenForIndex === currentCardIndex
      if ((focusInActionsMenu || menuOpenForFocusedCard) && (key === 'w' || key === 's' || key === 'e' || key === 'enter' || key === 'q' || key === 'escape')) {
        return
      }
      /* Ignore key repeat for left/right only (so A/D don’t skip); allow repeat for W/S so holding moves up/down */
      if (e.repeat && (key === 'a' || key === 'd' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return
      if (blockConfirm) {
        if (key === 'escape') {
          e.preventDefault()
          setBlockConfirm(null)
          return
        }
        return // let Tab/Enter reach the dialog buttons
      }
      if (key === 'w' || key === 's' || key === 'a' || key === 'd' || key === 'e' || key === 'enter' || key === 'r' || key === 'f' || key === 'c' || key === 'h' || key === 'b' || key === 'm' || key === '`' || key === '4' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.preventDefault()

      if (key === 'b') {
        if (focusedItem?.post?.author && session?.did !== focusedItem.post.author.did) {
          setBlockConfirm({
            did: focusedItem.post.author.did,
            handle: focusedItem.post.author.handle ?? focusedItem.post.author.did,
            avatar: focusedItem.post.author.avatar,
          })
          requestAnimationFrame(() => blockCancelRef.current?.focus())
        }
        return
      }

      /* Use ref + concrete value (not functional updater) so Strict Mode double-invoke doesn't move two steps */
      const fromNone = i < 0
      const columns = cols >= 2 ? distributedColumns : null
      const getRect = (idx: number) => cardRefsRef.current[idx]?.getBoundingClientRect()
      if (key === 'w' || e.key === 'ArrowUp') {
        mouseMovedRef.current = false
        setKeyboardNavActive(true)
        scrollIntoViewFromKeyboardRef.current = true
        const onFirstImageOfCard = i === firstFocusIndexForCard[currentCardIndex]
        const next = fromNone
          ? (lastFocusIndexForCard[displayEntries.length - 1] ?? focusTargets.length - 1)
          : !onFirstImageOfCard
            ? Math.max(0, i - 1)
            : (() => {
                const nextCard = cols >= 2 && columns ? indexAbove(columns, currentCardIndex) : Math.max(0, currentCardIndex - 1)
                return lastFocusIndexForCard[nextCard] ?? firstFocusIndexForCard[nextCard] ?? 0
              })()
        dispatch({ type: 'SET_KEYBOARD_FOCUS', index: next })
        return
      }
      if (key === 's' || e.key === 'ArrowDown') {
        mouseMovedRef.current = false
        setKeyboardNavActive(true)
        scrollIntoViewFromKeyboardRef.current = true
        const onLastImageOfCard = i === lastFocusIndexForCard[currentCardIndex]
        const next = fromNone
          ? 0
          : !onLastImageOfCard
            ? Math.min(focusTargets.length - 1, i + 1)
            : (() => {
                const nextCard = cols >= 2 && columns ? indexBelow(columns, currentCardIndex) : Math.min(displayEntries.length - 1, currentCardIndex + 1)
                return firstFocusIndexForCard[nextCard] ?? i
              })()
        dispatch({ type: 'SET_KEYBOARD_FOCUS', index: next })
        return
      }
      if (key === 'a' || e.key === 'ArrowLeft') {
        mouseMovedRef.current = false
        setKeyboardNavActive(true)
        scrollIntoViewFromKeyboardRef.current = true
        const nextCard = fromNone ? 0 : cols >= 2 && columns ? indexLeftClosest(columns, currentCardIndex, getRect) : currentCardIndex
        const next = fromNone ? 0 : nextCard !== currentCardIndex ? (lastFocusIndexForCard[nextCard] ?? i) : i
        if (next !== i) dispatch({ type: 'SET_ACTIONS_MENU_OPEN', index: null })
        dispatch({ type: 'SET_KEYBOARD_FOCUS', index: next })
        return
      }
      if (key === 'd' || e.key === 'ArrowRight') {
        mouseMovedRef.current = false
        setKeyboardNavActive(true)
        scrollIntoViewFromKeyboardRef.current = true
        const nextCard = fromNone ? 0 : cols >= 2 && columns ? indexRightClosest(columns, currentCardIndex, getRect) : currentCardIndex
        const next = fromNone ? 0 : nextCard !== currentCardIndex ? (lastFocusIndexForCard[nextCard] ?? i) : i
        if (next !== i) dispatch({ type: 'SET_ACTIONS_MENU_OPEN', index: null })
        dispatch({ type: 'SET_KEYBOARD_FOCUS', index: next })
        return
      }
      if ((key === 'm' || key === '`') && i >= 0) {
        if (menuOpenForFocusedCard) {
          dispatch({ type: 'SET_ACTIONS_MENU_OPEN', index: null })
        } else {
          dispatch({ type: 'SET_ACTIONS_MENU_OPEN', index: currentCardIndex })
        }
        return
      }
      if (key === 'e' || key === 'enter') {
        if (focusedItem) openPostModal(focusedItem.post.uri)
        return
      }
      if (key === 'r') {
        if (focusedItem) openPostModal(focusedItem.post.uri, true)
        return
      }
      if (key === 'f') {
        const item = focusedItem
        if (!item?.post?.uri || !item?.post?.cid) return
        const uri = item.post.uri
        const currentLikeUri = uri in likeOverrides ? (likeOverrides[uri] ?? undefined) : (item.post as { viewer?: { like?: string } }).viewer?.like
        if (currentLikeUri) {
          agent.deleteLike(currentLikeUri).then(() => {
            setLikeOverride(uri, null)
          }).catch(() => {})
        } else {
          agent.like(uri, item.post.cid).then((res) => {
            setLikeOverride(uri, res.uri)
          }).catch(() => {})
        }
        return
      }
      if (key === 'c') {
        setKeyboardAddOpen(true)
        return
      }
      if (key === '4') {
        const author = focusedItem?.post?.author as { did: string; viewer?: { following?: string } } | undefined
        const postUri = focusedItem?.post?.uri
        if (author && session?.did && session.did !== author.did && postUri) {
          const followingUri = author.viewer?.following
          if (followingUri) {
            agent.deleteFollow(followingUri).then(() => {
              dispatch({
                type: 'UPDATE_ITEMS',
                updater: (prev) =>
                  prev.map((it): TimelineItem => {
                    if (it.post.uri !== postUri) return it
                    const post = it.post
                    const auth = post.author as { did: string; handle?: string; viewer?: { following?: string } }
                    return {
                      ...it,
                      post: {
                        ...post,
                        author: {
                          ...auth,
                          viewer: { ...auth.viewer, following: undefined },
                        },
                      } as TimelineItem['post'],
                    }
                  })
              })
            }).catch(() => {})
          } else {
            agent.follow(author.did).then((res) => {
              dispatch({
                type: 'UPDATE_ITEMS',
                updater: (prev) =>
                  prev.map((it): TimelineItem => {
                    if (it.post.uri !== postUri) return it
                    const post = it.post
                    const auth = post.author as { did: string; handle?: string; viewer?: { following?: string } }
                    return {
                      ...it,
                      post: {
                        ...post,
                        author: {
                          ...auth,
                          viewer: { ...auth.viewer, following: res.uri },
                        },
                      } as TimelineItem['post'],
                    }
                  })
              })
            }).catch(() => {})
          }
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [location.search, cols, isModalOpen, openPostModal, blockConfirm, session, likeOverrides, feedState.actionsMenuOpenForIndex, focusTargets, firstFocusIndexForCard, lastFocusIndexForCard])

  useEffect(() => {
    if (blockConfirm) blockCancelRef.current?.focus()
  }, [blockConfirm])

  const pullRefreshTargetRef = useRef<HTMLDivElement>(null)
  const feedPullRefresh = useContext(FeedPullRefreshContext)
  const pullRefreshTouchTargetRef = feedPullRefresh?.wrapperRef ?? pullRefreshTargetRef
  const pullRefresh = usePullToRefresh({
    scrollRef: { current: null },
    touchTargetRef: pullRefreshTouchTargetRef,
    onRefresh: async () => {
      await load()
      requestAnimationFrame(() => {
        window.scrollTo(0, 0)
      })
    },
    enabled: isDesktop,
    maxTouchStartY: 130,
  })

  const swipeEnabled =
    !!feedSwipe && mixEntries.length === 1 && feedSwipe.feedSources.length > 1

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      pullRefresh.onTouchStart(e)
      if (swipeEnabled && e.touches.length === 1) {
        swipeStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
        swipeGestureRef.current = 'unknown'
      }
    },
    [swipeEnabled, pullRefresh]
  )

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (swipeEnabled && swipeStartRef.current && e.touches.length === 1) {
        if (swipeGestureRef.current === 'unknown') {
          const dx = e.touches[0].clientX - swipeStartRef.current.x
          const dy = e.touches[0].clientY - swipeStartRef.current.y
          if (Math.abs(dx) > 20 || Math.abs(dy) > 20) {
            swipeGestureRef.current = Math.abs(dx) > 2 * Math.abs(dy) ? 'swipe' : 'pull'
          }
        }
        if (swipeGestureRef.current === 'pull' || swipeGestureRef.current === 'unknown') {
          pullRefresh.onTouchMove(e)
        }
      } else {
        pullRefresh.onTouchMove(e)
      }
    },
    [swipeEnabled, pullRefresh]
  )

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (swipeEnabled && feedSwipe && swipeStartRef.current && e.changedTouches.length === 1) {
        const dx = e.changedTouches[0].clientX - swipeStartRef.current.x
        const dy = e.changedTouches[0].clientY - swipeStartRef.current.y
        if (
          swipeGestureRef.current === 'swipe' &&
          Math.abs(dx) > 80 &&
          Math.abs(dx) > 2 * Math.abs(dy)
        ) {
          const sources = feedSwipe.feedSources
          const cur = mixEntries[0].source
          const idx = sources.findIndex((s) => sameFeedSource(s, cur))
          if (idx >= 0) {
            const nextIdx = dx < 0 ? (idx + 1) % sources.length : (idx - 1 + sources.length) % sources.length
            feedSwipe.setSingleFeed(sources[nextIdx])
          }
        }
        swipeStartRef.current = null
        swipeGestureRef.current = 'unknown'
      }
      pullRefresh.onTouchEnd(e)
    },
    [swipeEnabled, feedSwipe, mixEntries, pullRefresh]
  )

  useEffect(() => {
    const setHandlers = feedPullRefresh?.setHandlers
    if (setHandlers) {
      setHandlers({ onTouchStart: handleTouchStart, onTouchMove: handleTouchMove, onTouchEnd: handleTouchEnd })
      return () => {
        setHandlers(null)
      }
    }
  }, [feedPullRefresh?.setHandlers, handleTouchStart, handleTouchMove, handleTouchEnd])

  const useWrapperForPull = !!feedPullRefresh?.wrapperRef

  return (
    <Layout title="Feed" showNav>
      <>
      <div
        ref={pullRefreshTargetRef}
        className={styles.wrap}
        onTouchStart={useWrapperForPull ? undefined : handleTouchStart}
        onTouchMove={useWrapperForPull ? undefined : handleTouchMove}
        onTouchEnd={useWrapperForPull ? undefined : handleTouchEnd}
      >
        <div
          className={`${styles.pullRefreshHeader} ${(pullRefresh.pullDistance > 0 || pullRefresh.isRefreshing) ? styles.pullRefreshHeaderActive : ''}`}
          aria-hidden={pullRefresh.pullDistance === 0 && !pullRefresh.isRefreshing}
          aria-live="polite"
          aria-label={pullRefresh.isRefreshing ? 'Refreshing' : undefined}
        >
          {(pullRefresh.pullDistance > 0 || pullRefresh.isRefreshing) && (
            <div className={styles.pullRefreshSpinner} />
          )}
        </div>
        <div
          className={styles.pullRefreshContent}
          style={{
            transform: `translateY(${pullRefresh.pullDistance}px)`,
          }}
        >
        {session && (
          <div className={styles.suggestedFollowsSection}>
            <div className={styles.suggestedFollowsSectionInner}>
              <button
                type="button"
                className={styles.suggestedFollowsToggle}
                onClick={() => setSuggestedFollowsOpen((open) => !open)}
                aria-expanded={suggestedFollowsOpen}
                aria-label={suggestedFollowsOpen ? 'Hide suggestions' : 'Discover accounts to follow'}
              >
                {suggestedFollowsOpen ? 'Hide suggestions' : 'Discover accounts'}
              </button>
            </div>
            {suggestedFollowsOpen && <SuggestedFollows />}
          </div>
        )}
        <div
          key={mixEntries.length === 1 ? (mixEntries[0].source.uri ?? mixEntries[0].source.label) : 'mixed'}
          className={styles.feedContentTransition}
        >
        {feedState.error && <p className={styles.error}>{feedState.error}</p>}
        {feedState.loading ? (
          <div className={styles.loading}>Loading…</div>
        ) : displayEntries.length === 0 ? (
          <div className={styles.empty}>
            {canLoadMoreWhenEmpty ? (
              <>
                <p className={styles.emptyLoadMoreText}>
                  {itemsAfterOtherFilters.length > 0
                    ? "You've seen everything visible from this batch. There may be more from your other feeds."
                    : 'No posts in this batch.'}
                </p>
                <button
                  type="button"
                  className={styles.loadMoreBtn}
                  onClick={() => feedState.cursor && !feedState.loadingMore && load(feedState.cursor)}
                  disabled={feedState.loadingMore}
                >
                  {feedState.loadingMore ? 'Loading…' : 'Load more'}
                </button>
              </>
            ) : emptyBecauseAllSeen ? (
              <>You've read all the posts in this feed.<br />New posts will appear as they're posted.</>
            ) : mediaMode === 'media' ? (
              'No posts with images or videos in this feed.'
            ) : (
              'No posts in this feed.'
            )}
          </div>
        ) : (
          <>
            <div
              ref={gridRef}
              className={`${styles.gridColumns} ${styles[`gridView${viewMode}`]}`}
              data-feed-cards
              data-view-mode={viewMode}
              data-keyboard-nav={keyboardNavActive || undefined}
            >
              {distributedColumns.map((column, colIndex) => (
                <FeedColumn
                  key={colIndex}
                  column={column}
                  colIndex={colIndex}
                  loadMoreSentinelRef={feedState.cursor ? (el) => { loadMoreSentinelRefs.current[colIndex] = el } : undefined}
                  hasCursor={!!feedState.cursor}
                  keyboardFocusIndex={feedState.keyboardFocusIndex}
                  focusTargets={focusTargets}
                  firstFocusIndexForCard={firstFocusIndexForCard}
                  focusSetByMouse={focusSetByMouse}
                  keyboardAddOpen={keyboardAddOpen}
                  actionsMenuOpenForIndex={feedState.actionsMenuOpenForIndex}
                  nsfwPreference={nsfwPreference}
                  unblurredUris={unblurredUris}
                  setUnblurred={setUnblurred}
                  likeOverrides={likeOverrides}
                  setLikeOverrides={setLikeOverride}
                  seenUris={feedState.seenUris}
                  openPostModal={openPostModal}
                  cardRef={handleCardRef}
                  onMediaRef={handleMediaRef}
                  onActionsMenuOpenChange={handleActionsMenuOpenChange}
                  onMouseEnter={handleMouseEnter}
                  onAddClose={handleAddClose}
                />
              ))}
            </div>
            {session && (
              <div className={styles.loadMoreRow}>
                {feedState.loadingMore && (
                  <p className={styles.loadingMore} role="status">Loading more…</p>
                )}
                <button
                  type="button"
                  className={styles.loadMoreBtn}
                  onClick={() => feedState.cursor && !feedState.loadingMore && load(feedState.cursor)}
                  disabled={feedState.loadingMore || !feedState.cursor}
                >
                  {feedState.cursor ? 'Load more' : 'No more posts'}
                </button>
              </div>
            )}
          </>
        )}
        </div>
        {!session && (
          <div className={styles.feedLoginHint}>
            <div className={styles.feedLoginHintBtnRow}>
              <button type="button" className={styles.feedLoginHintBtn} onClick={() => openLoginModal()}>
                Log in
              </button>
            </div>
            <p className={styles.feedLoginHintText}>
              Or{' '}
              <button type="button" className={styles.feedLoginHintLink} onClick={() => openLoginModal('create')}>
                create an account
              </button>
              {' to see your own feeds.'}
            </p>
          </div>
        )}
        </div>
      </div>
      {blockConfirm && (
        <div
          className={styles.blockOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="block-dialog-title"
          onKeyDown={(e) => e.key === 'Escape' && setBlockConfirm(null)}
          onClick={() => setBlockConfirm(null)}
        >
          <div className={styles.blockDialog} onClick={(e) => e.stopPropagation()}>
            <h2 id="block-dialog-title" className={styles.blockTitle}>Block user?</h2>
            <div className={styles.blockUser}>
              {blockConfirm.avatar ? (
                <img src={blockConfirm.avatar} alt="" className={styles.blockAvatar} loading="lazy" />
              ) : (
                <div className={styles.blockAvatarPlaceholder} />
              )}
              <span className={styles.blockHandle}>@{blockConfirm.handle}</span>
            </div>
            <div className={styles.blockActions}>
              <button
                ref={blockCancelRef}
                type="button"
                className={styles.blockCancelBtn}
                onClick={() => setBlockConfirm(null)}
              >
                Cancel
              </button>
              <button
                ref={blockConfirmRef}
                type="button"
                className={styles.blockConfirmBtn}
                onClick={async () => {
                  if (!blockConfirm) return
                  try {
                    await blockAccount(blockConfirm.did)
                    setBlockConfirm(null)
                  } catch (_) {}
                }}
              >
                Block
              </button>
            </div>
          </div>
        </div>
      )}
      </>
    </Layout>
  )
}
