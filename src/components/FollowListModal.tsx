import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { publicAgent, getFollowers, getFollowsList, getMutualsList, getFolloweesWhoFollowTarget, type ProfileViewBasic } from '../lib/bsky'
import type { AtpAgent } from '@atproto/api'
import { useProfileModal } from '../context/ProfileModalContext'
import styles from './FollowListModal.module.css'

const PAGE_SIZE = 50

export type FollowListSortBy = 'handle' | 'displayName' | 'date'
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
  const { openProfileModal } = useProfileModal()
  const [list, setList] = useState<ProfileViewBasic[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<FollowListSortBy>('handle')
  const [order, setOrder] = useState<FollowListOrder>('asc')

  const load = useCallback(
    async (nextCursor?: string) => {
      const isFirst = !nextCursor
      if (isFirst) setLoading(true)
      else setLoadingMore(true)
      try {
        if (mode === 'mutuals') {
          const { list: mutualList } = await getMutualsList(publicAgent, actor)
          setList(mutualList)
          setCursor(undefined)
        } else if (mode === 'followedByFollows' && viewerDid && authenticatedClient) {
          const { list: followeesList } = await getFolloweesWhoFollowTarget(authenticatedClient, viewerDid, actor)
          setList(followeesList)
          setCursor(undefined)
        } else {
          const fetcher = mode === 'followers' ? getFollowers : getFollowsList
          const { list: page, cursor: next } = await fetcher(publicAgent, actor, {
            limit: PAGE_SIZE,
            cursor: nextCursor,
          })
          setList((prev) => (isFirst ? page : [...prev, ...page]))
          setCursor(next)
        }
      } catch {
        if (isFirst) setList([])
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [actor, mode, viewerDid, authenticatedClient]
  )

  useEffect(() => {
    if (mode === 'followedByFollows' && (!viewerDid || !authenticatedClient)) {
      setLoading(false)
      setList([])
      return
    }
    load()
  }, [load, mode, viewerDid, authenticatedClient])

  const filteredAndSorted = useMemo(() => {
    const q = search.trim().toLowerCase()
    let out = q
      ? list.filter(
          (p) =>
            (p.handle ?? '').toLowerCase().includes(q) ||
            (p.displayName ?? '').toLowerCase().includes(q)
        )
      : [...list]
    const byHandle = (a: ProfileViewBasic, b: ProfileViewBasic) =>
      (a.handle ?? a.did).localeCompare(b.handle ?? b.did)
    const byDisplayName = (a: ProfileViewBasic, b: ProfileViewBasic) =>
      (a.displayName ?? a.handle ?? '').localeCompare(b.displayName ?? b.handle ?? '') || byHandle(a, b)
    const byDate = (a: ProfileViewBasic, b: ProfileViewBasic) => {
      const ta = a.indexedAt ? new Date(a.indexedAt).getTime() : 0
      const tb = b.indexedAt ? new Date(b.indexedAt).getTime() : 0
      return ta - tb
    }
    const cmp = sortBy === 'handle' ? byHandle : sortBy === 'displayName' ? byDisplayName : byDate
    out.sort((a, b) => (order === 'asc' ? cmp(a, b) : cmp(b, a)))
    return out
  }, [list, search, sortBy, order])

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore || loading) return
    load(cursor)
  }, [cursor, load, loading, loadingMore])

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose()
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
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 id="follow-list-title" className={styles.title}>
            {mode === 'followers'
              ? 'Followers'
              : mode === 'following'
                ? 'Following'
                : mode === 'followedByFollows'
                  ? 'People you follow who follow this account'
                  : 'Mutuals'}
            {list.length > 0 && !loading && (
              <span className={styles.count}> ({list.length}{mode !== 'mutuals' && mode !== 'followedByFollows' && cursor != null ? '+' : ''})</span>
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
          {loading && list.length === 0 ? (
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
          {cursor && mode !== 'mutuals' && mode !== 'followedByFollows' && list.length > 0 && !loading && (
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
