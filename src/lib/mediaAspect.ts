import { getCachedMediaAspect } from './mediaAspectCache'

/** Relative tolerance when comparing API aspect ratio to measured dimensions. */
const ASPECT_MISMATCH_RATIO = 0.08

/** Placeholder before API/cache/measured — portrait-leaning default for art feeds. */
export const DEFAULT_PLACEHOLDER_ASPECT = 4 / 5

export function isAspectMismatch(
  apiAspect: number,
  measuredWidth: number,
  measuredHeight: number,
): boolean {
  if (measuredWidth <= 0 || measuredHeight <= 0) return false
  const measured = measuredWidth / measuredHeight
  const ratio = measured / apiAspect
  return ratio < 1 - ASPECT_MISMATCH_RATIO || ratio > 1 + ASPECT_MISMATCH_RATIO
}

/** True when layout should be updated from measured pixels (missing or suspect API). */
export function shouldCorrectLayoutAspect(
  apiAspect: number | null | undefined,
  measuredWidth: number,
  measuredHeight: number,
): boolean {
  if (measuredWidth <= 0 || measuredHeight <= 0) return false
  if (apiAspect == null || apiAspect <= 0) return true
  return isAspectMismatch(apiAspect, measuredWidth, measuredHeight)
}

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
 * Pick the best aspect ratio for card layout: prefer API metadata when it matches
 * measured dimensions; otherwise use measured (missing or suspect API values).
 */
export function resolveMediaAspect(
  apiAspect: number | null | undefined,
  measuredWidth: number,
  measuredHeight: number,
): number {
  if (measuredWidth <= 0 || measuredHeight <= 0) {
    return apiAspect != null && apiAspect > 0 ? apiAspect : DEFAULT_PLACEHOLDER_ASPECT
  }
  const measured = measuredWidth / measuredHeight
  if (apiAspect == null || apiAspect <= 0) return measured
  if (isAspectMismatch(apiAspect, measuredWidth, measuredHeight)) return measured
  return apiAspect
}
