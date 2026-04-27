/**
 * Shared IntersectionObserver for card virtualization.
 *
 * Cards beyond VIRTUALIZATION_MARGIN are eligible for replacement with a
 * fixed-height placeholder, freeing images, video, HLS instances, and
 * per-card observers from memory. A single shared IO keeps overhead O(1)
 * regardless of how many cards exist.
 *
 * Margin is calculated as 1.5x viewport height in each direction,
 * giving React enough time to re-mount content before it scrolls into view.
 */

function getVirtualizationMargin(): string {
  if (typeof window === 'undefined') return '1200px 0px 1200px 0px'
  const vh = window.innerHeight
  const margin = Math.floor(vh * 1.5)
  return `${margin}px 0px ${margin}px 0px`
}

type VirtCallback = (isNearViewport: boolean) => void

const virtCallbacks = new WeakMap<Element, VirtCallback>()
// Track elements separately for window resize handling (WeakMap is not iterable)
const trackedElements = new Map<Element, { callback: VirtCallback; root: Element | null }>()
const observerCache = new Map<Element | null, IntersectionObserver>()

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
        // Collect all roots first to avoid mutation during iteration
        const allRoots = Array.from(observerCache.keys())
        const allElements = Array.from(trackedElements.entries())

        // Disconnect and delete old observers
        for (const root of allRoots) {
          const observer = observerCache.get(root)
          if (observer) {
            observer.disconnect()
            observerCache.delete(root)
          }
        }

        // Recreate all observers with new margin
        for (const root of allRoots) {
          const elements = allElements
            .filter(([, data]) => data.root === root)
            .map(([el]) => el)

          const newObserver = new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                virtCallbacks.get(entry.target)?.(entry.isIntersecting)
              }
            },
            { rootMargin: getVirtualizationMargin(), threshold: 0, root },
          )
          observerCache.set(root, newObserver)

          // Re-observe all elements
          for (const el of elements) {
            newObserver.observe(el)
          }
        }
      } catch (error) {
        // Silently fail on resize errors to prevent app crashes
        console.error('Error updating virtualization observers on resize:', error)
      }
    }, 250)
  }, { passive: true })
}

function getObserver(root: Element | null = null): IntersectionObserver {
  const cached = observerCache.get(root)
  if (cached) return cached

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        virtCallbacks.get(entry.target)?.(entry.isIntersecting)
      }
    },
    { rootMargin: getVirtualizationMargin(), threshold: 0, root },
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
  virtCallbacks.set(el, callback)
  trackedElements.set(el, { callback, root: root ?? null })
  observer.observe(el)
  return () => {
    virtCallbacks.delete(el)
    trackedElements.delete(el)
    observer.unobserve(el)
  }
}
