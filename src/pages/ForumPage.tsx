import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getSession, publicAgent } from '../lib/bsky'
import { listForumPostsFromFollowedAndDiscovery, listForumPosts, createForumPost, saveDraft } from '../lib/forum'
import { formatRelativeTime, formatExactDateTime } from '../lib/date'
import { useListKeyboardNav } from '../hooks/useListKeyboardNav'
import Layout from '../components/Layout'
import ProfileLink from '../components/ProfileLink'
import { useProfileModal } from '../context/ProfileModalContext'
import { useSession } from '../context/SessionContext'
import { CollabContent } from './CollabPage'
import { ReplyAsRow } from './PostDetailPage'
import type { ForumPost } from '../types'
import styles from './ForumPage.module.css'
import postBlockStyles from './PostDetailPage.module.css'

type ForumSection = 'discover' | 'artsky' | 'collab'

function matchesSearchForumPost(post: ForumPost, q: string): boolean {
  if (!q.trim()) return true
  const lower = q.toLowerCase().trim()
  const title = (post.title ?? '').toLowerCase()
  const body = (post.body ?? '').toLowerCase()
  const handle = (post.authorHandle ?? '').toLowerCase()
  const tags = (post.tags ?? []).join(' ').toLowerCase()
  return title.includes(lower) || body.includes(lower) || handle.includes(lower) || tags.includes(lower)
}

const BODY_PREVIEW_LENGTH = 140

function bodyPreview(body: string | undefined): string {
  if (!body?.trim()) return ''
  const oneLine = body.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= BODY_PREVIEW_LENGTH) return oneLine
  return oneLine.slice(0, BODY_PREVIEW_LENGTH).trim() + '…'
}

type ForumTab = 'all' | 'followed' | 'mine'

