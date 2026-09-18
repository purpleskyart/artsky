import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import Layout from '../components/Layout'
import { HOME_PATH, RESERVED_APP_PATH_SEGMENTS } from '../lib/routes'
import PostMasonryGrid from '../components/PostMasonryGrid'
import { getPostsBatch, getProfileCached, getPostCardFocusMediaCount, isPostNsfw, type TimelineItem } from '../lib/bsky'
import { postViewToTimelineItem } from '../lib/timeline'
import { distributeTimelineItemsByHeight } from '../lib/masonryLayout'
import { getCollectionByAtUri, isLikelyCollectionRefParam, removePostFromCollection } from '../lib/collections'
import { getShareableCollectionUrl } from '../lib/appUrl'
import { useSession } from '../context/SessionContext'
import { useViewMode } from '../context/ViewModeContext'
import { useModeration } from '../context/ModerationContext'
import { useToast } from '../context/ToastContext'
import { useCollectionSaveActions } from '../context/CollectionSaveContext'
import { useProfileModal } from '../context/ProfileModalContext'
import { useLikeOverridesActions } from '../context/LikeOverridesContext'
import { useColumnCount } from '../hooks/useViewportWidth'
import { usePostCardGridPointerGate } from '../hooks/usePostCardGridPointerGate'
import { useMediaGridKeyboardNav } from '../hooks/useMediaGridKeyboardNav'
import { useMediaFocusTargets } from '../hooks/useMediaFocusTargets'
import { useKeyboardScrollIntoView } from '../hooks/useKeyboardScrollIntoView'
import styles from './CollectionPage.module.css'
import { usePostCardDisplayContext } from '../hooks/usePostCardDisplayContext'
import { useModalScroll } from '../context/ModalScrollContext'
import { useModalGridKeyboardShell, useModalScrollKeyboardFocus } from '../hooks/useModalGridKeyboardShell'

export interface CollectionDetailContentProps {
  uri: string
  inModal?: boolean
  isTopModal?: boolean
}

