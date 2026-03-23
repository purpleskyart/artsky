import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { discoverForumPosts, createForumPost } from '../lib/forum'
import { useListKeyboardNav } from '../hooks/useListKeyboardNav'
import Layout from '../components/Layout'
import { useProfileModal } from '../context/ProfileModalContext'
import { useModalScroll } from '../context/ModalScrollContext'
import { useSession } from '../context/SessionContext'
import ProfileLink from '../components/ProfileLink'
import { formatRelativeTime } from '../lib/date'
import type { ForumPost } from '../types'
import styles from './ForumPage.module.css'

function matchesSearchPost(post: ForumPost, q: string): boolean {
  if (!q.trim()) return true
  const lower = q.toLowerCase().trim()
  const title = String(post.title ?? '').toLowerCase()
  const body = String(post.body ?? '').toLowerCase()
  const handle = String(post.authorHandle ?? post.did ?? '').toLowerCase()
  const tags = (post.tags ?? []).join(' ').toLowerCase()
  return title.includes(lower) || body.includes(lower) || handle.includes(lower) || tags.includes(lower)
}

function bodyPreview(body: string | undefined, max = 220): string {
  if (!body?.trim()) return ''
  const oneLine = body.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine
}

export function ForumContent({ inModal = false, onRegisterRefresh }: { inModal?: boolean; onRegisterRefresh?: (fn: () => void | Promise<void>) => void }) {
  const [posts, setPosts] = useState<ForumPost[]>([])
  const [cursorsByDid, setCursorsByDid] = useState<Record<string, string | undefined>>({})
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [showNewThread, setShowNewThread] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newBody, setNewBody] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null)
  const loadingMoreRef = useRef(false)
  const modalScrollRef = useModalScroll()

  const { isModalOpen, openForumPostModal } = useProfileModal()
  const { session } = useSession()

  const mergeByUri = useCallback((prev: ForumPost[], incoming: ForumPost[]): ForumPost[] => {
    const map = new Map<string, ForumPost>()
    for (const p of prev) map.set(p.uri, p)
    for (const p of incoming) {
      if (!map.has(p.uri)) map.set(p.uri, p)
    }
    return [...map.values()].sort((a, b) => {
      const ta = new Date(a.createdAt ?? 0).getTime()
      const tb = new Date(b.createdAt ?? 0).getTime()
      return tb - ta
    })
  }, [])

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const { posts: batch, nextCursorsByDid, hasMore: more } = await discoverForumPosts({ append: false })
      setCursorsByDid(nextCursorsByDid)
      setHasMore(more)
      setPosts(mergeByUri([], batch))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load forum threads')
    } finally {
      setLoading(false)
    }
  }, [mergeByUri])

  const loadMore = useCallback(async () => {
    try {
      setLoadingMore(true)
      setError(null)
      const { posts: batch, nextCursorsByDid, hasMore: more } = await discoverForumPosts({
        append: true,
        cursorsByDid,
      })
      setCursorsByDid(nextCursorsByDid)
      setHasMore(more)
      setPosts((prev) => mergeByUri(prev, batch))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load more threads')
    } finally {
      setLoadingMore(false)
    }
  }, [cursorsByDid, mergeByUri])

  useEffect(() => {
    setPosts([])
    setCursorsByDid({})
    setHasMore(false)
    void refresh()
  }, [session?.did, refresh])

  useEffect(() => {
    onRegisterRefresh?.(() => refresh())
  }, [onRegisterRefresh, refresh])

  const filteredPosts = useMemo(
    () => posts.filter((p) => matchesSearchPost(p, searchQuery)),
    [posts, searchQuery]
  )

  useEffect(() => {
    setFocusedIndex((i) => (filteredPosts.length ? Math.min(i, filteredPosts.length - 1) : 0))
  }, [filteredPosts.length])

  useEffect(() => {
    if (!listRef.current || focusedIndex < 0) return
    const li = listRef.current.querySelector(`[data-forum-index="${focusedIndex}"]`)
    if (li) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusedIndex])

  loadingMoreRef.current = loadingMore
  useEffect(() => {
    if (!hasMore) return
    const el = loadMoreSentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || loadingMoreRef.current) return
        void loadMore()
      },
      { root: inModal ? modalScrollRef?.current ?? null : null, rootMargin: '400px', threshold: 0 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, loadMore, inModal, modalScrollRef])

  useListKeyboardNav({
    enabled: filteredPosts.length > 0 && (inModal || !isModalOpen),
    itemCount: filteredPosts.length,
    focusedIndex,
    setFocusedIndex,
    onActivate: (index) => {
      const p = filteredPosts[index]
      if (p) openForumPostModal(p.uri)
    },
    useCapture: true,
  })

  async function handleCreateThread(e: React.FormEvent) {
    e.preventDefault()
    const title = newTitle.trim()
    const body = newBody.trim()
    if (!title || !body) {
      setCreateError('Add a title and body for your thread.')
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const { uri } = await createForumPost({ title, body })
      setNewTitle('')
      setNewBody('')
      setShowNewThread(false)
      await refresh()
      openForumPostModal(uri)
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Could not create thread')
    } finally {
      setCreating(false)
    }
  }

  const wrap = (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>Forums</h2>
          {session ? (
            <button
              type="button"
              className={styles.newThreadBtn}
              onClick={() => {
                setShowNewThread((v) => !v)
                setCreateError(null)
              }}
            >
              {showNewThread ? 'Cancel' : 'New thread'}
            </button>
          ) : null}
        </div>
        {session && showNewThread ? (
          <form className={styles.newThreadFormWrap} onSubmit={handleCreateThread} style={{ marginTop: '0.75rem' }}>
            <div>
              <input
                type="text"
                className={styles.newThreadInput}
                placeholder="Thread title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                aria-label="Thread title"
                autoComplete="off"
              />
            </div>
            <div style={{ marginTop: '0.5rem' }}>
              <textarea
                className={styles.newThreadInput}
                placeholder="What do you want to discuss?"
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                aria-label="Thread body"
                rows={4}
              />
            </div>
            {createError ? <p className={styles.error}>{createError}</p> : null}
            <div className={styles.newThreadActions} style={{ marginTop: '0.5rem' }}>
              <button type="submit" className={styles.newThreadBtn} disabled={creating}>
                {creating ? 'Publishing…' : 'Publish thread'}
              </button>
            </div>
          </form>
        ) : null}
        <div className={styles.searchRow}>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search threads…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search threads"
          />
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}
      {loading ? (
        <div className={styles.loading}>Loading forum threads…</div>
      ) : filteredPosts.length === 0 ? (
        <div className={styles.empty}>
          {searchQuery.trim()
            ? 'No threads match your search.'
            : session
              ? 'No forum threads yet from you or people you follow. Start one with New thread, or follow people who use PurpleSky forums.'
              : 'Sign in to see forum threads from your network. Public discovery DIDs can be added in config (forumLexicon).'}
        </div>
      ) : (
        <>
          <ul ref={listRef} className={styles.list}>
            {filteredPosts.map((post, index) => {
              const isFocused = index === focusedIndex
              const handle = post.authorHandle ?? post.did.slice(0, 12)
              const when = post.createdAt ? formatRelativeTime(post.createdAt) : ''
              const preview = bodyPreview(post.body)
              return (
                <li key={post.uri} data-forum-index={index}>
                  <button
                    type="button"
                    className={`${styles.postLink} ${isFocused ? styles.postLinkFocused : ''}`}
                    data-selected={isFocused || undefined}
                    onClick={() => openForumPostModal(post.uri)}
                    onMouseEnter={() => setFocusedIndex(index)}
                  >
                    <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'flex-start', textAlign: 'left', width: '100%' }}>
                      {post.authorAvatar ? (
                        <img
                          src={post.authorAvatar}
                          alt=""
                          width={36}
                          height={36}
                          style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                        />
                      ) : (
                        <span className={styles.avatarPlaceholder} aria-hidden>
                          {(handle[0] ?? '?').toUpperCase()}
                        </span>
                      )}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'baseline' }}>
                          <span style={{ fontWeight: 700, color: 'var(--text)' }}>{post.title || 'Untitled thread'}</span>
                          {post.isPinned ? <span className={styles.commentBadge}>Pinned</span> : null}
                          {post.isWiki ? <span className={styles.commentBadge}>Wiki</span> : null}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
                          <ProfileLink handle={handle} className={styles.standardLink}>
                            @{handle}
                          </ProfileLink>
                          {when ? <span> · {when}</span> : null}
                        </div>
                        {preview ? <p className={styles.bodyPreview}>{preview}</p> : null}
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
          {hasMore ? (
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
