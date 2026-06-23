/**
 * Scroll a focused field into view and re-run when the visual viewport
 * resizes (mobile on-screen keyboard open/close).
 *
 * Returns a disposer; call on blur or unmount.
 *
 * Inside AppModal, adjusts only the `[data-modal-scroll]` container. Never calls
 * scrollIntoView on the window — on iOS Safari that scrolls the body behind the
 * position:fixed overlay and desyncs fixed chrome from the visible viewport.
 */
function getVisibleViewportYBounds(): { top: number; bottom: number } {
  const vv = window.visualViewport
  const pad = 12
  if (!vv) {
    return { top: pad, bottom: window.innerHeight - pad }
  }
  const fromLayoutTop = Math.max(pad, vv.offsetTop + pad)
  const fromLayoutBottom = Math.min(window.innerHeight - pad, vv.offsetTop + vv.height - pad)
  if (vv.height < window.innerHeight - 48) {
    const visualTop = pad
    const visualBottom = vv.height - pad
    return {
      top: Math.max(fromLayoutTop, visualTop),
      bottom: Math.min(fromLayoutBottom, visualBottom),
    }
  }
  return { top: fromLayoutTop, bottom: Math.max(fromLayoutTop + 1, fromLayoutBottom) }
}

function alignFieldInModalScrollRoot(el: HTMLElement, scrollRoot: HTMLElement) {
  const { top: visibleTop, bottom: visibleBottom } = getVisibleViewportYBounds()
  const rect = el.getBoundingClientRect()
  const form = el.closest('form')
  const formBottom = form ? form.getBoundingClientRect().bottom : rect.bottom
  const effectiveBottom = Math.max(rect.bottom, Math.min(formBottom, rect.bottom + 80))
  const tol = 6
  if (rect.top >= visibleTop - tol && effectiveBottom <= visibleBottom + tol) return
  if (effectiveBottom - rect.top > visibleBottom - visibleTop && rect.top >= visibleTop - tol && rect.bottom <= visibleBottom + tol) return
  let delta = 0
  if (effectiveBottom > visibleBottom + tol) {
    delta = effectiveBottom - visibleBottom
  } else if (rect.top < visibleTop - tol) {
    delta = rect.top - visibleTop
  }
  if (delta === 0) return
  const maxScroll = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight)
  scrollRoot.scrollTop = Math.min(Math.max(0, scrollRoot.scrollTop + delta), maxScroll)
}

function alignFieldInModalScrollRootIterated(el: HTMLElement, scrollRoot: HTMLElement) {
  for (let pass = 0; pass < 3; pass++) {
    const { top: visibleTop, bottom: visibleBottom } = getVisibleViewportYBounds()
    const rect = el.getBoundingClientRect()
    const form = el.closest('form')
    const formBottom = form ? form.getBoundingClientRect().bottom : rect.bottom
    const effectiveBottom = Math.max(rect.bottom, Math.min(formBottom, rect.bottom + 80))
    const tol = 6
    if (rect.top >= visibleTop - tol && effectiveBottom <= visibleBottom + tol) break
    if (effectiveBottom - rect.top > visibleBottom - visibleTop && rect.top >= visibleTop - tol && rect.bottom <= visibleBottom + tol) break
    alignFieldInModalScrollRoot(el, scrollRoot)
  }
}

function nudgeCaretPosition(el: HTMLElement) {
  if (!(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLInputElement)) return
  const pos = el.selectionStart ?? 0
  el.setSelectionRange(pos, pos)
}

function adjustScroll(el: HTMLElement) {
  if (el.closest('[data-compose-sheet]') || el.closest('[data-modal-keyboard-aware]')) {
    requestAnimationFrame(() => nudgeCaretPosition(el))
    return
  }
  const modalRoot = el.closest('[data-modal-scroll]') as HTMLElement | null
  if (modalRoot) {
    alignFieldInModalScrollRootIterated(el, modalRoot)
  } else {
    el.scrollIntoView({ block: 'center', behavior: 'auto', inline: 'nearest' })
  }
  requestAnimationFrame(() => nudgeCaretPosition(el))
}

export function scrollFieldAboveKeyboard(el: HTMLElement): () => void {
  if (typeof window === 'undefined') return () => {}

  let cancelled = false
  let rafId: number | null = null

  const scheduleAdjust = () => {
    if (rafId !== null) cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(() => {
      rafId = null
      if (cancelled) return
      adjustScroll(el)
    })
  }

  scheduleAdjust()

  const vv = window.visualViewport
  const onResize = () => {
    if (cancelled) return
    if (rafId !== null) cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(() => {
      if (cancelled) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        if (cancelled) return
        adjustScroll(el)
      })
    })
  }

  if (vv) {
    vv.addEventListener('resize', onResize, { passive: true })
  }

  return () => {
    cancelled = true
    if (rafId !== null) cancelAnimationFrame(rafId)
    if (vv) {
      vv.removeEventListener('resize', onResize)
    }
  }
}
