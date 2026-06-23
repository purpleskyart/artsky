/** Gap between layout viewport bottom and visual viewport bottom (browser chrome / iOS pan). */
export function visualViewportBottomGap(): number {
  if (typeof window === 'undefined') return 0
  const vv = window.visualViewport
  if (!vv) return 0
  return Math.max(0, Math.round(window.innerHeight - vv.offsetTop - vv.height))
}

/** After an overlay closes, dismiss dialog focus and re-sync document scroll once the keyboard settles. */
export function blurDialogFocusAndSyncScroll(scrollY?: number): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  const active = document.activeElement
  if (active instanceof HTMLElement && active.closest('[role="dialog"]')) {
    active.blur()
  }
  const y = scrollY ?? window.scrollY
  window.scrollTo({ top: y, left: 0, behavior: 'instant' })
  requestAnimationFrame(() => {
    window.scrollTo({ top: y, left: 0, behavior: 'instant' })
  })
}
