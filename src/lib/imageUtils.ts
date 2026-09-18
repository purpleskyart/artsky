/** Read pixel dimensions from a local image file (for gallery embed aspectRatio). */
export function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to read image dimensions'))
    }
    img.src = url
  })
}

/**
 * Image URL helpers for performance on low-end devices and poor connections.
 * - Resized avatars: avoid loading full-size images when displaying small
 * - WebP format preference for better compression
 *
 * Uses Bluesky CDN's native capabilities (cdn.bsky.app) instead of external proxies.
 * The CDN supports:
 * - ?format=webp for WebP conversion
 * - ?width=N for image resizing
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
  
  // Use Bluesky CDN's native width parameter
  const separator = originalUrl.includes('?') ? '&' : '?'
  return `${originalUrl}${separator}width=${size}`
}

/** For avatars - alias for clarity. */
export function resizedAvatarUrl(originalUrl: string | undefined | null, displaySizePx: number): string {
  return resizedImageUrl(originalUrl, displaySizePx)
}

/**
 * Convert an image URL to prefer WebP format with fallback
 * Uses Bluesky CDN's native format parameter for WebP conversion
 * 
 * Requirements: 5.4
 */
export function webpImageUrl(originalUrl: string | undefined | null, width?: number): string {
  if (!originalUrl || !originalUrl.startsWith('http')) return originalUrl ?? ''
  
  // Only apply WebP transformation if browser supports it
  if (!supportsWebP()) return originalUrl
  
  // Use Bluesky CDN's native format parameter
  const separator = originalUrl.includes('?') ? '&' : '?'
  const widthParam = width ? `&width=${width}` : ''
  
  return `${originalUrl}${separator}format=webp${widthParam}`
}

/** Tighter srcset / preload margins on small or save-data connections. */
export function getProgressiveImageDefaults(): { sizes: number[]; preloadDistance: number } {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  const conn = nav ? (nav as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection : undefined
  if (conn?.saveData) {
    return { sizes: [320, 480, 640], preloadDistance: 1200 }
  }
  if (conn?.effectiveType === '2g' || conn?.effectiveType === 'slow-2g') {
    return { sizes: [320, 480], preloadDistance: 600 }
  }
  if (typeof window !== 'undefined' && window.innerWidth > 0 && window.innerWidth < 720) {
    return { sizes: [320, 480, 640, 960], preloadDistance: 1400 }
  }
  return { sizes: [320, 640, 960, 1280], preloadDistance: 2000 }
}
