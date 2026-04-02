import { useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, startTransition, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import {
  getPostMediaInfoForDisplay,
  getPostAllMediaForDisplay,
  getGuestFeed,
  getMixedFeed,
  getTimelineWithLifecycle,
  getFeedWithLifecycle,
  isPostNsfw,
  likePostWithLifecycle,
  unlikePostWithLifecycle,
  followAccountWithLifecycle,
  unfollowAccountWithLifecycle,
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
import { usePullToRefresh, PULL_THRESHOLD_PX } from '../hooks/usePullToRefresh'
import { useStandalonePwa } from '../hooks/useStandalonePwa'
import { useColumnCount } from '../hooks/useViewportWidth'
import { usePostCardGridPointerGate } from '../hooks/usePostCardGridPointerGate'
import FeedColumn from '../components/FeedColumn'
import { feedReducer, type FeedState } from './feedReducer'
import { debounce } from '../lib/utils'
import { asyncStorage } from '../lib/AsyncStorage'
import styles from './FeedPage.module.css'

/** Dedupe feed items by post URI (keep first). Stops the same post appearing as both original and repost. */
function dedupeFeedByPostUri(items: TimelineItem[] | undefined | null): TimelineItem[] {
  const list = items ?? []
  const seen = new Set<string>()
  return list.filter((item) => {
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

const REASON_REPOST = 'app.bsky.feed.defs#reasonRepost'
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

export type FeedDisplayEntry = { type: 'post'; item: TimelineItem; entryIndex: number }

function isRepost(item: TimelineItem): boolean {
  return (item.reason as { $type?: string })?.$type === REASON_REPOST
}

export function buildDisplayEntries(items: TimelineItem[]): FeedDisplayEntry[] {
  return items.map((item, entryIndex) => ({ type: 'post', item, entryIndex }))
}

function estimateEntryHeight(entry: FeedDisplayEntry): number {
  const media = getPostMediaInfoForDisplay(entry.item.post)
  if (!media) return CARD_CHROME + 80
  if (media.aspectRatio != null && media.aspectRatio > 0) {
    return CARD_CHROME + ESTIMATE_COL_WIDTH / media.aspectRatio
  }
  return CARD_CHROME + 220
}

/** Stable id for column placement and list keys (append, trim, load more). */
export function stableCardKey(entry: FeedDisplayEntry): string {
  return `p:${entry.item.post.uri}`
}

function previousColumnForEntry(
  entry: FeedDisplayEntry,
  keyToColumn: Map<string, number>,
  numCols: number
): number | undefined {
  const fromKey = keyToColumn.get(stableCardKey(entry))
  if (fromKey !== undefined && fromKey < numCols) return fromKey
  return undefined
}

function pickShortestColumnIndex(
  columns: Array<Array<{ entry: FeedDisplayEntry; originalIndex: number }>>,
  columnHeights: number[]
): number {
  const cols = columnHeights.length
  let best = 0
  for (let c = 1; c < cols; c++) {
    const shorter = columnHeights[c] < columnHeights[best]
    const sameHeight = Math.abs(columnHeights[c] - columnHeights[best]) < 2
    const fewerItems = columns[c].length < columns[best].length
    if (shorter || (sameHeight && fewerItems)) best = c
  }
  return best
}

/** Distribute entries so no column is much longer than others. */
function distributeEntriesByHeight(
  entries: FeedDisplayEntry[],
  numCols: number,
  previousDistribution?: Array<Array<{ entry: FeedDisplayEntry; originalIndex: number }>>
): Array<Array<{ entry: FeedDisplayEntry; originalIndex: number }>> {
  const cols = Math.max(1, Math.floor(numCols))
  if (cols < 1) return []

  // Reuse each card's column from the last layout when column count is unchanged — including when
  // the entry list shrinks or grows (load more), so previews don't jump.
  if (previousDistribution && previousDistribution.length === cols) {
    const keyToColumn = new Map<string, number>()
    previousDistribution.forEach((col, colIndex) => {
      col.forEach(({ entry }) => {
        keyToColumn.set(stableCardKey(entry), colIndex)
      })
    })

    const columns: Array<Array<{ entry: FeedDisplayEntry; originalIndex: number }>> = Array.from(
      { length: cols },
      () => []
    )
    const columnHeights: number[] = Array(cols).fill(0)

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const h = estimateEntryHeight(entry)
      const prevCol = previousColumnForEntry(entry, keyToColumn, cols)
      const col = prevCol !== undefined ? prevCol : pickShortestColumnIndex(columns, columnHeights)
      columns[col].push({ entry, originalIndex: i })
      columnHeights[col] += h
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

/**
 * Left/right nav: use the card at the same row index in the adjacent column (top of column = row 0).
 * Shorter columns clamp to their last row. Purely structural — no DOM rects — so All Columns behaves
 * like 2/3 column mode (no geometry ties, no skipped targets when layout is still settling).
 */
function indexLeftByRow(
  columns: Array<Array<{ originalIndex: number }>>,
  currentIndex: number
): number {
  for (let c = 0; c < columns.length; c++) {
    const row = columns[c].findIndex((e) => e.originalIndex === currentIndex)
    if (row < 0) continue
    if (c === 0) return currentIndex
    const leftCol = columns[c - 1]
    if (leftCol.length === 0) return currentIndex
    const targetRow = Math.min(row, leftCol.length - 1)
    return leftCol[targetRow].originalIndex
  }
  return currentIndex
}

function indexRightByRow(
  columns: Array<Array<{ originalIndex: number }>>,
  currentIndex: number
): number {
  for (let c = 0; c < columns.length; c++) {
    const row = columns[c].findIndex((e) => e.originalIndex === currentIndex)
    if (row < 0) continue
    if (c === columns.length - 1) return currentIndex
    const rightCol = columns[c + 1]
    if (rightCol.length === 0) return currentIndex
    const targetRow = Math.min(row, rightCol.length - 1)
    return rightCol[targetRow].originalIndex
  }
  return currentIndex
}

export default function FeedPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const isDesktop = useSyncExternalStore(subscribeDesktop, getDesktopSnapshot, () => false)
  const { beginKeyboardNavigation, tryHoverSelectCard, gridPointerGateProps } = usePostCardGridPointerGate()
  const isStandalonePwa = useStandalonePwa()
  const { openLoginModal } = useLoginModal()
  const { session, authResolved } = useSession()
  const { viewMode } = useViewMode()
  const gridRef = useRef<HTMLDivElement | null>(null)
  const [gridLayoutKey, setGridLayoutKey] = useState(0)
  const bindGridRef = useCallback((el: HTMLDivElement | null) => {
    gridRef.current = el
    setGridLayoutKey((n) => n + 1)
  }, [])
  /** Debounced + hysteresis-stable column count (must match grid and load-more sentinels). */
  const cols = useColumnCount(viewMode, 150, { measureRef: gridRef, measureLayoutKey: gridLayoutKey })
  const [source, setSource] = useState<FeedSource>(PRESET_SOURCES[0])

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
  const { openPostModal, isModalOpen } = useProfileModal()
  const cardRefsRef = useRef<(HTMLDivElement | null)[]>([])
  /** Refs for focused media elements: [cardIndex][mediaIndex] for scroll-into-view on multi-image posts */
  const mediaRefsRef = useRef<Record<number, Record<number, HTMLElement | null>>>({})
  const mediaItemsRef = useRef<TimelineItem[]>([])
  const keyboardFocusIndexRef = useRef(-1)
  const actionsMenuOpenForIndexRef = useRef<number | null>(null)
  const lastScrollIntoViewIndexRef = useRef<number>(-1)
  /** Only scroll into view when focus was changed by keyboard (W/S/A/D), not by mouse hover */
  const scrollIntoViewFromKeyboardRef = useRef(false)
  /** When true, focus was set by mouse hover – don’t lift one image in multi-image cards; only keyboard A/D should */
  const [focusSetByMouse, setFocusSetByMouse] = useState(false)
  const [collectionMenuOpenForIndex, setCollectionMenuOpenForIndex] = useState<number | null>(null)
  const [collectionMenuOpenSignal, setCollectionMenuOpenSignal] = useState(0)
  const [blockConfirm, setBlockConfirm] = useState<{ did: string; handle: string; avatar?: string } | null>(null)
  const blockCancelRef = useRef<HTMLButtonElement>(null)
  const blockConfirmRef = useRef<HTMLButtonElement>(null)
  const prevPathnameRef = useRef(location.pathname)
  const locationSearchRef = useRef(location.search)
  locationSearchRef.current = location.search
  const seenUrisRef = useRef(feedState.seenUris)
  seenUrisRef.current = feedState.seenUris
  const seenPostsContext = useSeenPosts()

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
      /* Under <Routes location={backgroundLocation}> this hook sees the frozen underlay; the real URL still has ?search= / ?tag= etc. */
      const search = typeof window !== 'undefined' ? window.location.search : location.search
      const hash = typeof window !== 'undefined' ? window.location.hash : location.hash
      navigate(
        { pathname: location.pathname, search, hash },
        { replace: true },
      )
    }
  }, [location.state, location.pathname, location.search, location.hash, navigate])

  const {
    entries: mixEntries,
    totalPercent: mixTotalPercent,
  } = useFeedMix()
  const feedSwipe = useFeedSwipe()

  const swipeStartRef = useRef<{ x: number; y: number } | null>(null)
  const swipeGestureRef = useRef<'unknown' | 'swipe' | 'pull'>('unknown')
  const feedItemsRef = useRef<TimelineItem[]>([])
  feedItemsRef.current = feedState.items
  /** When true, next initial load should run even if user is scrolled down (e.g. they changed feeds in the Feeds dropdown). */
  const feedMixChangedRef = useRef(false)
  /** Monotonic marker for feed-selection changes; prevents stale requests from clearing refresh intent. */
  const feedMixChangedVersionRef = useRef(0)

  function sameFeedSource(a: FeedSource, b: FeedSource): boolean {
    return (a.uri ?? a.label) === (b.uri ?? b.label)
  }

  const FEED_LOAD_TIMEOUT_MS = 15_000

  const load = useCallback(async (nextCursor?: string, signal?: AbortSignal) => {
    const limit = Math.min(60, cols >= 2 ? cols * 10 : 20)
    const changeVersionAtStart = feedMixChangedVersionRef.current
    const activeMixEntries = mixEntries.filter((e) => e.percent > 0)
    const activeMixTotalPercent = activeMixEntries.reduce((s, e) => s + e.percent, 0)

    // If mix is configured but every feed is at 0%, show an intentionally empty feed.
    // This avoids falling back to "Following" on refresh, which makes toggles feel broken.
    if (session && mixEntries.length > 0 && activeMixEntries.length === 0) {
      if (!nextCursor) {
        dispatch({ type: 'SET_ITEMS', items: [], cursor: undefined })
      }
      dispatch({ type: 'SET_LOADING', loading: false })
      dispatch({ type: 'SET_LOADING_MORE', loadingMore: false })
      return
    }
    
    // Don't refresh feed (load new items at top) if user is scrolled down — unless they just changed which feeds are active
    if (!nextCursor && window.scrollY > 100 && !feedMixChangedRef.current) {
      dispatch({ type: 'SET_LOADING', loading: false })
      return
    }

    try {
      // Check if request was cancelled
      if (signal?.aborted) {
        return
      }

      if (!authResolved) {
        if (!nextCursor) dispatch({ type: 'SET_LOADING', loading: true })
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
          const merged = dedupeFeedByPostUri(nextCursor ? [...feedItemsRef.current, ...feed] : feed)
          dispatch({ type: 'SET_ITEMS', items: merged, cursor: next })
        }
        // Load-more must run apply() before finally clears loadingMore; deferred startTransition left the sentinel re-firing in a tight loop.
        apply()
      } else if (activeMixEntries.length >= 2 && activeMixTotalPercent >= 99) {
        const isLoadMore = !!nextCursor
        let cursorsToUse: Record<string, string> | undefined
        if (isLoadMore && nextCursor) {
          try {
            cursorsToUse = JSON.parse(nextCursor) as Record<string, string>
          } catch {
            cursorsToUse = undefined
          }
        }
        const totalPct = activeMixEntries.reduce((s, e) => s + e.percent, 0)
        const normalized =
          totalPct > 0
            ? activeMixEntries.map((e) => ({ source: e.source, percent: (e.percent / totalPct) * 100 }))
            : activeMixEntries.map((e) => ({ source: e.source, percent: e.percent }))
        const { feed, cursors: nextCursors } = await withTimeout(
          getMixedFeed(
            normalized,
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
          const merged = dedupeFeedByPostUri(isLoadMore ? [...feedItemsRef.current, ...feed] : feed)
          const cursor = Object.keys(nextCursors).length > 0 ? JSON.stringify(nextCursors) : undefined
          dispatch({ type: 'SET_ITEMS', items: merged, cursor })
        }
        apply()
      } else if (activeMixEntries.length === 1) {
        const single = activeMixEntries[0].source
        if (single.kind === 'timeline') {
          const res = await withTimeout(getTimelineWithLifecycle(limit, nextCursor), FEED_LOAD_TIMEOUT_MS)
          const apply = () => {
            const merged = dedupeFeedByPostUri(nextCursor ? [...feedItemsRef.current, ...res.data.feed] : res.data.feed)
            dispatch({ type: 'SET_ITEMS', items: merged, cursor: res.data.cursor })
          }
          apply()
        } else if (single.uri) {
          const res = await withTimeout(getFeedWithLifecycle(single.uri, limit, nextCursor), FEED_LOAD_TIMEOUT_MS)
          const apply = () => {
            const merged = dedupeFeedByPostUri(nextCursor ? [...feedItemsRef.current, ...res.data.feed] : res.data.feed)
            dispatch({ type: 'SET_ITEMS', items: merged, cursor: res.data.cursor })
          }
          apply()
        }
      } else if (source.kind === 'timeline') {
        const res = await withTimeout(getTimelineWithLifecycle(limit, nextCursor), FEED_LOAD_TIMEOUT_MS)
        const apply = () => {
          const merged = dedupeFeedByPostUri(nextCursor ? [...feedItemsRef.current, ...res.data.feed] : res.data.feed)
          dispatch({ type: 'SET_ITEMS', items: merged, cursor: res.data.cursor })
        }
        apply()
      } else if (source.uri) {
        const res = await withTimeout(getFeedWithLifecycle(source.uri, limit, nextCursor), FEED_LOAD_TIMEOUT_MS)
        const apply = () => {
          const merged = dedupeFeedByPostUri(nextCursor ? [...feedItemsRef.current, ...res.data.feed] : res.data.feed)
          dispatch({ type: 'SET_ITEMS', items: merged, cursor: res.data.cursor })
        }
        apply()
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load feed'
      dispatch({ type: 'SET_ERROR', error: msg })
    } finally {
      dispatch({ type: 'SET_LOADING', loading: false })
      dispatch({ type: 'SET_LOADING_MORE', loadingMore: false })
      loadingMoreRef.current = false
      /* Only clear for the latest non-aborted initial load; stale aborted requests must not reset this flag. */
      if (!nextCursor && !signal?.aborted && feedMixChangedVersionRef.current === changeVersionAtStart) {
        feedMixChangedRef.current = false
      }
    }
  }, [source, session, authResolved, mixEntries, mixTotalPercent, cols])

  useEffect(() => {
    feedMixChangedRef.current = true
    feedMixChangedVersionRef.current += 1
    // Leaving "hide read" snapshot active across feed-source changes can make a re-enabled feed appear empty.
    dispatch({ type: 'CLEAR_SEEN_SNAPSHOT' })
  }, [mixEntries, mixTotalPercent])

  /* Switching accounts must refresh the feed even when scrolled down (same as changing feed mix). */
  useEffect(() => {
    feedMixChangedRef.current = true
    feedMixChangedVersionRef.current += 1
    dispatch({ type: 'CLEAR_SEEN_SNAPSHOT' })
  }, [session?.did])

  useEffect(() => {
    const abortController = new AbortController()
    load(undefined, abortController.signal)
    return () => {
      abortController.abort()
    }
  }, [load])

  // Infinite scroll: load more when sentinel enters view. Cooldown prevents re-triggering while sentinel stays in view (stops infinite load loop).
  // Large rootMargin so we load before the user reaches the end. After each load we also schedule a
  // fallback check: if any column clearly ends above the viewport bottom (visible gap), trigger another
  // load once the cooldown expires — not when the user is already at the end (avoids infinite chaining).
  /** Debounce between automatic load-more triggers (sentinel can stay visible on short columns). Keep low so reaching another column’s bottom doesn’t feel stuck for seconds after a recent load. */
  const LOAD_MORE_COOLDOWN_MS = 900
  /** Start loading when sentinel is within this distance below the viewport (load before user reaches end). */
  const LOAD_MORE_ROOT_MARGIN_PX = 600
  /** Min gap (px) between viewport bottom and a column sentinel to count as "short" (empty masonry below). Capped vs viewport so small phones still work. */
  const LOAD_MORE_SHORT_MARGIN_PX = 300
  useEffect(() => {
    if (!feedState.cursor) return
    const refs = loadMoreSentinelRefs.current
    let rafId = 0
    let retryId = 0
    /**
     * True when a column ends with clear empty space still visible below its sentinel — not when the user
     * is scrolled to the document end (sentinel near viewport bottom). The old check used
     * threshold = innerHeight + margin, so nearly every sentinel matched and scheduleRetry() chained
     * load-more forever, locking scroll at the bottom on mobile.
     */
    const anyColumnShort = () => {
      const vh = window.innerHeight
      const margin = Math.min(LOAD_MORE_SHORT_MARGIN_PX, Math.floor(vh * 0.4))
      const threshold = vh - margin
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
          lastLoadMoreAtRef.current = Date.now()
          rafId = requestAnimationFrame(() => {
            rafId = 0
            load(c)
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
    // whose sentinels may have scrolled beyond rootMargin or been blocked by cooldown (incl. 1-col).
    scheduleRetry()

    return () => {
      observer.disconnect()
      if (rafId) cancelAnimationFrame(rafId)
      clearTimeout(retryId)
    }
  }, [feedState.cursor, load, cols])

  const { mediaMode } = useMediaOnly()
  const { nsfwPreference, unblurredUris, setUnblurred } = useModeration()
  const { hideRepostsFromDids } = useHideReposts() ?? { hideRepostsFromDids: [] as string[] }
  const displayItems = useMemo(() =>
    (feedState.items ?? [])
      .filter((item) => (mediaMode === 'media' ? getPostMediaInfoForDisplay(item.post) : true))
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
  const mediaCountByUri = useMemo(() => {
    const map = new Map<string, number>()
    for (const entry of displayEntries) {
      const uri = entry.item.post.uri
      if (!uri) continue
      map.set(uri, Math.max(1, getPostAllMediaForDisplay(entry.item.post).length))
    }
    return map
  }, [displayEntries])
  const itemsAfterOtherFilters = useMemo(() =>
    (feedState.items ?? [])
      .filter((item) => (mediaMode === 'media' ? getPostMediaInfoForDisplay(item.post) : true))
      .filter((item) => nsfwPreference !== 'sfw' || !isPostNsfw(item.post)),
    [feedState.items, mediaMode, nsfwPreference]
  )
  /** Only "seen all" when there's nothing more to load (no cursor). With mixed feeds, one feed can be exhausted while others still have posts. */
  const emptyBecauseAllSeen = displayEntries.length === 0 && itemsAfterOtherFilters.length > 0 && !feedState.cursor
  const canLoadMoreWhenEmpty = displayEntries.length === 0 && feedState.cursor != null

  // Track previous distribution to avoid re-shuffling existing posts when new ones load
  const previousDistributionRef = useRef<Array<Array<{ entry: FeedDisplayEntry; originalIndex: number }>>>([])
  const previousColsRef = useRef<number>(0)
  const distributionContextKeyRef = useRef<string>('')
  
  // Memoize column distribution to prevent recalculation on every render
  const distributedColumns = useMemo(() => {
    const ctx = `${source.kind}|${source.uri ?? ''}|${source.label}|${mediaMode}|${nsfwPreference}`
    if (distributionContextKeyRef.current !== ctx) {
      distributionContextKeyRef.current = ctx
      previousDistributionRef.current = []
      previousColsRef.current = 0
    }
    if (cols !== previousColsRef.current) {
      previousDistributionRef.current = []
    }
    
    const newDistribution = distributeEntriesByHeight(
      displayEntries, 
      cols,
      previousDistributionRef.current
    )
    previousDistributionRef.current = newDistribution
    previousColsRef.current = cols
    return newDistribution
  }, [displayEntries, cols, source, mediaMode, nsfwPreference])
  
  /** Flat list of focus targets: one per media item per post (or one per card in text-only mode). */
  const focusTargets = useMemo(() => {
    const out: { cardIndex: number; mediaIndex: number }[] = []
    displayEntries.forEach((entry, cardIndex) => {
      const n = mediaMode === 'text' ? 1 : (mediaCountByUri.get(entry.item.post.uri) ?? 1)
      for (let m = 0; m < n; m++) out.push({ cardIndex, mediaIndex: m })
    })
    return out
  }, [displayEntries, mediaMode, mediaCountByUri])
  /** First focus index for each card (top image; for S and A/D). */
  const firstFocusIndexForCard = useMemo(() => {
    const out: number[] = []
    let idx = 0
    displayEntries.forEach((_entry, cardIndex) => {
      out[cardIndex] = idx
      const entry = displayEntries[cardIndex]
      const n = mediaMode === 'text' ? 1 : (mediaCountByUri.get(entry.item.post.uri) ?? 1)
      idx += n
    })
    return out
  }, [displayEntries, mediaMode, mediaCountByUri])
  /** Last focus index for each card (bottom image; for W when moving to card above). */
  const lastFocusIndexForCard = useMemo(() => {
    const out: number[] = []
    displayEntries.forEach((entry, cardIndex) => {
      const n = mediaMode === 'text' ? 1 : (mediaCountByUri.get(entry.item.post.uri) ?? 1)
      out[cardIndex] = firstFocusIndexForCard[cardIndex] + n - 1
    })
    return out
  }, [displayEntries, firstFocusIndexForCard, mediaMode, mediaCountByUri])
  mediaItemsRef.current = displayItems
  keyboardFocusIndexRef.current = feedState.keyboardFocusIndex
  actionsMenuOpenForIndexRef.current = feedState.actionsMenuOpenForIndex
  const displayEntriesRef = useRef(displayEntries)
  const focusTargetsRef = useRef(focusTargets)
  const firstFocusIndexForCardRef = useRef(firstFocusIndexForCard)
  const lastFocusIndexForCardRef = useRef(lastFocusIndexForCard)
  const distributedColumnsRef = useRef(distributedColumns)
  const colsRef = useRef(cols)
  const likeOverridesRef = useRef(likeOverrides)
  const blockConfirmRefState = useRef(blockConfirm)
  const sessionRef = useRef(session)
  displayEntriesRef.current = displayEntries
  focusTargetsRef.current = focusTargets
  firstFocusIndexForCardRef.current = firstFocusIndexForCard
  lastFocusIndexForCardRef.current = lastFocusIndexForCard
  distributedColumnsRef.current = distributedColumns
  colsRef.current = cols
  likeOverridesRef.current = likeOverrides
  blockConfirmRefState.current = blockConfirm
  sessionRef.current = session

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

  const handleMouseEnter = useCallback(
    (originalIndex: number) => {
      tryHoverSelectCard(
        originalIndex,
        () => focusTargets[keyboardFocusIndexRef.current]?.cardIndex ?? -1,
        (cardIndex) => {
          dispatch({ type: 'SET_KEYBOARD_FOCUS', index: firstFocusIndexForCard[cardIndex] ?? 0 })
        },
        { applyOnTouch: false, onApplied: () => setFocusSetByMouse(true) },
      )
    },
    [tryHoverSelectCard, firstFocusIndexForCard, focusTargets],
  )

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
      const hasContentModalInUrl = /[?&](post|profile|tag)=/.test(locationSearchRef.current)
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
      const currentEntries = displayEntriesRef.current
      const currentFocusTargets = focusTargetsRef.current
      const currentFirstByCard = firstFocusIndexForCardRef.current
      const currentLastByCard = lastFocusIndexForCardRef.current
      const currentCols = colsRef.current
      const currentDistribution = distributedColumnsRef.current
      const currentLikeOverrides = likeOverridesRef.current
      const currentSession = sessionRef.current
      const currentBlockConfirm = blockConfirmRefState.current
      if (currentEntries.length === 0 || currentFocusTargets.length === 0) return

      setFocusSetByMouse(false)
      const focusTarget = currentFocusTargets[i]
      const currentCardIndex = focusTarget?.cardIndex ?? 0
      const focusedEntry = currentEntries[currentCardIndex]
      const focusedItem = focusedEntry?.item ?? null

      const key = e.key.toLowerCase()
      const focusInActionsMenu = (document.activeElement as HTMLElement)?.closest?.('[role="menu"]')
      const focusInCollectionMenu = (document.activeElement as HTMLElement)?.closest?.('[data-collection-menu="true"]')
      const collectionMenuOpen = document.querySelector('[data-collection-menu="true"]') != null
      const menuOpenForFocusedCard = actionsMenuOpenForIndexRef.current === currentCardIndex
      if ((focusInActionsMenu || focusInCollectionMenu || collectionMenuOpen || menuOpenForFocusedCard) && (key === 'w' || key === 's' || key === 'e' || key === 'enter' || key === 'q' || key === 'backspace' || key === 'escape' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        return
      }
      /* Ignore key repeat for left/right only (so A/D don’t skip); allow repeat for W/S so holding moves up/down */
      if (e.repeat && (key === 'a' || key === 'd' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return
      if (currentBlockConfirm) {
        if (key === 'escape') {
          e.preventDefault()
          setBlockConfirm(null)
          return
        }
        return // let Tab/Enter reach the dialog buttons
      }
      if (key === 'w' || key === 's' || key === 'a' || key === 'd' || key === 'e' || key === 'enter' || key === 'r' || key === 'c' || e.code === 'Space' || key === 'h' || key === 'm' || key === '`' || key === 'f' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.preventDefault()

      /* Use ref + concrete value (not functional updater) so Strict Mode double-invoke doesn't move two steps */
      const fromNone = i < 0
      const columns = currentCols >= 2 ? currentDistribution : null
      if (key === 'w' || e.key === 'ArrowUp') {
        beginKeyboardNavigation()
        scrollIntoViewFromKeyboardRef.current = true
        const onFirstImageOfCard = i === currentFirstByCard[currentCardIndex]
        const next = fromNone
          ? (currentLastByCard[currentEntries.length - 1] ?? currentFocusTargets.length - 1)
          : !onFirstImageOfCard
            ? Math.max(0, i - 1)
            : (() => {
                const nextCard = currentCols >= 2 && columns ? indexAbove(columns, currentCardIndex) : Math.max(0, currentCardIndex - 1)
                /* At top of column there is no card above; don’t jump to last image of the same post (feels like random vertical scroll). */
                if (nextCard === currentCardIndex) return i
                return currentLastByCard[nextCard] ?? currentFirstByCard[nextCard] ?? 0
              })()
        dispatch({ type: 'SET_KEYBOARD_FOCUS', index: next })
        return
      }
      if (key === 's' || e.key === 'ArrowDown') {
        beginKeyboardNavigation()
        scrollIntoViewFromKeyboardRef.current = true
        const onLastImageOfCard = i === currentLastByCard[currentCardIndex]
        const next = fromNone
          ? 0
          : !onLastImageOfCard
            ? Math.min(currentFocusTargets.length - 1, i + 1)
            : (() => {
                const nextCard = currentCols >= 2 && columns ? indexBelow(columns, currentCardIndex) : Math.min(currentEntries.length - 1, currentCardIndex + 1)
                /* At bottom of column, indexBelow returns same card; first focus index would jump to top of a multi-image post or confuse scroll. */
                if (nextCard === currentCardIndex) return i
                return currentFirstByCard[nextCard] ?? i
              })()
        dispatch({ type: 'SET_KEYBOARD_FOCUS', index: next })
        return
      }
      if (key === 'a' || e.key === 'ArrowLeft') {
        beginKeyboardNavigation()
        scrollIntoViewFromKeyboardRef.current = true
        const nextCard = fromNone ? 0 : currentCols >= 2 && columns ? indexLeftByRow(columns, currentCardIndex) : currentCardIndex
        const next = fromNone ? 0 : nextCard !== currentCardIndex ? (currentLastByCard[nextCard] ?? i) : i
        if (next !== i) dispatch({ type: 'SET_ACTIONS_MENU_OPEN', index: null })
        dispatch({ type: 'SET_KEYBOARD_FOCUS', index: next })
        return
      }
      if (key === 'd' || e.key === 'ArrowRight') {
        beginKeyboardNavigation()
        scrollIntoViewFromKeyboardRef.current = true
        const nextCard = fromNone ? 0 : currentCols >= 2 && columns ? indexRightByRow(columns, currentCardIndex) : currentCardIndex
        const next = fromNone ? 0 : nextCard !== currentCardIndex ? (currentLastByCard[nextCard] ?? i) : i
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
        if (focusedItem) openPostModal(focusedItem.post.uri, undefined, undefined, focusedItem.post.author?.handle)
        return
      }
      if (key === 'r') {
        if (focusedItem) openPostModal(focusedItem.post.uri, true, undefined, focusedItem.post.author?.handle)
        return
      }
      if (key === 'c') {
        if (!focusedItem?.post?.uri) return
        setCollectionMenuOpenForIndex(currentCardIndex)
        setCollectionMenuOpenSignal((n) => n + 1)
        return
      }
      if (e.code === 'Space') {
        const item = focusedItem
        if (!item?.post?.uri || !item?.post?.cid) return
        const uri = item.post.uri
        const currentLikeUri = uri in currentLikeOverrides ? (currentLikeOverrides[uri] ?? undefined) : (item.post as { viewer?: { like?: string } }).viewer?.like
        if (currentLikeUri) {
          unlikePostWithLifecycle(currentLikeUri).then(() => {
            setLikeOverride(uri, null)
          }).catch((err: unknown) => {
            console.error('Failed to unlike post:', err)
          })
        } else {
          likePostWithLifecycle(uri, item.post.cid).then((res) => {
            setLikeOverride(uri, res.uri)
          }).catch((err: unknown) => {
            console.error('Failed to like post:', err)
          })
        }
        return
      }
      if (key === 'f') {
        const author = focusedItem?.post?.author as { did: string; viewer?: { following?: string } } | undefined
        const postUri = focusedItem?.post?.uri
        if (author && currentSession?.did && currentSession.did !== author.did && postUri) {
          const followingUri = author.viewer?.following
          if (followingUri) {
            unfollowAccountWithLifecycle(followingUri).then(() => {
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
            }).catch((err: unknown) => {
              console.error('Failed to unfollow:', err)
            })
          } else {
            followAccountWithLifecycle(author.did).then((res) => {
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
            }).catch((err: unknown) => {
              console.error('Failed to follow:', err)
            })
          }
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [beginKeyboardNavigation, isModalOpen, openPostModal, setLikeOverride])

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
    /* Custom pull only when installed as PWA; in mobile Safari/Chrome tab, use native pull-to-refresh. */
    enabled: !isDesktop && isStandalonePwa,
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
    if (!setHandlers) return
    if (!isStandalonePwa) {
      setHandlers(null)
      return () => setHandlers(null)
    }
    setHandlers({ onTouchStart: handleTouchStart, onTouchMove: handleTouchMove, onTouchEnd: handleTouchEnd })
    return () => setHandlers(null)
  }, [feedPullRefresh?.setHandlers, handleTouchStart, handleTouchMove, handleTouchEnd, isStandalonePwa])

  useEffect(() => {
    const setPull = feedPullRefresh?.setPullOffsetPx
    if (!setPull) return
    if (!isStandalonePwa) {
      setPull(0)
      return () => setPull(0)
    }
    setPull(pullRefresh.pullDistance)
    return () => setPull(0)
  }, [feedPullRefresh?.setPullOffsetPx, pullRefresh.pullDistance, isStandalonePwa])

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
        {!isDesktop &&
          isStandalonePwa &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              className={`${styles.pullRefreshHeader} ${(pullRefresh.pullDistance > 0 || pullRefresh.isRefreshing) ? styles.pullRefreshHeaderActive : ''}`}
              aria-hidden={pullRefresh.pullDistance === 0 && !pullRefresh.isRefreshing}
              aria-live="polite"
              aria-label={pullRefresh.isRefreshing ? 'Refreshing' : undefined}
            >
              {(pullRefresh.pullDistance > 0 || pullRefresh.isRefreshing) && (
                <div
                  className={styles.pullRefreshSpinner}
                  style={
                    pullRefresh.isRefreshing
                      ? undefined
                      : {
                          animation: 'none',
                          transform: `rotate(${Math.min(1, pullRefresh.pullDistance / PULL_THRESHOLD_PX) * 360}deg)`,
                        }
                  }
                />
              )}
            </div>,
            document.body
          )}
        <div className={styles.pullRefreshContent}>
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
              ref={bindGridRef}
              className={`${styles.gridColumns} ${viewMode === 'a' ? styles.gridView3 : styles[`gridView${viewMode}`]}`}
              {...gridPointerGateProps}
              data-view-mode={viewMode}
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
                  collectionMenuOpenForIndex={collectionMenuOpenForIndex}
                  collectionMenuOpenSignal={collectionMenuOpenSignal}
                />
              ))}
            </div>
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
              <button type="button" className={styles.feedLoginHintLink} onClick={() => openLoginModal()}>
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
