import { getCachedMediaAspect } from './mediaAspectCache'

/** Placeholder before API/cache/measured — portrait-leaning default for art feeds. */
export const DEFAULT_PLACEHOLDER_ASPECT = 4 / 5

/** Reserve card space: cache → API → null (caller may use placeholder). */
export function initialLayoutAspect(
  url: string | undefined,
  apiAspect: number | null | undefined,
): number | null {
  if (url) {
    const cached = getCachedMediaAspect(url)
    if (cached != null) return cached
  }
  if (apiAspect != null && apiAspect > 0) return apiAspect
  return null
}

/**
 * Pick aspect ratio for card layout: measured pixels when available, else API, else placeholder.
 * Always prefers measured dimensions so cards match the actual image (no letterbox/crop drift).
 */
export function resolveMediaAspect(
  apiAspect: number | null | undefined,
  measuredWidth: number,
  measuredHeight: number,
): number {
  if (measuredWidth > 0 && measuredHeight > 0) {
    return measuredWidth / measuredHeight
  }
  if (apiAspect != null && apiAspect > 0) return apiAspect
  return DEFAULT_PLACEHOLDER_ASPECT
}
