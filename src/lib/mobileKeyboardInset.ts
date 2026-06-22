import { virtualKeyboardInsetPx } from './virtualKeyboard'

/** Bottom inset (px) above which we treat the on-screen keyboard as open. */
export const MOBILE_KEYBOARD_INSET_THRESHOLD_PX = 72

export function getMobileKeyboardInsetPx(): number {
  if (typeof window === 'undefined') return 0
  // Chromium (interactive-widget=overlays-content): the keyboard overlays content and the visual
  // viewport stays full-size, so read the real keyboard height from the VirtualKeyboard API.
  const vk = virtualKeyboardInsetPx()
  if (vk > 0) return vk
  // iOS Safari: no VirtualKeyboard API, but the keyboard shrinks/pans the visual viewport.
  const vv = window.visualViewport
  if (!vv) return 0
  return Math.max(0, Math.round(window.innerHeight - (vv.offsetTop + vv.height)))
}

export function isMobileKeyboardLikelyOpen(): boolean {
  return getMobileKeyboardInsetPx() > MOBILE_KEYBOARD_INSET_THRESHOLD_PX
}
