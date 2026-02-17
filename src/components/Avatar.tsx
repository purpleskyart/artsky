import { useState, useCallback } from 'react'

interface AvatarProps {
  src: string | undefined | null
  alt?: string
  className?: string
  loading?: 'lazy' | 'eager'
  fallback?: React.ReactNode
}

/**
 * Avatar component with automatic error handling
 * 
 * Silently handles 404 errors and other image loading failures
 * by hiding the image element when it fails to load.
 * 
 * If a fallback is provided, it will be shown instead of the broken image.
 */
export function Avatar({ src, alt = '', className, loading = 'lazy', fallback }: AvatarProps) {
  const [hasError, setHasError] = useState(false)

  const handleError = useCallback(() => {
    setHasError(true)
  }, [])

  // If no src or error occurred, show fallback or nothing
  if (!src || hasError) {
    return fallback ? <>{fallback}</> : null
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      onError={handleError}
    />
  )
}
