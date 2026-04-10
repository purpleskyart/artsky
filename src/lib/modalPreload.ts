import { getProfileCached, getPostsBatch } from './bsky'

let postOverlayPreloaded = false
let postDetailPagePreloaded = false
let profileOverlayPreloaded = false
let tagOverlayPreloaded = false
let profilePagePreloaded = false
let tagPagePreloaded = false
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

/** Preload the PostDetailPage route chunk for instant navigation on desktop. */
function preloadPostDetailPageChunk(): void {
  if (postDetailPagePreloaded) return
  postDetailPagePreloaded = true
  void import('../pages/PostDetailPage')
}

/** Profile overlay + lazy ProfileModal (preload inner chunk for first open). */
function preloadProfileOverlayChunks(): void {
  if (profileOverlayPreloaded) return
  profileOverlayPreloaded = true
  // Don't preload ProfileModal or ProfileModalOverlay to avoid circular dependency
  // React's lazy loading will handle it when needed
}

/** Preload the ProfilePage route chunk for instant navigation on desktop. */
function preloadProfilePageChunk(): void {
  if (profilePagePreloaded) return
  profilePagePreloaded = true
  void import('../pages/ProfileContent')
}

/** Tag modal overlay (preload chunk for first open). */
function preloadTagOverlayChunks(): void {
  if (tagOverlayPreloaded) return
  tagOverlayPreloaded = true
  void import('../components/TagModal')
}

/** Preload the TagPage route chunk for instant navigation on desktop. */
function preloadTagPageChunk(): void {
  if (tagPagePreloaded) return
  tagPagePreloaded = true
  void import('../pages/TagPage')
}

export function preloadPostOpen(uri: string): void {
  if (!uri) return
  preloadPostOverlayChunks()
  preloadPostDetailPageChunk()
  if (postPrefetchInFlight.has(uri)) return
  postPrefetchInFlight.add(uri)
  // Fetch only the post itself (no comments) to minimize data usage during hover
  // Comments will be fetched when the post actually opens
  void getPostsBatch([uri])
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
  preloadProfilePageChunk()
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

export function preloadTagOpen(tag: string): void {
  const normalized = tag.trim().replace(/^#/, '')
  if (!normalized) return
  preloadTagOverlayChunks()
  preloadTagPageChunk()
  // Tags don't require API prefetching - the page fetches its own feed
}
