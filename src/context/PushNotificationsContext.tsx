import React, { createContext, useContext, useCallback, useEffect } from 'react'
import {
  usePushNotifications,
  type NotificationPreferences,
  type NotificationType,
} from '../hooks/usePushNotifications'

export type { NotificationType } from '../hooks/usePushNotifications'

interface PushNotificationsContextValue {
  // State
  isSupported: boolean
  isEnabled: boolean
  isLoading: boolean
  error: string | null
  permission: NotificationPermission
  enabledTypes: NotificationType[]
  quietHoursEnabled: boolean
  quietHoursStart: string
  quietHoursEnd: string
  unreadCount: number
  lastCheckedAt: Date | null
  pollInterval: number

  // Actions
  enableNotifications: () => Promise<void>
  disableNotifications: () => void
  toggleNotificationType: (type: NotificationType) => void
  setQuietHours: (enabled: boolean, start?: string, end?: string) => void
  setPollInterval: (minutes: number) => void
  checkNow: () => Promise<void>
  dismissError: () => void
}

const PushNotificationsContext = createContext<PushNotificationsContextValue | null>(null)

export function usePushNotificationsContext(): PushNotificationsContextValue {
  const context = useContext(PushNotificationsContext)
  if (!context) {
    throw new Error('usePushNotificationsContext must be used within PushNotificationsProvider')
  }
  return context
}

interface PushNotificationsProviderProps {
  children: React.ReactNode
}

export function PushNotificationsProvider({ children }: PushNotificationsProviderProps): React.ReactElement {
  const push = usePushNotifications()

  // Computed state
  const isEnabled = push.preferences.enabled && push.permission === 'granted'
  const enabledTypes = push.preferences.types
  const quietHoursEnabled = push.preferences.quietHours.enabled
  const quietHoursStart = push.preferences.quietHours.start
  const quietHoursEnd = push.preferences.quietHours.end

  /**
   * Enable notifications
   */
  const enableNotifications = useCallback(async (): Promise<void> => {
    if (!push.isSupported) {
      return
    }

    await push.enableNotifications()
  }, [push])

  /**
   * Disable notifications
   */
  const disableNotifications = useCallback((): void => {
    push.disableNotifications()
  }, [push])

  /**
   * Toggle a notification type
   */
  const toggleNotificationType = useCallback((type: NotificationType): void => {
    const currentTypes = push.preferences.types
    let newTypes: NotificationType[]

    if (type === 'all') {
      // Toggle all types
      const allTypes: NotificationType[] = ['mention', 'reply', 'like', 'follow', 'repost', 'quote']
      const hasAllTypes = allTypes.every(t => currentTypes.includes(t))
      newTypes = hasAllTypes ? [] : allTypes
    } else {
      // Toggle specific type
      newTypes = currentTypes.includes(type)
        ? currentTypes.filter(t => t !== type)
        : [...currentTypes, type]
    }

    push.updatePreferences({ types: newTypes })
  }, [push])

  /**
   * Set quiet hours
   */
  const setQuietHours = useCallback((enabled: boolean, start?: string, end?: string): void => {
    push.updatePreferences({
      quietHours: {
        enabled,
        start: start ?? push.preferences.quietHours.start,
        end: end ?? push.preferences.quietHours.end,
      },
    })
  }, [push])

  /**
   * Set polling interval
   */
  const setPollInterval = useCallback((minutes: number): void => {
    push.updatePreferences({ pollInterval: minutes })
  }, [push])

  // Check if we should be in quiet hours
  useEffect(() => {
    if (!push.preferences.enabled || !push.preferences.quietHours.enabled) {
      return
    }

    // Check every minute if we enter/exit quiet hours
    const interval = setInterval(() => {
      const now = new Date()
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

      const { start, end } = push.preferences.quietHours
      // Check if currently in quiet hours
      void isTimeInRange(currentTime, start, end)

      // Could update a "isInQuietHours" state here if needed
      // This is useful for UI indicators
    }, 60000)

    return () => clearInterval(interval)
  }, [push.preferences.enabled, push.preferences.quietHours])

  const value: PushNotificationsContextValue = {
    isSupported: push.isSupported,
    isEnabled,
    isLoading: push.isLoading,
    error: push.error,
    permission: push.permission,
    enabledTypes,
    quietHoursEnabled,
    quietHoursStart,
    quietHoursEnd,
    unreadCount: push.unreadCount,
    lastCheckedAt: push.lastCheckedAt,
    pollInterval: push.preferences.pollInterval,
    enableNotifications,
    disableNotifications,
    toggleNotificationType,
    setQuietHours,
    setPollInterval,
    checkNow: push.checkNow,
    dismissError: push.dismissError,
  }

  return (
    <PushNotificationsContext.Provider value={value}>
      {children}
    </PushNotificationsContext.Provider>
  )
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

/**
 * Helper to check if a notification should be suppressed due to quiet hours
 */
export function isInQuietHours(preferences: NotificationPreferences): boolean {
  if (!preferences.enabled || !preferences.quietHours.enabled) {
    return false
  }

  const now = new Date()
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  const { start, end } = preferences.quietHours
  return isTimeInRange(currentTime, start, end)
}
