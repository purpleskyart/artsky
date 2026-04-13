import { useCallback, useEffect, useRef, useState } from 'react'
import { getQuotes } from '../lib/bsky'
import type { TimelineItem } from '../lib/bsky'
import ProfileColumn from './ProfileColumn'
import AppModal from './AppModal'
import { useProfileModal } from '../context/ProfileModalContext'
import { useLikeOverrides } from '../context/LikeOverridesContext'
import { useModeration } from '../context/ModerationContext'
import { useModalScroll } from '../context/ModalScrollContext'
import { usePostCardGridPointerGate } from '../hooks/usePostCardGridPointerGate'
import styles from './QuotesModal.module.css'
import profileGridStyles from '../pages/ProfilePage.module.css'

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
  const { likeOverrides, setLikeOverride } = useLikeOverrides()
  const [keyboardFocusIndex, setKeyboardFocusIndex] = useState(0)
  const cardRefsRef = useRef<(HTMLDivElement | null)[]>([])
  const keyboardFocusIndexRef = useRef(0)
  const itemsRef = useRef<TimelineItem[]>([])
  const scrollIntoViewFromKeyboardRef = useRef(false)
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null)
  const modalScrollRef = useModalScroll()
  const { beginKeyboardNavigation, tryHoverSelectCard, gridPointerGateProps } = usePostCardGridPointerGate()

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

  itemsRef.current = items
  keyboardFocusIndexRef.current = keyboardFocusIndex

  useEffect(() => {
    setKeyboardFocusIndex((i) => (items.length ? Math.min(i, items.length - 1) : 0))
  }, [items.length])

  useEffect(() => {
    if (!scrollIntoViewFromKeyboardRef.current) return
    scrollIntoViewFromKeyboardRef.current = false
    const index = keyboardFocusIndex
    const raf = requestAnimationFrame(() => {
      const el = cardRefsRef.current[index]
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    })
    return () => cancelAnimationFrame(raf)
  }, [keyboardFocusIndex])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) {
        if (e.key === 'Escape') {
          e.preventDefault()
          target.blur()
        }
        return
      }
      if (e.ctrlKey || e.metaKey) return
      if (items.length === 0) return

      const i = keyboardFocusIndexRef.current
      const key = e.key.toLowerCase()
      if (key === 'w' || key === 's' || key === 'e' || key === 'enter' || e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault()

      if (key === 'w' || e.key === 'ArrowUp') {
        beginKeyboardNavigation()
        scrollIntoViewFromKeyboardRef.current = true
        setKeyboardFocusIndex((idx) => Math.max(0, idx - 1))
        return
      }
      if (key === 's' || e.key === 'ArrowDown') {
        beginKeyboardNavigation()
        scrollIntoViewFromKeyboardRef.current = true
        setKeyboardFocusIndex((idx) => Math.min(items.length - 1, idx + 1))
        return
      }
      if (key === 'e' || key === 'enter') {
        const item = itemsRef.current[i]
        if (item) openPostModal(item.post.uri, undefined, undefined, item.post.author?.handle)
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [beginKeyboardNavigation, items.length, openPostModal])

  useEffect(() => {
    if (!cursor || loadingMore) return
    const el = loadMoreSentinelRef.current
    if (!el) return
    const root = el.closest('[data-modal-scroll]') ?? undefined
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) load(cursor)
      },
      { root, rootMargin: '200px', threshold: 0 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [cursor, loadingMore, load])

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
      <div className={styles.wrap}>
        {error && <p className={styles.error}>{error}</p>}
        {loading ? (
          <div className={styles.loading}>Loading…</div>
        ) : items.length === 0 ? (
          <div className={styles.empty}>No one has quoted this post yet.</div>
        ) : (
          <>
            <div
              className={`${profileGridStyles.gridColumns} ${profileGridStyles.gridView1}`}
              {...gridPointerGateProps}
            >
              <ProfileColumn
                column={items.map((item, i) => ({ item, originalIndex: i }))}
                colIndex={0}
                scrollRef={modalScrollRef}
                loadMoreSentinelRef={cursor ? (el) => { (loadMoreSentinelRef as unknown as { current: HTMLDivElement | null }).current = el } : undefined}
                hasCursor={!!cursor}
                keyboardFocusIndex={keyboardFocusIndex}
                actionsMenuOpenForIndex={null}
                nsfwPreference={nsfwPreference}
                unblurredUris={unblurredUris}
                setUnblurred={setUnblurred}
                likeOverrides={likeOverrides}
                setLikeOverrides={setLikeOverride}
                openPostModal={openPostModal}
                cardRef={(index) => (el) => { cardRefsRef.current[index] = el }}
                onActionsMenuOpenChange={() => {}}
                onMouseEnter={(originalIndex) =>
                  tryHoverSelectCard(
                    originalIndex,
                    () => keyboardFocusIndexRef.current,
                    (idx) => setKeyboardFocusIndex(idx),
                    { disabled: false }
                  )
                }
                isSelected={(index) => index === keyboardFocusIndex}
              />
            </div>
            {loadingMore && <div className={styles.loadingMore}>Loading more…</div>}
          </>
        )}
      </div>
    </AppModal>
  )
}
