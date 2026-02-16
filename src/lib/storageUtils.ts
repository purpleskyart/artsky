/**
 * Storage and cache management utilities for the Settings/Cache page.
 * Handles localStorage estimation, Cache API usage, and clearing operations.
 */

/** Image cache name from vite.config workbox runtimeCaching */
export const IMAGE_CACHE_NAME = 'artsky-images'

/** Approximate localStorage usage (keys + values) for artsky-* items */
export function getLocalStorageUsage(): { totalBytes: number; keys: string[] } {
  const keys: string[] = []
  let totalBytes = 0
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith('artsky-')) {
        keys.push(key)
        const val = localStorage.getItem(key) ?? ''
        totalBytes += (key.length + val.length) * 2 // UTF-16
      }
    }
  } catch {
    /* ignore */
  }
  return { totalBytes, keys }
}

export type CacheUsage = {
  name: string
  bytes: number
  entries: number
}

/** Get Cache API storage usage. Returns estimate per cache. */
export async function getCacheUsage(): Promise<CacheUsage[]> {
  const result: CacheUsage[] = []
  try {
    if (!('caches' in self)) return result
    const names = await caches.keys()
    for (const name of names) {
      const cache = await caches.open(name)
      const keys = await cache.keys()
      let bytes = 0
      for (const req of keys) {
        try {
          const res = await cache.match(req)
          if (res?.body) {
            const blob = await res.blob()
            bytes += blob.size
          }
        } catch {
          bytes += 1024 // fallback estimate per entry
        }
      }
      result.push({ name, bytes, entries: keys.length })
    }
  } catch {
    /* ignore */
  }
  return result
}

/** Total storage usage: localStorage + all caches */
export async function getTotalStorageUsage(): Promise<{
  localStorageBytes: number
  cacheBytes: number
  cacheBreakdown: CacheUsage[]
}> {
  const { totalBytes: localStorageBytes } = getLocalStorageUsage()
  const cacheBreakdown = await getCacheUsage()
  const cacheBytes = cacheBreakdown.reduce((s, c) => s + c.bytes, 0)
  return { localStorageBytes, cacheBytes, cacheBreakdown }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

/** Clear the image cache (artsky-images) */
export async function clearImageCache(): Promise<void> {
  try {
    if ('caches' in self) {
      await caches.delete(IMAGE_CACHE_NAME)
    }
  } catch {
    /* ignore */
  }
}

/** Clear all service worker caches */
export async function clearAllCaches(): Promise<void> {
  try {
    if ('caches' in self) {
      const names = await caches.keys()
      await Promise.all(names.map((n) => caches.delete(n)))
    }
  } catch {
    /* ignore */
  }
}

/** Clear all ArtSky local storage (artboards, drafts, settings, sessions, etc.). Logs user out. */
export function clearLocalData(): void {
  const { keys } = getLocalStorageUsage()
  for (const key of keys) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  }
}
