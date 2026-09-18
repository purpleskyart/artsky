import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useProfileModal } from '../context/ProfileModalContext'
import { useSession } from '../context/SessionContext'
import { blockAccount, getProfileCached, unblockAccount } from '../lib/bsky'
import {
  getConvoReportSubject,
  leaveConvo,
  muteConvo,
  reportConversation,
  unmuteConvo,
  type ChatConvoView,
  type ChatMessageView,
} from '../lib/chat'
import styles from './ChatActionsMenu.module.css'

type MenuStep = 'main' | 'block' | 'report' | 'leave'

const REPORT_REASONS: { label: string; reasonType: string }[] = [
  { label: 'Spam', reasonType: 'com.atproto.moderation.defs#reasonSpam' },
  { label: 'Harassment', reasonType: 'com.atproto.moderation.defs#reasonViolation' },
  { label: 'Misleading', reasonType: 'com.atproto.moderation.defs#reasonMisleading' },
  { label: 'Other', reasonType: 'com.atproto.moderation.defs#reasonOther' },
]

interface ChatActionsMenuProps {
  convo: ChatConvoView | null
  convoId: string | null
  peerDid: string
  profileHandle: string | null
  messages: ChatMessageView[]
  hasMessages: boolean
  onConvoChange: (convo: ChatConvoView) => void
  onLeave: () => void
}

