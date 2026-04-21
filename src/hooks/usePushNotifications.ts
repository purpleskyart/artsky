import { useState, useEffect, useCallback, useRef } from 'react'
import { getUnreadNotificationCount, getNotifications } from '../lib/bsky'

export type NotificationType = 'mention' | 'reply' | 'like' | 'follow' | 'repost' | 'quote' | 'all'

export interface NotificationPreferences {
  enabled: boolean
  types: NotificationType[]
  quietHours: {
    enabled: boolean
    start: string // 24h format "22:00"
    end: string   // 24h format "08:00"
  }
  // Polling interval in minutes (minimum 1)
  pollInterval: number
}

interface UsePushNotificationsReturn {
  // State
  isSupported: boolean
  permission: NotificationPermission
  preferences: NotificationPreferences
  isLoading: boolean
  error: string | null
  unreadCount: number
  lastCheckedAt: Date | null

  // Actions
  requestPermission: () => Promise<boolean>
  enableNotifications: () => Promise<void>
  disableNotifications: () => void
  updatePreferences: (prefs: Partial<NotificationPreferences>) => void
  dismissError: () => void
  checkNow: () => Promise<void>
}

// Storage keys
const STORAGE_KEY = 'artsky-push-prefs'
const LAST_NOTIFICATION_KEY = 'artsky-last-notification-time'

// Default preferences
const defaultPreferences: NotificationPreferences = {
  enabled: false,
  types: ['mention', 'reply', 'like', 'follow', 'repost', 'quote'],
  quietHours: {
    enabled: false,
    start: '22:00',
    end: '08:00',
  },
  pollInterval: 2, // Check every 2 minutes
}

// Minimum poll interval in ms (1 minute)
const MIN_POLL_INTERVAL = 60_000
// Maximum poll interval in ms (10 minutes)
const MAX_POLL_INTERVAL = 600_000

export function usePushNotifications(): UsePushNotificationsReturn {
  // Feature detection
  const isSupported = typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window

  // State
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [preferences, setPreferences] = useState<NotificationPreferences>(defaultPreferences)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null)

  // Refs
  const isInitializing = useRef(false)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastNotificationTimeRef = useRef<string | null>(null)

  // Load saved preferences on mount
  useEffect(() => {
    if (!isSupported) return

    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as NotificationPreferences
        setPreferences(prev => ({ ...prev, ...parsed }))
      }
      const lastNotif = localStorage.getItem(LAST_NOTIFICATION_KEY)
      if (lastNotif) {
        lastNotificationTimeRef.current = lastNotif
      }
    } catch {
      // Ignore parse errors
    }
    
    // Check initial permission
    setPermission(Notification.permission)
    
    isInitializing.current = true
  }, [isSupported])

  // Save preferences when they change
  useEffect(() => {
    if (!isSupported) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  }, [preferences, isSupported])

  // Save last notification time when it changes
  useEffect(() => {
    if (lastNotificationTimeRef.current) {
      localStorage.setItem(LAST_NOTIFICATION_KEY, lastNotificationTimeRef.current)
    }
  }, [lastCheckedAt])

  // Poll for notifications when enabled
  useEffect(() => {
    if (!isSupported || !preferences.enabled || permission !== 'granted') {
      // Clear any existing interval
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
      return
    }

    // Check immediately when enabled
    void checkForNotifications()

    // Set up polling interval
    const intervalMs = Math.min(
      Math.max(preferences.pollInterval * 60_000, MIN_POLL_INTERVAL),
      MAX_POLL_INTERVAL
    )
    
    pollIntervalRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void checkForNotifications()
      }
    }, intervalMs)

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
  }, [isSupported, preferences.enabled, preferences.pollInterval, permission])

  // Listen for permission changes
  useEffect(() => {
    if (!isSupported) return

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setPermission(Notification.permission)
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [isSupported])

  /**
   * Request notification permission
   */
  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      setError('Notifications are not supported on this device')
      return false
    }

    setIsLoading(true)
    setError(null)

    try {
      const result = await Notification.requestPermission()
      setPermission(result)
      return result === 'granted'
    } catch (err) {
      setError('Failed to request notification permission')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [isSupported])

  /**
   * Check for new notifications and show local notifications
   */
  const checkForNotifications = useCallback(async (): Promise<void> => {
    if (!isSupported || permission !== 'granted') return

    try {
      // Get unread count first (lightweight)
      const count = await getUnreadNotificationCount()
      setUnreadCount(count)
      setLastCheckedAt(new Date())

      if (count === 0) return

      // Get recent notifications to check for new ones
      const { notifications } = await getNotifications(10)
      
      const lastSeenTime = lastNotificationTimeRef.current
      const newNotifications = lastSeenTime 
        ? notifications.filter(n => new Date(n.indexedAt) > new Date(lastSeenTime))
        : notifications.slice(0, 3) // Show up to 3 on first enable

      if (newNotifications.length > 0) {
        // Update last seen time
        const latestTime = notifications[0]?.indexedAt
        if (latestTime) {
          lastNotificationTimeRef.current = latestTime
        }

        // Show notifications for enabled types
        for (const notification of newNotifications) {
          if (!preferences.types.includes(notification.reason as NotificationType) && 
              !preferences.types.includes('all')) {
            continue
          }

          // Check quiet hours
          if (isInQuietHours(preferences)) continue

          // Show the notification
          showLocalNotification(notification)
        }
      }
    } catch (err) {
      console.error('[Notifications] Check error:', err)
    }
  }, [isSupported, permission, preferences])

  /**
   * Enable notifications (start polling)
   */
  const enableNotifications = useCallback(async (): Promise<void> => {
    if (!isSupported) {
      setError('Notifications are not supported on this device')
      return
    }

    if (permission !== 'granted') {
      const granted = await requestPermission()
      if (!granted) {
        setError('Notification permission denied')
        return
      }
    }

    setIsLoading(true)
    setError(null)

    try {
      setPreferences(prev => ({ ...prev, enabled: true }))
      // Initial check
      await checkForNotifications()
    } catch (err) {
      console.error('[Notifications] Enable error:', err)
      setError(err instanceof Error ? err.message : 'Failed to enable notifications')
    } finally {
      setIsLoading(false)
    }
  }, [isSupported, permission, requestPermission, checkForNotifications])

  /**
   * Disable notifications (stop polling)
   */
  const disableNotifications = useCallback((): void => {
    setPreferences(prev => ({ ...prev, enabled: false }))
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }, [])

  /**
   * Update notification preferences
   */
  const updatePreferences = useCallback((prefs: Partial<NotificationPreferences>): void => {
    setPreferences(prev => {
      const updated = { ...prev, ...prefs }
      // Clamp poll interval
      if (updated.pollInterval !== undefined) {
        updated.pollInterval = Math.max(1, Math.min(10, updated.pollInterval))
      }
      return updated
    })
  }, [])

  /**
   * Dismiss error message
   */
  const dismissError = useCallback((): void => {
    setError(null)
  }, [])

  return {
    isSupported,
    permission,
    preferences,
    isLoading,
    error,
    unreadCount,
    lastCheckedAt,
    requestPermission,
    enableNotifications,
    disableNotifications,
    updatePreferences,
    dismissError,
    checkNow: checkForNotifications,
  }
}

