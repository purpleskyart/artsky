/**
 * VirtualKeyboard API helpers.
 *
 * `index.html` sets `interactive-widget=overlays-content`, so on Chromium the on-screen keyboard
 * overlays content instead of resizing the viewport — `visualViewport.height` does NOT shrink, so
 * inferring the keyboard from the visual viewport (the iOS technique) reports 0 there. The
 * VirtualKeyboard API exposes the real keyboard geometry on those browsers; iOS Safari has no such
 * API but does shrink/pan the visual viewport, so callers fall back to that (see mobileKeyboardInset).
 */

interface VirtualKeyboardLike {
  overlaysContent: boolean
  boundingRect: DOMRectReadOnly
  addEventListener: (type: 'geometrychange', listener: () => void) => void
  removeEventListener: (type: 'geometrychange', listener: () => void) => void
}

function getVirtualKeyboard(): VirtualKeyboardLike | null {
  if (typeof navigator === 'undefined') return null
  const vk = (navigator as Navigator & { virtualKeyboard?: VirtualKeyboardLike }).virtualKeyboard
  return vk ?? null
}

let overlaysEnabled = false

/** Opt into keyboard geometry reporting. Safe to call repeatedly; only the first call has effect. */
export function enableVirtualKeyboardOverlays(): void {
  if (overlaysEnabled) return
  const vk = getVirtualKeyboard()
  if (!vk) return
  try {
    vk.overlaysContent = true
    overlaysEnabled = true
  } catch {
    /* unsupported / not allowed */
  }
}

/** On-screen keyboard height (px) reported by the VirtualKeyboard API, or 0 when unavailable (e.g. iOS). */
export function virtualKeyboardInsetPx(): number {
  const vk = getVirtualKeyboard()
  const height = vk?.boundingRect?.height
  return typeof height === 'number' && height > 0 ? Math.round(height) : 0
}

/** Subscribe to keyboard geometry changes. Returns an unsubscribe fn (no-op when unsupported). */
export function onVirtualKeyboardGeometryChange(listener: () => void): () => void {
  const vk = getVirtualKeyboard()
  if (!vk) return () => {}
  vk.addEventListener('geometrychange', listener)
  return () => vk.removeEventListener('geometrychange', listener)
}
