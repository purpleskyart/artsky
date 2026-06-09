import { memo, useCallback, useEffect, useState } from 'react'
import type { ChatAllowIncoming, ChatConvoView } from '../lib/chat'
import { getChatAllowIncoming, getConvoPeer, isIncomingMessageRequest, setChatAllowIncoming } from '../lib/chat'
import { resizedAvatarUrl } from '../lib/imageUtils'
import { useToast } from '../context/ToastContext'
import MessagesNewChatPanel from './MessagesNewChatPanel'
import styles from './Layout.module.css'

export type MessagesFilter = 'all' | 'requests'

type MessagesPanelView = 'list' | 'settings' | 'newChat'

const ALLOW_INCOMING_OPTIONS: { value: ChatAllowIncoming; label: string; description: string }[] = [
  { value: 'all', label: 'Everyone', description: 'Anyone on Bluesky can message you' },
  { value: 'following', label: 'Users I follow', description: 'Only people you follow can message you' },
  { value: 'none', label: 'No one', description: 'Nobody can start a new conversation with you' },
]

interface LayoutMessagesPanelProps {
  messagesFilter: MessagesFilter
  onFilterChange: (filter: MessagesFilter) => void
  convosLoading: boolean
  convos: ChatConvoView[]
  currentAccountDid?: string
  onClose: () => void
  onSelectConvo: (convo: ChatConvoView) => void
  onStartChat: (memberDid: string, memberHandle: string) => void
}

function formatMessagePreview(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= 80) return trimmed
  return `${trimmed.slice(0, 80)}…`
}

function MessagesSettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function MessagesNewChatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M12 7v6M9 10h6" />
    </svg>
  )
}

function MessagesBackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}

