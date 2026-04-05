/**
 * Scroll a focused field into view and re-run when the visual viewport changes
 * (mobile on-screen keyboard). Returns a disposer; call on blur or unmount.
 */
export function scrollFieldAboveKeyboard(el: HTMLElement): () => void {
  if (typeof window === 'undefined') return () => {}

  let cancelled = false
  const scroll = () => {
    if (cancelled) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth', inline: 'nearest' })
  }

  scroll()
  requestAnimationFrame(() => {
    if (cancelled) return
    requestAnimationFrame(scroll)
  })
  const t1 = window.setTimeout(scroll, 50)
  const t2 = window.setTimeout(scroll, 200)

  const vv = window.visualViewport
  if (vv) {
    vv.addEventListener('resize', scroll, { passive: true })
    vv.addEventListener('scroll', scroll, { passive: true })
  }

  return () => {
    cancelled = true
    window.clearTimeout(t1)
    window.clearTimeout(t2)
    if (vv) {
      vv.removeEventListener('resize', scroll)
      vv.removeEventListener('scroll', scroll)
    }
  }
}
