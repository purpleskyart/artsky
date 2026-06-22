import { useLayoutEffect, useState, type RefObject } from 'react'
import {
  enableVirtualKeyboardOverlays,
  onVirtualKeyboardGeometryChange,
  virtualKeyboardInsetPx,
} from '../lib/virtualKeyboard'
import { isMobileKeyboardLikelyOpen } from '../lib/mobileKeyboardInset'

interface PinnedModalViewport {
  /** True while the on-screen keyboard is open (for nav-hide / padding class toggles). */
  keyboardOpen: boolean
}

function clearPinnedGeometry(node: HTMLElement) {
  node.style.top = ''
  node.style.left = ''
  node.style.right = ''
  node.style.bottom = ''
  node.style.width = ''
  node.style.height = ''
  node.style.minHeight = ''
  node.style.maxHeight = ''
}

/**
 * While the on-screen keyboard is open, pins a fixed overlay to the visual viewport so it sits
 * above the keyboard and iOS viewport panning cannot desync touch coordinates.
 *
 * When the keyboard is closed, inline geometry is cleared so CSS `inset: 0` applies. Keeping pin
 * active after dismiss (stale iOS offsetTop) caused bottom gaps on stacked modals and after focus.
 */
export function usePinnedModalViewport(
  overlayRef: RefObject<HTMLElement | null>,
  enabled: boolean
): PinnedModalViewport {
  const [keyboardOpen, setKeyboardOpen] = useState(false)

  useLayoutEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    const vv = window.visualViewport
    const overlay = overlayRef.current
    if (!vv || !overlay) return

    enableVirtualKeyboardOverlays()

    let raf = 0
    let lastKeyboardOpen = false

    const apply = () => {
      raf = 0
      const node = overlayRef.current
      if (!node) return

      const open = isMobileKeyboardLikelyOpen()
      if (open !== lastKeyboardOpen) {
        lastKeyboardOpen = open
        setKeyboardOpen(open)
      }

      if (!open) {
        clearPinnedGeometry(node)
        return
      }

      const keyboardInset = virtualKeyboardInsetPx()
      const top = Math.max(0, vv.offsetTop)
      const left = Math.max(0, vv.offsetLeft)
      const width = Math.max(0, vv.width)
      const height = Math.max(0, vv.height - keyboardInset)
      node.style.top = `${top}px`
      node.style.left = `${left}px`
      node.style.right = 'auto'
      node.style.bottom = 'auto'
      node.style.width = `${width}px`
      node.style.height = `${height}px`
      node.style.minHeight = '0'
      node.style.maxHeight = 'none'
    }

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply)
    }

    apply()
    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    document.addEventListener('focusin', schedule)
    document.addEventListener('focusout', schedule)
    const offGeometry = onVirtualKeyboardGeometryChange(schedule)

    return () => {
      if (raf) cancelAnimationFrame(raf)
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      document.removeEventListener('focusin', schedule)
      document.removeEventListener('focusout', schedule)
      offGeometry()
      const node = overlayRef.current
      if (node) clearPinnedGeometry(node)
      setKeyboardOpen(false)
    }
  }, [enabled, overlayRef])

  return { keyboardOpen }
}