const LayoutMessagesPanel = memo(function LayoutMessagesPanel({
  messagesFilter,
  onFilterChange,
  convosLoading,
  convos,
  currentAccountDid,
  onClose,
  onSelectConvo,
  onStartChat,
}: LayoutMessagesPanelProps) {
  const toast = useToast()
  const [view, setView] = useState<MessagesPanelView>('list')
  const [allowIncoming, setAllowIncoming] = useState<ChatAllowIncoming>('following')
  const [allowIncomingLoading, setAllowIncomingLoading] = useState(false)
  const [allowIncomingSaving, setAllowIncomingSaving] = useState(false)

  useEffect(() => {
    setAllowIncomingLoading(true)
    getChatAllowIncoming()
      .then(setAllowIncoming)
      .catch(() => setAllowIncoming('following'))
      .finally(() => setAllowIncomingLoading(false))
  }, [])

  const handleAllowIncomingChange = useCallback(
    async (next: ChatAllowIncoming) => {
      if (next === allowIncoming || allowIncomingSaving) return
      const previous = allowIncoming
      setAllowIncoming(next)
      setAllowIncomingSaving(true)
      try {
        await setChatAllowIncoming(next)
      } catch {
        setAllowIncoming(previous)
        toast?.showToast('Could not update message settings. Please try again.')
      } finally {
        setAllowIncomingSaving(false)
      }
    },
    [allowIncoming, allowIncomingSaving, toast]
  )

  const handleStartChat = useCallback(
    (memberDid: string, memberHandle: string) => {
      onClose()
      onStartChat(memberDid, memberHandle)
    },
    [onClose, onStartChat]
  )

  const filtered =
    messagesFilter === 'requests'
      ? convos.filter((c) => isIncomingMessageRequest(c, currentAccountDid))
      : convos.filter((c) => !isIncomingMessageRequest(c, currentAccountDid))

  const title =
    view === 'settings' ? 'Message settings' : view === 'newChat' ? 'New chat' : 'Messages'

  return (
    <>
      <div className={styles.messagesMenuHeader}>
        <h2 className={styles.menuTitle}>{title}</h2>
        <div className={styles.messagesMenuHeaderActions}>
          {view === 'list' && (
            <>
              <button
                type="button"
                className={styles.messagesMenuSettingsBtn}
                onClick={() => setView('newChat')}
                aria-label="New chat"
                title="New chat"
              >
                <MessagesNewChatIcon />
              </button>
              <button
                type="button"
                className={styles.messagesMenuSettingsBtn}
                onClick={() => setView('settings')}
                aria-label="Message settings"
                title="Message settings"
              >
                <MessagesSettingsIcon />
              </button>
            </>
          )}
          {view !== 'list' && (
            <button
              type="button"
              className={styles.messagesMenuSettingsBtn}
              onClick={() => setView('list')}
              aria-label="Back to messages"
              title="Back to messages"
            >
              <MessagesBackIcon />
            </button>
          )}
        </div>
      </div>

      {view === 'settings' ? (
        <div className={styles.messagesSettingsPanel}>
          <p className={styles.messagesSettingsIntro}>Who can send you new messages?</p>
          {allowIncomingLoading ? (
            <p className={styles.notificationsLoading}>Loading…</p>
          ) : (
            <ul className={styles.messagesSettingsList}>
              {ALLOW_INCOMING_OPTIONS.map((option) => {
                const active = allowIncoming === option.value
                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      className={active ? styles.messagesSettingsOptionActive : styles.messagesSettingsOption}
                      onClick={() => handleAllowIncomingChange(option.value)}
                      disabled={allowIncomingSaving}
                      aria-pressed={active}
                    >
                      <span className={styles.messagesSettingsOptionLabel}>{option.label}</span>
                      <span className={styles.messagesSettingsOptionDesc}>{option.description}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : view === 'newChat' ? (
        <MessagesNewChatPanel currentAccountDid={currentAccountDid} onSelectUser={handleStartChat} />
      ) : (
        <>
          <div className={styles.notificationFilters}>
            <button
              type="button"
              className={messagesFilter === 'all' ? styles.notificationFilterActive : styles.notificationFilter}
              onClick={() => onFilterChange('all')}
            >
              All
            </button>
            <button
              type="button"
              className={messagesFilter === 'requests' ? styles.notificationFilterActive : styles.notificationFilter}
              onClick={() => onFilterChange('requests')}
            >
              Requests
            </button>
          </div>
          {convosLoading ? (
            <p className={styles.notificationsLoading}>Loading…</p>
          ) : filtered.length === 0 ? (
            <p className={styles.notificationsEmpty}>
              {messagesFilter === 'all' ? 'No messages yet.' : 'No message requests.'}
            </p>
          ) : (
            <ul className={styles.notificationsList} data-messages-list>
              {filtered.map((convo) => {
                const peer = currentAccountDid ? getConvoPeer(convo, currentAccountDid) : convo.members[0]
                const handle = peer?.handle ?? peer?.did ?? 'Unknown'
                const lastMsg = convo.lastMessage
                const preview =
                  lastMsg && 'text' in lastMsg && typeof lastMsg.text === 'string'
                    ? formatMessagePreview(lastMsg.text)
                    : convo.status === 'request'
                      ? 'Message request'
                      : 'No messages yet'
                const unread = (convo.unreadCount ?? 0) > 0
                return (
                  <li key={convo.id}>
                    <button
                      type="button"
                      className={`${styles.notificationItem} ${styles.messageItemBtn}${unread ? ` ${styles.messageItemUnread}` : ''}`}
                      onClick={() => {
                        onClose()
                        onSelectConvo(convo)
                      }}
                    >
                      {peer?.avatar ? (
                        <img
                          src={resizedAvatarUrl(peer.avatar, 36)}
                          alt=""
                          className={styles.notificationAvatar}
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <span className={styles.notificationAvatarPlaceholder} aria-hidden>
                          {handle.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <span className={styles.notificationTextWrap}>
                        <span className={styles.messageItemHeader}>
                          <strong>@{handle}</strong>
                          {unread && <span className={styles.messageUnreadBadge}>{convo.unreadCount}</span>}
                        </span>
                        <span className={styles.notificationReplyPreview}>{preview}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </>
  )
})

export default LayoutMessagesPanel
