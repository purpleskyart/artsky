import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { listStandardSiteDocumentsAll, listStandardSiteDocumentsForForum, getSession, type StandardSiteDocumentView } from '../lib/bsky'
import { listForumPosts, createForumPost, saveDraft } from '../lib/forum'
import { FORUM_DISCOVERY_URLS } from '../config/forumDiscovery'
import { formatRelativeTime, formatExactDateTime } from '../lib/date'
import { useListKeyboardNav } from '../hooks/useListKeyboardNav'
import Layout from '../components/Layout'
import ProfileLink from '../components/ProfileLink'
import { useProfileModal } from '../context/ProfileModalContext'
import { CollabContent } from './CollabPage'
import { ConsensusContent } from './ConsensusPage'
import type { ForumPost } from '../types'
import styles from './ForumPage.module.css'
import postBlockStyles from './PostDetailPage.module.css'

type ForumSection = 'discover' | 'artsky' | 'collab' | 'consensus'

function documentUrl(doc: StandardSiteDocumentView): string | null {
  if (!doc.baseUrl) return null
  const base = doc.baseUrl.replace(/\/$/, '')
  const path = (doc.path ?? '').replace(/^\//, '')
  return path ? `${base}/${path}` : base
}

function matchesSearch(doc: StandardSiteDocumentView, q: string): boolean {
  if (!q.trim()) return true
  const lower = q.toLowerCase().trim()
  const title = (doc.title ?? '').toLowerCase()
  const body = (doc.body ?? '').toLowerCase()
  const handle = (doc.authorHandle ?? '').toLowerCase()
  const path = (doc.path ?? '').toLowerCase()
  return title.includes(lower) || body.includes(lower) || handle.includes(lower) || path.includes(lower)
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
  const [documents, setDocuments] = useState<StandardSiteDocumentView[]>([])
  const [artskyPosts, setArtskyPosts] = useState<ForumPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [showArtskyCompose, setShowArtskyCompose] = useState(false)
  const [artskyCompose, setArtskyCompose] = useState({ title: '', body: '', tags: '' })
  const session = getSession()
  const { isModalOpen, openForumPostModal } = useProfileModal()
  const listRef = useRef<HTMLUListElement>(null)

  const loadDiscover = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      if (tab === 'all') {
        const list = await listStandardSiteDocumentsAll(FORUM_DISCOVERY_URLS)
        setDocuments(list)
      } else {
        const list = await listStandardSiteDocumentsForForum()
        if (tab === 'followed') {
          setDocuments(session?.did ? list.filter((doc) => doc.did !== session.did) : [])
        } else {
          setDocuments(session?.did ? list.filter((doc) => doc.did === session.did) : [])
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load forum')
    } finally {
      setLoading(false)
    }
  }, [tab, session?.did])

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
      setDocuments([])
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

  const filteredDocuments = useMemo(
    () => documents.filter((doc) => matchesSearch(doc, searchQuery)),
    [documents, searchQuery]
  )

  useEffect(() => {
    setFocusedIndex((i) => (filteredDocuments.length ? Math.min(i, filteredDocuments.length - 1) : 0))
  }, [filteredDocuments.length])

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
      filteredDocuments.length > 0 &&
      (inModal || !isModalOpen),
    itemCount: section === 'discover' ? filteredDocuments.length : section === 'artsky' ? artskyFiltered.length : 0,
    focusedIndex: section === 'discover' ? focusedIndex : artskyFocusedIndex,
    setFocusedIndex,
    onActivate: (index) => {
      if (section === 'discover') {
        const doc = filteredDocuments[index]
        if (doc) openForumPostModal(doc.uri)
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

  const wrap = (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h2 className={styles.title}>Forums</h2>
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
          <button
            type="button"
            className={section === 'consensus' ? styles.tabActive : styles.tab}
            onClick={() => setSection('consensus')}
            aria-pressed={section === 'consensus'}
          >
            Consensus
          </button>
        </div>

        {section === 'discover' && (
          <>
            <p className={styles.subtitle} style={{ marginTop: '0.5rem' }}>
              Posts from the ATmosphere using <a href="https://standard.site" target="_blank" rel="noopener noreferrer" className={styles.standardLink}>standard.site</a>
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
      {section === 'consensus' && <ConsensusContent />}

      {section === 'discover' && (
        <>
          {error && <p className={styles.error}>{error}</p>}
          {showSignInForTab ? (
            <div className={styles.empty}>Log in to see {tab === 'followed' ? 'posts from people you follow' : 'your posts'}.</div>
          ) : loading ? (
            <div className={styles.loading}>{tab === 'all' ? 'Loading discovered posts…' : tab === 'followed' ? 'Loading followed posts…' : 'Loading your posts…'}</div>
          ) : filteredDocuments.length === 0 ? (
            <div className={styles.empty}>
              {documents.length === 0
                ? tab === 'all'
                  ? 'No standard.site posts discovered yet. Add more publication URLs in forum discovery config.'
                  : tab === 'followed'
                    ? 'No posts yet from people you follow.'
                    : "You haven't posted in the forums yet."
                : 'No posts match your search.'}
            </div>
          ) : (
            <ul ref={listRef} className={styles.list}>
              {filteredDocuments.map((doc, index) => {
                const handle = doc.authorHandle ?? doc.did
                const url = documentUrl(doc)
                const createdAt = doc.createdAt
                const title = doc.title || doc.path || 'Untitled'
                const head = (
                  <div className={postBlockStyles.postHead}>
                    {doc.authorAvatar ? (
                      <img src={doc.authorAvatar} alt="" className={postBlockStyles.avatar} loading="lazy" />
                    ) : (
                      <span className={styles.avatarPlaceholder} aria-hidden>{(handle || doc.did).slice(0, 1).toUpperCase()}</span>
                    )}
                    <div className={postBlockStyles.authorRow}>
                      <ProfileLink handle={handle} className={postBlockStyles.handleLink} onClick={(e) => e.stopPropagation()}>@{handle}</ProfileLink>
                      {createdAt && <span className={postBlockStyles.postTimestamp} title={formatExactDateTime(createdAt)}>{formatRelativeTime(createdAt)}</span>}
                    </div>
                  </div>
                )
                const isFocused = index === focusedIndex
                return (
                  <li key={doc.uri} data-forum-index={index}>
                    <Link to="#" className={isFocused ? `${styles.postLink} ${styles.postLinkFocused}` : styles.postLink} onClick={(e) => { e.preventDefault(); openForumPostModal(doc.uri) }}>
                      <article className={postBlockStyles.postBlock}>
                        <div className={postBlockStyles.postBlockContent}>
                          {head}
                          <p className={postBlockStyles.postText}>{title}</p>
                          {bodyPreview(doc.body) && <p className={styles.bodyPreview}>{bodyPreview(doc.body)}</p>}
                          {!url && <p className={styles.noUrl}>No publication URL</p>}
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
            <div style={{ padding: '1rem', marginBottom: '1rem', background: 'var(--surface)', borderRadius: '0.5rem', border: '1px solid var(--border)' }}>
              <input
                type="text"
                placeholder="Post title"
                value={artskyCompose.title}
                onChange={(e) => setArtskyCompose((c) => ({ ...c, title: e.target.value }))}
                style={{ width: '100%', marginBottom: '0.5rem', padding: '0.5rem' }}
              />
              <textarea
                placeholder="Write your post… Use @username for mentions"
                value={artskyCompose.body}
                onChange={(e) => setArtskyCompose((c) => ({ ...c, body: e.target.value }))}
                style={{ width: '100%', minHeight: 120, marginBottom: '0.5rem', padding: '0.5rem' }}
              />
              <input
                type="text"
                placeholder="Tags (comma-separated)"
                value={artskyCompose.tags}
                onChange={(e) => setArtskyCompose((c) => ({ ...c, tags: e.target.value }))}
                style={{ width: '100%', marginBottom: '0.5rem', padding: '0.5rem' }}
              />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className={styles.tabActive} onClick={handleArtskyCreatePost}>Post</button>
                <button type="button" className={styles.tab} onClick={handleArtskySaveDraft}>Save Draft</button>
                <button type="button" className={styles.tab} onClick={() => setShowArtskyCompose(false)}>Cancel</button>
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
