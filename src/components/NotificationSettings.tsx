import { usePushNotificationsContext, type NotificationType } from '../context/PushNotificationsContext'
import styles from './NotificationSettings.module.css'

const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  all: 'All Notifications',
  mention: 'Mentions',
  reply: 'Replies',
  like: 'Likes',
  follow: 'New Followers',
  repost: 'Reposts',
  quote: 'Quotes',
}

const NOTIFICATION_TYPE_ICONS: Record<NotificationType, string> = {
  all: '🔔',
  mention: '@',
  reply: '💬',
  like: '❤️',
  follow: '👤',
  repost: '🔄',
  quote: '❝',
}

export function NotificationSettings(): React.ReactElement {
  const {
    isSupported,
    isEnabled,
    isLoading,
    error,
    permission,
    enabledTypes,
    quietHoursEnabled,
    quietHoursStart,
    quietHoursEnd,
    enableNotifications,
    disableNotifications,
    toggleNotificationType,
    setQuietHours,
    dismissError,
  } = usePushNotificationsContext()

  // Handle main toggle
  const handleToggle = async () => {
    if (isEnabled) {
      await disableNotifications()
    } else {
      await enableNotifications()
    }
  }

  // Handle notification type toggle
  const handleTypeToggle = (type: NotificationType) => {
    toggleNotificationType(type)
  }

  // Handle quiet hours toggle
  const handleQuietHoursToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuietHours(e.target.checked)
  }

  // Handle time change
  const handleTimeChange = (field: 'start' | 'end', value: string) => {
    setQuietHours(
      quietHoursEnabled,
      field === 'start' ? value : quietHoursStart,
      field === 'end' ? value : quietHoursEnd
    )
  }

  // Permission denied state
  if (!isSupported) {
    return (
      <div className={styles.container}>
        <div className={styles.notSupported}>
          <div className={styles.notSupportedIcon}>🔕</div>
          <div className={styles.notSupportedText}>Push notifications not available</div>
          <div className={styles.notSupportedSubtext}>
            Your device or browser doesn't support push notifications
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      {/* Main Toggle */}
      <div className={styles.section}>
        <div className={styles.toggleRow}>
          <div className={styles.toggleLabel}>
            <span className={styles.toggleIcon}>🔔</span>
            <div className={styles.toggleText}>
              <span className={styles.toggleTitle}>Push Notifications</span>
              <span className={styles.toggleDescription}>
                {isEnabled
                  ? 'Receiving notifications on this device'
                  : permission === 'denied'
                    ? 'Permission denied - enable in browser settings'
                    : 'Get notified about activity on Bluesky'}
              </span>
            </div>
          </div>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              className={styles.toggleInput}
              checked={isEnabled}
              onChange={handleToggle}
              disabled={isLoading || permission === 'denied'}
            />
            <span className={styles.toggleSlider} />
          </label>
        </div>
      </div>

      {isLoading && (
        <div className={styles.loading}>
          <span className={styles.spinner} />
          {isEnabled ? 'Disabling...' : 'Enabling...'}
        </div>
      )}

      {/* Notification Types */}
      {isEnabled && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Notify me about</div>
          <div className={styles.checkboxGrid}>
            {(Object.keys(NOTIFICATION_TYPE_LABELS) as NotificationType[])
              .filter(type => type !== 'all')
              .map(type => (
                <label key={type} className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={enabledTypes.includes(type)}
                    onChange={() => handleTypeToggle(type)}
                  />
                  <span>
                    {NOTIFICATION_TYPE_ICONS[type]} {NOTIFICATION_TYPE_LABELS[type]}
                  </span>
                </label>
              ))}
          </div>
          <label className={styles.checkboxRow} style={{ marginTop: '0.5rem' }}>
            <input
              type="checkbox"
              checked={enabledTypes.length === 6}
              onChange={() => handleTypeToggle('all')}
            />
            <span>Select All</span>
          </label>
        </div>
      )}

      {/* Quiet Hours */}
      {isEnabled && (
        <div className={styles.section}>
          <div className={styles.toggleRow}>
            <div className={styles.toggleLabel}>
              <span className={styles.toggleIcon}>🌙</span>
              <div className={styles.toggleText}>
                <span className={styles.toggleTitle}>Quiet Hours</span>
                <span className={styles.toggleDescription}>
                  Pause notifications during these hours
                </span>
              </div>
            </div>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                className={styles.toggleInput}
                checked={quietHoursEnabled}
                onChange={handleQuietHoursToggle}
              />
              <span className={styles.toggleSlider} />
            </label>
          </div>

          {quietHoursEnabled && (
            <div className={styles.quietHoursGrid}>
              <div className={styles.timeInput}>
                <label>Start</label>
                <input
                  type="time"
                  value={quietHoursStart}
                  onChange={(e) => handleTimeChange('start', e.target.value)}
                />
              </div>
              <div className={styles.timeInput}>
                <label>End</label>
                <input
                  type="time"
                  value={quietHoursEnd}
                  onChange={(e) => handleTimeChange('end', e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className={styles.error}>
          <span>⚠️</span>
          <span>{error}</span>
          <button onClick={dismissError} className={styles.errorDismiss}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
