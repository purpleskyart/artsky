/**
 * Path segments reserved for first-class app routes.
 * Two-segment paths `/:a/:b` are interpreted as `/:handle/:collectionSlug` only when `a` is not in this set.
 */
export const RESERVED_APP_PATH_SEGMENTS = new Set([
  'feed',
  'forum',
  'consensus',
  'collections',
  'post',
  'profile',
  'tag',
  'c',
  'login',
  'oauth',
  'client-metadata',
])

/** True when pathname is a two-segment board share URL `/handle/collection-slug` (first segment not a reserved app route). */
export function isHandleBoardPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/$/, '') || '/'
  const m = normalized.match(/^\/([^/]+)\/([^/]+)$/)
  if (!m) return false
  return !RESERVED_APP_PATH_SEGMENTS.has(m[1].toLowerCase())
}

/** Pages that render the multi-column masonry grid (same view-mode “All columns” layout as the home feed). */
export function isMultiColumnGridRoute(pathname: string): boolean {
  const normalized = pathname.replace(/\/$/, '') || '/'
  if (normalized === '/feed') return true
  if (normalized.startsWith('/tag/')) return true
  if (/^\/profile\/[^/]+$/.test(normalized)) return true
  return isHandleBoardPath(normalized)
}
