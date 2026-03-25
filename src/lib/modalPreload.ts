import { agent, getPostThreadCached, getProfileCached, getSession, publicAgent } from './bsky'

let postOverlayPreloaded = false
let profileOverlayPreloaded = false
const postPrefetchInFlight = new Set<string>()
const profilePrefetchInFlight = new Set<string>()
const preloadedProfileByHandle = new Map<string, {
  handle?: string
  displayName?: string
  avatar?: string
  description?: string
  did?: string
  viewer?: { following?: string; blocking?: string }
  verification?: { verifiedStatus?: string }
  createdAt?: string
  indexedAt?: string
}>()

/** Post modal overlay pulls in PostDetailModal; no separate import needed. */
function preloadPostOverlayChunks(): void {
  if (postOverlayPreloaded) return
  postOverlayPreloaded = true
  void import('../components/PostModalOverlay')
}

/** Profile overlay + lazy ProfileModal (preload inner chunk for first open). */
function preloadProfileOverlayChunks(): void {
  if (profileOverlayPreloaded) return
  profileOverlayPreloaded = true
  void import('../components/ProfileModalOverlay')
  void import('../components/ProfileModal')
}

export function preloadPostOpen(uri: string): void {
  if (!uri) return
  preloadPostOverlayChunks()
  if (postPrefetchInFlight.has(uri)) return
  postPrefetchInFlight.add(uri)
  const api = getSession() ? agent : publicAgent
  void getPostThreadCached(uri, api)
    .catch(() => {
      // Best-effort prefetch only.
    })
    .finally(() => {
      postPrefetchInFlight.delete(uri)
    })
}

export function preloadProfileOpen(handle: string): void {
  const normalized = handle.trim()
  if (!normalized) return
  preloadProfileOverlayChunks()
  if (profilePrefetchInFlight.has(normalized)) return
  profilePrefetchInFlight.add(normalized)
  void getProfileCached(normalized)
    .then((data) => {
      preloadedProfileByHandle.set(normalized.toLowerCase(), data)
    })
    .catch(() => {
      // Best-effort prefetch only.
    })
    .finally(() => {
      profilePrefetchInFlight.delete(normalized)
    })
}

export function getPreloadedProfileSnapshot(handle: string) {
  return preloadedProfileByHandle.get(handle.trim().toLowerCase()) ?? null
}
