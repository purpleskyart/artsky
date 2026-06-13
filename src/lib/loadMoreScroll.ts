/** Per-column debounce between automatic load-more triggers. */
export const LOAD_MORE_COOLDOWN_MS = 450

/** Cooldown after a retry-triggered load to prevent infinite short-column chaining. */
export const LOAD_MORE_RETRY_COOLDOWN_MS = 2000

/** Viewport-height multiplier for load-more prefetch (~150%). */
export const LOAD_MORE_ROOT_MARGIN_VIEWPORT_RATIO = 1.5

/** Min gap (px) between viewport bottom and a column sentinel to count as "short". */
export const LOAD_MORE_SHORT_MARGIN_PX = 300

export function getViewportHeight(): number {
  const vv = window.visualViewport
  return vv ? vv.height : window.innerHeight
}

/** Pixel rootMargin (~150% viewport height) for IntersectionObserver load-more. */
export function getLoadMoreRootMarginPx(): number {
  return Math.floor(getViewportHeight() * LOAD_MORE_ROOT_MARGIN_VIEWPORT_RATIO)
}

export function getLoadMoreRootMargin(): string {
  return `${getLoadMoreRootMarginPx()}px`
}

/** Viewport Y below which a column sentinel counts as "short" (visible gap below). */
export function getShortColumnThreshold(): number {
  const vh = getViewportHeight()
  const margin = Math.min(LOAD_MORE_SHORT_MARGIN_PX, Math.floor(vh * 0.4))
  return vh - margin
}

export function resolveModalScrollRoot(sentinel: Element | null | undefined): Element | null {
  return sentinel?.closest('[data-modal-scroll]') ?? null
}
