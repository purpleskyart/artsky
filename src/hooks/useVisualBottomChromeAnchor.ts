import { useLayoutEffect } from 'react'
import { visualViewportBottomGap } from '../lib/mobileViewportSettle'

const BOTTOM_CHROME_VV_GAP_VAR = '--bottom-chrome-vv-gap'

/**
 * Keep bottom fixed chrome (nav pill) aligned with the visible viewport bottom on mobile.
 * iOS can leave layout/visual viewports desynced after modal keyboard use; this tracks the
 * gap on feed scroll without pinning modals or intercepting field focus.
 */
export function useVisualBottomChromeAnchor(enabled: boolean): void {
  useLayoutEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    const root = document.documentElement
    const vv = window.visualViewport
    if (!vv) return

    const sync = () => {
      root.style.setProperty(BOTTOM_CHROME_VV_GAP_VAR, `${visualViewportBottomGap()}px`)
    }

    sync()
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync, { passive: true })
    window.addEventListener('scroll', sync, { passive: true })

    return () => {
      vv.removeEventListener('resize', sync)
      vv.removeEventListener('scroll', sync)
      window.removeEventListener('scroll', sync)
      root.style.removeProperty(BOTTOM_CHROME_VV_GAP_VAR)
    }
  }, [enabled])
}
