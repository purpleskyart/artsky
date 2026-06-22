import { useLayoutEffect, useState } from 'react'
import { isMobileKeyboardLikelyOpen } from '../lib/mobileKeyboardInset'
import { onVirtualKeyboardGeometryChange } from '../lib/virtualKeyboard'

/**
 * Tracks whether the on-screen keyboard is open (for nav-hide / padding class toggles).
 * Does not resize the modal overlay — the overlay stays full-screen so the feed cannot
 * bleed through gaps below a shrunken visual-viewport box.
 */
export function useModalKeyboardOpen(enabled: boolean): boolean {
  const [keyboardOpen, setKeyboardOpen] = useState(false)

  useLayoutEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    const vv = window.visualViewport
    if (!vv) return

    const update = () => setKeyboardOpen(isMobileKeyboardLikelyOpen())

    update()
    vv.addEventListener('resize', update)
    document.addEventListener('focusout', update)
    const offGeometry = onVirtualKeyboardGeometryChange(update)

    return () => {
      vv.removeEventListener('resize', update)
      document.removeEventListener('focusout', update)
      offGeometry()
      setKeyboardOpen(false)
    }
  }, [enabled])

  return keyboardOpen
}
