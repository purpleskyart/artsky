/**
 * Image URL helpers for performance on low-end devices and poor connections.
 * - Resized avatars: avoid loading full-size images when displaying small
 */

/** Return a URL that serves the image resized (e.g. for avatars). Reduces bandwidth. */
export function resizedImageUrl(originalUrl: string | undefined | null, displaySizePx: number): string {
  if (!originalUrl || !originalUrl.startsWith('http')) return originalUrl ?? ''
  const size = Math.min(256, Math.max(displaySizePx * 2, 40))
  const encoded = encodeURIComponent(originalUrl)
  return `https://wsrv.nl/?url=${encoded}&w=${size}&h=${size}&fit=cover`
}

/** For avatars - alias for clarity. */
export function resizedAvatarUrl(originalUrl: string | undefined | null, displaySizePx: number): string {
  return resizedImageUrl(originalUrl, displaySizePx)
}
