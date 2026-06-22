import { useLayoutEffect } from 'react'

const FLOAT_CHROME_VV_OFFSET_VAR = '--float-chrome-vv-offset'

/** Pin Layout mobile float chrome (gear, feeds, bell) to the visual viewport while a modal is open. */
export function useFloatChromeVisualViewportPin(enabled: boolean): void {
  useLayoutEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    const root = document.documentElement
    const vv = window.visualViewport
    if (!vv) return

    const pin = () => {
      root.style.setProperty(FLOAT_CHROME_VV_OFFSET_VAR, `${vv.offsetTop}px`)
    }

    pin()
    vv.addEventListener('resize', pin)
    vv.addEventListener('scroll', pin, { passive: true })
    document.addEventListener('focusin', pin)
    document.addEventListener('focusout', pin)

    return () => {
      vv.removeEventListener('resize', pin)
      vv.removeEventListener('scroll', pin)
      document.removeEventListener('focusin', pin)
      document.removeEventListener('focusout', pin)
      root.style.removeProperty(FLOAT_CHROME_VV_OFFSET_VAR)
    }
  }, [enabled])
}
