/**
 * Post/thread cache for instant load when reopening posts.
 * - Caches getPostThread responses with TTL
 * - Deduplicates in-flight requests
 * - Holds initial post from feed for instant display when opening from feed
 */

import { getSession } from './bsky'

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/** Thread responses include viewer-specific state (likes, follows); scope by logged-in account. */
function threadStorageKey(uri: string): string {
  const did = getSession()?.did
  return `${uri}::${did ?? 'guest'}`
}

type ThreadData = unknown
type Cached = { data: ThreadData; at: number }

const cache = new Map<string, Cached>()
const inFlight = new Map<string, Promise<{ data: ThreadData }>>()
/** Bumped when a thread is invalidated so in-flight getPostThread results are not applied (stale deduped fetch). */
const threadFetchEpoch = new Map<string, number>()
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
  const key = threadStorageKey(uri)
  const c = cache.get(key)
  if (!c) return null
  if (Date.now() - c.at > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return c.data
}

/** Monotonic epoch for thread URI; used to discard stale in-flight fetches after invalidation. */
export function getThreadFetchEpoch(uri: string): number {
  return threadFetchEpoch.get(threadStorageKey(uri)) ?? 0
}

/** Invalidate cached thread for a post URI so the next load fetches fresh data (e.g. after posting a reply). */
export function invalidateThreadCache(uri: string): void {
  const key = threadStorageKey(uri)
  cache.delete(key)
  inFlight.delete(key)
  threadFetchEpoch.set(key, (threadFetchEpoch.get(key) ?? 0) + 1)
}

/** Store thread in cache. */
export function setCachedThread(uri: string, data: ThreadData): void {
  const key = threadStorageKey(uri)
  cache.set(key, { data, at: Date.now() })
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
  const key = threadStorageKey(uri)
  const existing = inFlight.get(key)
  if (existing) return existing as Promise<{ data: T }>

  const p = fetchFn().then((res) => {
    inFlight.delete(key)
    return res
  })
  inFlight.set(key, p as Promise<{ data: unknown }>)
  return p
}
