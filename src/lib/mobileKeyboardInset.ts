/** Bottom inset (px) above which we treat the on-screen keyboard as open. */
export const MOBILE_KEYBOARD_INSET_THRESHOLD_PX = 72

export function getMobileKeyboardInsetPx(): number {
  if (typeof window === 'undefined') return 0
  const vv = window.visualViewport
  if (!vv) return 0
  return Math.max(0, Math.round(window.innerHeight - (vv.offsetTop + vv.height)))
}

export function isMobileKeyboardLikelyOpen(): boolean {
  return getMobileKeyboardInsetPx() > MOBILE_KEYBOARD_INSET_THRESHOLD_PX
}
