import { PAUSE_VISIBILITY_RATIO, PLAY_VISIBILITY_RATIO } from './videoHlsConfig'

type VisibilityCallback = (intersectionRatio: number, nearViewport: boolean) => void

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
        callbacks.get(entry.target)?.(entry.intersectionRatio, entry.isIntersecting)
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
  for (const [el, { root }] of trackedElements) {
    const observer = observerCache.get(root)
    if (!observer) continue
    observer.unobserve(el)
    observer.observe(el)
    const pending = observer.takeRecords()
    for (const entry of pending) {
      callbacks.get(entry.target)?.(entry.intersectionRatio, entry.isIntersecting)
    }
  }
}
