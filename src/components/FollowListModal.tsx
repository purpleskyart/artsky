import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { publicAgent, getFollowers, getFollowsList, type ProfileViewBasic } from '../lib/bsky'
import type { AtpAgent } from '@atproto/api'
import { useProfileModal } from '../context/ProfileModalContext'
import { useSwipeToClose } from '../hooks/useSwipeToClose'
import styles from './FollowListModal.module.css'

const PAGE_SIZE = 25
const MOBILE_BREAKPOINT = 768
function subscribeMobile(cb: () => void) {
  if (typeof window === 'undefined') return () => {}
  const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
function getMobileSnapshot() {
  return typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false
}

export type FollowListSortBy = 'handle' | 'displayName' | 'date' | 'followers'
export type FollowListOrder = 'asc' | 'desc'

export function FollowListModal({
  mode,
  actor,
  onClose,
  viewerDid,
  authenticatedClient,
}: {
  mode: 'followers' | 'following' | 'mutuals' | 'followedByFollows'
  actor: string
  onClose: () => void
  /** Required when mode is 'followedByFollows': the logged-in user's DID. */
  viewerDid?: string
  /** Required when mode is 'followedByFollows': authenticated API client. */
  authenticatedClient?: AtpAgent
}) {
  const { openProfileModal, closeAllModals } = useProfileModal()
  const isMobile = useSyncExternalStore(subscribeMobile, getMobileSnapshot, () => false)
  const [pages, setPages] = useState<ProfileViewBasic[][]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(false) // Changed to false - don't load on mount
  const [loadingMore, setLoadingMore] = useState(false)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<FollowListSortBy>('handle')
  const [order, setOrder] = useState<FollowListOrder>('asc')
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false) // Track if we've loaded data

  const panelRef = useRef<HTMLDivElement>(null)

  const handleSwipeRight = useCallback(() => {
    onClose()
  }, [onClose])

  const swipe = useSwipeToClose({
    enabled: isMobile,
    onSwipeRight: handleSwipeRight,
  })

  const load = useCallback(
    async (nextCursor?: string) => {
      const isFirst = !nextCursor
      if (isFirst) setLoading(true)
      else setLoadingMore(true)
      try {
        if (mode === 'mutuals' || mode === 'followedByFollows') {
          setPages([])
          setCursor(undefined)
        } else {
          const fetcher = mode === 'followers' ? getFollowers : getFollowsList
          const { list: page, cursor: next } = await fetcher(publicAgent, actor, {
            limit: PAGE_SIZE,
            cursor: nextCursor,
          })
          setPages((prev) => (isFirst ? [page] : [...prev, page]))
          setCursor(next)
        }
        if (isFirst) setHasLoadedOnce(true)
      } catch {
        if (isFirst) setPages([])
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [actor, mode, viewerDid, authenticatedClient]
  )

  // Auto-load on mount for followers/following modes
  useEffect(() => {
    if (mode === 'mutuals' || mode === 'followedByFollows') {
      // Don't auto-load for modes that require special handling
      setLoading(false)
      setPages([])
    } else {
      // Auto-load followers/following immediately
      load()
    }
  }, [mode, load])

  // Flatten pages, sorting each page individually so newly loaded pages stay at the bottom
  const filteredAndSorted = useMemo(() => {
    const q = search.trim().toLowerCase()
    const byHandle = (a: ProfileViewBasic, b: ProfileViewBasic) =>
      (a.handle ?? a.did).localeCompare(b.handle ?? b.did)
    const byDisplayName = (a: ProfileViewBasic, b: ProfileViewBasic) =>
      (a.displayName ?? a.handle ?? '').localeCompare(b.displayName ?? b.handle ?? '') || byHandle(a, b)
    const byDate = (a: ProfileViewBasic, b: ProfileViewBasic) => {
      const ta = a.indexedAt ? new Date(a.indexedAt).getTime() : 0
      const tb = b.indexedAt ? new Date(b.indexedAt).getTime() : 0
      return ta - tb
    }
    const byFollowers = (a: ProfileViewBasic, b: ProfileViewBasic) => {
      const fa = a.followersCount ?? 0
      const fb = b.followersCount ?? 0
      return fa - fb
    }
    const cmp = sortBy === 'handle' ? byHandle : sortBy === 'displayName' ? byDisplayName : sortBy === 'followers' ? byFollowers : byDate

    // Process each page: filter, sort within page, maintain page order
    const processedPages = pages.map((page) => {
      let out = q
        ? page.filter(
            (p) =>
              (p.handle ?? '').toLowerCase().includes(q) ||
              (p.displayName ?? '').toLowerCase().includes(q)
          )
        : [...page]
      out.sort((a, b) => (order === 'asc' ? cmp(a, b) : cmp(b, a)))
      return out
    })

    return processedPages.flat()
  }, [pages, search, sortBy, order])

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore || loading) return
    load(cursor)
  }, [cursor, load, loading, loadingMore])

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose()
      }
    },
    [onClose]
  )

  return createPortal(
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="follow-list-title"
      onClick={handleBackdropClick}
    >
      <div
        ref={panelRef}
        className={`${styles.panel} ${swipe.isReturning ? styles.panelSwipeReturning : ''} ${isMobile ? styles.panelMobile : ''}`}
        style={swipe.style}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={swipe.onTouchStart}
        onTouchMove={swipe.onTouchMove}
        onTouchEnd={swipe.onTouchEnd}
      >
        <div className={styles.header}>
          <h2 id="follow-list-title" className={styles.title}>
            {mode === 'followers'
              ? 'Followers'
              : mode === 'following'
                ? 'Following'
                : mode === 'followedByFollows'
                  ? 'People you follow who follow this account'
                  : 'Mutuals'}
            {pages.length > 0 && !loading && (
              <span className={styles.count}> ({pages.flat().length}{mode !== 'mutuals' && mode !== 'followedByFollows' && cursor != null ? '+' : ''})</span>
            )}
          </h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className={styles.toolbar}>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search by username or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search list"
          />
          <span className={styles.sortByLabel} aria-hidden>
            Sort By:{' '}
          </span>
          <select
            className={styles.sortSelect}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as FollowListSortBy)}
            aria-label="Sort by"
          >
            <option value="handle">Username</option>
            <option value="displayName">Display name</option>
            <option value="followers">Followers count</option>
            <option value="date">Date followed</option>
          </select>
          <button
            type="button"
            className={styles.orderToggleBtn}
            onClick={() => setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
            aria-label={order === 'asc' ? 'Ascending; click for descending' : 'Descending; click for ascending'}
            title={order === 'asc' ? 'Ascending (click for descending)' : 'Descending (click for ascending)'}
          >
            {order === 'asc' ? (
              <svg className={styles.orderArrow} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M18 15l-6-6-6 6" />
              </svg>
            ) : (
              <svg className={styles.orderArrow} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M6 9l6 6 6-6" />
              </svg>
            )}
          </button>
        </div>
        <div className={styles.body}>
          {!hasLoadedOnce ? (
            <div className={styles.loadPrompt}>
              <p className={styles.loadPromptText}>
                Click "Load {mode === 'followers' ? 'Followers' : mode === 'following' ? 'Following' : mode === 'followedByFollows' ? 'List' : 'Mutuals'}" to view the list
              </p>
              <button
                type="button"
                className={styles.loadBtn}
                onClick={() => load()}
                disabled={loading}
              >
                {loading ? 'Loading…' : `Load ${mode === 'followers' ? 'Followers' : mode === 'following' ? 'Following' : mode === 'followedByFollows' ? 'List' : 'Mutuals'}`}
              </button>
            </div>
          ) : loading && pages.length === 0 ? (
            <p className={styles.loading}>Loading…</p>
          ) : filteredAndSorted.length === 0 ? (
            <p className={styles.empty}>
              {search.trim()
                ? 'No matches.'
                : mode === 'followers'
                  ? 'No followers.'
                  : mode === 'following'
                    ? 'Not following anyone.'
                    : mode === 'followedByFollows'
                      ? 'None of the people you follow follow this account.'
                      : 'No mutuals.'}
            </p>
          ) : (
            <ul className={styles.list}>
              {filteredAndSorted.map((p) => (
                <li key={p.did} className={styles.item}>
                  <button
                    type="button"
                    className={styles.rowBtn}
                    onClick={() => {
                      openProfileModal(p.handle ?? p.did)
                      onClose()
                    }}
                  >
                    {p.avatar ? (
                      <img src={p.avatar} alt="" className={styles.avatar} loading="lazy" />
                    ) : (
                      <span className={styles.avatarPlaceholder} aria-hidden>
                        {(p.displayName ?? p.handle ?? p.did).slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span className={styles.info}>
                      {p.displayName && <span className={styles.displayName}>{p.displayName}</span>}
                      <span className={styles.handle}>@{p.handle ?? p.did}</span>
                      {p.indexedAt && (
                        <span className={styles.dateLabel}>
                          {mode === 'followers' ? 'Follower since ' : mode === 'following' ? 'Following since ' : 'Mutual since '}
                          {new Date(p.indexedAt).toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {cursor && mode !== 'mutuals' && mode !== 'followedByFollows' && pages.length > 0 && !loading && (
            <div className={styles.loadMoreWrap}>
              <button
                type="button"
                className={styles.loadMoreBtn}
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
