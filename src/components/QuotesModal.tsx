import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getQuotes } from '../lib/bsky'
import type { TimelineItem } from '../lib/bsky'
import ProfileColumn from './ProfileColumn'
import AppModal from './AppModal'
import { useProfileModal } from '../context/ProfileModalContext'
import { useLikeOverridesActions } from '../context/LikeOverridesContext'
import { useModeration } from '../context/ModerationContext'
import { usePostCardGridPointerGate } from '../hooks/usePostCardGridPointerGate'
import { useModalGridKeyboardShell, useModalScrollKeyboardFocus } from '../hooks/useModalGridKeyboardShell'
import { shouldUnderlayHandleGridKeys } from '../lib/modalKeyboard'
import { useModalScroll } from '../context/ModalScrollContext'
import styles from './QuotesModal.module.css'
import gridStyles from '../styles/postGrid.module.css'
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
  const cardRefsRef = useRef<(HTMLDivElement | null)[]>([])
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null)
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
        const timelineItems = posts.map((post) => ({ post } as TimelineItem))
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

  useEffect(() => {
    if (!cursor || loadingMore) return
    const el = loadMoreSentinelRef.current
    if (!el) return
    const root = el.closest('[data-modal-scroll]') ?? undefined
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) load(cursor)
      },
      { root, rootMargin: '25%', threshold: 0 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [cursor, loadingMore, load])

  // Keyboard navigation for quotes grid
  useEffect(() => {
    keyboardFocusIndexRef.current = keyboardFocusIndex
  }, [keyboardFocusIndex])

  useEffect(() => {
    if (!keyboardShell.registerKeys) return

    const { useCapture, claimKey, shouldBlockEditable, blurEditableOnEscape } = keyboardShell

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (!shouldUnderlayHandleGridKeys(target, inModal)) return
      if (shouldBlockEditable(target)) {
        blurEditableOnEscape(e, target)
        return
      }
      if (e.ctrlKey || e.metaKey) return
      const key = e.key.toLowerCase()
      const i = keyboardFocusIndexRef.current
      const fromNone = i < 0

      if (key === 'w' || key === 'i' || e.key === 'ArrowUp') {
        if (fromNone) {
          if (items.length > 0) {
            e.preventDefault()
            beginKeyboardNavigation()
            setKeyboardFocusIndex(0)
          }
          claimKey(e)
          return
        }
        e.preventDefault()
        beginKeyboardNavigation()
        setKeyboardFocusIndex((idx) => Math.max(0, idx - 1))
        claimKey(e)
        return
      }
      if (key === 's' || key === 'k' || e.key === 'ArrowDown') {
        if (fromNone) {
          if (items.length > 0) {
            e.preventDefault()
            beginKeyboardNavigation()
            setKeyboardFocusIndex(0)
          }
          claimKey(e)
          return
        }
        e.preventDefault()
        beginKeyboardNavigation()
        setKeyboardFocusIndex((idx) => Math.min(items.length - 1, idx + 1))
        claimKey(e)
        return
      }
      if (key === 'a' || key === 'j' || e.key === 'ArrowLeft') {
        if (fromNone || items.length === 0) return
        e.preventDefault()
        beginKeyboardNavigation()
        setKeyboardFocusIndex((idx) => Math.max(0, idx - 1))
        claimKey(e)
        return
      }
      if (key === 'd' || key === 'l' || e.key === 'ArrowRight') {
        if (fromNone || items.length === 0) return
        e.preventDefault()
        beginKeyboardNavigation()
        setKeyboardFocusIndex((idx) => Math.min(items.length - 1, idx + 1))
        claimKey(e)
        return
      }
      if (key === 'e' || key === 'o' || key === 'enter') {
        if (fromNone || i >= items.length) return
        e.preventDefault()
        const item = items[i]
        if (item) openPostModal(item.post.uri)
        claimKey(e)
        return
      }
    }
    window.addEventListener('keydown', onKeyDown, useCapture)
    return () => window.removeEventListener('keydown', onKeyDown, useCapture)
  }, [beginKeyboardNavigation, items.length, openPostModal, keyboardShell, isTopModal])

  const postCardDisplayContext = usePostCardDisplayContext(true)

  const quoteColumn = useMemo(
    () => items.map((item, i) => ({ item, originalIndex: i })),
    [items],
  )

  const handleCardRef = useCallback((index: number) => (el: HTMLDivElement | null) => {
    cardRefsRef.current[index] = el
  }, [])

  const handleLoadMoreSentinelRef = useCallback((el: HTMLDivElement | null) => {
    (loadMoreSentinelRef as unknown as { current: HTMLDivElement | null }).current = el
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
    (index: number) => index === keyboardFocusIndex,
    [keyboardFocusIndex],
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
            <div className={`${gridStyles.gridColumns} ${gridStyles.gridView1}`}>
              <ProfileColumn
                column={quoteColumn}
                colIndex={0}
                scrollRef={modalScrollRef}
                loadMoreSentinelRef={cursor ? handleLoadMoreSentinelRef : undefined}
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
