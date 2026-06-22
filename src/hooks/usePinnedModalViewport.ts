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

/**
 * Pins a `position: fixed` full-screen overlay to the *visual* viewport so it always covers exactly
 * the visible region minus the on-screen keyboard.
 *
 * Why this exists: a plain `inset: 0` overlay is anchored to the layout viewport, but iOS pans the
 * visual viewport when a field is focused and as you scroll — opening gaps where the page behind
 * shows through, and never shrinking so content stays above the keyboard. We write the geometry
 * directly to the DOM inside a single rAF (no React state round-trip, which lags a frame and was the
 * source of the feed-bleed glitches) on every `resize` AND `scroll`, plus the VirtualKeyboard
 * `geometrychange` for Chromium where the visual viewport doesn't shrink.
 *
 * The overlay's `top/left/width/height/right/bottom` are owned entirely by this hook while enabled,
 * so the consumer must not also set those via inline styles (z-index etc. are fine).
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
      const keyboardInset = virtualKeyboardInsetPx()
      const top = Math.max(0, vv.offsetTop)
      const left = Math.max(0, vv.offsetLeft)
      const width = Math.max(0, vv.width)
      // iOS: vv.height already excludes the keyboard (keyboardInset is 0).
      // Chromium: vv.height stays full, so subtract the VirtualKeyboard height.
      const height = Math.max(0, vv.height - keyboardInset)
      node.style.top = `${top}px`
      node.style.left = `${left}px`
      node.style.right = 'auto'
      node.style.bottom = 'auto'
      node.style.width = `${width}px`
      node.style.height = `${height}px`
      // Overlay CSS may declare `min-height: 100dvh`, which would otherwise win over the shrunk
      // height while the keyboard is open. Neutralise min/max-height so the pinned height holds.
      node.style.minHeight = '0'
      node.style.maxHeight = 'none'

      const open = isMobileKeyboardLikelyOpen()
      if (open !== lastKeyboardOpen) {
        lastKeyboardOpen = open
        setKeyboardOpen(open)
      }
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
      if (node) {
        node.style.top = ''
        node.style.left = ''
        node.style.right = ''
        node.style.bottom = ''
        node.style.width = ''
        node.style.height = ''
        node.style.minHeight = ''
        node.style.maxHeight = ''
      }
      setKeyboardOpen(false)
    }
  }, [enabled, overlayRef])

  return { keyboardOpen }
}
