import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { getMobileSnapshot, subscribeMobile } from '../config/breakpoints'
import { usePinnedModalViewport } from '../hooks/usePinnedModalViewport'
import { useSession } from '../context/SessionContext'
import { useScrollLock } from '../context/ScrollLockContext'
import {
  acceptConvo,
  getConvoForMembers,
  getConvoMessages,
  getConvoPeer,
  isIncomingMessageRequest,
  leaveConvo,
  sendChatMessage,
  updateConvoRead,
  type ChatConvoView,
  type ChatMessageView,
} from '../lib/chat'
import { Avatar } from './Avatar'
import ChatActionsMenu from './ChatActionsMenu'
import ProfileLink from './ProfileLink'
import styles from './ChatModal.module.css'

interface ChatModalProps {
  memberDid: string
  memberHandle?: string
  initialConvoId?: string
  onClose: () => void
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

export default function ChatModal({
  memberDid,
  memberHandle,
  initialConvoId,
  onClose,
}: ChatModalProps) {
  const { session } = useSession()
  const scrollLock = useScrollLock()
  const myDid = session?.did
  const [convo, setConvo] = useState<ChatConvoView | null>(null)
  const [convoId, setConvoId] = useState<string | null>(initialConvoId ?? null)
  const [messages, setMessages] = useState<ChatMessageView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [requestLoading, setRequestLoading] = useState<'accept' | 'decline' | null>(null)
  const isMobile = useSyncExternalStore(subscribeMobile, getMobileSnapshot, () => false)
  const overlayRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { keyboardOpen } = usePinnedModalViewport(overlayRef, isMobile)
  const convoRef = useRef(convo)
  convoRef.current = convo
  const lastMessageIdRef = useRef<string | null>(null)

  const displayHandle = memberHandle ?? memberDid
  const peer = useMemo(
    () => (myDid && convo ? getConvoPeer(convo, myDid) : null),
    [convo, myDid]
  )
  const profileHandle = peer?.handle ?? (memberHandle && !memberHandle.startsWith('did:') ? memberHandle : null)
  const profileAvatar = peer?.avatar
  const profileLabel = profileHandle ?? displayHandle

  const headerProfile = (
    <>
      <Avatar
        src={profileAvatar}
        alt=""
        className={styles.headerAvatar}
        sizePx={32}
        fallback={
          <span className={styles.headerAvatarPlaceholder} aria-hidden>
            {profileLabel.replace(/^@/, '').slice(0, 1).toUpperCase()}
          </span>
        }
      />
      <span className={styles.headerHandle}>@{profileLabel.replace(/^@/, '')}</span>
    </>
  )

  const applyMessages = useCallback(
    async (
      activeConvoId: string,
      activeConvo: ChatConvoView,
      loaded: ChatMessageView[],
      force = false
    ) => {
      const sorted = [...loaded].sort(
        (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime()
      )
      const lastId = sorted[sorted.length - 1]?.id ?? null
      const hasNew = force || lastId !== lastMessageIdRef.current
      if (!hasNew) return
      lastMessageIdRef.current = lastId
      setMessages(sorted)
      if (isIncomingMessageRequest(activeConvo, myDid, sorted)) return
      const last = sorted[sorted.length - 1]
      if (last) {
        const updated = await updateConvoRead(activeConvoId, last.id)
        setConvo(updated)
      }
    },
    [myDid]
  )

  const loadThread = useCallback(async () => {
    setLoading(true)
    setError(null)
    lastMessageIdRef.current = null
    try {
      let activeConvoId = convoId
      let activeConvo = convo
      if (!activeConvoId || !activeConvo) {
        const resolved = await getConvoForMembers([memberDid])
        activeConvo = resolved
        activeConvoId = resolved.id
        setConvo(resolved)
        setConvoId(resolved.id)
      }
      const { messages: loaded } = await getConvoMessages(activeConvoId)
      await applyMessages(activeConvoId, activeConvo, loaded, true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load conversation')
    } finally {
      setLoading(false)
    }
  }, [convoId, convo, memberDid, applyMessages])

  const refreshMessages = useCallback(async () => {
    const activeConvoId = convoId
    const activeConvo = convoRef.current
    if (!activeConvoId || !activeConvo) return
    try {
      const { messages: loaded } = await getConvoMessages(activeConvoId)
      await applyMessages(activeConvoId, activeConvo, loaded)
    } catch {
      /* keep showing current thread on background refresh failure */
    }
  }, [convoId, applyMessages])

  useEffect(() => {
    void loadThread()
  }, [memberDid, initialConvoId])

  useEffect(() => {
    if (loading || !convoId) return
    const poll = () => void refreshMessages()
    const interval = setInterval(poll, 3000)
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') poll()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [convoId, loading, refreshMessages])

  useEffect(() => {
    scrollLock?.lockScroll()
    return () => scrollLock?.unlockScroll()
  }, [scrollLock])

  useEffect(() => {
    if (messages.length === 0) return
    const el = messagesRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages.length, messages[messages.length - 1]?.id])

  useEffect(() => {
    if (!loading && convoId && !isMobile) inputRef.current?.focus({ preventScroll: true })
  }, [loading, convoId, isMobile])

  async function handleAccept() {
    if (!convoId || requestLoading) return
    setRequestLoading('accept')
    setError(null)
    try {
      await acceptConvo(convoId)
      await loadThread()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept request')
    } finally {
      setRequestLoading(null)
    }
  }

  async function handleDecline() {
    if (!convoId || requestLoading) return
    setRequestLoading('decline')
    setError(null)
    try {
      await leaveConvo(convoId)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not decline request')
    } finally {
      setRequestLoading(null)
    }
  }

  async function handleSend(e?: React.FormEvent) {
    e?.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || !convoId || sending) return
    if (isIncomingMessageRequest(convo, myDid, messages)) return
    setSending(true)
    setError(null)
    setText('')
    inputRef.current?.focus({ preventScroll: true })
    try {
      const sent = await sendChatMessage(convoId, trimmed)
      lastMessageIdRef.current = sent.id
      setMessages((prev) => [...prev, sent])
      const updated = await updateConvoRead(convoId, sent.id)
      setConvo(updated)
    } catch (err) {
      setText(trimmed)
      setError(err instanceof Error ? err.message : 'Could not send message')
    } finally {
      setSending(false)
      inputRef.current?.focus({ preventScroll: true })
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const isIncomingRequest = convo ? isIncomingMessageRequest(convo, myDid, messages) : false
  const canSend = !isIncomingRequest && !!convoId

  const modal = (
    <div
      ref={overlayRef}
      className={`${styles.overlay}${keyboardOpen ? ` ${styles.overlayKeyboardOpen}` : ''}${isMobile ? ` ${styles.overlayPinned}` : ''}`}
      role="dialog"
      aria-label={`Chat with @${displayHandle}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div className={styles.backdrop} onClick={onClose} aria-hidden />
      <div className={styles.card} data-compose-sheet onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <div className={styles.headerSide}>
            <button type="button" className={styles.closeBtn} onClick={onClose}>
              Close
            </button>
          </div>
          <div className={styles.headerCenter}>
            {profileHandle ? (
              <ProfileLink
                handle={profileHandle}
                className={styles.headerProfileLink}
                title={`@${profileHandle}`}
                aria-label={`Open @${profileHandle}'s profile`}
              >
                {headerProfile}
              </ProfileLink>
            ) : (
              <div className={styles.headerProfileStatic}>{headerProfile}</div>
            )}
          </div>
          <div className={styles.headerSide}>
            <ChatActionsMenu
              convo={convo}
              convoId={convoId}
              peerDid={memberDid}
              profileHandle={profileHandle}
              messages={messages}
              hasMessages={messages.length > 0}
              onConvoChange={setConvo}
              onLeave={onClose}
            />
          </div>
        </header>

        {isIncomingRequest && (
          <div className={styles.requestBanner}>
            <p>Message request from @{displayHandle}</p>
            <div className={styles.requestActions}>
              <button
                type="button"
                className={styles.declineBtn}
                onClick={() => void handleDecline()}
                disabled={requestLoading !== null}
              >
                {requestLoading === 'decline' ? 'Declining…' : 'Decline'}
              </button>
              <button
                type="button"
                className={styles.acceptBtn}
                onClick={() => void handleAccept()}
                disabled={requestLoading !== null}
              >
                {requestLoading === 'accept' ? 'Accepting…' : 'Accept'}
              </button>
            </div>
          </div>
        )}

        <div ref={messagesRef} className={styles.messages}>
          {loading ? (
            <p className={styles.loading}>Loading…</p>
          ) : messages.length === 0 ? (
            <p className={styles.empty}>{isIncomingRequest ? 'Accept the request to reply.' : 'No messages yet. Say hi!'}</p>
          ) : (
            messages.map((msg) => {
              const isOwn = myDid ? msg.sender.did === myDid : false
              return (
                <div
                  key={msg.id}
                  className={`${styles.messageRow} ${isOwn ? styles.messageRowOwn : styles.messageRowOther}`}
                >
                  <div className={styles.messageBubble}>{msg.text}</div>
                  <span className={styles.messageTime}>{formatTime(msg.sentAt)}</span>
                </div>
              )
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <form className={styles.compose} onSubmit={(e) => void handleSend(e)}>
          <textarea
            ref={inputRef}
            className={styles.input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={canSend ? 'Write a message…' : 'Accept request to reply'}
            disabled={!canSend}
            rows={1}
            aria-label="Message text"
          />
          <button type="submit" className={styles.sendBtn} disabled={!canSend || sending || !text.trim()}>
            {sending ? '…' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  )

  if (isMobile) {
    return createPortal(
      <div className={styles.modalStackRoot}>
        <div className={styles.modalViewportScrim} aria-hidden />
        {modal}
      </div>,
      document.body
    )
  }

  return createPortal(modal, document.body)
}
