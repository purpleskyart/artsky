/**
 * Shared IntersectionObserver for card virtualization.
 *
 * Cards far off-screen are replaced with fixed-height placeholders, freeing
 * images, video, HLS instances, and per-card observers from memory. A single
 * shared IO keeps overhead O(1) regardless of card count.
 *
 * Hysteresis avoids flicker: unmount thresholds are tighter than remount
 * thresholds, so cards virtualize soon after leaving the viewport but remount
 * with lead time before they scroll back into view. Top (scrolled-past) margins
 * are tighter than bottom (upcoming) margins to avoid keeping many cards above
 * the viewport mounted.
 */

/** Viewport-height multiples — unmount when farther than this outside the root. */
export const VIRT_UNMOUNT_MARGIN_VH = {
  /** Scrolled-past cards: virtualize once farther than this above the viewport. */
  top: 0.4,
  bottom: 0.75,
} as const

/** Viewport-height multiples — remount when closer than this outside the root. */
export const VIRT_MOUNT_MARGIN_VH = {
  /** Scroll-back: remount with lead time; must be < unmount top for stable hysteresis. */
  top: 0.25,
  bottom: 0.5,
} as const

type ViewBounds = { top: number; bottom: number }

function getViewportHeight(): number {
  if (typeof window === 'undefined') return 800
  return window.innerHeight
}

function getRootBounds(root: Element | null): ViewBounds {
  if (!root) {
    return { top: 0, bottom: getViewportHeight() }
  }
  const rect = root.getBoundingClientRect()
  return { top: rect.top, bottom: rect.bottom }
}

function getVirtualizationRootMargin(): string {
  const vh = getViewportHeight()
  const top = Math.floor(vh * VIRT_UNMOUNT_MARGIN_VH.top)
  const bottom = Math.floor(vh * VIRT_UNMOUNT_MARGIN_VH.bottom)
  return `${top}px 0px ${bottom}px 0px`
}

/**
 * Hysteresis without oscillation: remount when close (mount), stay mounted until
 * farther (unmount). Requires mount < unmount per direction.
 *
 * near = distance < mount OR (near && distance < unmount)
 */
export function computeVirtualizationNear(
  currentNear: boolean,
  rect: DOMRectReadOnly,
  bounds: ViewBounds,
  vh: number,
): boolean {
  const visible = rect.bottom > bounds.top && rect.top < bounds.bottom
  if (visible) return true

  const unmountTop = vh * VIRT_UNMOUNT_MARGIN_VH.top
  const unmountBottom = vh * VIRT_UNMOUNT_MARGIN_VH.bottom
  const mountTop = vh * VIRT_MOUNT_MARGIN_VH.top
  const mountBottom = vh * VIRT_MOUNT_MARGIN_VH.bottom

  if (rect.bottom <= bounds.top) {
    const distance = bounds.top - rect.bottom
    return distance < mountTop || (currentNear && distance < unmountTop)
  }

  if (rect.top >= bounds.bottom) {
    const distance = rect.top - bounds.bottom
    return distance < mountBottom || (currentNear && distance < unmountBottom)
  }

  return true
}

type VirtCallback = (isNearViewport: boolean) => void

const virtCallbacks = new WeakMap<Element, VirtCallback>()
const nearState = new WeakMap<Element, boolean>()
const trackedElements = new Map<Element, { callback: VirtCallback; root: Element | null }>()
const observerCache = new Map<Element | null, IntersectionObserver>()

function updateElementNear(el: Element, root: Element | null): void {
  const bounds = getRootBounds(root)
  const vh = getViewportHeight()
  const rect = el.getBoundingClientRect()
  const current = nearState.get(el) ?? true
  const next = computeVirtualizationNear(current, rect, bounds, vh)
  if (next === current) return
  nearState.set(el, next)
  virtCallbacks.get(el)?.(next)
}

function handleIntersectionEntries(entries: IntersectionObserverEntry[], root: Element | null): void {
  for (const entry of entries) {
    updateElementNear(entry.target, root)
  }
}

// Clear stale module-level state on page load (fixes refresh issues)
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    trackedElements.clear()
    observerCache.forEach((observer) => observer.disconnect())
    observerCache.clear()
  })
}

// Handle window resize to update observers with new margin
if (typeof window !== 'undefined') {
  let resizeTimeout: ReturnType<typeof setTimeout> | undefined
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout)
    resizeTimeout = setTimeout(() => {
      try {
        const allRoots = Array.from(observerCache.keys())
        const allElements = Array.from(trackedElements.entries())

        for (const root of allRoots) {
          const observer = observerCache.get(root)
          if (observer) {
            observer.disconnect()
            observerCache.delete(root)
          }
        }

        for (const root of allRoots) {
          const elements = allElements
            .filter(([, data]) => data.root === root)
            .map(([el]) => el)

          const newObserver = new IntersectionObserver(
            (entries) => handleIntersectionEntries(entries, root),
            { rootMargin: getVirtualizationRootMargin(), threshold: 0, root },
          )
          observerCache.set(root, newObserver)

          for (const el of elements) {
            newObserver.observe(el)
            updateElementNear(el, root)
          }
        }
      } catch (error) {
        console.error('Error updating virtualization observers on resize:', error)
      }
    }, 250)
  }, { passive: true })
}

function getObserver(root: Element | null = null): IntersectionObserver {
  const cached = observerCache.get(root)
  if (cached) return cached

  const observer = new IntersectionObserver(
    (entries) => handleIntersectionEntries(entries, root),
    { rootMargin: getVirtualizationRootMargin(), threshold: 0, root },
  )
  observerCache.set(root, observer)
  return observer
}

export function observeVirtualization(
  el: Element,
  callback: VirtCallback,
  root?: Element | null,
): () => void {
  const observer = getObserver(root)
  const rootEl = root ?? null
  virtCallbacks.set(el, callback)
  trackedElements.set(el, { callback, root: rootEl })
  nearState.set(el, true)
  observer.observe(el)
  updateElementNear(el, rootEl)
  return () => {
    virtCallbacks.delete(el)
    trackedElements.delete(el)
    nearState.delete(el)
    observer.unobserve(el)
  }
}
