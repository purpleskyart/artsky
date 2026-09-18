/** Gap between layout viewport bottom and visual viewport bottom (browser chrome / iOS pan). */
export function visualViewportBottomGap(): number {
  if (typeof window === 'undefined') return 0
  const vv = window.visualViewport
  if (!vv) return 0
  return Math.max(0, Math.round(window.innerHeight - vv.offsetTop - vv.height))
}

function scrollWindowTo(y: number): void {
  window.scrollTo({ top: y, left: 0, behavior: 'instant' })
  document.documentElement.scrollTop = y
  document.body.scrollTop = y
}

/** After an overlay closes, dismiss dialog focus and re-sync document scroll once the keyboard settles. */
export function blurDialogFocusAndSyncScroll(scrollY?: number): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  const active = document.activeElement
  if (active instanceof HTMLElement && active.closest('[role="dialog"]')) {
    active.blur()
  }
  scrollWindowTo(scrollY ?? window.scrollY)
  requestAnimationFrame(() => {
    scrollWindowTo(scrollY ?? window.scrollY)
  })
}

/**
 * iOS can leave layout/visual viewports desynced after modal keyboard use, which makes
 * position:fixed feed chrome drift while scrolling. Re-pin document scroll once the keyboard
 * has dismissed — do not continuously adjust chrome offsets during feed scroll.
 */
export function resetMobileViewportAfterKeyboard(scrollY: number): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  const active = document.activeElement
  if (active instanceof HTMLElement && active.closest('[role="dialog"]')) {
    active.blur()
  }

  const settle = () => scrollWindowTo(scrollY)

  settle()
  requestAnimationFrame(settle)
  requestAnimationFrame(() => {
    scrollWindowTo(scrollY + 1)
    requestAnimationFrame(settle)
  })
  window.setTimeout(settle, 50)
  window.setTimeout(settle, 150)
  window.setTimeout(settle, 350)
}
