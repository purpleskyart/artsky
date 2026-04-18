import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { searchPostsByPhraseAndTags, getPostMediaInfo, isPostNsfw, likePostWithLifecycle, unlikePostWithLifecycle, followAccountWithLifecycle, unfollowAccountWithLifecycle } from '../lib/bsky'
import type { TimelineItem } from '../lib/bsky'
import type { AppBskyFeedDefs } from '@atproto/api'
import ProfileColumn from './ProfileColumn'
import { useSession } from '../context/SessionContext'
import { useProfileModal } from '../context/ProfileModalContext'
import { useLikeOverrides } from '../context/LikeOverridesContext'
import { useViewMode } from '../context/ViewModeContext'
import { useModeration } from '../context/ModerationContext'
import { useModalScroll } from '../context/ModalScrollContext'
import { useColumnCount } from '../hooks/useViewportWidth'
import { usePostCardGridPointerGate } from '../hooks/usePostCardGridPointerGate'
import styles from '../pages/TagPage.module.css'
import profileGridStyles from '../pages/ProfilePage.module.css'
import { getPostAppPath } from '../lib/appUrl'
import { getOverlayBackgroundLocation } from '../lib/overlayNavigation'

const ESTIMATE_COL_WIDTH = 280
const CARD_CHROME = 100

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
  const [items, setItems] = useState<TimelineItem[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keyboardFocusIndex, setKeyboardFocusIndex] = useState(0)
  const { likeOverrides, setLikeOverride } = useLikeOverrides()
  const cardRefsRef = useRef<(HTMLDivElement | null)[]>([])
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null)
  const loadMoreSentinelRefs = useRef<(HTMLDivElement | null)[]>([])
  const loadingMoreRef = useRef(false)
  const keyboardFocusIndexRef = useRef(0)
  const mediaItemsRef = useRef<TimelineItem[]>([])
  const scrollIntoViewFromKeyboardRef = useRef(false)
  const lastScrollIntoViewIndexRef = useRef(-1)
  const modalScrollRef = useModalScroll()
  const gridRef = useRef<HTMLDivElement | null>(null)
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

  const { nsfwPreference, unblurredUris, setUnblurred } = useModeration()
  const mediaItems = items
    .filter((item) => getPostMediaInfo(item.post))
    .filter((item) => nsfwPreference !== 'sfw' || !isPostNsfw(item.post))
  const cols = useColumnCount(viewMode, 150)
  mediaItemsRef.current = mediaItems
  keyboardFocusIndexRef.current = keyboardFocusIndex

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
    setKeyboardFocusIndex((i) => (mediaItems.length ? Math.min(i, mediaItems.length - 1) : 0))
  }, [mediaItems.length])

  useEffect(() => {
    if (!scrollIntoViewFromKeyboardRef.current) return
    scrollIntoViewFromKeyboardRef.current = false
    if (keyboardFocusIndex === lastScrollIntoViewIndexRef.current) return
    lastScrollIntoViewIndexRef.current = keyboardFocusIndex
    const index = keyboardFocusIndex
    const raf = requestAnimationFrame(() => {
      const el = cardRefsRef.current[index]
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    })
    return () => cancelAnimationFrame(raf)
  }, [keyboardFocusIndex])

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
      const key = e.key.toLowerCase()
      const focusInNotificationsMenu = (document.activeElement as HTMLElement)?.closest?.('[data-notifications-list]')
      const notificationsMenuOpen = document.querySelector('[data-notifications-list]') != null
      if ((focusInNotificationsMenu || notificationsMenuOpen) && (key === 'w' || key === 's' || key === 'e' || key === 'o' || key === 'enter' || key === 'q' || key === 'u' || key === 'backspace' || key === 'escape' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        return
      }
      if (key === 'w' || key === 's' || key === 'a' || key === 'd' || key === 'i' || key === 'j' || key === 'k' || key === 'l' || key === 'e' || key === 'o' || key === 'enter' || key === 'f' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.preventDefault()

      if (key === 'w' || key === 'i' || e.key === 'ArrowUp') {
        beginKeyboardNavigation()
        scrollIntoViewFromKeyboardRef.current = true
        setKeyboardFocusIndex((idx) => Math.max(0, idx - cols))
        return
      }
      if (key === 's' || key === 'k' || e.key === 'ArrowDown') {
        beginKeyboardNavigation()
        scrollIntoViewFromKeyboardRef.current = true
        setKeyboardFocusIndex((idx) => Math.min(items.length - 1, idx + cols))
        return
      }
      if (key === 'a' || key === 'j' || e.key === 'ArrowLeft') {
        beginKeyboardNavigation()
        scrollIntoViewFromKeyboardRef.current = true
        setKeyboardFocusIndex((idx) => Math.max(0, idx - 1))
        return
      }
      if (key === 'd' || key === 'l' || e.key === 'ArrowRight') {
        beginKeyboardNavigation()
        scrollIntoViewFromKeyboardRef.current = true
        setKeyboardFocusIndex((idx) => Math.min(items.length - 1, idx + 1))
        return
      }
      if (key === 'e' || key === 'o' || key === 'enter') {
        const item = items[i]
        if (item) {
          if (inModal) openPostModal(item.post.uri, undefined, undefined, item.post.author?.handle)
          else {
            const path = getPostAppPath(item.post.uri, item.post.author?.handle)
            navigate(path, { state: { backgroundLocation: getOverlayBackgroundLocation(location) } })
          }
        }
        return
      }
      if (key === 'f' && session) {
        const item = items[i]
        if (!item?.post?.author) return
        const author = item.post.author as { did: string; viewer?: { following?: string } }
        if (session.did === author.did) return
        const followingUri = author.viewer?.following
        if (followingUri) {
          unfollowAccountWithLifecycle(followingUri).then(() => {
            setItems((prev) =>
              prev.map((it) => {
                if (it.post.uri !== item.post.uri) return it
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
          followAccountWithLifecycle(author.did).then((res) => {
            setItems((prev) =>
              prev.map((it) => {
                if (it.post.uri !== item.post.uri) return it
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
      if (e.code === 'Space' && inModal) {
        const item = items[i]
        if (!item?.post?.uri || !item?.post?.cid) return
        const uri = item.post.uri
        const currentLikeUri = uri in likeOverrides ? (likeOverrides[uri] ?? undefined) : (item.post as { viewer?: { like?: string } }).viewer?.like
        if (currentLikeUri) {
          unlikePostWithLifecycle(currentLikeUri, uri).then(() => {
            setLikeOverride(uri, null)
          }).catch(() => {})
        } else {
          likePostWithLifecycle(uri, item.post.cid).then((res) => {
            setLikeOverride(uri, res.uri)
          }).catch(() => {})
        }
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [beginKeyboardNavigation, mediaItems.length, cols, navigate, location, isModalOpen, inModal, openPostModal, likeOverrides, session, setLikeOverride, setItems])

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
                actionsMenuOpenForIndex={null}
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
                cardRef={(index) => (el) => {
                  cardRefsRef.current[index] = el
                }}
                onActionsMenuOpenChange={() => {}}
                onMouseEnter={(originalIndex) =>
                  tryHoverSelectCard(
                    originalIndex,
                    () => keyboardFocusIndexRef.current,
                    (idx) => setKeyboardFocusIndex(idx)
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

