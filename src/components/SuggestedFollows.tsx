import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { agent, getSession, getSuggestedFollows, getSuggestedFollowsByMutuals, getSuggestedFollowDetail, type SuggestedFollow, type SuggestedFollowDetail } from '../lib/bsky'
import { getRecommendationsShown, markRecommendationsShown, getRotationCutoff } from '../lib/recommendationStorage'
import { useProfileModal } from '../context/ProfileModalContext'
import styles from './SuggestedFollows.module.css'

const DISPLAY_COUNT = 8

export type SuggestedFollowSort = 'count' | 'mutuals'

export default function SuggestedFollows() {
  const { openProfileModal } = useProfileModal()
  const [suggestions, setSuggestions] = useState<SuggestedFollow[]>([])
  const [loading, setLoading] = useState(false)
  const [followLoadingDid, setFollowLoadingDid] = useState<string | null>(null)
  const [dismissedDids, setDismissedDids] = useState<Set<string>>(() => new Set())
  const [sortBy, setSortBy] = useState<SuggestedFollowSort>('count')
  const [infoOpenForDid, setInfoOpenForDid] = useState<string | null>(null)
  const [detail, setDetail] = useState<SuggestedFollowDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const sortedSuggestions = useMemo(() => suggestions, [suggestions])

  const load = useCallback(async () => {
    const session = getSession()
    const did = session?.did
    if (!did) return
    setLoading(true)
    try {
      const raw =
        sortBy === 'mutuals'
          ? await getSuggestedFollowsByMutuals(agent, did, { maxSuggestions: 20 })
          : await getSuggestedFollows(agent, did, { maxSuggestions: 20 })
      const shown = getRecommendationsShown()
      const cutoff = getRotationCutoff()
      /* Only filter out dismissed (×) accounts for 7 days; don't mark as "shown" when displaying so each open is fresh */
      const filtered = raw.filter(
        (s) => !dismissedDids.has(s.did) && (!shown[s.did] || shown[s.did] < cutoff)
      )
      const toDisplay = filtered.slice(0, DISPLAY_COUNT)
      setSuggestions(toDisplay)
    } catch {
      setSuggestions([])
    } finally {
      setLoading(false)
    }
  }, [dismissedDids, sortBy])

  useEffect(() => {
    load()
  }, [load])

  const openInfo = useCallback(async (s: SuggestedFollow) => {
    setInfoOpenForDid(s.did)
    setDetail(null)
    setDetailLoading(true)
    try {
      const session = getSession()
      const did = session?.did
      if (!did) return
      const d = await getSuggestedFollowDetail(agent, did, s.did, {
        source: sortBy === 'mutuals' ? 'mutuals' : 'peopleYouFollow',
      })
      setDetail(d)
    } catch {
      setDetail({ count: 0, followedBy: [] })
    } finally {
      setDetailLoading(false)
    }
  }, [sortBy])

  const handleFollow = useCallback(
    async (did: string, _handle: string) => {
      setFollowLoadingDid(did)
      try {
        await agent.follow(did)
        setSuggestions((prev) => prev.filter((s) => s.did !== did))
      } catch {
        // leave in list so user can retry
      } finally {
        setFollowLoadingDid(null)
      }
    },
    []
  )

  const handleDismiss = useCallback((did: string) => {
    markRecommendationsShown([did])
    setDismissedDids((prev) => new Set(prev).add(did))
    setSuggestions((prev) => prev.filter((s) => s.did !== did))
  }, [])

  const infoSuggestion = infoOpenForDid ? suggestions.find((s) => s.did === infoOpenForDid) : null

  return (
    <div className={styles.wrap} aria-label="Suggested accounts to follow">
      <p className={styles.subtext}>
        Accounts followed by people you follow. New suggestions each time you open.
      </p>
      {suggestions.length > 0 && (
        <div className={styles.sortRow}>
          <span className={styles.sortLabel}>Sort by:</span>
          <select
            className={styles.sortSelect}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SuggestedFollowSort)}
            aria-label="Sort suggestions"
          >
            <option value="count">Most followed by people you follow</option>
            <option value="mutuals">Most followed by mutuals</option>
          </select>
        </div>
      )}
      {loading && suggestions.length === 0 ? (
        <p className={styles.loading}>Loading…</p>
      ) : suggestions.length === 0 ? (
        <p className={styles.empty}>No suggestions right now. Follow more accounts to see recommendations.</p>
      ) : (
      <ul className={styles.list}>
        {sortedSuggestions.map((s) => (
          <li key={s.did} className={styles.item}>
            <button
              type="button"
              className={styles.profileBtn}
              onClick={() => openProfileModal(s.handle)}
              aria-label={`View @${s.handle} profile`}
            >
              {s.avatar ? (
                <img src={s.avatar} alt="" className={styles.avatar} loading="lazy" />
              ) : (
                <span className={styles.avatarPlaceholder} aria-hidden>
                  {(s.displayName ?? s.handle).slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className={styles.info}>
                <span className={styles.handle}>@{s.handle}</span>
                <span className={styles.reason}>
                  {sortBy === 'mutuals'
                    ? s.count === 1
                      ? 'Followed by 1 mutual'
                      : `Followed by ${s.count} mutuals`
                    : s.count === 1
                      ? 'Followed by 1 person you follow'
                      : `Followed by ${s.count} people you follow`}
                </span>
              </span>
            </button>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.infoBtn}
                onClick={(e) => { e.stopPropagation(); openInfo(s); }}
                aria-label="Why we recommend this account"
                title="Why we recommend this account"
              >
                <InfoIcon />
              </button>
              <button
                type="button"
                className={styles.followBtn}
                onClick={() => handleFollow(s.did, s.handle)}
                disabled={followLoadingDid === s.did}
              >
                {followLoadingDid === s.did ? '…' : 'Follow'}
              </button>
              <button
                type="button"
                className={styles.dismissBtn}
                onClick={() => handleDismiss(s.did)}
                aria-label="Not now"
                title="Hide this suggestion for a week"
              >
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>
      )}
      {infoOpenForDid && infoSuggestion && createPortal(
        <div
          className={styles.detailBackdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="suggestion-detail-title"
          onClick={() => setInfoOpenForDid(null)}
        >
          <div className={styles.detailPanel} onClick={(e) => e.stopPropagation()}>
            <div className={styles.detailHeader}>
              <h3 id="suggestion-detail-title" className={styles.detailTitle}>
                Why we recommend @{infoSuggestion.handle}
              </h3>
              <button
                type="button"
                className={styles.detailClose}
                onClick={() => setInfoOpenForDid(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            {detailLoading ? (
              <p className={styles.detailLoading}>Loading…</p>
            ) : detail ? (
              <div className={styles.detailBody}>
                <p className={styles.detailSummary}>
                  {detail.fromMutuals
                    ? detail.count === 1
                      ? 'Followed by 1 mutual:'
                      : `Followed by ${detail.count} mutuals:`
                    : detail.count === 1
                      ? 'Followed by 1 person you follow:'
                      : `Followed by ${detail.count} people you follow:`}
                </p>
                <ul className={styles.detailList}>
                  {detail.followedBy.map((acc) => (
                    <li key={acc.did} className={styles.detailListItem}>
                      <button
                        type="button"
                        className={styles.detailProfileBtn}
                        onClick={() => { openProfileModal(acc.handle); setInfoOpenForDid(null); }}
                      >
                        {acc.avatar ? (
                          <img src={acc.avatar} alt="" className={styles.detailAvatar} loading="lazy" />
                        ) : (
                          <span className={styles.detailAvatarPlaceholder} aria-hidden>
                            {(acc.displayName ?? acc.handle).slice(0, 1).toUpperCase()}
                          </span>
                        )}
                        <span className={styles.detailProfileInfo}>
                          {acc.displayName && <span className={styles.detailDisplayName}>{acc.displayName}</span>}
                          <span className={styles.detailHandle}>@{acc.handle}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

function InfoIcon() {
  return (
    <svg className={styles.infoIcon} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
    </svg>
  )
}
