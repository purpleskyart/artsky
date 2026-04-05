/**
 * Scroll a focused field into view and re-run when the visual viewport changes
 * (mobile on-screen keyboard). Returns a disposer; call on blur or unmount.
 *
 * Inside AppModal, adjusts `[data-modal-scroll]` so the field sits in the visible
 * visual viewport — avoids relying on a single scrollIntoView pass that some WebKit
 * builds mishandle inside fixed overlays.
 */
function getVisibleViewportYBounds(): { top: number; bottom: number } {
  const vv = window.visualViewport
  const pad = 12
  if (!vv) {
    return { top: pad, bottom: window.innerHeight - pad }
  }
  const top = Math.max(pad, vv.offsetTop + pad)
  const bottom = Math.min(window.innerHeight - pad, vv.offsetTop + vv.height - pad)
  return { top, bottom: Math.max(top + 1, bottom) }
}

function alignFieldInModalScrollRoot(
  el: HTMLElement,
  scrollRoot: HTMLElement,
  behavior: ScrollBehavior
) {
  const { top: visibleTop, bottom: visibleBottom } = getVisibleViewportYBounds()
  const targetMid = (visibleTop + visibleBottom) / 2
  const rect = el.getBoundingClientRect()
  const mid = (rect.top + rect.bottom) / 2
  const delta = mid - targetMid
  const maxScroll = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight)
  const nextTop = Math.min(Math.max(0, scrollRoot.scrollTop + delta), maxScroll)
  if (behavior === 'smooth') {
    scrollRoot.scrollTo({ top: nextTop, behavior: 'smooth' })
  } else {
    scrollRoot.scrollTop = nextTop
  }
}

function scrollIntoModalScrollRoot(el: HTMLElement, scrollRoot: HTMLElement, behavior: ScrollBehavior) {
  /* Prime the correct scroll container (especially WebKit inside fixed modals). */
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' })

  const runAlign = (b: ScrollBehavior) => alignFieldInModalScrollRoot(el, scrollRoot, b)

  if (behavior === 'smooth') {
    requestAnimationFrame(() => {
      runAlign('smooth')
      requestAnimationFrame(() => runAlign('auto'))
    })
  } else {
    requestAnimationFrame(() => runAlign('auto'))
  }
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
  const t3 = window.setTimeout(scrollSnap, 450)

  const vv = window.visualViewport
  if (vv) {
    vv.addEventListener('resize', scrollSnap, { passive: true })
    vv.addEventListener('scroll', scrollSnap, { passive: true })
  }

  return () => {
    cancelled = true
    window.clearTimeout(t1)
    window.clearTimeout(t2)
    window.clearTimeout(t3)
    if (vv) {
      vv.removeEventListener('resize', scrollSnap)
      vv.removeEventListener('scroll', scrollSnap)
    }
  }
}
