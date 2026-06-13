import { useEffect } from 'react'
import { refreshAllVideoVisibility } from '../lib/videoPlaybackManager'

/** Re-check video visibility after page load, bfcache restore, and foreground resume. */
export function VideoAutoplayBootstrap() {
  useEffect(() => {
    const refresh = () => refreshAllVideoVisibility()
    if (document.readyState === 'complete') {
      refresh()
    } else {
      window.addEventListener('load', refresh, { once: true })
    }
    window.addEventListener('pageshow', refresh)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    // Feed/profile grids often mount videos after window load; re-check once layout settles.
    // Extra delays help when iOS Low Power Mode throttles timers on cold PWA launch.
    const timers = [400, 1200, 3000, 6000].map((ms) => window.setTimeout(refresh, ms))
    return () => {
      window.removeEventListener('pageshow', refresh)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      for (const id of timers) window.clearTimeout(id)
    }
  }, [])

  return null
}
