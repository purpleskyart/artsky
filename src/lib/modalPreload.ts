import { agent, getPostThreadCached, getProfileCached, getSession, publicAgent } from './bsky'

let overlayChunksPreloaded = false
const postPrefetchInFlight = new Set<string>()
const profilePrefetchInFlight = new Set<string>()

export function preloadOverlayChunks(): void {
  if (overlayChunksPreloaded) return
  overlayChunksPreloaded = true
  void import('../components/PostModalOverlay')
  void import('../components/ProfileModalOverlay')
  void import('../components/PostDetailModal')
  void import('../components/ProfileModal')
}

export function preloadPostOpen(uri: string): void {
  if (!uri) return
  preloadOverlayChunks()
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
  preloadOverlayChunks()
  if (profilePrefetchInFlight.has(normalized)) return
  profilePrefetchInFlight.add(normalized)
  void getProfileCached(normalized)
    .catch(() => {
      // Best-effort prefetch only.
    })
    .finally(() => {
      profilePrefetchInFlight.delete(normalized)
    })
}