// ============================================================================
// Helpers
// ============================================================================

interface NotificationData {
  uri: string
  author: { handle?: string; did: string; avatar?: string; displayName?: string }
  reason: string
  reasonSubject?: string
  isRead: boolean
  indexedAt: string
  replyPreview?: string
}

/**
 * Show a local notification for a Bluesky notification
 */
function showLocalNotification(notification: NotificationData): void {
  const reasonText: Record<string, string> = {
    mention: 'mentioned you',
    reply: 'replied to you',
    like: 'liked your post',
    follow: 'followed you',
    repost: 'reposted your post',
    quote: 'quoted your post',
  }

  const title = notification.author.displayName || notification.author.handle || 'Bluesky'
  const body = reasonText[notification.reason] || `interacted with you`
  const extraText = notification.replyPreview ? `: "${notification.replyPreview}"` : ''

  try {
    // Use service worker to show notification if available
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SHOW_NOTIFICATION',
        title,
        body: body + extraText,
        icon: notification.author.avatar || '/icon-192.png',
        data: {
          url: notification.reason === 'follow' 
            ? `/profile/${notification.author.did}`
            : notification.uri ? `/post/${notification.uri.split('/').pop()}`
            : '/',
          type: notification.reason,
        }
      })
    } else {
      // Fallback to direct notification
      // eslint-disable-next-line no-new
      new Notification(title, {
        body: body + extraText,
        icon: notification.author.avatar || '/icon-192.png',
        tag: notification.uri,
      })
    }
  } catch (err) {
    console.error('[Notifications] Failed to show notification:', err)
  }
}

/**
 * Check if currently in quiet hours
 */
function isInQuietHours(preferences: NotificationPreferences): boolean {
  if (!preferences.enabled || !preferences.quietHours.enabled) {
    return false
  }

  const now = new Date()
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const { start, end } = preferences.quietHours

  return isTimeInRange(currentTime, start, end)
}

/**
 * Check if a time falls within a range (handles overnight ranges)
 */
function isTimeInRange(time: string, start: string, end: string): boolean {
  const [timeH, timeM] = time.split(':').map(Number)
  const [startH, startM] = start.split(':').map(Number)
  const [endH, endM] = end.split(':').map(Number)

  const timeMinutes = timeH * 60 + timeM
  const startMinutes = startH * 60 + startM
  const endMinutes = endH * 60 + endM

  if (startMinutes <= endMinutes) {
    // Normal range (e.g., 08:00 to 22:00)
    return timeMinutes >= startMinutes && timeMinutes <= endMinutes
  } else {
    // Overnight range (e.g., 22:00 to 08:00)
    return timeMinutes >= startMinutes || timeMinutes <= endMinutes
  }
}
