import { useEffect, useState, useRef } from 'react'

/**
 * Hook to optimize off-screen post rendering by minimizing DOM presence
 * when posts are scrolled out of view.
 * 
 * Uses IntersectionObserver to detect when elements leave the viewport
 * and returns a boolean indicating whether the element should render
 * its full content or a minimal placeholder.
 * 
 * @param elementRef - Ref to the element to observe
 * @param options - IntersectionObserver options
 * @returns isVisible - Whether the element is in or near the viewport
 */
export function useOffscreenOptimization(
  elementRef: React.RefObject<HTMLElement | null>,
  options?: IntersectionObserverInit
): boolean {
  const [isVisible, setIsVisible] = useState(true)
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    const element = elementRef.current
    if (!element) return

    // Create observer with generous rootMargin to keep content rendered
    // slightly before/after viewport for smooth scrolling
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Element is visible if it's intersecting with the viewport
          setIsVisible(entry.isIntersecting)
        }
      },
      {
        // Large rootMargin ensures content is rendered before entering viewport
        // and stays rendered slightly after leaving for smooth experience
        rootMargin: options?.rootMargin ?? '400px 0px 400px 0px',
        threshold: options?.threshold ?? 0,
        ...options,
      }
    )

    observerRef.current.observe(element)

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = null
      }
    }
  }, [elementRef, options])

  return isVisible
}
