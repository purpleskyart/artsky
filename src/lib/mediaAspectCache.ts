const MAX_ENTRIES = 500
const cache = new Map<string, number>()

export function getCachedMediaAspect(url: string): number | undefined {
  const aspect = cache.get(url)
  return aspect != null && aspect > 0 ? aspect : undefined
}

export function setCachedMediaAspect(url: string, aspect: number): void {
  if (!url || aspect <= 0) return
  if (cache.size >= MAX_ENTRIES && !cache.has(url)) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(url, aspect)
}
