/**
 * Shared IntersectionObserver for card virtualization.
 *
 * Cards beyond the margin are replaced with fixed-height placeholders, freeing
 * images, video, HLS instances, and per-card observers from memory. A single
 * shared IO keeps overhead O(1) regardless of card count.
 *
 * Top margin is smaller than bottom so scrolled-past cards above the viewport
 * virtualize sooner; bottom keeps a larger buffer for smooth scroll-down.
 */

/** Viewport-height multiples for asymmetric rootMargin (top, bottom). */
export const VIRT_ROOT_MARGIN_VH = {
  /** Scrolled-past: virtualize once farther than this above the viewport. */
  top: 0.5,
  /** Upcoming: keep mounted until this far below the viewport. */
  bottom: 0.75,
} as const

function getViewportHeight(): number {
  if (typeof window === 'undefined') return 800
  return window.innerHeight
}

function getVirtualizationRootMargin(): string {
  const vh = getViewportHeight()
  const top = Math.floor(vh * VIRT_ROOT_MARGIN_VH.top)
  const bottom = Math.floor(vh * VIRT_ROOT_MARGIN_VH.bottom)
  return `${top}px 0px ${bottom}px 0px`
}

type VirtCallback = (isNearViewport: boolean) => void

const virtCallbacks = new WeakMap<Element, VirtCallback>()
const trackedElements = new Map<Element, { callback: VirtCallback; root: Element | null }>()
const observerCache = new Map<Element | null, IntersectionObserver>()

function handleIntersectionEntries(entries: IntersectionObserverEntry[]): void {
  for (const entry of entries) {
    virtCallbacks.get(entry.target)?.(entry.isIntersecting)
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
            (entries) => handleIntersectionEntries(entries),
            { rootMargin: getVirtualizationRootMargin(), threshold: 0, root },
          )
          observerCache.set(root, newObserver)

          for (const el of elements) {
            newObserver.observe(el)
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
    (entries) => handleIntersectionEntries(entries),
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
  observer.observe(el)

  const deliverPending = () => {
    const pending = observer.takeRecords()
    if (pending.length > 0) handleIntersectionEntries(pending)
  }
  deliverPending()
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(deliverPending)
  }

  return () => {
    virtCallbacks.delete(el)
    trackedElements.delete(el)
    observer.unobserve(el)
  }
}
