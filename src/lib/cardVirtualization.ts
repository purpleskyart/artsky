/**
 * Shared IntersectionObserver for card virtualization.
 *
 * Cards beyond the margin are replaced with fixed-height placeholders, freeing
 * images, video, HLS instances, and per-card observers from memory. A single
 * shared IO keeps overhead O(1) regardless of card count.
 *
 * Top margin is smaller than bottom so scrolled-past cards above the viewport
 * virtualize sooner; bottom keeps a larger buffer for smooth scroll-down.
 *
 * Modal scroll containers should not virtualize (see VirtualizedCell); only
 * window-scrolled grids use this module today (home feed + full-page grids).
 */

/** Viewport-height multiples for asymmetric rootMargin (top, bottom). */
export const VIRT_ROOT_MARGIN_VH = {
  /** Scrolled-past: virtualize once farther than this above the scrollport. */
  top: 0.5,
  /** Upcoming: keep mounted until this far below the scrollport. */
  bottom: 0.75,
} as const

type ViewBounds = { top: number; bottom: number }

type VirtCallback = (isNearViewport: boolean) => void

const virtCallbacks = new WeakMap<Element, VirtCallback>()
const nearState = new WeakMap<Element, boolean>()
const trackedElements = new Map<Element, { callback: VirtCallback; root: Element | null }>()
const observerCache = new Map<Element | null, IntersectionObserver>()
const scrollRefreshAttached = new WeakSet<Element | Window>()

let scrollRaf = 0
const pendingScrollRoots = new Set<Element | null>()

function getViewportHeight(): number {
  if (typeof window === 'undefined') return 800
  return window.innerHeight
}

function getRootHeight(root: Element | null): number {
  if (root) {
    const h = root.clientHeight
    if (h > 0) return h
    const rect = root.getBoundingClientRect()
    if (rect.height > 0) return rect.height
  }
  return getViewportHeight()
}

function getRootBounds(root: Element | null): ViewBounds {
  if (!root) {
    return { top: 0, bottom: getViewportHeight() }
  }
  const rect = root.getBoundingClientRect()
  return { top: rect.top, bottom: rect.bottom }
}

function getMargins(root: Element | null): { top: number; bottom: number } {
  const h = getRootHeight(root)
  return {
    top: Math.floor(h * VIRT_ROOT_MARGIN_VH.top),
    bottom: Math.floor(h * VIRT_ROOT_MARGIN_VH.bottom),
  }
}

function getVirtualizationRootMargin(root: Element | null): string {
  const { top, bottom } = getMargins(root)
  return `${top}px 0px ${bottom}px 0px`
}

/** Whether the element is inside the scrollport plus asymmetric margins. */
export function computeVirtualizationNear(el: Element, root: Element | null): boolean {
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 && rect.height <= 0) return nearState.get(el) ?? true

  const bounds = getRootBounds(root)
  const { top: topMargin, bottom: bottomMargin } = getMargins(root)
  const expandedTop = bounds.top - topMargin
  const expandedBottom = bounds.bottom + bottomMargin

  return rect.bottom > expandedTop && rect.top < expandedBottom
}

function deliverNear(el: Element, near: boolean): void {
  const prev = nearState.get(el)
  if (prev === near) return
  nearState.set(el, near)
  virtCallbacks.get(el)?.(near)
}

function updateElementNear(el: Element, root: Element | null): void {
  deliverNear(el, computeVirtualizationNear(el, root))
}

function refreshTrackedForRoot(root: Element | null): void {
  for (const [el, data] of trackedElements) {
    if (data.root !== root) continue
    updateElementNear(el, data.root)
  }
}

function scheduleScrollRefresh(root: Element | null): void {
  pendingScrollRoots.add(root)
  if (scrollRaf) return
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
    for (const r of pendingScrollRoots) {
      refreshTrackedForRoot(r)
    }
    pendingScrollRoots.clear()
  })
}

function attachScrollRefresh(root: Element | null): void {
  const target: Element | Window = root ?? window
  if (scrollRefreshAttached.has(target)) return
  scrollRefreshAttached.add(target)
  target.addEventListener('scroll', () => scheduleScrollRefresh(root), { passive: true })
}

function handleIntersectionEntries(entries: IntersectionObserverEntry[], root: Element | null): void {
  for (const entry of entries) {
    updateElementNear(entry.target, root)
  }
}

/** Re-check all cards observed against this scroll root (e.g. after modal scroll restore). */
export function refreshVirtualization(root?: Element | null): void {
  refreshTrackedForRoot(root ?? null)
}

// Clear stale module-level state on page load (fixes refresh issues)
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    trackedElements.clear()
    observerCache.forEach((observer) => observer.disconnect())
    observerCache.clear()
  })
  attachScrollRefresh(null)
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
            { rootMargin: getVirtualizationRootMargin(root), threshold: 0, root },
          )
          observerCache.set(root, newObserver)

          for (const el of elements) {
            newObserver.observe(el)
          }
          refreshTrackedForRoot(root)
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

  attachScrollRefresh(root)

  const observer = new IntersectionObserver(
    (entries) => handleIntersectionEntries(entries, root),
    { rootMargin: getVirtualizationRootMargin(root), threshold: 0, root },
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

  const sync = () => updateElementNear(el, rootEl)
  sync()
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(sync)
  }

  return () => {
    virtCallbacks.delete(el)
    trackedElements.delete(el)
    nearState.delete(el)
    observer.unobserve(el)
  }
}
