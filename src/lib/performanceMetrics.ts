/**
 * Performance metrics tracking for Core Web Vitals
 * Requirements: 9.2, 9.3, 9.4
 */

export interface PerformanceMetrics {
  fcp?: number // First Contentful Paint (ms)
  lcp?: number // Largest Contentful Paint (ms)
  tti?: number // Time to Interactive (ms)
  cls?: number // Cumulative Layout Shift (score)
  fid?: number // First Input Delay (ms)
  ttfb?: number // Time to First Byte (ms)
}

let metrics: PerformanceMetrics = {}

/**
 * Measure First Contentful Paint (FCP)
 * Requirement 9.2
 */
export function measureFCP(): void {
  if (typeof window === 'undefined' || !('PerformanceObserver' in window)) return

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint') {
          metrics.fcp = entry.startTime
          if (import.meta.env.DEV) {
            console.log(`[Performance] FCP: ${entry.startTime.toFixed(2)}ms`)
          }
          observer.disconnect()
        }
      }
    })

    observer.observe({ type: 'paint', buffered: true })
  } catch (err) {
    console.error('Failed to measure FCP:', err)
  }
}

/**
 * Measure Largest Contentful Paint (LCP)
 * Requirement 9.3
 */
export function measureLCP(): void {
  if (typeof window === 'undefined' || !('PerformanceObserver' in window)) return

  try {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries()
      const lastEntry = entries[entries.length - 1]
      if (lastEntry) {
        metrics.lcp = lastEntry.startTime
        if (import.meta.env.DEV) {
          console.log(`[Performance] LCP: ${lastEntry.startTime.toFixed(2)}ms`)
        }
      }
    })

    observer.observe({ type: 'largest-contentful-paint', buffered: true })
  } catch (err) {
    console.error('Failed to measure LCP:', err)
  }
}

/**
 * Measure Time to Interactive (TTI)
 * Requirement 9.4
 * 
 * TTI is approximated as the time when the main thread is idle for at least 5 seconds
 * after FCP. This is a simplified implementation.
 */
export function measureTTI(): void {
  if (typeof window === 'undefined') return

  try {
    // Wait for page load
    if (document.readyState === 'complete') {
      estimateTTI()
    } else {
      window.addEventListener('load', estimateTTI, { once: true })
    }
  } catch (err) {
    console.error('Failed to measure TTI:', err)
  }
}

function estimateTTI(): void {
  // Simple TTI estimation: time when load event fires + small buffer
  // In production, you'd use a more sophisticated algorithm or library like tti-polyfill
  const loadTime = performance.timing?.loadEventEnd - performance.timing?.navigationStart
  
  if (loadTime > 0) {
    metrics.tti = loadTime
    if (import.meta.env.DEV) {
      console.log(`[Performance] TTI (estimated): ${loadTime.toFixed(2)}ms`)
    }
  }
}

/**
 * Measure Cumulative Layout Shift (CLS)
 * Requirement 9.3
 */
export function measureCLS(): void {
  if (typeof window === 'undefined' || !('PerformanceObserver' in window)) return

  try {
    let clsValue = 0

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // Only count layout shifts without recent user input
        if (!(entry as any).hadRecentInput) {
          clsValue += (entry as any).value
          metrics.cls = clsValue
          if (import.meta.env.DEV) {
            console.log(`[Performance] CLS: ${clsValue.toFixed(4)}`)
          }
        }
      }
    })

    observer.observe({ type: 'layout-shift', buffered: true })
  } catch (err) {
    console.error('Failed to measure CLS:', err)
  }
}

/**
 * Measure First Input Delay (FID)
 * Requirement 9.3
 */
export function measureFID(): void {
  if (typeof window === 'undefined' || !('PerformanceObserver' in window)) return

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const fidEntry = entry as PerformanceEventTiming
        metrics.fid = fidEntry.processingStart - fidEntry.startTime
        if (import.meta.env.DEV) {
          console.log(`[Performance] FID: ${metrics.fid.toFixed(2)}ms`)
        }
        observer.disconnect()
      }
    })

    observer.observe({ type: 'first-input', buffered: true })
  } catch (err) {
    console.error('Failed to measure FID:', err)
  }
}

/**
 * Measure Time to First Byte (TTFB)
 * Requirement 9.2
 */
export function measureTTFB(): void {
  if (typeof window === 'undefined' || !performance.timing) return

  try {
    const ttfb = performance.timing.responseStart - performance.timing.requestStart
    if (ttfb > 0) {
      metrics.ttfb = ttfb
      if (import.meta.env.DEV) {
        console.log(`[Performance] TTFB: ${ttfb.toFixed(2)}ms`)
      }
    }
  } catch (err) {
    console.error('Failed to measure TTFB:', err)
  }
}

/**
 * Initialize all performance metrics tracking
 */
export function initPerformanceMetrics(): void {
  measureFCP()
  measureLCP()
  measureTTI()
  measureCLS()
  measureFID()
  measureTTFB()
}

/**
 * Get current performance metrics
 */
export function getPerformanceMetrics(): PerformanceMetrics {
  return { ...metrics }
}

/**
 * Reset performance metrics (for testing)
 */
export function resetPerformanceMetrics(): void {
  metrics = {}
}
