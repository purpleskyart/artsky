import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { searchPostsByPhraseAndTags, getPostMediaInfo, isPostNsfw, likePostWithLifecycle, unlikePostWithLifecycle, followAccountWithLifecycle, unfollowAccountWithLifecycle, listBlockedAccounts, listMutedAccounts } from '../lib/bsky'
import type { TimelineItem } from '../lib/bsky'
import type { AppBskyFeedDefs } from '@atproto/api'
import ProfileColumn from './ProfileColumn'
import { useSession } from '../context/SessionContext'
import { useProfileModal } from '../context/ProfileModalContext'
import { useLikeOverrides } from '../context/LikeOverridesContext'
import { useFollowOverrides } from '../context/FollowOverridesContext'
import { useViewMode } from '../context/ViewModeContext'
import { useModeration } from '../context/ModerationContext'
import { useColumnCount } from '../hooks/useViewportWidth'
import { usePostCardGridPointerGate } from '../hooks/usePostCardGridPointerGate'
import styles from '../pages/TagPage.module.css'
import profileGridStyles from '../pages/ProfilePage.module.css'
import { getPostAppPath } from '../lib/appUrl'
import { getOverlayBackgroundLocation } from '../lib/overlayNavigation'
import { pickAdjacentCardIndexByViewport } from '../lib/masonryHorizontalNav'

const ESTIMATE_COL_WIDTH = 280
const CARD_CHROME = 100

/** Given columns from distributeByHeight, return the index of the card directly above or below. */
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
 * Left/right nav fallback: same slot index in the adjacent column (not visual row). Used when DOM
 * rects are unavailable; prefer {@link pickAdjacentCardIndexByViewport} for A/D so focus matches the
 * preview beside the focused one on screen.
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

function toTimelineItem(post: AppBskyFeedDefs.PostView): TimelineItem {
  return { post }
}

function estimateItemHeight(item: TimelineItem): number {
  const media = getPostMediaInfo(item.post)
  if (!media) return CARD_CHROME + 80
  if (media.aspectRatio != null && media.aspectRatio > 0) {
    return CARD_CHROME + ESTIMATE_COL_WIDTH / media.aspectRatio
  }
  return CARD_CHROME + 220
}

function distributeByHeight(
  items: TimelineItem[],
  numCols: number
): Array<Array<{ item: TimelineItem; originalIndex: number }>> {
  if (numCols < 1) return []
  const columns: Array<Array<{ item: TimelineItem; originalIndex: number }>> = Array.from(
    { length: numCols },
    () => []
  )
  const columnHeights: number[] = Array(numCols).fill(0)
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const h = estimateItemHeight(item)
    const lengths = columns.map((col) => col.length)
    const minCount = lengths.length === 0 ? 0 : Math.min(...lengths)
    let best = -1
    for (let c = 0; c < numCols; c++) {
      if (columns[c].length > minCount + 1) continue
      if (best === -1 || columnHeights[c] < columnHeights[best]) best = c
      else if (columnHeights[c] === columnHeights[best] && columns[c].length < columns[best].length) best = c
    }
    if (best === -1) best = 0
    columns[best].push({ item, originalIndex: i })
    columnHeights[best] += h
  }
  return columns
}

export interface SearchModalGridContentProps {
  searchQuery: string
  /** Same contract as TagContent: modal uses context openPostModal + modal scroll; page would use navigate. */
  inModal?: boolean
  onRegisterRefresh?: (refresh: () => void | Promise<void>) => void
  /** Extra class on the outer wrap (e.g. modal chrome offset). */
  contentClassName?: string
}

/**
 * Search results grid — mirrors TagContent so stacked post/profile modals behave like tag modal.
 */
