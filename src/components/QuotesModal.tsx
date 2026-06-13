import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getQuotes } from '../lib/bsky'
import type { TimelineItem } from '../lib/bsky'
import ProfileColumn from './ProfileColumn'
import AppModal from './AppModal'
import { useProfileModal } from '../context/ProfileModalContext'
import { useLikeOverridesActions } from '../context/LikeOverridesContext'
import { useModeration } from '../context/ModerationContext'
import { usePostCardGridPointerGate } from '../hooks/usePostCardGridPointerGate'
import { useColumnLoadMore } from '../hooks/useColumnLoadMore'
import { useModalGridKeyboardShell, useModalScrollKeyboardFocus } from '../hooks/useModalGridKeyboardShell'
import { useModalScroll } from '../context/ModalScrollContext'
import { useMediaFocusTargets } from '../hooks/useMediaFocusTargets'
import { useMediaGridKeyboardNav } from '../hooks/useMediaGridKeyboardNav'
import { useKeyboardScrollIntoView } from '../hooks/useKeyboardScrollIntoView'
import { postViewsToTimelineItems } from '../lib/timeline'
import { getPostGridClassName } from '../lib/gridClassName'
import styles from './QuotesModal.module.css'
import { usePostCardDisplayContext } from '../hooks/usePostCardDisplayContext'

interface QuotesModalProps {
  postUri: string
  onClose: () => void
  onBack: () => void
  canGoBack: boolean
  onDesktopBackdrop?: () => void
  isTopModal?: boolean
  stackIndex?: number
}

