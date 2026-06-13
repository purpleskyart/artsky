import { PAUSE_VISIBILITY_RATIO, PLAY_VISIBILITY_RATIO } from './videoHlsConfig'

type VisibilityCallback = (intersectionRatio: number, nearViewport: boolean) => void

/** Fallback when IntersectionObserver reports 0 despite the element being on-screen (common on iOS). */
function estimateIntersectionRatio(el: Element, root: Element | null): number {
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return 0

  const bounds = root
    ? root.getBoundingClientRect()
    : {
        top: 0,
        left: 0,
        bottom: typeof window !== 'undefined' ? window.innerHeight : 0,
        right: typeof window !== 'undefined' ? window.innerWidth : 0,
      }

  const overlapTop = Math.max(rect.top, bounds.top)
  const overlapBottom = Math.min(rect.bottom, bounds.bottom)
  const overlapLeft = Math.max(rect.left, bounds.left)
  const overlapRight = Math.min(rect.right, bounds.right)
  const overlapHeight = Math.max(0, overlapBottom - overlapTop)
  const overlapWidth = Math.max(0, overlapRight - overlapLeft)
  const overlapArea = overlapHeight * overlapWidth
  const totalArea = rect.width * rect.height
  return totalArea > 0 ? overlapArea / totalArea : 0
}

function isNearViewport(el: Element, root: Element | null): boolean {
  const rect = el.getBoundingClientRect()
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0
  const margin = vh * 0.5
  const bounds = root
    ? root.getBoundingClientRect()
    : { top: 0, bottom: vh, left: -Infinity, right: Infinity }

  return rect.bottom >= bounds.top - margin && rect.top <= bounds.bottom + margin
}

const callbacks = new WeakMap<Element, VisibilityCallback>()
const trackedElements = new Map<Element, { callback: VisibilityCallback; root: Element | null }>()
const observerCache = new Map<Element | null, IntersectionObserver>()

function getNearViewportMargin(): string {
  if (typeof window === 'undefined') return '50% 0px 50% 0px'
  const vh = window.innerHeight
  const margin = Math.floor(vh * 0.5)
  return `${margin}px 0px ${margin}px 0px`
}

function getObserver(root: Element | null = null): IntersectionObserver {
  const cached = observerCache.get(root)
  if (cached) return cached

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        let ratio = entry.intersectionRatio
        let near = entry.isIntersecting
        if (ratio < PAUSE_VISIBILITY_RATIO) {
          const tracked = trackedElements.get(entry.target)
          const estimated = estimateIntersectionRatio(entry.target, tracked?.root ?? null)
          if (estimated > ratio) {
            ratio = estimated
            near = near || isNearViewport(entry.target, tracked?.root ?? null)
          }
        }
        callbacks.get(entry.target)?.(ratio, near)
      }
    },
    {
      threshold: [0, PAUSE_VISIBILITY_RATIO, PLAY_VISIBILITY_RATIO, 0.75, 1],
      rootMargin: getNearViewportMargin(),
      root: root ?? undefined,
    },
  )
  observerCache.set(root, observer)
  return observer
}

export function observeVideoVisibility(
  el: Element,
  callback: VisibilityCallback,
  root?: Element | null,
): () => void {
  const observer = getObserver(root ?? null)
  callbacks.set(el, callback)
  trackedElements.set(el, { callback, root: root ?? null })
  observer.observe(el)
  return () => {
    callbacks.delete(el)
    trackedElements.delete(el)
    observer.unobserve(el)
  }
}

/** Force re-measure after layout settles (shared across all video observers). */
export function refreshVideoVisibilityObservers(): void {
  for (const [el, { root, callback }] of trackedElements) {
    const observer = observerCache.get(root)
    if (!observer) continue
    observer.unobserve(el)
    observer.observe(el)
    const pending = observer.takeRecords()
    if (pending.length > 0) {
      for (const entry of pending) {
        let ratio = entry.intersectionRatio
        let near = entry.isIntersecting
        if (ratio < PAUSE_VISIBILITY_RATIO) {
          const estimated = estimateIntersectionRatio(entry.target, root)
          if (estimated > ratio) {
            ratio = estimated
            near = near || isNearViewport(entry.target, root)
          }
        }
        callbacks.get(entry.target)?.(ratio, near)
      }
      continue
    }

    const estimatedRatio = estimateIntersectionRatio(el, root)
    if (estimatedRatio >= PAUSE_VISIBILITY_RATIO || isNearViewport(el, root)) {
      callback(estimatedRatio, isNearViewport(el, root))
    }
  }
}
