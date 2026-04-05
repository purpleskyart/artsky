/**
 * Scroll a focused field into view and re-run when the visual viewport changes
 * (mobile on-screen keyboard). Returns a disposer; call on blur or unmount.
 *
 * Inside AppModal, adjusts `[data-modal-scroll]` so the field sits in the visible
 * visual viewport. Does NOT call el.scrollIntoView() inside modals because on iOS
 * Safari that can scroll the body/window behind the position:fixed overlay, causing
 * touch coordinates to desync from where elements visually appear.
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
   * client rects line up when they're tied to the visual viewport. */
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
    if (effectiveBottom - rect.top > visibleBottom - visibleTop && rect.top >= visibleTop - tol && rect.bottom <= visibleBottom + tol) {
      break
    }
    const useBehavior = pass === 0 ? behavior : 'auto'
    alignFieldInModalScrollRoot(el, scrollRoot, useBehavior)
  }
}

/* Only adjust the modal's own scroll container — never call el.scrollIntoView()
 * here. On iOS Safari, scrollIntoView scrolls ALL ancestor containers including
 * the body/window behind the position:fixed modal overlay. The overlay stays
 * visually in place but the underlying document shifts, causing iOS's touch
 * hit-testing to become offset from where elements actually appear on screen. */
function scrollIntoModalScrollRoot(el: HTMLElement, scrollRoot: HTMLElement, behavior: ScrollBehavior) {
  if (behavior === 'smooth') {
    alignFieldInModalScrollRootIterated(el, scrollRoot, 'smooth')
    requestAnimationFrame(() => alignFieldInModalScrollRootIterated(el, scrollRoot, 'auto'))
  } else {
    alignFieldInModalScrollRootIterated(el, scrollRoot, 'auto')
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
  requestAnimationFrame(() => nudgeCaretPosition(el))
}

export function scrollFieldAboveKeyboard(el: HTMLElement): () => void {
  if (typeof window === 'undefined') return () => {}

  let cancelled = false
  let cooldown = false
  let rafId: number | null = null

  const doScroll = (behavior: ScrollBehavior) => {
    if (cancelled) return
    cooldown = true
    runScroll(el, behavior)
    // After a programmatic scroll, ignore viewport events briefly so the
    // browser-fired scroll/resize that follows our own adjustment doesn't
    // re-trigger the handler (breaks the iOS feedback loop).
    window.setTimeout(() => { cooldown = false }, 150)
  }

  const onViewportResize = () => {
    if (cancelled || cooldown) return
    if (rafId !== null) return
    rafId = requestAnimationFrame(() => {
      rafId = null
      if (cancelled || cooldown) return
      doScroll('auto')
    })
  }

  doScroll('smooth')
  const t1 = window.setTimeout(() => doScroll('auto'), 80)
  const t2 = window.setTimeout(() => doScroll('auto'), 300)

  const vv = window.visualViewport
  if (vv) {
    // Only listen for resize (keyboard open/close). Listening to
    // visualViewport scroll caused a feedback loop on iOS: programmatic
    // scroll → viewport scroll event → handler → scroll → …
    vv.addEventListener('resize', onViewportResize, { passive: true })
  }

  return () => {
    cancelled = true
    if (rafId !== null) cancelAnimationFrame(rafId)
    window.clearTimeout(t1)
    window.clearTimeout(t2)
    if (vv) {
      vv.removeEventListener('resize', onViewportResize)
    }
  }
}
