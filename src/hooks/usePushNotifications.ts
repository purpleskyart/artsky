import { useState, useEffect, useCallback, useRef } from 'react'

// VAPID public key from your backend
// This should be replaced with your actual VAPID public key
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || ''

export type NotificationType = 'mention' | 'reply' | 'like' | 'follow' | 'repost' | 'quote' | 'all'

export interface PushSubscriptionData {
  endpoint: string
  expirationTime: number | null
  keys: {
    p256dh: string
    auth: string
  }
}

export interface NotificationPreferences {
  enabled: boolean
  types: NotificationType[]
  quietHours: {
    enabled: boolean
    start: string // 24h format "22:00"
    end: string   // 24h format "08:00"
  }
}

interface UsePushNotificationsReturn {
  // State
  isSupported: boolean
  permission: NotificationPermission
  subscription: PushSubscription | null
  preferences: NotificationPreferences
  isLoading: boolean
  error: string | null

  // Actions
  requestPermission: () => Promise<boolean>
  subscribe: () => Promise<void>
  unsubscribe: () => Promise<void>
  updatePreferences: (prefs: Partial<NotificationPreferences>) => void
  dismissError: () => void
}

// Storage keys
const STORAGE_KEY = 'artsky-push-prefs'

// Default preferences
const defaultPreferences: NotificationPreferences = {
  enabled: false,
  types: ['mention', 'reply'],
  quietHours: {
    enabled: false,
    start: '22:00',
    end: '08:00',
  },
}

export function usePushNotifications(): UsePushNotificationsReturn {
  // Feature detection
  const isSupported = typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window

  // State
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [subscription, setSubscription] = useState<PushSubscription | null>(null)
  const [preferences, setPreferences] = useState<NotificationPreferences>(defaultPreferences)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Refs to prevent duplicate operations
  const isInitializing = useRef(false)
  const serviceWorkerRef = useRef<ServiceWorkerRegistration | null>(null)

  // Load saved preferences on mount
  useEffect(() => {
    if (!isSupported) return

    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as NotificationPreferences
        setPreferences(prev => ({ ...prev, ...parsed }))
      }
    } catch {
      // Ignore parse errors
    }
  }, [isSupported])

  // Save preferences when they change
  useEffect(() => {
    if (!isSupported) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  }, [preferences, isSupported])

  // Initialize: check permission and existing subscription
  useEffect(() => {
    if (!isSupported || isInitializing.current) return

    isInitializing.current = true

    const init = async () => {
      try {
        // Check notification permission
        setPermission(Notification.permission)

        // Wait for service worker to be ready
        const registration = await navigator.serviceWorker.ready
        serviceWorkerRef.current = registration

        // Check for existing push subscription
        const existingSub = await registration.pushManager.getSubscription()
        setSubscription(existingSub)

        // If we have a subscription but permissions changed, clean up
        if (existingSub && Notification.permission !== 'granted') {
          await existingSub.unsubscribe()
          setSubscription(null)
        }
      } catch (err) {
        console.error('[Push] Initialization error:', err)
      }
    }

    void init()

    // Listen for permission changes
    const handlePermissionChange = () => {
      setPermission(Notification.permission)
      if (Notification.permission !== 'granted' && subscription) {
        setSubscription(null)
      }
    }

    // Unfortunately there's no standard event for permission changes
    // We poll periodically when the tab becomes visible
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handlePermissionChange()
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [isSupported, subscription])

  /**
   * Request notification permission
   */
  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      setError('Push notifications are not supported on this device')
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
   * Subscribe to push notifications
   */
  const subscribe = useCallback(async (): Promise<void> => {
    if (!isSupported || !serviceWorkerRef.current) {
      setError('Push notifications not available')
      return
    }

    if (!VAPID_PUBLIC_KEY) {
      setError('VAPID key not configured')
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
      // Unsubscribe first if already subscribed
      const existingSub = await serviceWorkerRef.current.pushManager.getSubscription()
      if (existingSub) {
        await existingSub.unsubscribe()
      }

      // Subscribe with VAPID key
      const newSubscription = await serviceWorkerRef.current.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as ArrayBuffer,
      })

      // Convert to JSON-serializable format
      const subData = newSubscription.toJSON() as PushSubscriptionData

      // Send to your backend
      const success = await sendSubscriptionToBackend(subData, 'subscribe')

      if (success) {
        setSubscription(newSubscription)
        setPreferences(prev => ({ ...prev, enabled: true }))
      } else {
        // Clean up if backend registration failed
        await newSubscription.unsubscribe()
        throw new Error('Failed to register with server')
      }
    } catch (err) {
      console.error('[Push] Subscribe error:', err)
      setError(err instanceof Error ? err.message : 'Failed to subscribe to notifications')
    } finally {
      setIsLoading(false)
    }
  }, [isSupported, permission, requestPermission])

  /**
   * Unsubscribe from push notifications
   */
  const unsubscribe = useCallback(async (): Promise<void> => {
    if (!subscription) return

    setIsLoading(true)
    setError(null)

    try {
      // Notify backend to remove subscription
      const subData = subscription.toJSON() as PushSubscriptionData
      await sendSubscriptionToBackend(subData, 'unsubscribe')

      // Unsubscribe from push manager
      const success = await subscription.unsubscribe()

      if (success) {
        setSubscription(null)
        setPreferences(prev => ({ ...prev, enabled: false }))
      } else {
        throw new Error('Unsubscribe failed')
      }
    } catch (err) {
      console.error('[Push] Unsubscribe error:', err)
      setError(err instanceof Error ? err.message : 'Failed to unsubscribe')
    } finally {
      setIsLoading(false)
    }
  }, [subscription])

  /**
   * Update notification preferences
   */
  const updatePreferences = useCallback((prefs: Partial<NotificationPreferences>): void => {
    setPreferences(prev => {
      const updated = { ...prev, ...prefs }

      // Send preference update to backend if enabled
      if (updated.enabled && subscription) {
        void sendPreferencesToBackend(updated)
      }

      return updated
    })
  }, [subscription])

  /**
   * Dismiss error message
   */
  const dismissError = useCallback((): void => {
    setError(null)
  }, [])

  return {
    isSupported,
    permission,
    subscription,
    preferences,
    isLoading,
    error,
    requestPermission,
    subscribe,
    unsubscribe,
    updatePreferences,
    dismissError,
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert URL-safe base64 to Uint8Array
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from(rawData.split('').map(c => c.charCodeAt(0)))
}

/**
 * Send subscription to backend
 */
async function sendSubscriptionToBackend(
  subscription: PushSubscriptionData,
  action: 'subscribe' | 'unsubscribe'
): Promise<boolean> {
  try {
    const endpoint = import.meta.env.VITE_PUSH_API_ENDPOINT || '/api/push'
    const response = await fetch(`${endpoint}/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ subscription }),
    })

    return response.ok
  } catch (err) {
    console.error('[Push] Backend error:', err)
    return false
  }
}

/**
 * Send preferences to backend
 */
async function sendPreferencesToBackend(preferences: NotificationPreferences): Promise<void> {
  try {
    const endpoint = import.meta.env.VITE_PUSH_API_ENDPOINT || '/api/push'
    await fetch(`${endpoint}/preferences`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ preferences }),
    })
  } catch (err) {
    console.error('[Push] Failed to update preferences:', err)
  }
}
