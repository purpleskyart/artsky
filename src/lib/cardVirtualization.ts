/**
 * Shared IntersectionObserver for card virtualization.
 *
 * Cards beyond VIRTUALIZATION_MARGIN are eligible for replacement with a
 * fixed-height placeholder, freeing images, video, HLS instances, and
 * per-card observers from memory. A single shared IO keeps overhead O(1)
 * regardless of how many cards exist.
 *
 * 2 000 px ≈ 2–3 desktop viewport-heights of buffer in each direction,
 * giving React enough time to re-mount content before it scrolls into view.
 */

const VIRTUALIZATION_MARGIN = '2000px 0px 2000px 0px'

type VirtCallback = (isNearViewport: boolean) => void

const virtCallbacks = new WeakMap<Element, VirtCallback>()
const observerCache = new Map<Element | null, IntersectionObserver>()

function getObserver(root: Element | null = null): IntersectionObserver {
  const cached = observerCache.get(root)
  if (cached) return cached

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        virtCallbacks.get(entry.target)?.(entry.isIntersecting)
      }
    },
    { rootMargin: VIRTUALIZATION_MARGIN, threshold: 0, root },
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
  observer.observe(el)
  return () => {
    virtCallbacks.delete(el)
    observer.unobserve(el)
  }
}
