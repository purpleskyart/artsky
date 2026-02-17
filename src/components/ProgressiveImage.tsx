import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { webpImageUrl } from '../lib/imageUtils'
import styles from './ProgressiveImage.module.css'

interface ProgressiveImageProps {
  src: string
  alt: string
  aspectRatio?: number
  loading?: 'lazy' | 'eager'
  className?: string
  onLoad?: (e: React.SyntheticEvent<HTMLImageElement>) => void
  /**
   * Array of image widths to generate srcset for responsive sizing
   * If not provided, defaults to [320, 640, 960, 1280, 1920]
   */
  sizes?: number[]
  /**
   * Sizes attribute for responsive image selection
   * If not provided, defaults to viewport-based sizing
   */
  sizesAttr?: string
  /**
   * Maximum number of retry attempts for failed image loads
   * Defaults to 3
   */
  maxRetries?: number
  /**
   * Distance from viewport (in pixels) at which to start preloading
   * Defaults to 1500px - images start loading before they enter viewport
   */
  preloadDistance?: number
}

/**
 * ProgressiveImage component with blur-up placeholder loading
 * 
 * Features:
 * - Displays a blur-up placeholder while the full image loads
 * - Supports lazy/eager loading modes with intelligent preloading
 * - Maintains aspect ratio to prevent layout shift
 * - Smooth transition from placeholder to full image
 * - Prefers WebP format with automatic fallback for unsupported browsers
 * - Responsive image sizing with srcset for optimal bandwidth usage
 * - Retry logic with exponential backoff for failed image loads (up to 3 retries)
 * - Displays error placeholder for permanently failed images
 * - Preloads images before they reach viewport (1500px ahead by default)
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */
export function ProgressiveImage({
  src,
  alt,
  aspectRatio,
  loading = 'lazy',
  className = '',
  onLoad,
  sizes = [320, 640, 960, 1280, 1920],
  sizesAttr,
  maxRetries = 3,
  preloadDistance = 1500
}: ProgressiveImageProps) {
  /** If onLoad never fires (e.g. cached image, or slow/hung request), stop showing blur after this ms */
  const LOAD_REVEAL_TIMEOUT_MS = 12_000

  const [isLoaded, setIsLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [permanentError, setPermanentError] = useState(false)
  const [placeholderError, setPlaceholderError] = useState(false)
  const [shouldPreload, setShouldPreload] = useState(loading === 'eager')
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)
  
  // Convert to WebP format if browser supports it
  // Falls back to original URL if WebP is not supported or if WebP conversion fails
  const webpSrc = useMemo(() => webpImageUrl(src), [src])
  
  // Generate srcset with multiple image sizes for responsive loading
  // This allows the browser to select the most appropriate image size based on viewport
  const srcSet = useMemo(() => {
    // Only generate srcset for Bluesky CDN images that support resizing
    if (!src.includes('cdn.bsky.app')) {
      return undefined
    }
    
    return sizes
      .map(width => {
        // Generate URL with width parameter for CDN resizing
        const resizedUrl = src.includes('?') 
          ? `${src}&width=${width}` 
          : `${src}?width=${width}`
        const webpUrl = webpImageUrl(resizedUrl)
        return `${webpUrl} ${width}w`
      })
      .join(', ')
  }, [src, sizes])
  
  // Default sizes attribute based on common viewport breakpoints
  // This tells the browser what size the image will be at different viewport widths
  const defaultSizesAttr = useMemo(() => {
    return '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw'
  }, [])
  
  const finalSizesAttr = sizesAttr || defaultSizesAttr
  
  // Generate blur placeholder from thumbnail
  // For Bluesky CDN images, use a tiny version as blur-up placeholder
  const placeholderSrc = useMemo(() => {
    if (src.includes('cdn.bsky.app')) {
      // Replace the size variant (feed_fullsize, feed_thumbnail, avatar, etc.) with avatar_thumbnail
      // This handles URLs like: /img/feed_fullsize/... or /img/avatar/...
      return src.replace(/\/img\/[^/]+\//, '/img/avatar_thumbnail/')
    }
    return undefined
  }, [src])
  
  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current)
      loadTimeoutRef.current = null
    }
    setIsLoaded(true)
    setImageError(false)
    setPermanentError(false)
    setRetryCount(0)
    onLoad?.(e)
  }, [onLoad])
  
  const handlePlaceholderError = useCallback(() => {
    // Silently hide placeholder if it fails to load
    setPlaceholderError(true)
  }, [])
  
  const handleImageError = useCallback(() => {
    // If WebP fails, fall back to original URL
    if (!imageError && webpSrc !== src) {
      setImageError(true)
      return
    }
    
    // If we haven't exceeded max retries, retry with exponential backoff
    if (retryCount < maxRetries) {
      const backoffDelay = Math.pow(2, retryCount) * 1000 // 1s, 2s, 4s
      
      retryTimeoutRef.current = setTimeout(() => {
        setRetryCount(prev => prev + 1)
        // Force image reload by updating a state that triggers re-render
        setImageError(false)
      }, backoffDelay)
    } else {
      // All retries exhausted, mark as permanent error
      setPermanentError(true)
    }
  }, [imageError, webpSrc, src, retryCount, maxRetries])
  
  // Cleanup timeouts and observer on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current)
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current)
      if (observerRef.current) observerRef.current.disconnect()
    }
  }, [])
  
  // Set up IntersectionObserver to preload images before they enter viewport
  useEffect(() => {
    // Skip if already eager loading or if already loaded
    if (loading === 'eager' || isLoaded) {
      setShouldPreload(true)
      return
    }
    
    const container = containerRef.current
    if (!container) return
    
    // Create observer with large rootMargin to trigger preloading early
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            // Image is approaching viewport - start loading
            setShouldPreload(true)
            // Once we start preloading, we can disconnect the observer
            if (observerRef.current) {
              observerRef.current.disconnect()
            }
          }
        }
      },
      {
        // Large rootMargin ensures images start loading well before entering viewport
        rootMargin: `${preloadDistance}px 0px ${preloadDistance}px 0px`,
        threshold: 0,
      }
    )
    
    observerRef.current.observe(container)
    
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
      }
    }
  }, [loading, preloadDistance, isLoaded])
  
  // Reset retry state when src changes
  useEffect(() => {
    setRetryCount(0)
    setPermanentError(false)
    setIsLoaded(false)
    setImageError(false)
    setPlaceholderError(false)
    setShouldPreload(loading === 'eager')
  }, [src, loading])

  // When we're loading the full image: (1) check if already complete (e.g. cache), (2) fallback timeout so blur doesn't stick forever
  // Use WebP URL first, fall back to original if error occurs
  const currentSrc = imageError ? src : webpSrc

  useEffect(() => {
    if (!shouldPreload || isLoaded || permanentError) return

    const checkComplete = () => {
      const img = imgRef.current
      if (img?.complete && img.naturalWidth > 0) {
        if (loadTimeoutRef.current) {
          clearTimeout(loadTimeoutRef.current)
          loadTimeoutRef.current = null
        }
        setIsLoaded(true)
      }
    }

    // Cached images may complete before onLoad runs; check after paint
    const rafId = requestAnimationFrame(() => checkComplete())

    loadTimeoutRef.current = setTimeout(() => {
      loadTimeoutRef.current = null
      if (!isLoaded) setIsLoaded(true) // reveal image so we don't stay on blur forever
    }, LOAD_REVEAL_TIMEOUT_MS)

    return () => {
      cancelAnimationFrame(rafId)
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current)
        loadTimeoutRef.current = null
      }
    }
  }, [shouldPreload, currentSrc, retryCount, isLoaded, permanentError])
  
  // If permanently failed, show error placeholder
  if (permanentError) {
    return (
      <div 
        className={`${styles.progressiveImage} ${styles.error} ${className}`}
        style={{ aspectRatio: aspectRatio ? String(aspectRatio) : undefined }}
        role="img"
        aria-label={`Failed to load: ${alt}`}
      >
        <div className={styles.errorPlaceholder}>
          <svg 
            width="48" 
            height="48" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          <span className={styles.errorText}>Image failed to load</span>
        </div>
      </div>
    )
  }
  
  return (
    <div 
      ref={containerRef}
      className={`${styles.progressiveImage} ${isLoaded ? styles.loaded : ''} ${className}`}
      style={{ aspectRatio: aspectRatio ? String(aspectRatio) : undefined }}
    >
      {placeholderSrc && !isLoaded && !placeholderError && (
        <img 
          src={placeholderSrc} 
          alt="" 
          className={styles.placeholder}
          aria-hidden="true"
          onError={handlePlaceholderError}
        />
      )}
      <img
        ref={imgRef}
        key={`${currentSrc}-${retryCount}`} // Force reload on retry
        src={currentSrc}
        srcSet={srcSet}
        sizes={srcSet ? finalSizesAttr : undefined}
        alt={alt}
        loading={shouldPreload ? 'eager' : 'lazy'}
        onLoad={handleImageLoad}
        onError={handleImageError}
        className={styles.fullImage}
      />
    </div>
  )
}