/** Body only — used inside AppModal */
export function CollectionDetailContent({ uri: decodedUri, inModal = false, isTopModal = true }: CollectionDetailContentProps) {
  const { openPostModal, isModalOpen } = useProfileModal()
  const { session } = useSession()
  const { viewMode } = useViewMode()
  const toast = useToast()
  const { nsfwPreference, unblurredUris, setUnblurred } = useModeration()
  const { refreshUnionFromPds } = useCollectionSaveActions()
  const { beginKeyboardNavigation, tryHoverSelectCard, gridPointerGateProps } = usePostCardGridPointerGate()
  const modalScrollRef = useModalScroll()
  const keyboardShell = useModalGridKeyboardShell(inModal, isTopModal)
  useModalScrollKeyboardFocus(modalScrollRef, inModal && isTopModal, decodedUri)

  const [title, setTitle] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [ownerDid, setOwnerDid] = useState<string | null>(null)
  const [items, setItems] = useState<TimelineItem[]>([])
  const [totalPosts, setTotalPosts] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingPosts, setLoadingPosts] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { setLikeOverride } = useLikeOverridesActions()
  const [keyboardFocusIndex, setKeyboardFocusIndex] = useState(0)
  const keyboardFocusIndexRef = useRef(0)
  const displayItemsRef = useRef<TimelineItem[]>([])
  const cardRefsRef = useRef<(HTMLDivElement | null)[]>([])
  const mediaRefsRef = useRef<Record<number, Record<number, HTMLElement | null>>>({})
  const distributedColumnsRef = useRef<ReturnType<typeof distributeTimelineItemsByHeight>>([])
  const scrollIntoViewFromKeyboardRef = useRef(false)
  const lastScrollIntoViewIndexRef = useRef(-1)
  const actionsMenuOpenForIndexRef = useRef<number | null>(null)
  const colsRef = useRef(1)
  const copyLinkBtnRef = useRef<HTMLButtonElement>(null)
  const [resolvedAtUri, setResolvedAtUri] = useState<string | null>(null)
  const [shareHandle, setShareHandle] = useState<string | null>(null)
  const [boardSlug, setBoardSlug] = useState<string | null>(null)

  useEffect(() => {
    setResolvedAtUri(null)
    setShareHandle(null)
    setBoardSlug(null)
    setIsPrivate(false)
    setTotalPosts(0)
  }, [decodedUri])

  const load = useCallback(async () => {
    if (!decodedUri) return
    setLoading(true)
    setLoadingPosts(false)
    setError(null)
    setItems([])
    try {
      const col = await getCollectionByAtUri(decodedUri)
      if (!col) {
        setError('Collection not found, or it is private.')
        setTitle('')
        setIsPrivate(false)
        setOwnerDid(null)
        setResolvedAtUri(null)
        setBoardSlug(null)
        setTotalPosts(0)
        setLoading(false)
        return
      }
      setTitle(col.title)
      setIsPrivate(col.isPrivate)
      setOwnerDid(col.did)
      setResolvedAtUri(col.uri)
      setBoardSlug(col.slug)
      setTotalPosts(col.items.length)
      setLoading(false) // Show collection header immediately

      // Load posts progressively in chunks for better perceived performance
      if (col.items.length > 0) {
        setLoadingPosts(true)
        const chunkSize = 25 // Match API batch size
        const chunks: string[][] = []

        // Prepare all chunks
        for (let i = 0; i < col.items.length; i += chunkSize) {
          chunks.push(col.items.slice(i, i + chunkSize))
        }

        // Track loaded items by chunk index to maintain order
        const itemsByChunkIndex = new Map<number, TimelineItem[]>()
        let completedChunks = 0

        // Fetch all chunks in parallel
        const chunkPromises = chunks.map(async (chunk, chunkIndex) => {
          try {
            const map = await getPostsBatch(chunk)
            const newItems: TimelineItem[] = []
            for (const u of chunk) {
              const p = map.get(u)
              if (p) newItems.push(postViewToTimelineItem(p))
            }
            itemsByChunkIndex.set(chunkIndex, newItems)
          } catch (e) {
            console.warn('Failed to load post chunk:', e)
            itemsByChunkIndex.set(chunkIndex, [])
          } finally {
            completedChunks++
            // Update UI with all completed chunks so far
            const allItems: TimelineItem[] = []
            for (let i = 0; i < chunks.length; i++) {
              const items = itemsByChunkIndex.get(i)
              if (items) allItems.push(...items)
            }
            setItems(allItems)
          }
        })

        await Promise.all(chunkPromises)
        setLoadingPosts(false)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load collection')
      setTitle('')
      setIsPrivate(false)
      setOwnerDid(null)
      setResolvedAtUri(null)
      setBoardSlug(null)
      setItems([])
      setTotalPosts(0)
      setLoading(false)
      setLoadingPosts(false)
    }
  }, [decodedUri])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!ownerDid) {
      setShareHandle(null)
      return
    }
    let cancelled = false
    void getProfileCached(ownerDid)
      .then((p) => {
        if (!cancelled) setShareHandle(p.handle ?? null)
      })
      .catch(() => {
        if (!cancelled) setShareHandle(null)
      })
    return () => {
      cancelled = true
    }
  }, [ownerDid])

  const isOwner = !!(session?.did && ownerDid && session.did === ownerDid)
  const cols = useColumnCount(viewMode, 150)
  const postCardDisplayContext = usePostCardDisplayContext(true)

  const displayItems = useMemo(
    () =>
      items.filter((item) => {
        if (nsfwPreference === 'sfw' && isPostNsfw(item.post)) return false
        return true
      }),
    [items, nsfwPreference]
  )

  displayItemsRef.current = displayItems
  keyboardFocusIndexRef.current = keyboardFocusIndex

  const distributedColumns = useMemo(
    () => distributeTimelineItemsByHeight(displayItems, cols, distributedColumnsRef.current),
    [displayItems, cols],
  )
  distributedColumnsRef.current = distributedColumns
  colsRef.current = cols

  const getMediaCount = useCallback(
    (cardIndex: number) => {
      const item = displayItems[cardIndex]
      return item ? getPostCardFocusMediaCount(item) : 1
    },
    [displayItems],
  )
  const { focusTargets, firstFocusIndexForCard, lastFocusIndexForCard } = useMediaFocusTargets(
    displayItems.length,
    getMediaCount,
  )
  const focusTargetsRef = useRef(focusTargets)
  const firstFocusIndexForCardRef = useRef(firstFocusIndexForCard)
  const lastFocusIndexForCardRef = useRef(lastFocusIndexForCard)
  focusTargetsRef.current = focusTargets
  firstFocusIndexForCardRef.current = firstFocusIndexForCard
  lastFocusIndexForCardRef.current = lastFocusIndexForCard

  useEffect(() => {
    setKeyboardFocusIndex((i) => (focusTargets.length ? Math.min(i, focusTargets.length - 1) : 0))
  }, [displayItems.length, focusTargets.length])

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

  const getColumns = useCallback(
    () => (colsRef.current >= 2 ? distributedColumnsRef.current : null),
    [],
  )

  useMediaGridKeyboardNav({
    enabled: displayItems.length > 0,
    keyboardShell,
    inModal,
    isModalOpen,
    itemsRef: displayItemsRef,
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
      (item) => openPostModal(item.post.uri, undefined, undefined, item.post.author?.handle),
      [openPostModal],
    ),
  })

  const shareUrl = useMemo(() => {
    if (!decodedUri || !isLikelyCollectionRefParam(decodedUri)) return ''
    const ref = resolvedAtUri ?? decodedUri
    return getShareableCollectionUrl(ref, shareHandle, boardSlug)
  }, [decodedUri, resolvedAtUri, shareHandle, boardSlug])

  const copyShare = useCallback(() => {
    if (!shareUrl) return
    const anchor = copyLinkBtnRef.current
    void navigator.clipboard.writeText(shareUrl).then(
      () => toast?.showToast('Copied!', anchor),
      () => toast?.showToast('Could not copy', anchor)
    )
  }, [shareUrl, toast])

  const handleCardRef = useCallback((index: number) => (el: HTMLDivElement | null) => {
    cardRefsRef.current[index] = el
  }, [])

  const handleMouseEnter = useCallback(
    (originalIndex: number) => {
      tryHoverSelectCard(
        originalIndex,
        () => focusTargets[keyboardFocusIndexRef.current]?.cardIndex ?? -1,
        (cardIndex) => setKeyboardFocusIndex(firstFocusIndexForCardRef.current[cardIndex] ?? 0),
        { applyOnTouch: false },
      )
    },
    [tryHoverSelectCard, focusTargets],
  )

  const isSelected = useCallback(
    (index: number) => {
      const target = focusTargets[keyboardFocusIndex]
      return (target?.cardIndex ?? keyboardFocusIndex) === index
    },
    [keyboardFocusIndex, focusTargets],
  )

  const noopActionsMenuOpenChange = useCallback(() => {}, [])

  const onRemovePostFromCollection = useCallback(
    async (postUri: string) => {
      if (!isOwner || !decodedUri) return
      try {
        await removePostFromCollection(decodedUri, postUri)
        setItems((prev) => prev.filter((t) => t.post.uri !== postUri))
        void refreshUnionFromPds()
        void load()
      } catch (e) {
        toast?.showToast(e instanceof Error ? e.message : 'Could not remove')
      }
    },
    [isOwner, decodedUri, refreshUnionFromPds, toast, load]
  )

  if (!decodedUri) {
    return (
      <div className={styles.wrap}>
        <p className={styles.empty}>No collection specified.</p>
      </div>
    )
  }

  if (!isLikelyCollectionRefParam(decodedUri)) {
    return (
      <div className={styles.wrap}>
        <p className={styles.error}>Invalid collection link.</p>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{loading ? '…' : title || 'Collection'}</h1>
          <p className={styles.meta}>
            {loadingPosts && totalPosts > 0
              ? `Loading ${items.length} of ${totalPosts} posts…`
              : `${items.length} ${items.length === 1 ? 'post' : 'posts'}`}
            {isPrivate ? ' · Private collection' : !session ? ' · Anyone with the link can view this board' : ''}
          </p>
        </div>
        <div className={styles.actions}>
          <button
            ref={copyLinkBtnRef}
            type="button"
            className={styles.actionBtn}
            onClick={copyShare}
            disabled={!shareUrl || isPrivate}
          >
            Copy link
          </button>
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}
      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : displayItems.length === 0 && !loadingPosts ? (
        <div className={styles.empty}>No posts to show (removed or unavailable).</div>
      ) : (
        <>
          <PostMasonryGrid
            viewMode={viewMode}
            distributedColumns={distributedColumns}
            gridPointerGateProps={gridPointerGateProps}
            bindLoadMoreSentinelRef={() => () => {}}
            modalScrollRef={inModal ? modalScrollRef : null}
            loadingMore={loadingPosts}
            loadingMoreClassName={styles.loadingMore}
            columnProps={{
              keyboardFocusIndex,
              actionsMenuOpenForIndex: null,
              nsfwPreference,
              unblurredUris,
              setUnblurred,
              setLikeOverrides: setLikeOverride,
              openPostModal,
              cardRef: handleCardRef,
              onActionsMenuOpenChange: noopActionsMenuOpenChange,
              onMouseEnter: handleMouseEnter,
              isSelected,
              onRemovePostFromCollection: isOwner ? onRemovePostFromCollection : undefined,
              feedPreviewActionRow: true,
              collectionGridPlayback: true,
              displayContext: postCardDisplayContext,
            }}
          />
        </>
      )}
    </div>
  )
}

/** Full-page board: `/handle/collection-slug` (share URL). */
export default function CollectionPage() {
  const { handle, boardSlug } = useParams<{ handle: string; boardSlug: string }>()
  const h = handle?.trim()
  const s = boardSlug?.trim()
  if (!h || !s) return <Navigate to={HOME_PATH} replace />
  if (RESERVED_APP_PATH_SEGMENTS.has(h.toLowerCase())) return <Navigate to={HOME_PATH} replace />
  const uri = `${h}/${s}`
  return (
    <Layout title="Collection" showNav>
      <CollectionDetailContent uri={uri} />
    </Layout>
  )
}
