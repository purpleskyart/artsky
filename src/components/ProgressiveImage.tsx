import { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import { webpImageUrl, getProgressiveImageDefaults } from '../lib/imageUtils'
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
   * If not provided, defaults adapt to viewport / save-data
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
   * If not provided, defaults adapt to viewport / save-data
   */
  preloadDistance?: number
  /**
   * `contain` letterboxes the image so it is never cropped (uses max width/height of the box).
   * Default `cover` fills the aspect-ratio box and may crop edges.
   */
  objectFit?: 'cover' | 'contain'
  /**
   * Custom scroll container element to use as IntersectionObserver root
   * If not provided, defaults to viewport
   * Useful for modal contexts where the scrollable area is within the modal
   */
  root?: Element | null
}

type ObserverPoolEntry = {
  observer: IntersectionObserver
  callbacks: WeakMap<Element, () => void>
}
const observerPool = new Map<string, ObserverPoolEntry>()

function getObserverPoolEntry(preloadDistance: string, root: Element | null): ObserverPoolEntry | null {
  if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return null
  const margin = preloadDistance
  const rootId = root ? (root as any).__progressiveImageRootId ??= Math.random().toString(36).slice(2) : 'viewport'
  const key = `${margin}|${margin}|${margin}|${margin}|${rootId}`
  const existing = observerPool.get(key)
  if (existing) return existing
  const callbacks = new WeakMap<Element, () => void>()
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const cb = callbacks.get(entry.target)
        if (!cb) continue
        callbacks.delete(entry.target)
        observer.unobserve(entry.target)
        cb()
      }
    },
    { rootMargin: `${margin} ${margin} ${margin} ${margin}`, threshold: 0, root }
  )
  const created = { observer, callbacks }
  observerPool.set(key, created)
  return created
}

/**
 * ProgressiveImage component with blur-up placeholder loading
 *
 * Features:
 * - Displays a blur-up placeholder while the full image loads (skipped when save-data is on)
 * - Defers assigning src until near viewport (IntersectionObserver) or eager
 * - Prefers WebP with fallback
 * - Responsive srcset sized for connection / viewport
 */
