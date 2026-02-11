import { useCallback, useEffect, useRef, useState } from 'react'
import { getQuotes, isPostNsfw } from '../lib/bsky'
import type { TimelineItem } from '../lib/bsky'
import PostCard from './PostCard'
import AppModal from './AppModal'
import { useProfileModal } from '../context/ProfileModalContext'
import { useModeration } from '../context/ModerationContext'
import styles from './QuotesModal.module.css'

interface QuotesModalProps {
  postUri: string
  onClose: () => void
  onBack: () => void
  canGoBack: boolean
}

export default function QuotesModal({ postUri, onClose, onBack, canGoBack }: QuotesModalProps) {
  const { openPostModal } = useProfileModal()
  const { nsfwPreference, unblurredUris, setUnblurred } = useModeration()
  const [items, setItems] = useState<TimelineItem[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshFn, setRefreshFn] = useState<(() => void | Promise<void>) | null>(null)
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null)

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
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) load(cursor)
      },
      { rootMargin: '200px', threshold: 0 }
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
      onPullToRefresh={refreshFn ? () => refreshFn() : undefined}
    >
      <div className={styles.wrap}>
        {error && <p className={styles.error}>{error}</p>}
        {loading ? (
          <div className={styles.loading}>Loading…</div>
        ) : items.length === 0 ? (
          <div className={styles.empty}>No one has quoted this post yet.</div>
        ) : (
          <div className={styles.list}>
            {items.map((item) => (
              <div key={item.post.uri} className={styles.cardWrap}>
                <PostCard
                  item={item}
                  onPostClick={(uri) => openPostModal(uri)}
                  nsfwBlurred={
                    nsfwPreference === 'blurred' &&
                    isPostNsfw(item.post) &&
                    !unblurredUris.has(item.post.uri)
                  }
                  onNsfwUnblur={() => setUnblurred(item.post.uri, true)}
                />
              </div>
            ))}
            {cursor && (
              <div ref={loadMoreSentinelRef} className={styles.loadMoreSentinel} aria-hidden>
                {loadingMore && <span className={styles.loadingMore}>Loading more…</span>}
              </div>
            )}
          </div>
        )}
      </div>
    </AppModal>
  )
}
