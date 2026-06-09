import { memo } from 'react'
import type { ChatConvoView } from '../lib/chat'
import { getConvoPeer, isIncomingMessageRequest } from '../lib/chat'
import { resizedAvatarUrl } from '../lib/imageUtils'
import styles from './Layout.module.css'

export type MessagesFilter = 'all' | 'requests'

interface LayoutMessagesPanelProps {
  messagesFilter: MessagesFilter
  onFilterChange: (filter: MessagesFilter) => void
  convosLoading: boolean
  convos: ChatConvoView[]
  currentAccountDid?: string
  onClose: () => void
  onSelectConvo: (convo: ChatConvoView) => void
}

function formatMessagePreview(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= 80) return trimmed
  return `${trimmed.slice(0, 80)}…`
}

const LayoutMessagesPanel = memo(function LayoutMessagesPanel({
  messagesFilter,
  onFilterChange,
  convosLoading,
  convos,
  currentAccountDid,
  onClose,
  onSelectConvo,
}: LayoutMessagesPanelProps) {
  const filtered =
    messagesFilter === 'requests'
      ? convos.filter((c) => isIncomingMessageRequest(c, currentAccountDid))
      : convos.filter((c) => !isIncomingMessageRequest(c, currentAccountDid))

  return (
    <>
      <h2 className={styles.menuTitle}>Messages</h2>
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
  )
})

export default LayoutMessagesPanel
