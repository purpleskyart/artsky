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
  const fromLayoutTop = Math.max(pad, vv.offsetTop + pad)
  const fromLayoutBottom = Math.min(window.innerHeight - pad, vv.offsetTop + vv.height - pad)
  /* Keyboard overlays layout (Chrome / some WebKit): also intersect with visual height so
   * client rects line up when they’re tied to the visual viewport. */
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

function alignFieldInModalScrollRoot(
  el: HTMLElement,
  scrollRoot: HTMLElement,
  behavior: ScrollBehavior
) {
  const { top: visibleTop, bottom: visibleBottom } = getVisibleViewportYBounds()
  const rect = el.getBoundingClientRect()
  // Extend effective area to include the parent form's submit button / footer
  // so they stay visible while typing. Cap at 80px extra to avoid over-scrolling
  // if the form has a tall header above the field.
  const form = el.closest('form')
  const formBottom = form ? form.getBoundingClientRect().bottom : rect.bottom
  const effectiveBottom = Math.max(rect.bottom, Math.min(formBottom, rect.bottom + 80))
  const targetMid = (visibleTop + visibleBottom) / 2
  const mid = (rect.top + effectiveBottom) / 2
  const delta = mid - targetMid
  const maxScroll = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight)
  const nextTop = Math.min(Math.max(0, scrollRoot.scrollTop + delta), maxScroll)
  if (behavior === 'smooth') {
    scrollRoot.scrollTo({ top: nextTop, behavior: 'smooth' })
  } else {
    scrollRoot.scrollTop = nextTop
  }
}

/** Repeat alignment until the field + submit area sit in the visible band (handles late keyboard layout). */
function alignFieldInModalScrollRootIterated(el: HTMLElement, scrollRoot: HTMLElement, behavior: ScrollBehavior) {
  const maxPasses = 5
  const tol = 6
  for (let pass = 0; pass < maxPasses; pass++) {
    const { top: visibleTop, bottom: visibleBottom } = getVisibleViewportYBounds()
    const rect = el.getBoundingClientRect()
    const form = el.closest('form')
    const formBottom = form ? form.getBoundingClientRect().bottom : rect.bottom
    const effectiveBottom = Math.max(rect.bottom, Math.min(formBottom, rect.bottom + 80))
    if (rect.top >= visibleTop - tol && effectiveBottom <= visibleBottom + tol) {
      break
    }
    // If the effective area is taller than the visible band, accept when the field itself fits
    if (effectiveBottom - rect.top > visibleBottom - visibleTop && rect.top >= visibleTop - tol && rect.bottom <= visibleBottom + tol) {
      break
    }
    const useBehavior = pass === 0 ? behavior : 'auto'
    alignFieldInModalScrollRoot(el, scrollRoot, useBehavior)
  }
}

function scrollIntoModalScrollRoot(el: HTMLElement, scrollRoot: HTMLElement, behavior: ScrollBehavior) {
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' })

  const runAlign = () => alignFieldInModalScrollRootIterated(el, scrollRoot, 'auto')

  if (behavior === 'smooth') {
    requestAnimationFrame(() => {
      alignFieldInModalScrollRootIterated(el, scrollRoot, 'smooth')
      requestAnimationFrame(runAlign)
    })
  } else {
    requestAnimationFrame(runAlign)
  }
}

function nudgeCaretPosition(el: HTMLElement) {
  if (!(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLInputElement)) return
  const pos = el.selectionStart ?? 0
  el.setSelectionRange(pos, pos)
}

function runScroll(el: HTMLElement, behavior: ScrollBehavior) {
  const modalRoot = el.closest('[data-modal-scroll]') as HTMLElement | null
  if (modalRoot) {
    scrollIntoModalScrollRoot(el, modalRoot, behavior)
  } else {
    el.scrollIntoView({ block: 'center', behavior, inline: 'nearest' })
  }
  // iOS WebKit: caret can stick at the pre-scroll position after programmatic
  // scroll of a parent; nudge the selection to force recalculation.
  requestAnimationFrame(() => nudgeCaretPosition(el))
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
  const t4 = window.setTimeout(scrollSnap, 700)

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
    window.clearTimeout(t4)
    if (vv) {
      vv.removeEventListener('resize', scrollSnap)
      vv.removeEventListener('scroll', scrollSnap)
    }
  }
}
