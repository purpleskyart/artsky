import { useEffect, useState, useRef } from 'react'

/**
 * Hook to optimize off-screen post rendering by minimizing DOM presence
 * when posts are scrolled out of view.
 *
 * Observes `element` (re-subscribes when it changes) and returns whether
 * it intersects the viewport (with optional rootMargin).
 */
export function useOffscreenOptimization(
  element: HTMLElement | null,
  options?: IntersectionObserverInit & { root?: Element | null }
): boolean {
  const [isVisible, setIsVisible] = useState(true)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    if (!element) return

    const o = optionsRef.current
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setIsVisible(entry.isIntersecting)
        }
      },
      {
        rootMargin: o?.rootMargin ?? '400px 0px 400px 0px',
        threshold: o?.threshold ?? 0,
        root: o?.root,
      }
    )

    observerRef.current.observe(element)

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = null
      }
    }
  }, [element])

  return isVisible
}
