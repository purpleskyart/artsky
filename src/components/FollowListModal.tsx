import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { publicAgent, getFollowers, getFollowsList, getMutualsList, type ProfileViewBasic } from '../lib/bsky'
import { useProfileModal } from '../context/ProfileModalContext'
import styles from './FollowListModal.module.css'

const PAGE_SIZE = 50

export type FollowListSort = 'handle-asc' | 'handle-desc' | 'name-asc' | 'name-desc' | 'date-desc' | 'date-asc'

export function FollowListModal({
  mode,
  actor,
  onClose,
}: {
  mode: 'followers' | 'following' | 'mutuals'
  actor: string
  onClose: () => void
}) {
  const { openProfileModal } = useProfileModal()
  const [list, setList] = useState<ProfileViewBasic[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<FollowListSort>('handle-asc')

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
    [actor, mode]
  )

  useEffect(() => {
    load()
  }, [load])

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
      (a.displayName ?? '').localeCompare(b.displayName ?? '')
    const byDate = (a: ProfileViewBasic, b: ProfileViewBasic) => {
      const ta = a.indexedAt ? new Date(a.indexedAt).getTime() : 0
      const tb = b.indexedAt ? new Date(b.indexedAt).getTime() : 0
      return ta - tb
    }
    if (sort === 'handle-asc') out.sort(byHandle)
    else if (sort === 'handle-desc') out.sort((a, b) => byHandle(b, a))
    else if (sort === 'name-asc') out.sort((a, b) => byDisplayName(a, b) || byHandle(a, b))
    else if (sort === 'name-desc') out.sort((a, b) => byDisplayName(b, a) || byHandle(b, a))
    else if (sort === 'date-desc') out.sort((a, b) => byDate(b, a))
    else if (sort === 'date-asc') out.sort(byDate)
    return out
  }, [list, search, sort])

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
            {mode === 'followers' ? 'Followers' : mode === 'following' ? 'Following' : 'Mutuals'}
            {list.length > 0 && !loading && (
              <span className={styles.count}> ({list.length}{mode !== 'mutuals' && cursor != null ? '+' : ''})</span>
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
          <select
            className={styles.sortSelect}
            value={sort}
            onChange={(e) => setSort(e.target.value as FollowListSort)}
            aria-label="Sort list"
          >
            <option value="handle-asc">Username (A–Z)</option>
            <option value="handle-desc">Username (Z–A)</option>
            <option value="name-asc">Name (A–Z)</option>
            <option value="name-desc">Name (Z–A)</option>
            <option value="date-desc">
              {mode === 'followers' ? 'Became follower (newest)' : mode === 'following' ? 'Started following (newest)' : 'Date (newest)'}
            </option>
            <option value="date-asc">
              {mode === 'followers' ? 'Became follower (oldest)' : mode === 'following' ? 'Started following (oldest)' : 'Date (oldest)'}
            </option>
          </select>
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
          {cursor && mode !== 'mutuals' && list.length > 0 && !loading && (
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
