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
let sharedObserver: IntersectionObserver | null = null

function getSharedObserver(): IntersectionObserver {
  if (sharedObserver) return sharedObserver
  sharedObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        virtCallbacks.get(entry.target)?.(entry.isIntersecting)
      }
    },
    { rootMargin: VIRTUALIZATION_MARGIN, threshold: 0 },
  )
  return sharedObserver
}

export function observeVirtualization(
  el: Element,
  callback: VirtCallback,
): () => void {
  const observer = getSharedObserver()
  virtCallbacks.set(el, callback)
  observer.observe(el)
  return () => {
    virtCallbacks.delete(el)
    observer.unobserve(el)
  }
}