export default function QuotesModal({ postUri, onClose, onBack, canGoBack, onDesktopBackdrop, isTopModal, stackIndex }: QuotesModalProps) {
  const { openPostModal } = useProfileModal()
  const { nsfwPreference, unblurredUris, setUnblurred } = useModeration()
  const [items, setItems] = useState<TimelineItem[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshFn, setRefreshFn] = useState<(() => void | Promise<void>) | null>(null)
  const { setLikeOverride } = useLikeOverridesActions()
  const [keyboardFocusIndex, setKeyboardFocusIndex] = useState(0)
  const keyboardFocusIndexRef = useRef(0)
  const itemsRef = useRef<TimelineItem[]>([])
  const cardRefsRef = useRef<(HTMLDivElement | null)[]>([])
  const mediaRefsRef = useRef<Record<number, Record<number, HTMLElement | null>>>({})
  const scrollIntoViewFromKeyboardRef = useRef(false)
  const lastScrollIntoViewIndexRef = useRef(-1)
  const actionsMenuOpenForIndexRef = useRef<number | null>(null)
  const colsRef = useRef(1)
  const loadMoreSentinelRefs = useRef<(HTMLDivElement | null)[]>([])
  const distributedColumnLengthsRef = useRef<number[]>([])
  const loadingMoreRef = useRef(false)
  const { beginKeyboardNavigation, tryHoverSelectCard, gridPointerGateProps } = usePostCardGridPointerGate()
  const modalScrollRef = useModalScroll()
  const inModal = true
  const keyboardShell = useModalGridKeyboardShell(inModal, isTopModal ?? true)
  useModalScrollKeyboardFocus(modalScrollRef, inModal && (isTopModal ?? true), postUri)

  const load = useCallback(
    async (nextCursor?: string) => {
      try {
        if (nextCursor) setLoadingMore(true)
        else setLoading(true)
        setError(null)
        const { posts, cursor: next } = await getQuotes(postUri, { limit: 30, cursor: nextCursor })
        const timelineItems = postViewsToTimelineItems(posts)
        setItems((prev) => (nextCursor ? [...prev, ...timelineItems] : timelineItems))
        setCursor(next)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load quotes')
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [postUri]
  )

  useEffect(() => {
    setItems([])
    setCursor(undefined)
    load()
  }, [postUri, load])

  useEffect(() => {
    setRefreshFn(() => () => load())
  }, [load])

  const quoteColumn = useMemo(
    () => items.map((item, i) => ({ item, originalIndex: i })),
    [items],
  )
  distributedColumnLengthsRef.current = [quoteColumn.length]
  itemsRef.current = items
  keyboardFocusIndexRef.current = keyboardFocusIndex

  const { focusTargets, firstFocusIndexForCard, lastFocusIndexForCard } = useMediaFocusTargets(
    items.length,
    () => 1,
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
    cols: 1,
    itemCount: items.length,
    loadingMoreRef,
    loadMore: load,
    sentinelRefs: loadMoreSentinelRefs,
    columnLengthsRef: distributedColumnLengthsRef,
    inModal: true,
  })

  useKeyboardScrollIntoView({
    keyboardFocusIndex,
    scrollIntoViewFromKeyboardRef,
    lastScrollIntoViewIndexRef,
    block: 'nearest',
    getScrollTarget: useCallback(() => {
      const target = focusTargets[keyboardFocusIndex]
      return cardRefsRef.current[target?.cardIndex ?? keyboardFocusIndex]
    }, [keyboardFocusIndex, focusTargets]),
  })

  useMediaGridKeyboardNav({
    enabled: items.length > 0,
    keyboardShell,
    inModal,
    itemsRef,
    keyboardFocusIndexRef,
    setKeyboardFocusIndex,
    focusTargetsRef,
    firstFocusIndexForCardRef,
    lastFocusIndexForCardRef,
    colsRef,
    getColumns: useCallback(() => null, []),
    cardRefsRef,
    mediaRefsRef,
    scrollIntoViewFromKeyboardRef,
    beginKeyboardNavigation,
    actionsMenuOpenForIndexRef,
    includeCollectionMenu: false,
    skipWhenPageModalOpen: false,
    onOpenPost: useCallback((item: TimelineItem) => openPostModal(item.post.uri), [openPostModal]),
  })

  const postCardDisplayContext = usePostCardDisplayContext(true)

  const handleCardRef = useCallback((index: number) => (el: HTMLDivElement | null) => {
    cardRefsRef.current[index] = el
  }, [])

  const handleMouseEnter = useCallback(
    (originalIndex: number) => {
      tryHoverSelectCard(
        originalIndex,
        () => keyboardFocusIndexRef.current,
        (idx) => setKeyboardFocusIndex(idx),
        { disabled: true },
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

  const noopActionsMenuOpenChange = useCallback(() => {}, [])

  return (
    <AppModal
      ariaLabel="Posts that quote this post"
      onClose={onClose}
      onBack={onBack}
      canGoBack={canGoBack}
      onDesktopBackdrop={onDesktopBackdrop}
      onPullToRefresh={refreshFn ? () => refreshFn() : undefined}
      scrollKey={postUri}
      isTopModal={isTopModal}
      stackIndex={stackIndex}
    >
      <div className={styles.wrap} {...gridPointerGateProps}>
        {error && <p className={styles.error}>{error}</p>}
        {loading ? (
          <div className={styles.loading}>Loading…</div>
        ) : items.length === 0 ? (
          <div className={styles.empty}>No one has quoted this post yet.</div>
        ) : (
          <>
            <div className={getPostGridClassName('1')}>
              <ProfileColumn
                column={quoteColumn}
                colIndex={0}
                scrollRef={modalScrollRef}
                loadMoreSentinelRef={cursor ? bindLoadMoreSentinelRef(0) : undefined}
                hasCursor={!!cursor}
                keyboardFocusIndex={keyboardFocusIndex}
                actionsMenuOpenForIndex={null}
                nsfwPreference={nsfwPreference}
                unblurredUris={unblurredUris}
                setUnblurred={setUnblurred}
                setLikeOverrides={setLikeOverride}
                openPostModal={openPostModal}
                cardRef={handleCardRef}
                onActionsMenuOpenChange={noopActionsMenuOpenChange}
                onMouseEnter={handleMouseEnter}
                suppressHoverNsfwUnblur
                isSelected={isSelected}
                displayContext={postCardDisplayContext}
              />
            </div>
            {loadingMore && <div className={styles.loadingMore}>Loading more…</div>}
          </>
        )}
      </div>
    </AppModal>
  )
}
