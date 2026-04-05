/**
 * Scroll a focused field into view and re-run when the visual viewport changes
 * (mobile on-screen keyboard). Returns a disposer; call on blur or unmount.
 *
 * Inside AppModal, scrolls the `[data-modal-scroll]` container so the field sits
 * in the visible viewport above the keyboard — avoids `scrollIntoView` moving the
 * whole fixed modal or the document behind it.
 */
function scrollIntoModalScrollRoot(el: HTMLElement, scrollRoot: HTMLElement, behavior: ScrollBehavior) {
  const vv = window.visualViewport
  const pad = 12
  let visTop: number
  let visBottom: number
  if (vv) {
    visTop = vv.offsetTop + pad
    visBottom = vv.offsetTop + vv.height - pad
  } else {
    visTop = pad
    visBottom = window.innerHeight - pad
  }
  const targetMid = (visTop + visBottom) / 2
  const rect = el.getBoundingClientRect()
  const mid = (rect.top + rect.bottom) / 2
  const delta = mid - targetMid
  const maxScroll = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight)
  const nextTop = Math.min(Math.max(0, scrollRoot.scrollTop + delta), maxScroll)
  scrollRoot.scrollTo({ top: nextTop, behavior })
}

function runScroll(el: HTMLElement, behavior: ScrollBehavior) {
  const modalRoot = el.closest('[data-modal-scroll]') as HTMLElement | null
  if (modalRoot) {
    scrollIntoModalScrollRoot(el, modalRoot, behavior)
    return
  }
  el.scrollIntoView({ block: 'center', behavior, inline: 'nearest' })
}

export function scrollFieldAboveKeyboard(el: HTMLElement): () => void {
  if (typeof window === 'undefined') return () => {}

  let cancelled = false
  const scrollSmooth = () => {
    if (cancelled) return
    runScroll(el, 'smooth')
  }
  const scrollSnap = () => {
    if (cancelled) return
    runScroll(el, 'auto')
  }

  scrollSmooth()
  requestAnimationFrame(() => {
    if (cancelled) return
    requestAnimationFrame(scrollSmooth)
  })
  const t1 = window.setTimeout(scrollSmooth, 50)
  const t2 = window.setTimeout(scrollSnap, 200)

  const vv = window.visualViewport
  if (vv) {
    vv.addEventListener('resize', scrollSnap, { passive: true })
    vv.addEventListener('scroll', scrollSnap, { passive: true })
  }

  return () => {
    cancelled = true
    window.clearTimeout(t1)
    window.clearTimeout(t2)
    if (vv) {
      vv.removeEventListener('resize', scrollSnap)
      vv.removeEventListener('scroll', scrollSnap)
    }
  }
}
