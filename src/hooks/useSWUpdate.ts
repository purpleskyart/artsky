import { useCallback, useEffect, useState } from 'react'

interface SWUpdateState {
  needRefresh: boolean
  offlineReady: boolean
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>
  close: () => void
}

export function useSWUpdate(): SWUpdateState {
  const [needRefresh, setNeedRefresh] = useState(false)
  const [offlineReady, setOfflineReady] = useState(false)
  const [updateServiceWorkerFn, setUpdateServiceWorkerFn] = useState<(reloadPage?: boolean) => Promise<void>>(() => Promise.resolve())

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      import('virtual:pwa-register')
        .then(({ registerSW }) => {
          const updateSW = registerSW({
            onNeedRefresh() {
              setNeedRefresh(true)
            },
            onOfflineReady() {
              setOfflineReady(true)
            },
          })
          setUpdateServiceWorkerFn(() => updateSW)
        })
        .catch(() => {
          // SW registration failed (dev mode or unsupported)
        })
    }
  }, [])

  const close = useCallback(() => {
    setNeedRefresh(false)
    setOfflineReady(false)
  }, [])

  return {
    needRefresh,
    offlineReady,
    updateServiceWorker: updateServiceWorkerFn,
    close,
  }
}
