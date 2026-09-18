import { memo } from 'react'
import { Link } from 'react-router-dom'
import { getPostAppPath, parseBskyFeedPostUri } from '../lib/appUrl'
import { resizedAvatarUrl } from '../lib/imageUtils'
import styles from './Layout.module.css'

export type NotificationFilter = 'all' | 'reply' | 'follow'

export interface LayoutNotification {
  uri: string
  indexedAt: string
  reason: string
  reasonSubject?: string
  replyPreview?: string
  author: {
    did: string
    handle?: string
    avatar?: string
  }
}

interface LayoutNotificationsPanelProps {
  notificationFilter: NotificationFilter
  onFilterChange: (filter: NotificationFilter) => void
  notificationsLoading: boolean
  notifications: LayoutNotification[]
  isDesktop: boolean
  currentAccountDid?: string
  accountProfiles: Record<string, { handle?: string } | undefined>
  onClose: () => void
  openProfileModal: (handle: string) => void
  openPostModal: (uri: string, openReply?: boolean, focusUri?: string, authorHandle?: string) => void
}

const LayoutNotificationsPanel = memo(function LayoutNotificationsPanel({
  notificationFilter,
  onFilterChange,
  notificationsLoading,
  notifications,
  isDesktop,
  currentAccountDid,
  accountProfiles,
  onClose,
  openProfileModal,
  openPostModal,
}: LayoutNotificationsPanelProps) {
  const filtered =
    notificationFilter === 'all'
      ? notifications
      : notifications.filter((n) => n.reason === notificationFilter)

  return (
    <>
      <h2 className={styles.menuTitle}>Notifications</h2>
      <div className={styles.notificationFilters}>
        <button
          type="button"
          className={notificationFilter === 'all' ? styles.notificationFilterActive : styles.notificationFilter}
          onClick={() => onFilterChange('all')}
        >
          All
        </button>
        <button
          type="button"
          className={notificationFilter === 'reply' ? styles.notificationFilterActive : styles.notificationFilter}
          onClick={() => onFilterChange('reply')}
        >
          Replies
        </button>
        <button
          type="button"
          className={notificationFilter === 'follow' ? styles.notificationFilterActive : styles.notificationFilter}
          onClick={() => onFilterChange('follow')}
        >
          Follows
        </button>
      </div>
      {notificationsLoading ? (
        <p className={styles.notificationsLoading}>Loading…</p>
      ) : filtered.length === 0 ? (
        <p className={styles.notificationsEmpty}>
          {notificationFilter === 'all' ? 'No notifications yet.' : 'No matching notifications.'}
        </p>
      ) : (
        <ul className={styles.notificationsList} data-notifications-list>
          {filtered.map((n) => {
            const handle = n.author.handle ?? n.author.did
            const isFollow = n.reason === 'follow'
            const isReplyOrLike = n.reason === 'reply' || n.reason === 'like'
            const postUriForLink = n.reasonSubject ?? n.uri
            const parsedPost = parseBskyFeedPostUri(postUriForLink)
            let postAuthorHandle: string | undefined
            if (parsedPost && currentAccountDid && parsedPost.did === currentAccountDid) {
              postAuthorHandle = accountProfiles[currentAccountDid]?.handle
            } else if (parsedPost && n.author.did === parsedPost.did) {
              postAuthorHandle = n.author.handle
            }
            const href = isFollow
              ? `/profile/${encodeURIComponent(handle)}`
              : getPostAppPath(postUriForLink, postAuthorHandle)
            const reasonLabel =
              n.reason === 'like' ? 'liked your post' :
              n.reason === 'repost' ? 'reposted your post' :
              n.reason === 'follow' ? 'followed you' :
              n.reason === 'mention' ? 'mentioned you' :
              n.reason === 'reply' ? 'replied to you' :
              n.reason === 'quote' ? 'quoted your post' :
              n.reason
            const useModalOnClick =
              !isDesktop &&
              (isFollow || isReplyOrLike || n.reason === 'repost' || n.reason === 'mention' || n.reason === 'quote')
            return (
              <li key={n.uri} data-indexed-at={n.indexedAt}>
                <Link
                  to={href}
                  className={styles.notificationItem}
                  onClick={(e) => {
                    onClose()
                    if (useModalOnClick) {
                      e.preventDefault()
                      if (isFollow) {
                        openProfileModal(handle)
                      } else if (isReplyOrLike) {
                        openPostModal(n.uri, undefined, n.uri, n.author?.handle)
                      } else {
                        openPostModal(n.reasonSubject ?? n.uri, undefined, undefined, postAuthorHandle)
                      }
                    } else if (isFollow) {
                      e.preventDefault()
                      openProfileModal(handle)
                    }
                  }}
                >
                  {n.author.avatar ? (
                    <img
                      src={resizedAvatarUrl(n.author.avatar, 36)}
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
                    <span className={styles.notificationText}>
                      <strong>@{handle}</strong> {reasonLabel}
                    </span>
                    {n.replyPreview && (
                      <span className={styles.notificationReplyPreview}>{n.replyPreview}</span>
                    )}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
})

export default LayoutNotificationsPanel
