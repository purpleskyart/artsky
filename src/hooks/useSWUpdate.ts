import { useCallback, useEffect, useState } from 'react'

interface SWUpdateState {
  needRefresh: boolean
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>
  close: () => void
}

export function useSWUpdate(): SWUpdateState {
  const [needRefresh, setNeedRefresh] = useState(false)
  const [updateServiceWorkerFn, setUpdateServiceWorkerFn] = useState<(reloadPage?: boolean) => Promise<void>>(() => Promise.resolve())

  useEffect(() => {
    /** Avoid repeat `registration.update()` when tabbing in/out quickly; full check still runs on cold start. */
    const MIN_CHECK_GAP_MS = 5 * 60 * 1000
    const POLL_INTERVAL_MS = 30 * 60 * 1000 // Check every 30 minutes in background
    let lastCheckAt = 0
    let checking = false

    const checkForUpdate = async (options?: { bypassThrottle?: boolean }) => {
      if (!('serviceWorker' in navigator)) return
      const now = Date.now()
      if (!options?.bypassThrottle && now - lastCheckAt < MIN_CHECK_GAP_MS) return
      if (checking) return
      checking = true
      lastCheckAt = now
      try {
        const registration = await navigator.serviceWorker.getRegistration()
        await registration?.update()
      } catch {
        // Ignore transient update check failures.
      } finally {
        checking = false
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void checkForUpdate()
      }
    }

    if ('serviceWorker' in navigator) {
      document.addEventListener('visibilitychange', onVisible)

      import('virtual:pwa-register')
        .then(({ registerSW }) => {
          const updateSW = registerSW({
            onNeedRefresh() {
              setNeedRefresh(true)
            },
          })
          setUpdateServiceWorkerFn(() => updateSW)

          void checkForUpdate({ bypassThrottle: true })

          // Set up periodic polling for updates
          const pollInterval = setInterval(() => {
            void checkForUpdate()
          }, POLL_INTERVAL_MS)

          return () => {
            clearInterval(pollInterval)
          }
        })
        .catch((err) => {
          console.error('Service worker registration failed:', err)
        })
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const close = useCallback(() => {
    setNeedRefresh(false)
  }, [])

  return {
    needRefresh,
    updateServiceWorker: updateServiceWorkerFn,
    close,
  }
}