export function SearchModalGridContent({
  searchQuery,
  inModal = false,
  onRegisterRefresh,
  contentClassName,
}: SearchModalGridContentProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { session } = useSession()
  const { viewMode } = useViewMode()
  const { isModalOpen, openPostModal } = useProfileModal()
  const { likeOverrides, setLikeOverride } = useLikeOverrides()
  const { setFollowOverride } = useFollowOverrides()
  const [items, setItems] = useState<TimelineItem[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keyboardFocusIndex, setKeyboardFocusIndex] = useState(0)
  const [blockedDids, setBlockedDids] = useState<Set<string>>(new Set())
  const [mutedDids, setMutedDids] = useState<Set<string>>(new Set())
  const [actionsMenuOpenForIndex, setActionsMenuOpenForIndex] = useState<number | null>(null)
  const [blockConfirm, setBlockConfirm] = useState<{ did: string; handle: string; avatar?: string } | null>(null)
  const cardRefsRef = useRef<(HTMLDivElement | null)[]>([])
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null)
  const loadMoreSentinelRefs = useRef<(HTMLDivElement | null)[]>([])
  const loadingMoreRef = useRef(false)
  const keyboardFocusIndexRef = useRef(0)
  const mediaItemsRef = useRef<TimelineItem[]>([])
  const scrollIntoViewFromKeyboardRef = useRef(false)
  const lastScrollIntoViewIndexRef = useRef(-1)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const sessionRef = useRef(session)
  const likeOverridesRef = useRef(likeOverrides)
  const actionsMenuOpenForIndexRef = useRef<number | null>(null)
  const blockConfirmRefState = useRef(blockConfirm)
  const distributedColumnsRef = useRef<Array<Array<{ originalIndex: number }>>>([])
  const mediaRefsRef = useRef<Record<number, Record<number, HTMLElement | null>>>({})
  const focusTargetsRef = useRef<{ cardIndex: number; mediaIndex: number }[]>([])
  const firstFocusIndexForCardRef = useRef<number[]>([])
  const lastFocusIndexForCardRef = useRef<number[]>([])

  const cols = useColumnCount(viewMode, 150)
  const colsRef = useRef(cols)
  const { beginKeyboardNavigation, tryHoverSelectCard, gridPointerGateProps } = usePostCardGridPointerGate()

  const trimmedQuery = searchQuery.trim()

  const load = useCallback(
    async (nextCursor?: string) => {
      if (!trimmedQuery) {
        setLoading(false)
        setLoadingMore(false)
        return
      }
      try {
        if (nextCursor) setLoadingMore(true)
        else setLoading(true)
        setError(null)
        const { posts, cursor: next } = await searchPostsByPhraseAndTags(trimmedQuery, nextCursor)
        const timelineItems = posts.map(toTimelineItem)
        setItems((prev) => (nextCursor ? [...prev, ...timelineItems] : timelineItems))
        setCursor(next)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Search failed'
        setError(msg === 'Failed to fetch' ? 'Search couldn’t be completed. Check your connection or try again.' : msg)
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [trimmedQuery]
  )

  useEffect(() => {
    if (!trimmedQuery) {
      setItems([])
      setCursor(undefined)
      setLoading(false)
      return
    }
    setItems([])
    setCursor(undefined)
    load()
  }, [trimmedQuery, load])

  useEffect(() => {
    onRegisterRefresh?.(() => load())
  }, [onRegisterRefresh, load])

  useEffect(() => {
    if (!session) {
      setBlockedDids(new Set())
      setMutedDids(new Set())
      return
    }
    Promise.all([listBlockedAccounts(), listMutedAccounts()])
      .then(([blocked, muted]) => {
        setBlockedDids(new Set(blocked.map((b) => b.did)))
        setMutedDids(new Set(muted.map((m) => m.did)))
      })
      .catch(() => {
        // Silently fail - blocked/muted filtering is a nice-to-have, not critical
      })
  }, [session])

  const { nsfwPreference, unblurredUris, setUnblurred } = useModeration()
  const mediaItems = items
    .filter((item) => getPostMediaInfo(item.post))
    .filter((item) => nsfwPreference !== 'sfw' || !isPostNsfw(item.post))
    .filter((item) => {
      const authorDid = item.post.author?.did
      if (!authorDid) return true
      return !blockedDids.has(authorDid) && !mutedDids.has(authorDid)
    })
  mediaItemsRef.current = mediaItems
  keyboardFocusIndexRef.current = keyboardFocusIndex

  /** Flat list of focus targets: one per media item per post. */
  const focusTargets = useMemo(() => {
    const out: { cardIndex: number; mediaIndex: number }[] = []
    mediaItems.forEach((item, cardIndex) => {
      const media = getPostMediaInfo(item.post)
      const n = media ? media.imageCount ?? 1 : 1
      for (let m = 0; m < n; m++) out.push({ cardIndex, mediaIndex: m })
    })
    return out
  }, [mediaItems])

  /** First focus index for each card (top image). */
  const firstFocusIndexForCard = useMemo(() => {
    const out: number[] = []
    let idx = 0
    mediaItems.forEach((item, cardIndex) => {
      out[cardIndex] = idx
      const media = getPostMediaInfo(item.post)
      const n = media ? media.imageCount ?? 1 : 1
      idx += n
    })
    return out
  }, [mediaItems])

  /** Last focus index for each card (bottom image). */
  const lastFocusIndexForCard = useMemo(() => {
    const out: number[] = []
    let idx = 0
    mediaItems.forEach((item, cardIndex) => {
      const media = getPostMediaInfo(item.post)
      const n = media ? media.imageCount ?? 1 : 1
      idx += n
      out[cardIndex] = idx - 1
    })
    return out
  }, [mediaItems])

  // Keep refs in sync with state
  useEffect(() => {
    sessionRef.current = session
  }, [session])
  useEffect(() => {
    likeOverridesRef.current = likeOverrides
  }, [likeOverrides])
  useEffect(() => {
    actionsMenuOpenForIndexRef.current = actionsMenuOpenForIndex
  }, [actionsMenuOpenForIndex])
  useEffect(() => {
    blockConfirmRefState.current = blockConfirm
  }, [blockConfirm])
  useEffect(() => {
    focusTargetsRef.current = focusTargets
  }, [focusTargets])
  useEffect(() => {
    firstFocusIndexForCardRef.current = firstFocusIndexForCard
  }, [firstFocusIndexForCard])
  useEffect(() => {
    lastFocusIndexForCardRef.current = lastFocusIndexForCard
  }, [lastFocusIndexForCard])
  useEffect(() => {
    colsRef.current = cols
  }, [cols])

  // Stable callback refs to prevent unnecessary re-renders
  const handleCardRef = useCallback((index: number) => (el: HTMLDivElement | null) => {
    cardRefsRef.current[index] = el
  }, [])

  loadingMoreRef.current = loadingMore
  useEffect(() => {
    if (!cursor) return
    const colsForObserver = cols
    const firstSentinel = colsForObserver >= 2 ? loadMoreSentinelRefs.current[0] : loadMoreSentinelRef.current
    if (!firstSentinel) return
    const root =
      inModal ? (firstSentinel.closest('[data-modal-scroll]') as Element | null) ?? undefined : undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || loadingMoreRef.current) return
        loadingMoreRef.current = true
        load(cursor)
      },
      { root, rootMargin: '600px', threshold: 0 }
    )
    observer.observe(firstSentinel)
    if (colsForObserver >= 2) {
      const refs = loadMoreSentinelRefs.current
      for (let c = 1; c < colsForObserver; c++) {
        const el = refs[c]
        if (el) observer.observe(el)
      }
    }
    return () => observer.disconnect()
  }, [cursor, load, cols, inModal])

  useEffect(() => {
    setKeyboardFocusIndex((i) => {
      if (focusTargets.length === 0) return 0
      return mediaItems.length ? Math.min(i, focusTargets.length - 1) : 0
    })
  }, [mediaItems.length, focusTargets.length])

  // Scroll focused card/media into view only when focus was changed by keyboard (W/S/A/D), not on mouse hover
  useEffect(() => {
    if (!scrollIntoViewFromKeyboardRef.current) return
    scrollIntoViewFromKeyboardRef.current = false
    if (keyboardFocusIndex === lastScrollIntoViewIndexRef.current) return
    lastScrollIntoViewIndexRef.current = keyboardFocusIndex
    const target = focusTargets[keyboardFocusIndex]
    const raf = requestAnimationFrame(() => {
      const cardIndex = target?.cardIndex ?? keyboardFocusIndex
      const mediaIndex = target?.mediaIndex ?? 0
      const mediaEl = mediaRefsRef.current[cardIndex]?.[mediaIndex]
      const el = mediaEl ?? cardRefsRef.current[cardIndex]
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [keyboardFocusIndex, focusTargets])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!inModal && isModalOpen) return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) {
        if (e.key === 'Escape') {
          e.preventDefault()
          target.blur()
        }
        return
      }
      if (e.ctrlKey || e.metaKey) return
      if (mediaItems.length === 0) return

      const items = mediaItemsRef.current
      const i = keyboardFocusIndexRef.current
      const currentSession = sessionRef.current
      const currentLikeOverrides = likeOverridesRef.current
      const currentBlockConfirm = blockConfirmRefState.current
      const currentFocusTargets = focusTargetsRef.current
      const currentFirstByCard = firstFocusIndexForCardRef.current
      const currentLastByCard = lastFocusIndexForCardRef.current
      const currentCols = colsRef.current
      const fromNone = i < 0
      const key = e.key.toLowerCase()
      const focusInActionsMenu = (document.activeElement as HTMLElement)?.closest?.('[role="menu"]')
      const focusInCollectionMenu = (document.activeElement as HTMLElement)?.closest?.('[data-collection-menu="true"]')
      const collectionMenuOpen = document.querySelector('[data-collection-menu="true"]') != null
      const menuOpenForFocusedCard = actionsMenuOpenForIndexRef.current === i
      const focusInNotificationsMenu = (document.activeElement as HTMLElement)?.closest?.('[data-notifications-list]')
      const notificationsMenuOpen = document.querySelector('[data-notifications-list]') != null
      if ((focusInActionsMenu || focusInCollectionMenu || collectionMenuOpen || menuOpenForFocusedCard || focusInNotificationsMenu || notificationsMenuOpen) && (key === 'w' || key === 's' || key === 'e' || key === 'o' || key === 'enter' || key === 'backspace' || key === 'escape' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        return
      }
      /* Ignore key repeat for left/right only (so A/D/J/L don't skip); allow repeat for W/S/I/K so holding moves up/down */
      if (e.repeat && (key === 'a' || key === 'd' || key === 'j' || key === 'l' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return
      if (currentBlockConfirm) {
        if (key === 'escape') {
          e.preventDefault()
          setBlockConfirm(null)
          return
        }
        return // let Tab/Enter reach the dialog buttons
      }
      if (key === 'w' || key === 's' || key === 'a' || key === 'd' || key === 'i' || key === 'j' || key === 'k' || key === 'l' || key === 'e' || key === 'o' || key === 'enter' || key === 'r' || key === 'c' || e.code === 'Space' || key === 'm' || key === '`' || key === 'f' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.preventDefault()

      const focusTarget = currentFocusTargets[i]
      const currentCardIndex = focusTarget?.cardIndex ?? 0
      const currentMediaIndex = focusTarget?.mediaIndex ?? 0
      const focusedItem = items[currentCardIndex]

      const columns = currentCols >= 2 ? distributeByHeight(items, currentCols) : null
      if (columns) distributedColumnsRef.current = columns

      if (key === 'w' || key === 'i' || e.key === 'ArrowUp') {
        if (fromNone) {
          if (currentFocusTargets.length > 0) {
            beginKeyboardNavigation()
            scrollIntoViewFromKeyboardRef.current = true
            setKeyboardFocusIndex(0)
          }
          return
        }
        beginKeyboardNavigation()
        scrollIntoViewFromKeyboardRef.current = true
        const onFirstImageOfCard = i === currentFirstByCard[currentCardIndex]
        const next = !onFirstImageOfCard
          ? Math.max(0, i - 1)
          : (() => {
              const nextCard = currentCols >= 2 && columns ? indexAbove(columns, currentCardIndex) : Math.max(0, currentCardIndex - 1)
              if (nextCard === currentCardIndex) return null
              return currentLastByCard[nextCard] ?? currentFirstByCard[nextCard] ?? null
            })()
        if (next === null) return
        setKeyboardFocusIndex(next)
        return
      }
      if (key === 's' || key === 'k' || e.key === 'ArrowDown') {
        if (fromNone) {
          if (currentFocusTargets.length > 0) {
            beginKeyboardNavigation()
            scrollIntoViewFromKeyboardRef.current = true
            setKeyboardFocusIndex(0)
          }
          return
        }
        beginKeyboardNavigation()
        scrollIntoViewFromKeyboardRef.current = true
        const onLastImageOfCard = i === currentLastByCard[currentCardIndex]
        const next = !onLastImageOfCard
          ? Math.min(currentFocusTargets.length - 1, i + 1)
          : (() => {
              const nextCard = currentCols >= 2 && columns ? indexBelow(columns, currentCardIndex) : Math.min(items.length - 1, currentCardIndex + 1)
              if (nextCard === currentCardIndex) return null
              return currentFirstByCard[nextCard] ?? null
            })()
        if (next === null) return
        setKeyboardFocusIndex(next)
        return
      }
      if (key === 'a' || key === 'j' || e.key === 'ArrowLeft' || key === 'd' || key === 'l' || e.key === 'ArrowRight') {
        if (fromNone) {
          if (currentFocusTargets.length > 0) {
            beginKeyboardNavigation()
            scrollIntoViewFromKeyboardRef.current = true
            setKeyboardFocusIndex(0)
          }
          return
        }
        beginKeyboardNavigation()
        scrollIntoViewFromKeyboardRef.current = true
        const goLeft = key === 'a' || key === 'j' || e.key === 'ArrowLeft'
        const measureCardForHorizontal = (cardIdx: number) => {
          const n = currentLastByCard[cardIdx] - currentFirstByCard[cardIdx] + 1
          const m = Math.min(currentMediaIndex, Math.max(0, n - 1))
          const el = mediaRefsRef.current[cardIdx]?.[m] ?? cardRefsRef.current[cardIdx]
          if (!el) return null
          const r = el.getBoundingClientRect()
          if (r.width <= 0 && r.height <= 0) return null
          return { top: r.top, left: r.left, width: r.width, height: r.height }
        }
        let next = i
        if (currentCols >= 2 && columns) {
          const byView = pickAdjacentCardIndexByViewport(
            columns,
            goLeft ? -1 : 1,
            currentCardIndex,
            measureCardForHorizontal,
          )
          const nextCard = byView ?? (goLeft ? indexLeftByRow(columns, currentCardIndex) : indexRightByRow(columns, currentCardIndex))
          if (nextCard !== currentCardIndex) {
            const n = currentLastByCard[nextCard] - currentFirstByCard[nextCard] + 1
            const m = Math.min(currentMediaIndex, Math.max(0, n - 1))
            next = currentFirstByCard[nextCard] + m
          }
        }
        if (next !== i) setActionsMenuOpenForIndex(null)
        setKeyboardFocusIndex(next)
        return
      }
      if ((key === 'm' || key === '`') && i >= 0) {
        if (menuOpenForFocusedCard) {
          setActionsMenuOpenForIndex(null)
        } else {
          setActionsMenuOpenForIndex(currentCardIndex)
        }
        return
      }
      if (key === 'e' || key === 'o' || key === 'enter') {
        if (focusedItem) {
          if (inModal) openPostModal(focusedItem.post.uri, undefined, undefined, focusedItem.post.author?.handle)
          else {
            const path = getPostAppPath(focusedItem.post.uri, focusedItem.post.author?.handle)
            navigate(path, { state: { backgroundLocation: getOverlayBackgroundLocation(location) } })
          }
        }
        return
      }
      if (key === 'r') {
        if (focusedItem) {
          if (inModal) openPostModal(focusedItem.post.uri, true, undefined, focusedItem.post.author?.handle)
          else {
            const path = getPostAppPath(focusedItem.post.uri, focusedItem.post.author?.handle)
            const q = new URLSearchParams()
            q.set('reply', '1')
            navigate(
              { pathname: path, search: `?${q.toString()}` },
              { state: { backgroundLocation: getOverlayBackgroundLocation(location) } }
            )
          }
        }
        return
      }
      if (key === 'c') {
        if (i >= 0) {
          setActionsMenuOpenForIndex(currentCardIndex)
        }
        return
      }
      if (e.code === 'Space' && inModal) {
        if (!focusedItem?.post?.uri || !focusedItem?.post?.cid) return
        const uri = focusedItem.post.uri
        const currentLikeUri = uri in currentLikeOverrides ? (currentLikeOverrides[uri] ?? undefined) : (focusedItem.post as { viewer?: { like?: string } }).viewer?.like
        if (currentLikeUri) {
          unlikePostWithLifecycle(currentLikeUri, uri).then(() => {
            setLikeOverride(uri, null)
          }).catch(() => {})
        } else {
          likePostWithLifecycle(uri, focusedItem.post.cid).then((res) => {
            setLikeOverride(uri, res.uri)
          }).catch(() => {})
        }
        return
      }
      if (key === 'f' && currentSession) {
        if (!focusedItem?.post?.author) return
        const author = focusedItem.post.author as { did: string; viewer?: { following?: string } }
        if (currentSession.did === author.did) return
        const followingUri = author.viewer?.following
        const postUri = focusedItem.post.uri
        if (followingUri) {
          setFollowOverride(author.did, null)
          unfollowAccountWithLifecycle(followingUri).then(() => {
            setItems((prev) =>
              prev.map((it) => {
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
            )
          }).catch(() => {})
        } else {
          const pendingUri = `pending:follow:${author.did}:${Date.now()}`
          setFollowOverride(author.did, pendingUri)
          followAccountWithLifecycle(author.did).then((res) => {
            setFollowOverride(author.did, res.uri)
            setItems((prev) =>
              prev.map((it) => {
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
            )
          }).catch(() => {})
        }
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [beginKeyboardNavigation, mediaItems.length, cols, navigate, location, isModalOpen, inModal, openPostModal, likeOverrides, session, setLikeOverride, setItems, setFollowOverride, setActionsMenuOpenForIndex, setBlockConfirm])

  if (!trimmedQuery) return null

  return (
    <div className={[styles.wrap, contentClassName].filter(Boolean).join(' ')}>
      {error && <p className={styles.error}>{error}</p>}
      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : mediaItems.length === 0 ? (
        <div className={styles.empty}>No posts found for this search.</div>
      ) : (
        <>
          <div
            ref={gridRef}
            className={`${profileGridStyles.gridColumns} ${viewMode === 'a' ? profileGridStyles.gridView3 : profileGridStyles[`gridView${viewMode}`]}`}
            {...gridPointerGateProps}
            data-view-mode={viewMode}
          >
            {distributeByHeight(mediaItems, cols).map((column, colIndex) => (
              <ProfileColumn
                key={colIndex}
                column={column}
                colIndex={colIndex}
                scrollRef={null}
                loadMoreSentinelRef={
                  cursor
                    ? (el) => {
                        if (cols >= 2) loadMoreSentinelRefs.current[colIndex] = el
                        else ((loadMoreSentinelRef as unknown) as { current: HTMLDivElement | null }).current = el
                      }
                    : undefined
                }
                hasCursor={!!cursor}
                keyboardFocusIndex={keyboardFocusIndex}
                actionsMenuOpenForIndex={actionsMenuOpenForIndex}
                nsfwPreference={nsfwPreference}
                unblurredUris={unblurredUris}
                setUnblurred={setUnblurred}
                likeOverrides={likeOverrides}
                setLikeOverrides={setLikeOverride}
                openPostModal={
                  inModal
                    ? openPostModal
                    : (uri, openReply, focusUri, authorHandle) => {
                        const path = getPostAppPath(uri, authorHandle)
                        const q = new URLSearchParams()
                        if (openReply) q.set('reply', '1')
                        if (focusUri) q.set('focus', focusUri)
                        const qs = q.toString()
                        navigate(
                          { pathname: path, search: qs ? `?${qs}` : '' },
                          { state: { backgroundLocation: getOverlayBackgroundLocation(location) } }
                        )
                      }
                }
                cardRef={handleCardRef}
                onActionsMenuOpenChange={(index, open) => {
                  setActionsMenuOpenForIndex(open ? index : null)
                }}
                onMouseEnter={(originalIndex) =>
                  tryHoverSelectCard(
                    originalIndex,
                    () => keyboardFocusIndexRef.current,
                    (idx) => setKeyboardFocusIndex(idx),
                    { applyOnTouch: false }
                  )
                }
                isSelected={(index) => index === keyboardFocusIndex}
              />
            ))}
          </div>
          {loadingMore && <div className={profileGridStyles.loadingMore}>Loading…</div>}
        </>
      )}
    </div>
  )
}

