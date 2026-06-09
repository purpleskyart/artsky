const MAX_LIKE_OVERRIDE_KEYS = 500

export type LikeOverridesCache = Record<string, string | null | undefined>

let cache: LikeOverridesCache = {}
const listeners = new Set<() => void>()
const uriListeners = new Map<string, Set<() => void>>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function emitUri(postUri: string): void {
  const set = uriListeners.get(postUri)
  if (!set) return
  for (const listener of set) {
    listener()
  }
}

export function subscribeLikeOverrideUri(postUri: string, listener: () => void): () => void {
  let set = uriListeners.get(postUri)
  if (!set) {
    set = new Set()
    uriListeners.set(postUri, set)
  }
  set.add(listener)
  return () => {
    set!.delete(listener)
    if (set!.size === 0) uriListeners.delete(postUri)
  }
}

function prune(next: LikeOverridesCache): LikeOverridesCache {
  const keys = Object.keys(next)
  if (keys.length <= MAX_LIKE_OVERRIDE_KEYS) return next
  const keep = keys.slice(-MAX_LIKE_OVERRIDE_KEYS)
  const pruned: LikeOverridesCache = {}
  for (const k of keep) pruned[k] = next[k]
  return pruned
}

export function getLikeOverridesSnapshot(): LikeOverridesCache {
  return cache
}

export function subscribeLikeOverrides(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setLikeOverrideInStore(postUri: string, likeUri: string | null): void {
  cache = prune({ ...cache, [postUri]: likeUri })
  emit()
  emitUri(postUri)
}

export function clearLikeOverridesInStore(): void {
  cache = {}
  emit()
}

export function getLikeOverrideFromStore(postUri: string): string | null | undefined {
  return cache[postUri]
}

export function resetLikeOverridesStore(): void {
  cache = {}
  emit()
}
