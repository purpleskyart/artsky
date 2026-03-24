/** Vite base without slashes, e.g. '' or 'artsky' */
function basePathSegment(): string {
  return (import.meta.env.BASE_URL || '/').replace(/\/$/, '').replace(/^\//, '')
}

/**
 * Public URL to open a post (HashRouter + optional subdirectory base).
 * Example: https://host/#/post/at%3A... or https://host/artsky/#/post/...
 */
export function getShareablePostUrl(atUri: string): string {
  if (typeof window === 'undefined') return ''
  const seg = basePathSegment()
  const path = `/post/${encodeURIComponent(atUri)}`
  return seg
    ? `${window.location.origin}/${seg}/#${path}`
    : `${window.location.origin}/#${path}`
}

/** Public URL for a profile tab (HashRouter + base). */
export function getShareableProfileUrl(handle: string): string {
  if (typeof window === 'undefined') return ''
  const seg = basePathSegment()
  const path = `/profile/${encodeURIComponent(handle)}`
  return seg
    ? `${window.location.origin}/${seg}/#${path}`
    : `${window.location.origin}/#${path}`
}

/** Public URL to open a saved collection (feed + modal query; HashRouter + optional base). */
export function getShareableCollectionUrl(collectionAtUri: string): string {
  if (typeof window === 'undefined') return ''
  const seg = basePathSegment()
  const path = `/feed?collection=${encodeURIComponent(collectionAtUri)}`
  return seg
    ? `${window.location.origin}/${seg}/#${path}`
    : `${window.location.origin}/#${path}`
}
