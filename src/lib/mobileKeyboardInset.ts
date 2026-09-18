/** Gap above which visualViewport shrink is treated as an open keyboard (px). */
export const MOBILE_KEYBOARD_INSET_THRESHOLD = 72

export const MODAL_KEYBOARD_INSET_VAR = '--modal-keyboard-inset'
export const MODAL_KEYBOARD_AWARE_ATTR = 'data-modal-keyboard-aware'

/** Typical on-screen keyboard height before the keyboard has finished animating in. */
export function estimateMobileKeyboardInset(viewportHeight?: number): number {
  if (typeof window === 'undefined') return 280
  const h = viewportHeight ?? window.visualViewport?.height ?? window.innerHeight
  return Math.min(340, Math.max(200, Math.round(h * 0.35)))
}

/** Keyboard gap from layout viewport bottom (browser chrome / iOS keyboard). */
export function inferMobileKeyboardInset(): number {
  if (typeof window === 'undefined') return 0
  const vv = window.visualViewport
  if (!vv) return 0
  return Math.max(0, Math.round(window.innerHeight - (vv.offsetTop + vv.height)))
}

export function applyModalKeyboardInset(el: HTMLElement | null, inset: number): void {
  if (!el) return
  if (inset > 0) {
    el.style.setProperty(MODAL_KEYBOARD_INSET_VAR, `${inset}px`)
    el.setAttribute(MODAL_KEYBOARD_AWARE_ATTR, '')
  } else {
    el.style.removeProperty(MODAL_KEYBOARD_INSET_VAR)
    el.removeAttribute(MODAL_KEYBOARD_AWARE_ATTR)
  }
}

export function isEditableField(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return false
  if (target.type === 'file' || target.type === 'hidden' || target.disabled) return false
  return true
}
