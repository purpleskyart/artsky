import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  searchPostsByTag,
  getPostMediaInfo,
  likePostWithLifecycle,
  unlikePostWithLifecycle,
  followAccountWithLifecycle,
  unfollowAccountWithLifecycle,
} from '../lib/bsky'
import type { TimelineItem } from '../lib/bsky'
import Layout from '../components/Layout'
import PostMasonryGrid from '../components/PostMasonryGrid'
import { useSession } from '../context/SessionContext'
import { useProfileModal } from '../context/ProfileModalContext'
import { useLikeOverridesActions } from '../context/LikeOverridesContext'
import { getLikeOverrideFromStore } from '../lib/likeOverridesStore'
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
import styles from './TagPage.module.css'

export function TagContent({
  tag,
  inModal = false,
  isTopModal = true,
  onRegisterRefresh,
}: {
  tag: string
  inModal?: boolean
  isTopModal?: boolean
  onRegisterRefresh?: (refresh: () => void | Promise<void>) => void
}) {
  const { session } = useSession()
  const { viewMode } = useViewMode()
  const { isModalOpen, openPostModal } = useProfileModal()
  const [items, setItems] = useState<TimelineItem[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keyboardFocusIndex, setKeyboardFocusIndex] = useState(0)
  const { setLikeOverride } = useLikeOverridesActions()
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
  const actionsMenuOpenForIndexRef = useRef<number | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const colsRef = useRef(1)
  const { beginKeyboardNavigation, tryHoverSelectCard, gridPointerGateProps } = usePostCardGridPointerGate()

  const load = useCallback(async (nextCursor?: string) => {
    if (!tag) return
    try {
      if (nextCursor) setLoadingMore(true)
      else setLoading(true)
      setError(null)
      const { posts, cursor: next } = await searchPostsByTag(tag, nextCursor)
      const timelineItems = postViewsToTimelineItems(posts)
      setItems((prev) => (nextCursor ? [...prev, ...timelineItems] : timelineItems))
      setCursor(next)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load tag')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [tag])

  useEffect(() => {
    if (tag) {
      setItems([])
      setCursor(undefined)
      load()
    }
  }, [tag, load])

  useRegisterGridRefresh(onRegisterRefresh, load)

  const { nsfwPreference, unblurredUris, setUnblurred } = useModeration()
  const postCardDisplayContext = usePostCardDisplayContext(inModal)
  const modalScrollRef = useModalScroll()
  const keyboardShell = useModalGridKeyboardShell(inModal, isTopModal)
  useModalScrollKeyboardFocus(modalScrollRef, inModal && isTopModal, tag)
  const handleOpenPostFromGrid = useOpenPostFromGrid(inModal, openPostModal)

  const mediaItems = useMemo(
    () => filterMediaGridItems(items, { nsfwPreference }),
    [items, nsfwPreference],
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
    setKeyboardFocusIndex((i) => (mediaItems.length ? Math.min(i, focusTargets.length - 1) : 0))
  }, [mediaItems.length, focusTargets.length])

  useKeyboardScrollIntoView({
    keyboardFocusIndex,
    scrollIntoViewFromKeyboardRef,
    lastScrollIntoViewIndexRef,
    block: 'nearest',
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
    includeCollectionMenu: false,
    onOpenPost: useCallback(
      (item: TimelineItem) => handleOpenPostFromGrid(item.post.uri, undefined, undefined, item.post.author?.handle),
      [handleOpenPostFromGrid],
    ),
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
        if (!session?.did || !item.post.author) return
        const author = item.post.author as { did: string; viewer?: { following?: string } }
        if (session.did === author.did) return
        const followingUri = author.viewer?.following
        const postUri = item.post.uri
        if (followingUri) {
          unfollowAccountWithLifecycle(followingUri)
            .then(() => setItems((prev) => patchFollowingOnTimelineItem(prev, postUri, undefined)))
            .catch(() => {})
        } else {
          followAccountWithLifecycle(author.did)
            .then((res) => setItems((prev) => patchFollowingOnTimelineItem(prev, postUri, res.uri)))
            .catch(() => {})
        }
      },
      [session],
    ),
    likeOnSpaceInModalOnly: true,
  })

  const handleCardRef = useCallback((index: number) => (el: HTMLDivElement | null) => {
    cardRefsRef.current[index] = el
  }, [])

  const handleMouseEnter = useCallback(
    (originalIndex: number) => {
      tryHoverSelectCard(
        originalIndex,
        () => firstFocusIndexForCardRef.current[originalIndex] ?? keyboardFocusIndexRef.current,
        (idx) => setKeyboardFocusIndex(idx),
        { applyOnTouch: inModal ? false : undefined },
      )
    },
    [tryHoverSelectCard, inModal],
  )

  const isSelected = useCallback(
    (index: number) => {
      const target = focusTargets[keyboardFocusIndex]
      return (target?.cardIndex ?? keyboardFocusIndex) === index
    },
    [keyboardFocusIndex, focusTargets],
  )

  const noopActionsMenuOpenChange = useCallback(() => {}, [])

  if (!tag) return null

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h2 className={styles.title}>#{tag}</h2>
      </header>
      {error && <p className={styles.error}>{error}</p>}
      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : mediaItems.length === 0 ? (
        <div className={styles.empty}>No posts with images or videos for this tag.</div>
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
            actionsMenuOpenForIndex: null,
            nsfwPreference,
            unblurredUris,
            setUnblurred,
            setLikeOverrides: setLikeOverride,
            openPostModal: handleOpenPostFromGrid,
            cardRef: handleCardRef,
            onActionsMenuOpenChange: noopActionsMenuOpenChange,
            onMouseEnter: handleMouseEnter,
            suppressHoverNsfwUnblur: inModal,
            isSelected,
            displayContext: postCardDisplayContext,
          }}
        />
      )}
    </div>
  )
}

export default function TagPage() {
  const { tag: tagParam } = useParams<{ tag: string }>()
  const tag = tagParam ? decodeURIComponent(tagParam) : ''

  if (!tag) {
    return (
      <Layout title="Tag" showNav>
        <div className={styles.wrap}>
          <p className={styles.empty}>No tag specified.</p>
        </div>
      </Layout>
    )
  }

  return (
    <Layout title={`#${tag}`} showNav>
      <TagContent tag={tag} />
    </Layout>
  )
}
