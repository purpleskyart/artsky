import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppBskyFeedPost, type AppBskyFeedDefs } from '@atproto/api'
import { searchPostsByTag, isPostNsfw, type TimelineItem } from '../lib/bsky'
import { useListKeyboardNav } from '../hooks/useListKeyboardNav'
import Layout from '../components/Layout'
import { useProfileModal } from '../context/ProfileModalContext'
import { useModeration } from '../context/ModerationContext'
import { useModalScroll } from '../context/ModalScrollContext'
import OptimizedPostCard from '../components/OptimizedPostCard'
import { setInitialPostForUri } from '../lib/postCache'
import styles from './ForumPage.module.css'
import feedStyles from './FeedPage.module.css'

/** Hashtag for Bluesky-native forum threads (visible in the official app). */
const FORUM_DISCOVER_TAG = 'artsky'

function toTimelineItem(post: AppBskyFeedDefs.PostView): TimelineItem {
  return { post }
}

function matchesSearchPost(post: AppBskyFeedDefs.PostView, q: string): boolean {
  if (!q.trim()) return true
  const lower = q.toLowerCase().trim()
  const text = AppBskyFeedPost.isRecord(post.record)
    ? String(post.record.text ?? '').toLowerCase()
    : ''
  const handle = String(post.author.handle ?? '').toLowerCase()
  const dn = String(post.author.displayName ?? '').toLowerCase()
  return text.includes(lower) || handle.includes(lower) || dn.includes(lower)
}

export function ForumContent({ inModal = false, onRegisterRefresh }: { inModal?: boolean; onRegisterRefresh?: (fn: () => void | Promise<void>) => void }) {
  const [items, setItems] = useState<TimelineItem[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [likeOverrides, setLikeOverrides] = useState<Record<string, string | null>>({})
  const [actionsMenuOpenForIndex, setActionsMenuOpenForIndex] = useState<number | null>(null)
  const [keyboardAddOpen, setKeyboardAddOpen] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null)
  const loadingMoreRef = useRef(false)
  const modalScrollRef = useModalScroll()

  const { isModalOpen, openPostModal } = useProfileModal()
  const { nsfwPreference, unblurredUris, setUnblurred } = useModeration()

  const load = useCallback(async (nextCursor?: string) => {
    try {
      if (nextCursor) setLoadingMore(true)
      else setLoading(true)
      setError(null)
      const { posts, cursor: next } = await searchPostsByTag(FORUM_DISCOVER_TAG, nextCursor, 30)
      const timelineItems = posts.map(toTimelineItem)
      setItems((prev) => (nextCursor ? [...prev, ...timelineItems] : timelineItems))
      setCursor(next)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load posts')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    setItems([])
    setCursor(undefined)
    load()
  }, [load])

  useEffect(() => {
    onRegisterRefresh?.(() => load())
  }, [onRegisterRefresh, load])

  const filteredItems = useMemo(
    () => items.filter((it) => matchesSearchPost(it.post, searchQuery)),
    [items, searchQuery]
  )

  useEffect(() => {
    setFocusedIndex((i) => (filteredItems.length ? Math.min(i, filteredItems.length - 1) : 0))
  }, [filteredItems.length])

  useEffect(() => {
    if (!listRef.current || focusedIndex < 0) return
    const li = listRef.current.querySelector(`[data-forum-index="${focusedIndex}"]`)
    if (li) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusedIndex])

  loadingMoreRef.current = loadingMore
  useEffect(() => {
    if (!cursor) return
    const el = loadMoreSentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || loadingMoreRef.current) return
        void load(cursor)
      },
      { root: inModal ? modalScrollRef?.current ?? null : null, rootMargin: '400px', threshold: 0 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [cursor, load, inModal, modalScrollRef])

  useListKeyboardNav({
    enabled: filteredItems.length > 0 && (inModal || !isModalOpen),
    itemCount: filteredItems.length,
    focusedIndex,
    setFocusedIndex,
    onActivate: (index) => {
      const it = filteredItems[index]
      if (it) {
        setInitialPostForUri(it.post.uri, it)
        openPostModal(it.post.uri)
      }
    },
    useCapture: true,
  })

  const wrap = (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>Forums</h2>
        </div>
        <p className={styles.subtitle} style={{ marginTop: '0.5rem' }}>
          Posts tagged #artsky on Bluesky. Open a post to see replies—the same thread as in the Bluesky app.
        </p>
        <div className={styles.searchRow}>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search this list…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search posts"
          />
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}
      {loading ? (
        <div className={styles.loading}>Loading #{FORUM_DISCOVER_TAG}…</div>
      ) : filteredItems.length === 0 ? (
        <div className={styles.empty}>
          {searchQuery.trim()
            ? 'No posts match your search.'
            : `No posts with #${FORUM_DISCOVER_TAG} yet. Publish a Bluesky post with that tag to show it here.`}
        </div>
      ) : (
        <>
          <ul ref={listRef} className={styles.list}>
            {filteredItems.map((item, index) => {
              const uri = item.post.uri
              const isFocused = index === focusedIndex
              const nsfwBlurred =
                nsfwPreference === 'blurred' && isPostNsfw(item.post) && !unblurredUris.has(uri)
              return (
                <li key={uri} data-forum-index={index} className={feedStyles.gridItem} data-selected={isFocused || undefined}>
                  <div onMouseEnter={() => setFocusedIndex(index)}>
                    <OptimizedPostCard
                      item={item}
                      isSelected={isFocused}
                      focusedMediaIndex={undefined}
                      onMediaRef={() => {}}
                      cardRef={() => {}}
                      openAddDropdown={keyboardAddOpen && focusedIndex === index}
                      onAddClose={() => setKeyboardAddOpen(false)}
                      onActionsMenuOpenChange={(open) => setActionsMenuOpenForIndex(open ? index : null)}
                      cardIndex={index}
                      actionsMenuOpenForIndex={actionsMenuOpenForIndex}
                      onPostClick={(u, opts) => {
                        if (opts?.initialItem) setInitialPostForUri(u, opts.initialItem)
                        openPostModal(u, opts?.openReply)
                      }}
                      fillCell={false}
                      nsfwBlurred={nsfwBlurred}
                      onNsfwUnblur={() => setUnblurred(uri, true)}
                      setUnblurred={setUnblurred}
                      isRevealed={unblurredUris.has(uri)}
                      likedUriOverride={likeOverrides[uri]}
                      onLikedChange={(postUri, likeRecordUri) => setLikeOverrides((prev) => ({ ...prev, [postUri]: likeRecordUri ?? null }))}
                      seen={false}
                      constrainMediaHeight={false}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
          {cursor ? (
            <div ref={loadMoreSentinelRef} className={styles.loadMoreSentinel} aria-hidden />
          ) : null}
          {loadingMore && <div className={styles.loading}>Loading more…</div>}
        </>
      )}
    </div>
  )

  return wrap
}

export default function ForumPage() {
  return (
    <Layout title="Forums" showNav>
      <ForumContent />
    </Layout>
  )
}
