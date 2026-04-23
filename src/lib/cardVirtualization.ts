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

// Handle window resize to update observers with new margin
if (typeof window !== 'undefined') {
  let resizeTimeout: ReturnType<typeof setTimeout> | undefined
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout)
    resizeTimeout = setTimeout(() => {
      // Recreate all observers with new margin
      for (const [root, observer] of observerCache.entries()) {
        const elements = Array.from(trackedElements.entries())
          .filter(([, data]) => data.root === root)
          .map(([el]) => el)
        observer.disconnect()
        observerCache.delete(root)

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
    }, 100)
  })
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
