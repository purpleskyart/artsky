import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { listStandardSiteDocumentsAll, listStandardSiteDocumentsForForum, getSession, type StandardSiteDocumentView } from '../lib/bsky'
import { FORUM_DISCOVERY_URLS } from '../config/forumDiscovery'
import { formatRelativeTime, formatExactDateTime } from '../lib/date'
import Layout from '../components/Layout'
import styles from './ForumPage.module.css'
import postBlockStyles from './PostDetailPage.module.css'

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
  const handle = (doc.authorHandle ?? '').toLowerCase()
  const path = (doc.path ?? '').toLowerCase()
  return title.includes(lower) || handle.includes(lower) || path.includes(lower)
}

type ForumTab = 'all' | 'followed' | 'mine'

export default function ForumPage() {
  const [tab, setTab] = useState<ForumTab>('all')
  const [documents, setDocuments] = useState<StandardSiteDocumentView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const session = getSession()

  const load = useCallback(async () => {
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

  useEffect(() => {
    setDocuments([])
    load()
  }, [load])

  const filteredDocuments = useMemo(
    () => documents.filter((doc) => matchesSearch(doc, searchQuery)),
    [documents, searchQuery]
  )

  const showSignInForTab = (tab === 'followed' || tab === 'mine') && !session

  return (
    <Layout title="Forum" showNav>
      <div className={styles.wrap}>
        <header className={styles.header}>
          <h2 className={styles.title}>Forum</h2>
          <p className={styles.subtitle}>
            Posts from the ATmosphere using the <a href="https://standard.site" target="_blank" rel="noopener noreferrer" className={styles.standardLink}>standard.site</a> lexicon
          </p>
          <div className={styles.tabs}>
            <button
              type="button"
              className={tab === 'all' ? styles.tabActive : styles.tab}
              onClick={() => setTab('all')}
              aria-pressed={tab === 'all'}
            >
              All Posts
            </button>
            <button
              type="button"
              className={tab === 'followed' ? styles.tabActive : styles.tab}
              onClick={() => setTab('followed')}
              aria-pressed={tab === 'followed'}
            >
              Followed
            </button>
            <button
              type="button"
              className={tab === 'mine' ? styles.tabActive : styles.tab}
              onClick={() => setTab('mine')}
              aria-pressed={tab === 'mine'}
            >
              My Posts
            </button>
          </div>
          <div className={styles.searchRow}>
            <input
              type="search"
              className={styles.searchInput}
              placeholder="Search posts…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search forum posts"
            />
          </div>
        </header>
        {error && <p className={styles.error}>{error}</p>}
        {showSignInForTab ? (
          <div className={styles.empty}>Sign in to see {tab === 'followed' ? 'posts from people you follow' : 'your posts'}.</div>
        ) : loading ? (
          <div className={styles.loading}>
            {tab === 'all' ? 'Loading discovered posts…' : tab === 'followed' ? 'Loading followed posts…' : 'Loading your posts…'}
          </div>
        ) : filteredDocuments.length === 0 ? (
          <div className={styles.empty}>
            {documents.length === 0
              ? tab === 'all'
                ? 'No standard.site posts discovered yet. Add more publication URLs in forum discovery config.'
                : tab === 'followed'
                  ? 'No posts yet from people you follow.'
                  : 'You haven\'t posted in the forum yet.'
              : 'No posts match your search.'}
          </div>
        ) : (
          <ul className={styles.list}>
            {filteredDocuments.map((doc) => {
              const handle = doc.authorHandle ?? doc.did
              const url = documentUrl(doc)
              const createdAt = doc.createdAt
              const title = doc.title || doc.path || 'Untitled'
              const forumPostUrl = `/forum/post/${encodeURIComponent(doc.uri)}`
              const head = (
                <div className={postBlockStyles.postHead}>
                  {doc.authorAvatar ? (
                    <img src={doc.authorAvatar} alt="" className={postBlockStyles.avatar} />
                  ) : (
                    <span className={styles.avatarPlaceholder} aria-hidden>{(handle || doc.did).slice(0, 1).toUpperCase()}</span>
                  )}
                  <div className={postBlockStyles.authorRow}>
                    <Link
                      to={`/profile/${encodeURIComponent(handle)}`}
                      className={postBlockStyles.handleLink}
                      onClick={(e) => e.stopPropagation()}
                    >
                      @{handle}
                    </Link>
                    {createdAt && (
                      <span
                        className={postBlockStyles.postTimestamp}
                        title={formatExactDateTime(createdAt)}
                      >
                        {formatRelativeTime(createdAt)}
                      </span>
                    )}
                  </div>
                </div>
              )
              return (
                <li key={doc.uri}>
                  <Link to={forumPostUrl} className={styles.postLink}>
                    <article className={postBlockStyles.postBlock}>
                      <div className={postBlockStyles.postBlockContent}>
                        {head}
                        <p className={postBlockStyles.postText}>{title}</p>
                        {!url && <p className={styles.noUrl}>No publication URL</p>}
                      </div>
                    </article>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Layout>
  )
}
