import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  searchPostsByPhraseAndTags,
  getPostMediaInfo,
  likePostWithLifecycle,
  unlikePostWithLifecycle,
  followAccountWithLifecycle,
  unfollowAccountWithLifecycle,
  listBlockedAccounts,
  listMutedAccounts,
} from '../lib/bsky'
import type { TimelineItem } from '../lib/bsky'
import PostMasonryGrid from './PostMasonryGrid'
import { useSession } from '../context/SessionContext'
import { useProfileModal } from '../context/ProfileModalContext'
import { useLikeOverridesActions } from '../context/LikeOverridesContext'
import { getLikeOverrideFromStore } from '../lib/likeOverridesStore'
import { useFollowOverrides } from '../context/FollowOverridesContext'
import { useViewMode } from '../context/ViewModeContext'
import { useModeration } from '../context/ModerationContext'
import { useColumnCount } from '../hooks/useViewportWidth'
import { useColumnLoadMore } from '../hooks/useColumnLoadMore'
import { usePostCardGridPointerGate } from '../hooks/usePostCardGridPointerGate'
import { useModalGridKeyboardShell, useModalScrollKeyboardFocus } from '../hooks/useModalGridKeyboardShell'
import { useModalScroll } from '../context/ModalScrollContext'
import { usePostCardDisplayContext } from '../hooks/usePostCardDisplayContext'
import { useOpenPostFromGrid } from '../hooks/useOpenPostFromGrid'
import { useMediaFocusTargets } from '../hooks/useMediaFocusTargets'
import { useMediaGridKeyboardNav } from '../hooks/useMediaGridKeyboardNav'
import { useKeyboardScrollIntoView } from '../hooks/useKeyboardScrollIntoView'
import { useRegisterGridRefresh } from '../hooks/useModalPullRefresh'
import { distributeTimelineItemsByHeight } from '../lib/masonryLayout'
import { filterMediaGridItems } from '../lib/filterGridItems'
import { patchFollowingOnTimelineItem } from '../lib/followOptimisticUpdate'
import { postViewsToTimelineItems } from '../lib/timeline'
import styles from '../pages/TagPage.module.css'

export interface SearchModalGridContentProps {
  searchQuery: string
  inModal?: boolean
  isTopModal?: boolean
  onRegisterRefresh?: (refresh: () => void | Promise<void>) => void
  contentClassName?: string
}