export function ForumContent({ inModal = false, onRegisterRefresh }: { inModal?: boolean; onRegisterRefresh?: (fn: () => void | Promise<void>) => void }) {
  const [section, setSection] = useState<ForumSection>('discover')
  const [tab, setTab] = useState<ForumTab>('all')
  const [discoverPosts, setDiscoverPosts] = useState<ForumPost[]>([])
  const [artskyPosts, setArtskyPosts] = useState<ForumPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [showArtskyCompose, setShowArtskyCompose] = useState(false)
  const [artskyCompose, setArtskyCompose] = useState({ title: '', body: '', tags: '' })
  const session = getSession()
  const { sessionsList, switchAccount } = useSession()
  const { isModalOpen, openForumPostModal } = useProfileModal()
  const [replyAs, setReplyAs] = useState<{ handle: string; avatar?: string }>({ handle: '' })
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!session?.did) {
      setReplyAs({ handle: '' })
      return
    }
    let cancelled = false
    publicAgent.getProfile({ actor: session.did }).then((res) => {
      if (cancelled) return
      const data = res.data as { handle?: string; avatar?: string }
      setReplyAs({ handle: data.handle ?? session.did, avatar: data.avatar })
    }).catch(() => {
      if (!cancelled) setReplyAs({ handle: (session as { handle?: string }).handle ?? session.did })
    })
    return () => { cancelled = true }
  }, [session?.did])

  const loadDiscover = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const list = await listForumPostsFromFollowedAndDiscovery()
      setDiscoverPosts(list)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load forum')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadArtsky = useCallback(async () => {
    if (!session?.did) {
      setArtskyPosts([])
      return
    }
    try {
      setLoading(true)
      const result = await listForumPosts(session.did, { limit: 50 })
      setArtskyPosts(result.posts)
    } catch {
      setArtskyPosts([])
    } finally {
      setLoading(false)
    }
  }, [session?.did])

  useEffect(() => {
    if (section === 'discover') {
      setDiscoverPosts([])
      loadDiscover()
    } else if (section === 'artsky') {
      loadArtsky()
    }
  }, [section, loadDiscover, loadArtsky, tab])

  useEffect(() => {
    onRegisterRefresh?.(() => {
      if (section === 'discover') loadDiscover()
      else if (section === 'artsky') loadArtsky()
    })
  }, [onRegisterRefresh, section, loadDiscover, loadArtsky])

  const tabFilteredDiscoverPosts = useMemo(() => {
    if (tab === 'all') return discoverPosts
    if (tab === 'followed' && session?.did) return discoverPosts.filter((p) => p.did !== session.did)
    if (tab === 'mine' && session?.did) return discoverPosts.filter((p) => p.did === session.did)
    return []
  }, [discoverPosts, tab, session?.did])

  const filteredDiscoverPosts = useMemo(
    () => tabFilteredDiscoverPosts.filter((post) => matchesSearchForumPost(post, searchQuery)),
    [tabFilteredDiscoverPosts, searchQuery]
  )

  useEffect(() => {
    setFocusedIndex((i) => (filteredDiscoverPosts.length ? Math.min(i, filteredDiscoverPosts.length - 1) : 0))
  }, [filteredDiscoverPosts.length])

  useEffect(() => {
    if (!listRef.current || focusedIndex < 0) return
    const li = listRef.current.querySelector(`[data-forum-index="${focusedIndex}"]`)
    if (li) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusedIndex])

  const artskyFiltered = artskyPosts.filter((p) => !searchQuery.trim() || (p.title ?? '').toLowerCase().includes(searchQuery.toLowerCase()) || (p.body ?? '').toLowerCase().includes(searchQuery.toLowerCase()))
  const artskyFocusedIndex = Math.min(focusedIndex, Math.max(0, artskyFiltered.length - 1))

  useListKeyboardNav({
    enabled:
      section === 'discover' &&
      filteredDiscoverPosts.length > 0 &&
      (inModal || !isModalOpen),
    itemCount: section === 'discover' ? filteredDiscoverPosts.length : section === 'artsky' ? artskyFiltered.length : 0,
    focusedIndex: section === 'discover' ? focusedIndex : artskyFocusedIndex,
    setFocusedIndex,
    onActivate: (index) => {
      if (section === 'discover') {
        const post = filteredDiscoverPosts[index]
        if (post) openForumPostModal(post.uri)
      } else if (section === 'artsky') {
        const post = artskyFiltered[index]
        if (post) openForumPostModal(post.uri)
      }
    },
    useCapture: true,
  })

  const showSignInForTab = (tab === 'followed' || tab === 'mine') && !session

  async function handleArtskyCreatePost() {
    if (!artskyCompose.title.trim()) return
    try {
      await createForumPost({
        title: artskyCompose.title,
        body: artskyCompose.body,
        tags: artskyCompose.tags.split(',').map((t) => t.trim()).filter(Boolean),
      })
      setArtskyCompose({ title: '', body: '', tags: '' })
      setShowArtskyCompose(false)
      loadArtsky()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create post')
    }
  }

  function handleArtskySaveDraft() {
    saveDraft({
      title: artskyCompose.title,
      body: artskyCompose.body,
      tags: artskyCompose.tags.split(',').map((t) => t.trim()).filter(Boolean),
    })
    setShowArtskyCompose(false)
  }

  function openNewThread() {
    if (section !== 'artsky') setSection('artsky')
    setShowArtskyCompose(true)
  }

  const wrap = (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>Forums</h2>
          {session?.did && (
            <button
              type="button"
              className={styles.newThreadBtn}
              onClick={openNewThread}
              aria-label="Create a new forum thread"
            >
              New Thread
            </button>
          )}
        </div>
        <div className={styles.tabs} style={{ marginTop: '0.5rem' }}>
          <button
            type="button"
            className={section === 'discover' ? styles.tabActive : styles.tab}
            onClick={() => setSection('discover')}
            aria-pressed={section === 'discover'}
          >
            Discover
          </button>
          <button
            type="button"
            className={section === 'artsky' ? styles.tabActive : styles.tab}
            onClick={() => setSection('artsky')}
            aria-pressed={section === 'artsky'}
          >
            ArtSky
          </button>
          <button
            type="button"
            className={section === 'collab' ? styles.tabActive : styles.tab}
            onClick={() => setSection('collab')}
            aria-pressed={section === 'collab'}
          >
            Collab
          </button>
        </div>

        {section === 'discover' && (
          <>
            <p className={styles.subtitle} style={{ marginTop: '0.5rem' }}>
              Forum posts from people you follow (AT Protocol forum lexicon).
            </p>
            <div className={styles.tabs}>
              <button type="button" className={tab === 'all' ? styles.tabActive : styles.tab} onClick={() => setTab('all')} aria-pressed={tab === 'all'}>All Posts</button>
              <button type="button" className={tab === 'followed' ? styles.tabActive : styles.tab} onClick={() => setTab('followed')} aria-pressed={tab === 'followed'}>Followed</button>
              <button type="button" className={tab === 'mine' ? styles.tabActive : styles.tab} onClick={() => setTab('mine')} aria-pressed={tab === 'mine'}>My Posts</button>
            </div>
          </>
        )}

        {(section === 'discover' || section === 'artsky') && (
          <div className={styles.searchRow}>
            <input
              type="search"
              className={styles.searchInput}
              placeholder="Search posts…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search posts"
            />
          </div>
        )}
      </header>

      {section === 'collab' && <CollabContent />}

      {section === 'discover' && (
        <>
          {error && <p className={styles.error}>{error}</p>}
          {showSignInForTab ? (
            <div className={styles.empty}>Log in to see {tab === 'followed' ? 'posts from people you follow' : 'your posts'}.</div>
          ) : loading ? (
            <div className={styles.loading}>{tab === 'all' ? 'Loading forum posts…' : tab === 'followed' ? 'Loading followed posts…' : 'Loading your posts…'}</div>
          ) : filteredDiscoverPosts.length === 0 ? (
            <div className={styles.empty}>
              {searchQuery.trim()
                ? 'No posts match your search.'
                : tabFilteredDiscoverPosts.length === 0
                  ? tab === 'all'
                    ? 'No forum posts yet from you or people you follow.'
                    : tab === 'followed'
                      ? 'No posts yet from people you follow.'
                      : "You haven't posted in the forums yet."
                  : 'No posts match your search.'}
            </div>
          ) : (
            <ul ref={listRef} className={styles.list}>
              {filteredDiscoverPosts.map((post, index) => {
                const handle = post.authorHandle ?? post.did
                const isFocused = index === focusedIndex
                return (
                  <li key={post.uri} data-forum-index={index}>
                    <Link to="#" className={isFocused ? `${styles.postLink} ${styles.postLinkFocused}` : styles.postLink} onClick={(e) => { e.preventDefault(); openForumPostModal(post.uri) }}>
                      <article className={postBlockStyles.postBlock}>
                        <div className={postBlockStyles.postBlockContent}>
                          <div className={postBlockStyles.postHead}>
                            {post.authorAvatar ? (
                              <img src={post.authorAvatar} alt="" className={postBlockStyles.avatar} loading="lazy" />
                            ) : (
                              <span className={styles.avatarPlaceholder} aria-hidden>{(handle || post.did).slice(0, 1).toUpperCase()}</span>
                            )}
                            <div className={postBlockStyles.authorRow}>
                              <ProfileLink handle={handle} className={postBlockStyles.handleLink} onClick={(e) => e.stopPropagation()}>@{handle}</ProfileLink>
                              {post.createdAt && <span className={postBlockStyles.postTimestamp} title={formatExactDateTime(post.createdAt)}>{formatRelativeTime(post.createdAt)}</span>}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                            {post.isPinned && <span className={styles.commentBadge}>Pinned</span>}
                            {post.isWiki && <span className={styles.commentBadge}>Wiki</span>}
                            <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>{post.title || 'Untitled'}</h3>
                          </div>
                          {bodyPreview(post.body) && <p className={styles.bodyPreview}>{bodyPreview(post.body)}</p>}
                          {post.tags?.length ? (
                            <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                              {post.tags.map((tag) => (
                                <span key={tag} className={styles.commentBadge} style={{ fontSize: '0.7rem' }}>#{tag}</span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </article>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      {section === 'artsky' && (
        <>
          {session?.did && (
            <button type="button" className={styles.tab} style={{ marginBottom: '0.75rem' }} onClick={() => setShowArtskyCompose(!showArtskyCompose)}>
              + New Post
            </button>
          )}
          {showArtskyCompose && session?.did && (
            <div className={`${postBlockStyles.inlineReplyFormWrap} ${styles.newThreadFormWrap}`}>
              <div>
                <form
                  className={postBlockStyles.inlineReplyForm}
                  onSubmit={(e) => { e.preventDefault(); handleArtskyCreatePost() }}
                >
                  {replyAs.handle && (
                    <div className={postBlockStyles.inlineReplyFormHeader}>
                      {sessionsList?.length && session.did ? (
                        <ReplyAsRow
                          replyAs={replyAs}
                          sessionsList={sessionsList}
                          switchAccount={switchAccount}
                          currentDid={session.did}
                          label="Posting as"
                        />
                      ) : (
                        <p className={postBlockStyles.replyAs}>
                          <span className={postBlockStyles.replyAsLabel}>Posting as</span>
                          <span className={postBlockStyles.replyAsUserChip}>
                            {replyAs.avatar ? (
                              <img src={replyAs.avatar} alt="" className={postBlockStyles.replyAsAvatar} loading="lazy" />
                            ) : (
                              <span className={postBlockStyles.replyAsAvatarPlaceholder} aria-hidden>{replyAs.handle.slice(0, 1).toUpperCase()}</span>
                            )}
                            <span className={postBlockStyles.replyAsHandle}>@{replyAs.handle}</span>
                          </span>
                        </p>
                      )}
                    </div>
                  )}
                  <label className={postBlockStyles.inlineReplyFormLabel} htmlFor="forum-new-thread-title">Title</label>
                  <input
                    id="forum-new-thread-title"
                    type="text"
                    placeholder="Post title"
                    value={artskyCompose.title}
                    onChange={(e) => setArtskyCompose((c) => ({ ...c, title: e.target.value }))}
                    className={styles.newThreadInput}
                  />
                  <label className={postBlockStyles.inlineReplyFormLabel} htmlFor="forum-new-thread-body">Body</label>
                  <textarea
                    id="forum-new-thread-body"
                    placeholder="Write your post… Use @username for mentions"
                    value={artskyCompose.body}
                    onChange={(e) => setArtskyCompose((c) => ({ ...c, body: e.target.value }))}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === 'E') && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault()
                        if (artskyCompose.title.trim()) handleArtskyCreatePost()
                      }
                    }}
                    className={postBlockStyles.textarea}
                    rows={4}
                  />
                  <label className={postBlockStyles.inlineReplyFormLabel} htmlFor="forum-new-thread-tags">Tags (comma-separated)</label>
                  <input
                    id="forum-new-thread-tags"
                    type="text"
                    placeholder="e.g. help, feature"
                    value={artskyCompose.tags}
                    onChange={(e) => setArtskyCompose((c) => ({ ...c, tags: e.target.value }))}
                    className={styles.newThreadInput}
                  />
                  <p className={postBlockStyles.hint}>⌘ Enter to post</p>
                  <div className={styles.newThreadActions}>
                    <button type="submit" className={postBlockStyles.submit} disabled={!artskyCompose.title.trim()}>
                      Post
                    </button>
                    <button type="button" className={styles.tab} onClick={handleArtskySaveDraft}>Save Draft</button>
                    <button type="button" className={styles.tab} onClick={() => setShowArtskyCompose(false)}>Cancel</button>
                  </div>
                </form>
              </div>
            </div>
          )}
          {!session ? (
            <div className={styles.empty}>Log in to create and view ArtSky forum posts.</div>
          ) : loading ? (
            <div className={styles.loading}>Loading posts…</div>
          ) : artskyFiltered.length === 0 ? (
            <div className={styles.empty}>No forum posts yet. Be the first to start a discussion!</div>
          ) : (
            <ul ref={listRef} className={styles.list}>
              {artskyFiltered.map((post, index) => {
                const isFocused = index === artskyFocusedIndex
                return (
                  <li key={`${post.uri}-${index}`} data-forum-index={index}>
                    <Link
                      to="#"
                      className={isFocused ? `${styles.postLink} ${styles.postLinkFocused}` : styles.postLink}
                      onClick={(e) => { e.preventDefault(); openForumPostModal(post.uri) }}
                    >
                      <article className={postBlockStyles.postBlock}>
                        <div className={postBlockStyles.postBlockContent}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                            {post.isPinned && <span className={styles.commentBadge}>Pinned</span>}
                            {post.isWiki && <span className={styles.commentBadge}>Wiki</span>}
                            <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>{post.title || 'Untitled'}</h3>
                          </div>
                          {post.body && <p className={styles.bodyPreview}>{post.body.slice(0, 120)}{post.body.length > 120 ? '…' : ''}</p>}
                          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem', fontSize: '0.85rem', color: 'var(--muted)' }}>
                            {post.authorHandle && <span>@{post.authorHandle}</span>}
                            {post.createdAt && <span>{new Date(post.createdAt).toLocaleDateString()}</span>}
                            {post.tags?.map((tag) => (
                              <span key={tag} className={styles.commentBadge} style={{ fontSize: '0.7rem' }}>#{tag}</span>
                            ))}
                          </div>
                        </div>
                      </article>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
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
