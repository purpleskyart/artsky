import { useRef, useState, useEffect } from 'react'
import { blockAccount, unblockAccount, getSession, getProfileCached } from '../lib/bsky'
import { getShareableProfileUrl } from '../lib/appUrl'
import { formatExactDateTimeLongMonth } from '../lib/date'
import styles from './ProfileActionsMenu.module.css'

interface ProfileActionsMenuProps {
  profileDid: string
  profileHandle: string
  isOwnProfile: boolean
  /** When true, show "Don't show reposts" / "Show reposts" in menu (only for accounts you follow). */
  isFollowing?: boolean
  /** When true, reposts from this user are currently hidden on homepage. */
  hideRepostsFromThisUser?: boolean
  /** Callback to toggle hide reposts from this user. */
  onToggleHideReposts?: () => void
  /** When provided, menu uses this instead of fetching profile again (avoids extra API call). */
  initialProfileMeta?: { createdAt?: string; indexedAt?: string } | null
  /** When provided, menu uses this for block state instead of fetching profile again. */
  initialAuthorBlockingUri?: string | null
  className?: string
}

export default function ProfileActionsMenu({
  profileDid,
  profileHandle,
  isOwnProfile,
  isFollowing,
  hideRepostsFromThisUser,
  onToggleHideReposts,
  initialProfileMeta,
  initialAuthorBlockingUri,
  className,
}: ProfileActionsMenuProps) {
  const session = getSession()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [blockStep, setBlockStep] = useState<'idle' | 'confirm'>('idle')
  const [authorBlockingUri, setAuthorBlockingUri] = useState<string | null>(initialAuthorBlockingUri ?? null)
  const [profileMeta, setProfileMeta] = useState<{ createdAt?: string; indexedAt?: string } | null>(initialProfileMeta ?? null)
  const menuRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const lastSyncedProfileDidRef = useRef<string | null>(null)

  // Sync from props only when profile changes (so block/unblock in menu isn't overwritten by stale parent state)
  useEffect(() => {
    if (profileDid !== lastSyncedProfileDidRef.current) {
      lastSyncedProfileDidRef.current = profileDid
      if (initialAuthorBlockingUri !== undefined) setAuthorBlockingUri(initialAuthorBlockingUri)
      if (initialProfileMeta !== undefined) setProfileMeta(initialProfileMeta)
    }
  }, [profileDid, initialAuthorBlockingUri, initialProfileMeta])

  useEffect(() => {
    if (!open) setBlockStep('idle')
  }, [open])

  // Only fetch when menu opens if parent didn't pass data (avoids duplicate getProfileCached)
  useEffect(() => {
    if (!open) return
    if (initialProfileMeta !== undefined && initialAuthorBlockingUri !== undefined) return
    let cancelled = false
    getProfileCached(profileDid, !getSession()).then((data) => {
      if (cancelled) return
      setProfileMeta({
        createdAt: data.createdAt ?? undefined,
        indexedAt: data.indexedAt ?? undefined,
      })
      const viewerData = data as { viewer?: { blocking?: string } }
      setAuthorBlockingUri(viewerData.viewer?.blocking ?? null)
    }).catch(() => {
      if (!cancelled) {
        setAuthorBlockingUri(null)
        setProfileMeta(null)
      }
    })
    return () => { cancelled = true }
  }, [open, profileDid, initialProfileMeta, initialAuthorBlockingUri])

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'q' || e.key === 'u' || e.key === 'Backspace') {
        e.preventDefault()
        if (blockStep === 'confirm') setBlockStep('idle')
        else setOpen(false)
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, blockStep])

  function showSuccess(message: string) {
    setFeedback({ type: 'success', message })
    setTimeout(() => {
      setOpen(false)
      setFeedback(null)
    }, 1500)
  }

  function showError(message: string) {
    setFeedback({ type: 'error', message })
  }

  async function handleBlockConfirm() {
    if (!session?.did || isOwnProfile) return
    setLoading('block')
    setFeedback(null)
    try {
      const { uri } = await blockAccount(profileDid)
      setAuthorBlockingUri(uri)
      setBlockStep('idle')
      showSuccess('Account blocked')
    } catch {
      showError('Could not block. Try again.')
    } finally {
      setLoading(null)
    }
  }

  async function handleUnblock() {
    if (!authorBlockingUri) return
    setLoading('unblock')
    setFeedback(null)
    try {
      await unblockAccount(authorBlockingUri)
      setAuthorBlockingUri(null)
      showSuccess('Account unblocked')
    } catch {
      showError('Could not unblock. Try again.')
    } finally {
      setLoading(null)
    }
  }

  function handleCopyProfileLink() {
    const url = getShareableProfileUrl(profileHandle)
    navigator.clipboard.writeText(url).then(
      () => showSuccess('Link copied'),
      () => showError('Could not copy link')
    )
  }

  const loggedIn = !!session?.did
  const showBlockUnblock = loggedIn && !isOwnProfile

  return (
    <div ref={menuRef} className={`${styles.wrap} ${className ?? ''}`}>
      <button
        type="button"
        className={styles.trigger}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen(!open)
        }}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Profile options"
        title="Profile options"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="4" cy="12" r="2" fill="currentColor" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
          <circle cx="20" cy="12" r="2" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div ref={dropdownRef} className={styles.dropdown} role="menu">
          {feedback ? (
            <div className={feedback.type === 'success' ? styles.feedbackSuccess : styles.feedbackError} role="status">
              {feedback.message}
            </div>
          ) : blockStep === 'confirm' ? (
            <>
              <button
                type="button"
                className={styles.item}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setBlockStep('idle') }}
                role="menuitem"
              >
                ← Back
              </button>
              <div className={styles.label}>
                Block @{profileHandle}?
              </div>
              <button
                type="button"
                className={styles.item}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleBlockConfirm() }}
                disabled={loading === 'block'}
                role="menuitem"
              >
                {loading === 'block' ? '…' : 'Yes, block'}
              </button>
            </>
          ) : (
            <>
              {showBlockUnblock && (
                authorBlockingUri ? (
                  <button
                    type="button"
                    className={styles.item}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleUnblock() }}
                    disabled={loading === 'unblock'}
                    role="menuitem"
                  >
                    {loading === 'unblock' ? '…' : 'Unblock account'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.item}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setBlockStep('confirm') }}
                    role="menuitem"
                  >
                    Block user
                  </button>
                )
              )}
              {isFollowing && onToggleHideReposts && (
                <button
                  type="button"
                  className={styles.item}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleHideReposts() }}
                  role="menuitem"
                >
                  {hideRepostsFromThisUser ? `Show reposts from @${profileHandle}` : `Don't show reposts from @${profileHandle}`}
                </button>
              )}
              <button
                type="button"
                className={styles.item}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCopyProfileLink() }}
                role="menuitem"
              >
                Copy profile link
              </button>
              {profileMeta && (profileMeta.createdAt || profileMeta.indexedAt) && (
                <div className={styles.profileMeta} role="status">
                  {profileMeta.createdAt && (
                    <p className={styles.profileMetaLine} title={formatExactDateTimeLongMonth(profileMeta.createdAt)}>
                      Account created: {formatExactDateTimeLongMonth(profileMeta.createdAt)}
                    </p>
                  )}
                  {profileMeta.indexedAt &&
                    (!profileMeta.createdAt ||
                      new Date(profileMeta.indexedAt).getTime() - new Date(profileMeta.createdAt).getTime() > 60_000) && (
                    <p className={styles.profileMetaLine} title={formatExactDateTimeLongMonth(profileMeta.indexedAt)}>
                      Profile last updated: {formatExactDateTimeLongMonth(profileMeta.indexedAt)}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
