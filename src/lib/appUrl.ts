import { collectionRefToShortPathSegments } from './collections'

/** Site path including Vite base, e.g. `/artsky/post/...` or `/post/...`. */
export function appAbsolutePath(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
  return `${base}${p}`
}

/** Full URL for the current deployment (BrowserRouter + optional subdirectory base). */
export function appAbsoluteUrl(path: string): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}${appAbsolutePath(path)}`
}

/** Parse `at://did/app.bsky.feed.post/rkey` (rkey may contain `/` for future-proofing). */
export function parseBskyFeedPostUri(uri: string): { did: string; rkey: string } | null {
  const trimmed = uri.trim()
  if (!trimmed.startsWith('at://')) return null
  const withoutScheme = trimmed.slice('at://'.length)
  const parts = withoutScheme.split('/')
  if (parts.length < 3) return null
  const [did, collection, ...rkeyParts] = parts
  if (collection !== 'app.bsky.feed.post' || !did) return null
  const rkey = rkeyParts.join('/')
  return rkey ? { did, rkey } : null
}

/**
 * In-app path to open a post (matches Bluesky’s `/profile/handle/post/rkey` when author handle is known).
 * Falls back to `/post/{encoded at-uri}` when handle is missing.
 */
export function getPostAppPath(atUri: string, authorHandle?: string | null): string {
  const parsed = parseBskyFeedPostUri(atUri)
  if (parsed && authorHandle) {
    return `/profile/${encodeURIComponent(authorHandle)}/post/${encodeURIComponent(parsed.rkey)}`
  }
  return `/post/${encodeURIComponent(atUri)}`
}

/** In-app modal/navigation path that always resolves immediately (no handle->did lookup). */
export function getPostOverlayPath(atUri: string): string {
  return `/post/${encodeURIComponent(atUri)}`
}

/**
 * Public URL to open a post (same shape as bsky.app, with this deployment’s origin and base).
 * Pass `authorHandle` when known so the link is `/profile/handle/post/rkey` instead of a long encoded at-uri.
 */
export function getShareablePostUrl(atUri: string, authorHandle?: string | null): string {
  return appAbsoluteUrl(getPostAppPath(atUri, authorHandle))
}

/** Public URL for a profile tab. */
export function getShareableProfileUrl(handle: string): string {
  return appAbsoluteUrl(`/profile/${encodeURIComponent(handle)}`)
}

/**
 * Public URL to open a collection: `/handle/board-slug` (two-segment path).
 * Pass `boardSlug` from the loaded record so the path uses the name, not the internal rkey.
 */
export function getShareableCollectionUrl(
  collectionRef: string,
  ownerHandle?: string | null,
  boardSlug?: string | null
): string {
  const parts = collectionRefToShortPathSegments(collectionRef, { ownerHandle, boardSlug })
  if (!parts) return ''
  const path = `/${encodeURIComponent(parts.actor)}/${encodeURIComponent(parts.rkey)}`
  return appAbsoluteUrl(path)
}
