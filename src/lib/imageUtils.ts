/**
 * Image URL helpers for performance on low-end devices and poor connections.
 * - Resized avatars: avoid loading full-size images when displaying small
 * - WebP format preference for better compression
 */

/**
 * Detect if the browser supports WebP format
 * Uses a cached result to avoid repeated checks
 */
let webpSupported: boolean | null = null

export function supportsWebP(): boolean {
  if (webpSupported !== null) return webpSupported
  
  // Check if we're in a browser environment
  if (typeof document === 'undefined') {
    webpSupported = false
    return webpSupported
  }
  
  // Check if the browser supports WebP
  const canvas = document.createElement('canvas')
  if (canvas.getContext && canvas.getContext('2d')) {
    // Check for WebP support via data URL
    webpSupported = canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0
  } else {
    webpSupported = false
  }
  
  return webpSupported
}

/**
 * Reset WebP support detection (for testing purposes)
 * @internal
 */
export function resetWebPSupport() {
  webpSupported = null
}

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

/**
 * Convert an image URL to prefer WebP format with fallback
 * Uses wsrv.nl image transformation service which supports WebP output
 * 
 * Requirements: 5.4
 */
export function webpImageUrl(originalUrl: string | undefined | null, width?: number): string {
  if (!originalUrl || !originalUrl.startsWith('http')) return originalUrl ?? ''
  
  // Only apply WebP transformation if browser supports it
  if (!supportsWebP()) return originalUrl
  
  const encoded = encodeURIComponent(originalUrl)
  const widthParam = width ? `&w=${width}` : ''
  
  // Use wsrv.nl to serve WebP format
  // The service automatically converts images to WebP when output=webp is specified
  return `https://wsrv.nl/?url=${encoded}${widthParam}&output=webp`
}