/** Search results grid — mirrors TagContent with media-aware masonry keyboard nav. */
export function SearchModalGridContent({
  searchQuery,
  inModal = false,
  isTopModal = true,
  onRegisterRefresh,
  contentClassName,
}: SearchModalGridContentProps) {
  const { session } = useSession()
  const { viewMode } = useViewMode()
  const { isModalOpen, openPostModal } = useProfileModal()
  const { setLikeOverride } = useLikeOverridesActions()
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
  const mediaRefsRef = useRef<Record<number, Record<number, HTMLElement | null>>>({})
  const loadMoreSentinelRefs = useRef<(HTMLDivElement | null)[]>([])
  const distributedColumnLengthsRef = useRef<number[]>([])
  const distributedColumnsRef = useRef<ReturnType<typeof distributeTimelineItemsByHeight>>([])
  const loadingMoreRef = useRef(false)
  const keyboardFocusIndexRef = useRef(0)
  const mediaItemsRef = useRef<TimelineItem[]>([])
  const scrollIntoViewFromKeyboardRef = useRef(false)
  const lastScrollIntoViewIndexRef = useRef(-1)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const sessionRef = useRef(session)
  sessionRef.current = session
  const actionsMenuOpenForIndexRef = useRef<number | null>(null)
  actionsMenuOpenForIndexRef.current = actionsMenuOpenForIndex
  const blockConfirmRefState = useRef(blockConfirm)
  blockConfirmRefState.current = blockConfirm
  const colsRef = useRef(1)
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
        setItems((prev) => (nextCursor ? [...prev, ...postViewsToTimelineItems(posts)] : postViewsToTimelineItems(posts)))
        setCursor(next)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Search failed'
        setError(msg === 'Failed to fetch' ? 'Search couldn’t be completed. Check your connection or try again.' : msg)
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [trimmedQuery],
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

  useRegisterGridRefresh(onRegisterRefresh, load)

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
      .catch(() => {})
  }, [session])

  const { nsfwPreference, unblurredUris, setUnblurred } = useModeration()
  const postCardDisplayContext = usePostCardDisplayContext(inModal)
  const modalScrollRef = useModalScroll()
  const keyboardShell = useModalGridKeyboardShell(inModal, isTopModal)
  useModalScrollKeyboardFocus(modalScrollRef, inModal && isTopModal, trimmedQuery)
  const handleOpenPostFromGrid = useOpenPostFromGrid(inModal, openPostModal)

  const mediaItems = useMemo(
    () => filterMediaGridItems(items, { nsfwPreference, blockedDids, mutedDids }),
    [items, nsfwPreference, blockedDids, mutedDids],
  )
  const cols = useColumnCount(viewMode, 150)
  colsRef.current = cols
  const distributedColumns = useMemo(
    () => distributeTimelineItemsByHeight(mediaItems, cols, distributedColumnsRef.current),
    [mediaItems, cols],
  )
  distributedColumnsRef.current = distributedColumns
  distributedColumnLengthsRef.current = distributedColumns.map((c) => c.length)
  mediaItemsRef.current = mediaItems
  keyboardFocusIndexRef.current = keyboardFocusIndex

  const getMediaCount = useCallback(
    (cardIndex: number) => {
      const media = getPostMediaInfo(mediaItems[cardIndex]?.post)
      return media ? media.imageCount ?? 1 : 1
    },
    [mediaItems],
  )
  const { focusTargets, firstFocusIndexForCard, lastFocusIndexForCard } = useMediaFocusTargets(
    mediaItems.length,
    getMediaCount,
  )
  const focusTargetsRef = useRef(focusTargets)
  const firstFocusIndexForCardRef = useRef(firstFocusIndexForCard)
  const lastFocusIndexForCardRef = useRef(lastFocusIndexForCard)
  focusTargetsRef.current = focusTargets
  firstFocusIndexForCardRef.current = firstFocusIndexForCard
  lastFocusIndexForCardRef.current = lastFocusIndexForCard

  loadingMoreRef.current = loadingMore
  const bindLoadMoreSentinelRef = useColumnLoadMore({
    cursor,
    cols,
    itemCount: mediaItems.length,
    loadingMoreRef,
    loadMore: load,
    sentinelRefs: loadMoreSentinelRefs,
    columnLengthsRef: distributedColumnLengthsRef,
    inModal,
  })

  useEffect(() => {
    setKeyboardFocusIndex((i) => (focusTargets.length ? Math.min(i, focusTargets.length - 1) : 0))
  }, [mediaItems.length, focusTargets.length])

  useKeyboardScrollIntoView({
    keyboardFocusIndex,
    scrollIntoViewFromKeyboardRef,
    lastScrollIntoViewIndexRef,
    getScrollTarget: useCallback(() => {
      const target = focusTargets[keyboardFocusIndex]
      const cardIndex = target?.cardIndex ?? keyboardFocusIndex
      const mediaIndex = target?.mediaIndex ?? 0
      return mediaRefsRef.current[cardIndex]?.[mediaIndex] ?? cardRefsRef.current[cardIndex]
    }, [keyboardFocusIndex, focusTargets]),
  })

  const getColumns = useCallback(
    () => (colsRef.current >= 2 ? distributedColumnsRef.current : null),
    [],
  )

  useMediaGridKeyboardNav({
    enabled: mediaItems.length > 0,
    keyboardShell,
    inModal,
    isModalOpen,
    itemsRef: mediaItemsRef,
    keyboardFocusIndexRef,
    setKeyboardFocusIndex,
    focusTargetsRef,
    firstFocusIndexForCardRef,
    lastFocusIndexForCardRef,
    colsRef,
    getColumns,
    cardRefsRef,
    mediaRefsRef,
    scrollIntoViewFromKeyboardRef,
    beginKeyboardNavigation,
    actionsMenuOpenForIndexRef,
    setActionsMenuOpenForIndex,
    blockConfirmRef: blockConfirmRefState,
    setBlockConfirm,
    onOpenPost: useCallback(
      (item: TimelineItem) => handleOpenPostFromGrid(item.post.uri, undefined, undefined, item.post.author?.handle),
      [handleOpenPostFromGrid],
    ),
    onOpenReply: useCallback(
      (item: TimelineItem) => handleOpenPostFromGrid(item.post.uri, true, undefined, item.post.author?.handle),
      [handleOpenPostFromGrid],
    ),
    onToggleActionsMenu: useCallback((cardIndex: number, menuOpen: boolean) => {
      setActionsMenuOpenForIndex(menuOpen ? null : cardIndex)
    }, []),
    onOpenCollectionMenu: useCallback((cardIndex: number) => {
      setActionsMenuOpenForIndex(cardIndex)
    }, []),
    onToggleLike: useCallback(
      (item: TimelineItem) => {
        if (!item.post.uri || !item.post.cid) return
        const uri = item.post.uri
        const override = getLikeOverrideFromStore(uri)
        const currentLikeUri =
          override !== undefined ? (override ?? undefined) : (item.post as { viewer?: { like?: string } }).viewer?.like
        if (currentLikeUri) {
          unlikePostWithLifecycle(currentLikeUri, uri).then(() => setLikeOverride(uri, null)).catch(() => {})
        } else {
          likePostWithLifecycle(uri, item.post.cid).then((res) => setLikeOverride(uri, res.uri)).catch(() => {})
        }
      },
      [setLikeOverride],
    ),
    onToggleFollow: useCallback(
      (item: TimelineItem) => {
        const currentSession = sessionRef.current
        if (!currentSession?.did || !item.post.author) return
        const author = item.post.author as { did: string; viewer?: { following?: string } }
        if (currentSession.did === author.did) return
        const followingUri = author.viewer?.following
        const postUri = item.post.uri
        if (followingUri) {
          setFollowOverride(author.did, null)
          unfollowAccountWithLifecycle(followingUri)
            .then(() => setItems((prev) => patchFollowingOnTimelineItem(prev, postUri, undefined)))
            .catch(() => {})
        } else {
          const pendingUri = `pending:follow:${author.did}:${Date.now()}`
          setFollowOverride(author.did, pendingUri)
          followAccountWithLifecycle(author.did)
            .then((res) => {
              setFollowOverride(author.did, res.uri)
              setItems((prev) => patchFollowingOnTimelineItem(prev, postUri, res.uri))
            })
            .catch(() => {})
        }
      },
      [setFollowOverride],
    ),
  })

  const handleCardRef = useCallback((index: number) => (el: HTMLDivElement | null) => {
    cardRefsRef.current[index] = el
  }, [])

  const handleActionsMenuOpenChange = useCallback((index: number, open: boolean) => {
    setActionsMenuOpenForIndex(open ? index : null)
  }, [])

  const handleMouseEnter = useCallback(
    (originalIndex: number) => {
      tryHoverSelectCard(
        originalIndex,
        () => firstFocusIndexForCardRef.current[originalIndex] ?? keyboardFocusIndexRef.current,
        (idx) => setKeyboardFocusIndex(idx),
        { applyOnTouch: false },
      )
    },
    [tryHoverSelectCard],
  )

  const isSelected = useCallback(
    (index: number) => {
      const target = focusTargets[keyboardFocusIndex]
      return (target?.cardIndex ?? keyboardFocusIndex) === index
    },
    [keyboardFocusIndex, focusTargets],
  )

  if (!trimmedQuery) return null

  return (
    <div className={[styles.wrap, contentClassName].filter(Boolean).join(' ')}>
      {error && <p className={styles.error}>{error}</p>}
      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : mediaItems.length === 0 ? (
        <div className={styles.empty}>No posts found for this search.</div>
      ) : (
        <PostMasonryGrid
          viewMode={viewMode}
          distributedColumns={distributedColumns}
          gridRef={gridRef}
          gridPointerGateProps={gridPointerGateProps}
          cursor={cursor}
          bindLoadMoreSentinelRef={bindLoadMoreSentinelRef}
          modalScrollRef={inModal ? modalScrollRef : null}
          loadingMore={loadingMore}
          loadingMoreClassName={styles.loadingMore}
          columnProps={{
            keyboardFocusIndex,
            actionsMenuOpenForIndex,
            nsfwPreference,
            unblurredUris,
            setUnblurred,
            setLikeOverrides: setLikeOverride,
            openPostModal: handleOpenPostFromGrid,
            cardRef: handleCardRef,
            onActionsMenuOpenChange: handleActionsMenuOpenChange,
            onMouseEnter: handleMouseEnter,
            isSelected,
            displayContext: postCardDisplayContext,
          }}
        />
      )}
    </div>
  )
}
