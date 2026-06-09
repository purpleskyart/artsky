import { useEffect } from 'react'
import { refreshAllVideoVisibility } from '../lib/videoPlaybackManager'

/** Re-check video visibility after page load and bfcache restore. */
export function VideoAutoplayBootstrap() {
  useEffect(() => {
    const refresh = () => refreshAllVideoVisibility()
    if (document.readyState === 'complete') {
      refresh()
    } else {
      window.addEventListener('load', refresh, { once: true })
    }
    window.addEventListener('pageshow', refresh)
    // Feed/profile grids often mount videos after window load; re-check once layout settles.
    const t1 = window.setTimeout(refresh, 400)
    const t2 = window.setTimeout(refresh, 1200)
    return () => {
      window.removeEventListener('pageshow', refresh)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [])

  return null
}