export default function ChatActionsMenu({
  convo,
  convoId,
  peerDid,
  profileHandle,
  messages,
  hasMessages,
  onConvoChange,
  onLeave,
}: ChatActionsMenuProps) {
  const { openProfileModal } = useProfileModal()
  const { session, reportAuthError } = useSession()
  const myDid = session?.did
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<MenuStep>('main')
  const [loading, setLoading] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [authorBlockingUri, setAuthorBlockingUri] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const reportSubject = useMemo(
    () => (convo && myDid ? getConvoReportSubject(convo, peerDid, myDid, messages) : null),
    [convo, myDid, peerDid, messages]
  )

  const isMuted = convo?.muted ?? false

  useEffect(() => {
    if (!open) setStep('main')
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    getProfileCached(peerDid, !session)
      .then((data) => {
        if (cancelled) return
        const viewerData = data as { viewer?: { blocking?: string } }
        setAuthorBlockingUri(viewerData.viewer?.blocking ?? null)
      })
      .catch(() => {
        if (!cancelled) setAuthorBlockingUri(null)
      })
    return () => {
      cancelled = true
    }
  }, [open, peerDid, session])

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
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (step !== 'main') setStep('main')
        else setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, step])

  const showSuccess = useCallback((message: string) => {
    setFeedback({ type: 'success', message })
    setTimeout(() => {
      setOpen(false)
      setFeedback(null)
      setStep('main')
    }, 1500)
  }, [])

  const showError = useCallback((message: string) => {
    setFeedback({ type: 'error', message })
  }, [])

  const handleGoToProfile = useCallback(() => {
    if (!profileHandle) return
    setOpen(false)
    openProfileModal(profileHandle)
  }, [openProfileModal, profileHandle])

  const handleToggleMute = useCallback(async () => {
    if (!convoId) return
    setLoading('mute')
    setFeedback(null)
    try {
      const updated = isMuted ? await unmuteConvo(convoId) : await muteConvo(convoId)
      onConvoChange(updated)
      showSuccess(isMuted ? 'Conversation unmuted' : 'Conversation muted')
    } catch (err) {
      const error = err as { status?: number }
      if (error.status === 401) {
        showError('Your session has expired. Please log in again.')
        reportAuthError()
      } else {
        showError(isMuted ? 'Could not unmute conversation.' : 'Could not mute conversation.')
      }
    } finally {
      setLoading(null)
    }
  }, [convoId, isMuted, onConvoChange, showSuccess, showError, reportAuthError])

  const handleBlockConfirm = useCallback(async () => {
    if (!myDid) return
    setLoading('block')
    setFeedback(null)
    try {
      const { uri } = await blockAccount(peerDid)
      setAuthorBlockingUri(uri)
      setStep('main')
      showSuccess('Account blocked')
    } catch (err) {
      const error = err as { status?: number }
      if (error.status === 401) {
        showError('Your session has expired. Please log in again.')
        reportAuthError()
      } else {
        showError('Could not block account.')
      }
    } finally {
      setLoading(null)
    }
  }, [myDid, peerDid, showSuccess, showError, reportAuthError])

  const handleUnblock = useCallback(async () => {
    if (!authorBlockingUri) return
    setLoading('unblock')
    setFeedback(null)
    try {
      await unblockAccount(authorBlockingUri)
      setAuthorBlockingUri(null)
      showSuccess('Account unblocked')
    } catch (err) {
      const error = err as { status?: number }
      if (error.status === 401) {
        showError('Your session has expired. Please log in again.')
        reportAuthError()
      } else {
        showError('Could not unblock account.')
      }
    } finally {
      setLoading(null)
    }
  }, [authorBlockingUri, showSuccess, showError, reportAuthError])

  const handleReportWithReason = useCallback(
    async (reasonType: string) => {
      if (!reportSubject) return
      setLoading('report')
      setFeedback(null)
      try {
        await reportConversation(reportSubject, reasonType)
        showSuccess('Report sent to Bluesky')
      } catch (err) {
        const error = err as { status?: number }
        if (error.status === 401) {
          showError('Your session has expired. Please log in again.')
          reportAuthError()
        } else {
          showError('Could not send report. Try again.')
        }
      } finally {
        setLoading(null)
      }
    },
    [reportSubject, showSuccess, showError, reportAuthError]
  )

  const handleLeaveConfirm = useCallback(async () => {
    if (!convoId) return
    setLoading('leave')
    setFeedback(null)
    try {
      await leaveConvo(convoId)
      setOpen(false)
      onLeave()
    } catch (err) {
      const error = err as { status?: number }
      if (error.status === 401) {
        showError('Your session has expired. Please log in again.')
        reportAuthError()
      } else {
        showError('Could not leave conversation.')
      }
    } finally {
      setLoading(null)
    }
  }, [convoId, onLeave, showError, reportAuthError])

  if (!convoId) return null

  return (
    <div ref={menuRef} className={styles.wrap}>
      <button
        type="button"
        className={styles.trigger}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((prev) => !prev)
        }}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Conversation options"
        title="Conversation options"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="4" cy="12" r="2" fill="currentColor" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
          <circle cx="20" cy="12" r="2" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className={styles.dropdown} role="menu" onClick={(e) => e.stopPropagation()}>
          {feedback ? (
            <div
              className={feedback.type === 'success' ? styles.feedbackSuccess : styles.feedbackError}
              role="status"
            >
              {feedback.message}
            </div>
          ) : step === 'block' ? (
            <>
              <button
                type="button"
                className={styles.item}
                onClick={() => setStep('main')}
                role="menuitem"
              >
                ← Back
              </button>
              <div className={styles.confirmLabel}>
                Block {profileHandle ? `@${profileHandle}` : 'this account'}? They will not be able to
                contact you or see your profile.
              </div>
              <button
                type="button"
                className={`${styles.item} ${styles.itemDestructive}`}
                onClick={() => void handleBlockConfirm()}
                disabled={loading === 'block'}
                role="menuitem"
              >
                {loading === 'block' ? 'Blocking…' : 'Yes, block account'}
              </button>
            </>
          ) : step === 'report' ? (
            <>
              <button
                type="button"
                className={styles.item}
                onClick={() => setStep('main')}
                role="menuitem"
              >
                ← Back
              </button>
              <div className={styles.reportReasonLabel}>Report to Bluesky</div>
              {REPORT_REASONS.map(({ label, reasonType }) => (
                <button
                  key={reasonType}
                  type="button"
                  className={styles.item}
                  onClick={() => void handleReportWithReason(reasonType)}
                  disabled={loading === 'report'}
                  role="menuitem"
                >
                  {loading === 'report' ? '…' : label}
                </button>
              ))}
            </>
          ) : step === 'leave' ? (
            <>
              <button
                type="button"
                className={styles.item}
                onClick={() => setStep('main')}
                role="menuitem"
              >
                ← Back
              </button>
              <div className={styles.confirmLabel}>
                {hasMessages
                  ? 'Are you sure you want to leave this conversation? Your messages will be deleted for you, but not for the other participant.'
                  : 'Are you sure you want to leave this conversation?'}
              </div>
              <button
                type="button"
                className={`${styles.item} ${styles.itemDestructive}`}
                onClick={() => void handleLeaveConfirm()}
                disabled={loading === 'leave'}
                role="menuitem"
              >
                {loading === 'leave' ? 'Leaving…' : 'Leave conversation'}
              </button>
            </>
          ) : (
            <>
              {profileHandle && (
                <button type="button" className={styles.item} onClick={handleGoToProfile} role="menuitem">
                  Go to profile
                </button>
              )}
              <button
                type="button"
                className={styles.item}
                onClick={() => void handleToggleMute()}
                disabled={loading === 'mute'}
                role="menuitem"
              >
                {loading === 'mute' ? '…' : isMuted ? 'Unmute conversation' : 'Mute conversation'}
              </button>
              <div className={styles.divider} aria-hidden />
              {authorBlockingUri ? (
                <button
                  type="button"
                  className={`${styles.item} ${styles.itemDestructive}`}
                  onClick={() => void handleUnblock()}
                  disabled={loading === 'unblock'}
                  role="menuitem"
                >
                  {loading === 'unblock' ? '…' : 'Unblock account'}
                </button>
              ) : (
                <button
                  type="button"
                  className={`${styles.item} ${styles.itemDestructive}`}
                  onClick={() => setStep('block')}
                  role="menuitem"
                >
                  Block account
                </button>
              )}
              {reportSubject && (
                <button
                  type="button"
                  className={`${styles.item} ${styles.itemDestructive}`}
                  onClick={() => setStep('report')}
                  role="menuitem"
                >
                  Report conversation
                </button>
              )}
              <div className={styles.divider} aria-hidden />
              <button
                type="button"
                className={`${styles.item} ${styles.itemDestructive}`}
                onClick={() => setStep('leave')}
                role="menuitem"
              >
                Leave conversation
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
