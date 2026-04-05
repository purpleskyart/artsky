/**
 * Scroll a focused field into view and re-run when the visual viewport
 * resizes (mobile on-screen keyboard open/close).
 *
 * Returns a disposer; call on blur or unmount.
 *
 * Inside AppModal or the Layout compose card, adjusts only the `[data-modal-scroll]` container.
 * Never calls el.scrollIntoView() in that path — on iOS Safari it scrolls
 * the body/window behind the position:fixed overlay, desyncing touch
 * coordinates from where elements visually appear.
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
  // Already in view — no adjustment needed.
  if (rect.top >= visibleTop - tol && effectiveBottom <= visibleBottom + tol) return
  if (effectiveBottom - rect.top > visibleBottom - visibleTop && rect.top >= visibleTop - tol && rect.bottom <= visibleBottom + tol) return
  const targetMid = (visibleTop + visibleBottom) / 2
  const mid = (rect.top + effectiveBottom) / 2
  const delta = mid - targetMid
  const maxScroll = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight)
  scrollRoot.scrollTop = Math.min(Math.max(0, scrollRoot.scrollTop + delta), maxScroll)
}

/** Repeat until the field + submit area sit in the visible band (handles rounding). */
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

  // Defer the initial scroll one frame so the browser's own focus-scroll
  // (from a direct tap) settles first. For programmatic focus (reply button
  // with preventScroll:true) this is the first and only needed scroll.
  scheduleAdjust()

  const vv = window.visualViewport
  const onResize = () => {
    if (cancelled) return
    if (rafId !== null) cancelAnimationFrame(rafId)
    // Double-rAF: the first frame lets concurrent resize handlers run
    // (AppModal sets --keyboard-inset which changes pane max-height);
    // the second frame fires after the browser has reflowed those CSS
    // changes, so getBoundingClientRect measurements are accurate.
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
    // Only listen for resize (keyboard open/close), not scroll.
    // Responding to visualViewport.scroll causes a feedback loop on iOS
    // where adjusting scroll fires another viewport event.
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
