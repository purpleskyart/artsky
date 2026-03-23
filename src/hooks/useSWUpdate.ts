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
    if ('serviceWorker' in navigator) {
      import('virtual:pwa-register')
        .then(({ registerSW }) => {
          const updateSW = registerSW({
            onNeedRefresh() {
              setNeedRefresh(true)
            },
          })
          setUpdateServiceWorkerFn(() => updateSW)
        })
        .catch((err) => {
          console.error('Service worker registration failed:', err)
        })
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
