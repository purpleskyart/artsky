/**
 * Post/thread cache for instant load when reopening posts.
 * - Caches getPostThread responses with TTL
 * - Deduplicates in-flight requests
 * - Holds initial post from feed for instant display when opening from feed
 */

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

type ThreadData = unknown
type Cached = { data: ThreadData; at: number }

const cache = new Map<string, Cached>()
const inFlight = new Map<string, Promise<{ data: ThreadData }>>()
const INITIAL_POST_STORE_MAX = 120
const initialPostStore = new Map<string, unknown>()

function trimInitialPostStore(): void {
  while (initialPostStore.size > INITIAL_POST_STORE_MAX) {
    const first = initialPostStore.keys().next().value
    if (first === undefined) break
    initialPostStore.delete(first)
  }
}

/** Store post from feed for instant display when opening. Call before openPostModal(uri). */
export function setInitialPostForUri(uri: string, postOrItem: unknown): void {
  initialPostStore.delete(uri)
  initialPostStore.set(uri, postOrItem)
  trimInitialPostStore()
}

/** Get and consume initial post for uri. Returns null if none. */
export function takeInitialPostForUri(uri: string): unknown {
  const v = initialPostStore.get(uri)
  initialPostStore.delete(uri)
  return v ?? null
}

/** Get cached thread if valid. */
export function getCachedThread(uri: string): ThreadData | null {
  const c = cache.get(uri)
  if (!c) return null
  if (Date.now() - c.at > CACHE_TTL_MS) {
    cache.delete(uri)
    return null
  }
  return c.data
}

/** Invalidate cached thread for a post URI so the next load fetches fresh data (e.g. after posting a reply). */
export function invalidateThreadCache(uri: string): void {
  cache.delete(uri)
}

/** Store thread in cache. */
export function setCachedThread(uri: string, data: ThreadData): void {
  cache.set(uri, { data, at: Date.now() })
  if (cache.size > 200) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)
    const toDelete = Math.floor(cache.size / 4)
    for (let i = 0; i < toDelete && i < oldest.length; i++) {
      cache.delete(oldest[i][0])
    }
  }
}

/** Deduplicated fetch: if a request for uri is in flight, return that promise. */
export function dedupeFetch<T>(
  uri: string,
  fetchFn: () => Promise<{ data: T }>,
): Promise<{ data: T }> {
  const existing = inFlight.get(uri)
  if (existing) return existing as Promise<{ data: T }>

  const p = fetchFn().then((res) => {
    inFlight.delete(uri)
    return res
  })
  inFlight.set(uri, p as Promise<{ data: unknown }>)
  return p
}
