/**
 * Persist which suggested-follow DIDs we've shown so we can rotate them:
 * don't show the same account again until ROTATION_DAYS_MS has passed.
 */

const RECOMMENDATIONS_SHOWN_KEY = 'artsky-recommendations-shown'
const ROTATION_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const MAX_ENTRIES = 500

export function getRecommendationsShown(): Record<string, number> {
  try {
    const raw = localStorage.getItem(RECOMMENDATIONS_SHOWN_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, number>
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

export function markRecommendationsShown(dids: string[]): void {
  if (dids.length === 0) return
  const now = Date.now()
  const prev = getRecommendationsShown()
  const next = { ...prev }
  for (const did of dids) {
    next[did] = now
  }
  const entries = Object.entries(next)
  const toSave =
    entries.length <= MAX_ENTRIES
      ? entries
      : entries
          .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
          .slice(0, MAX_ENTRIES)
  try {
    localStorage.setItem(RECOMMENDATIONS_SHOWN_KEY, JSON.stringify(Object.fromEntries(toSave)))
  } catch {
    // ignore
  }
}

/** Cutoff: only show DIDs that were never shown or were shown before this time (so they can reappear after rotation). */
export function getRotationCutoff(): number {
  return Date.now() - ROTATION_DAYS_MS
}