export function ProgressiveImage({
  src,
  alt,
  aspectRatio,
  loading = 'lazy',
  className = '',
  onLoad,
  sizes: sizesProp,
  sizesAttr,
  maxRetries = 3,
  preloadDistance: preloadDistanceProp,
  objectFit = 'cover',
  root,
}: ProgressiveImageProps) {
  const LOAD_REVEAL_TIMEOUT_MS = 12_000

  const tuning = useMemo(() => getProgressiveImageDefaults(), [])
  const sizes = sizesProp ?? tuning.sizes
  const preloadDistance = preloadDistanceProp ?? tuning.preloadDistance

  const saveData =
    typeof navigator !== 'undefined' &&
    Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData)

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
  const observerPoolRef = useRef<ObserverPoolEntry | null>(null)
  const loadFinishedRef = useRef(false)

  const webpSrc = useMemo(() => webpImageUrl(src), [src])

  const srcSet = useMemo(() => {
    if (!src.includes('cdn.bsky.app')) {
      return undefined
    }

    return sizes
      .map((width) => {
        const separator = src.includes('?') ? '&' : '?'
        const webpUrl = `${src}${separator}format=webp&width=${width}`
        return `${webpUrl} ${width}w`
      })
      .join(', ')
  }, [src, sizes])

  const defaultSizesAttr = useMemo(() => {
    return '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw'
  }, [])

  const finalSizesAttr = sizesAttr || defaultSizesAttr

  const placeholderSrc = useMemo(() => {
    if (saveData || !src.includes('cdn.bsky.app')) {
      return undefined
    }
    return src.replace(/\/img\/[^/]+\//, '/img/avatar_thumbnail/')
  }, [src, saveData])

  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      if (loadFinishedRef.current) {
        onLoad?.(e)
        return
      }
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current)
        loadTimeoutRef.current = null
      }
      loadFinishedRef.current = true
      setIsLoaded(true)
      setImageError(false)
      setPermanentError(false)
      setRetryCount(0)
      onLoad?.(e)
    },
    [onLoad],
  )

  const handlePlaceholderError = useCallback(() => {
    setPlaceholderError(true)
  }, [])

  const handleImageError = useCallback(() => {
    if (!imageError && webpSrc !== src) {
      setImageError(true)
      return
    }

    if (retryCount < maxRetries) {
      const backoffDelay = Math.pow(2, retryCount) * 1000

      retryTimeoutRef.current = setTimeout(() => {
        setRetryCount((prev) => prev + 1)
        setImageError(false)
      }, backoffDelay)
    } else {
      loadFinishedRef.current = true
      setPermanentError(true)
    }
  }, [imageError, webpSrc, src, retryCount, maxRetries])

  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current)
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current)
      if (observerPoolRef.current && containerRef.current) {
        observerPoolRef.current.callbacks.delete(containerRef.current)
        observerPoolRef.current.observer.unobserve(containerRef.current)
      }
    }
  }, [])

  useLayoutEffect(() => {
    loadFinishedRef.current = false
    setRetryCount(0)
    setPermanentError(false)
    setIsLoaded(false)
    setImageError(false)
    setPlaceholderError(false)
    setShouldPreload(loading === 'eager')
  }, [src, loading])

  /* Re-subscribe when `src` changes while still unloaded: otherwise `isLoaded` stays false, deps look unchanged,
   * this effect does not re-run, and the observer may never attach for the new URL (stuck on blur placeholder). */
  useLayoutEffect(() => {
    if (loading === 'eager' || isLoaded) {
      setShouldPreload(true)
      return
    }

    const container = containerRef.current
    if (!container) return

    // Convert pixel distance to viewport-based percentage for resize compatibility
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800
    const preloadDistanceVh = Math.round((preloadDistance / vh) * 100)
    const margin = `${preloadDistanceVh}vh`

    const pooled = getObserverPoolEntry(margin, root ?? null)
    if (!pooled) {
      setShouldPreload(true)
      return
    }
    observerPoolRef.current = pooled
    pooled.callbacks.set(container, () => setShouldPreload(true))
    pooled.observer.observe(container)

    return () => {
      if (pooled && container) {
        pooled.callbacks.delete(container)
        pooled.observer.unobserve(container)
      }
    }
  }, [loading, preloadDistance, root, isLoaded, src])

  const currentSrc = imageError ? src : webpSrc
  const canShowFullImage = shouldPreload && !permanentError

  useEffect(() => {
    if (!canShowFullImage || isLoaded || permanentError) return

    const checkComplete = () => {
      const img = imgRef.current
      if (img?.complete && img.naturalWidth > 0) {
        if (loadFinishedRef.current) return
        if (loadTimeoutRef.current) {
          clearTimeout(loadTimeoutRef.current)
          loadTimeoutRef.current = null
        }
        loadFinishedRef.current = true
        setIsLoaded(true)
      }
    }

    const rafId = requestAnimationFrame(() => checkComplete())

    loadTimeoutRef.current = setTimeout(() => {
      loadTimeoutRef.current = null
      if (!loadFinishedRef.current) {
        loadFinishedRef.current = true
      }
      setIsLoaded((prev) => (prev ? prev : true))
    }, LOAD_REVEAL_TIMEOUT_MS)

    return () => {
      cancelAnimationFrame(rafId)
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current)
        loadTimeoutRef.current = null
      }
    }
  }, [canShowFullImage, currentSrc, retryCount, isLoaded, permanentError])

  if (permanentError) {
    return (
      <div
        className={`${styles.progressiveImage} ${objectFit === 'contain' ? styles.modeContain : ''} ${styles.error} ${className}`}
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
      className={`${styles.progressiveImage} ${objectFit === 'contain' ? styles.modeContain : ''} ${isLoaded ? styles.loaded : ''} ${className}`}
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
        key={`${currentSrc}-${retryCount}`}
        src={canShowFullImage ? currentSrc : undefined}
        srcSet={canShowFullImage && srcSet ? srcSet : undefined}
        sizes={canShowFullImage && srcSet ? finalSizesAttr : undefined}
        alt={alt}
        loading={loading === 'eager' || canShowFullImage ? 'eager' : 'lazy'}
        onLoad={handleImageLoad}
        onError={handleImageError}
        className={styles.fullImage}
      />
    </div>
  )
}
