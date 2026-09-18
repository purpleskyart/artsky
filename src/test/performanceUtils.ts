/**
 * Performance testing utilities for measuring Core Web Vitals and other metrics
 */

export interface PerformanceMetrics {
  // Core Web Vitals
  fcp?: number // First Contentful Paint (ms)
  lcp?: number // Largest Contentful Paint (ms)
  fid?: number // First Input Delay (ms)
  cls?: number // Cumulative Layout Shift (score)
  ttfb?: number // Time to First Byte (ms)
  tti?: number // Time to Interactive (ms)
  
  // Custom metrics
  renderCount?: number // Component render count
  bundleSize?: number // Main bundle size (bytes)
  chunkCount?: number // Number of chunks
  imageLoadTime?: number // Average image load time (ms)
  apiResponseTime?: number // Average API response time (ms)
}

/**
 * Measure First Contentful Paint (FCP)
 */
export function measureFCP(): Promise<number | null> {
  return new Promise((resolve) => {
    if (!('PerformanceObserver' in window)) {
      resolve(null)
      return
    }
    
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries()
      const fcpEntry = entries.find(entry => entry.name === 'first-contentful-paint')
      if (fcpEntry) {
        resolve(fcpEntry.startTime)
        observer.disconnect()
      }
    })
    
    observer.observe({ entryTypes: ['paint'] })
    
    // Timeout after 10 seconds
    setTimeout(() => {
      observer.disconnect()
      resolve(null)
    }, 10000)
  })
}

/**
 * Measure Largest Contentful Paint (LCP)
 */
export function measureLCP(): Promise<number | null> {
  return new Promise((resolve) => {
    if (!('PerformanceObserver' in window)) {
      resolve(null)
      return
    }
    
    let lcpValue: number | null = null
    
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries()
      const lastEntry = entries[entries.length - 1] as PerformanceEntry
      lcpValue = lastEntry.startTime
    })
    
    observer.observe({ entryTypes: ['largest-contentful-paint'] })
    
    // LCP is finalized when user interacts or page is hidden
    const finalizeLCP = () => {
      observer.disconnect()
      resolve(lcpValue)
    }
    
    document.addEventListener('visibilitychange', finalizeLCP, { once: true })
    
    // Timeout after 10 seconds
    setTimeout(finalizeLCP, 10000)
  })
}

/**
 * Measure Time to First Byte (TTFB)
 */
export function measureTTFB(): number | null {
  if (!('performance' in window) || !performance.timing) {
    return null
  }
  
  const { responseStart, requestStart } = performance.timing
  return responseStart - requestStart
}

/**
 * Measure Time to Interactive (TTI)
 * Simplified approximation - in production, use a library like web-vitals
 */
export function measureTTI(): Promise<number | null> {
  return new Promise((resolve) => {
    if (!('performance' in window)) {
      resolve(null)
      return
    }
    
    // Wait for load event
    if (document.readyState === 'complete') {
      resolve(performance.now())
    } else {
      window.addEventListener('load', () => {
        // TTI is approximately when the page is fully loaded and interactive
        resolve(performance.now())
      }, { once: true })
    }
    
    // Timeout after 30 seconds
    setTimeout(() => resolve(null), 30000)
  })
}

/**
 * Measure Cumulative Layout Shift (CLS)
 */
export function measureCLS(): Promise<number> {
  return new Promise((resolve) => {
    if (!('PerformanceObserver' in window)) {
      resolve(0)
      return
    }
    
    let clsValue = 0
    
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!(entry as any).hadRecentInput) {
          clsValue += (entry as any).value
        }
      }
    })
    
    observer.observe({ entryTypes: ['layout-shift'] })
    
    // Finalize CLS when page is hidden
    const finalizeCLS = () => {
      observer.disconnect()
      resolve(clsValue)
    }
    
    document.addEventListener('visibilitychange', finalizeCLS, { once: true })
    
    // Timeout after 10 seconds
    setTimeout(finalizeCLS, 10000)
  })
}

/**
 * Collect all performance metrics
 */
export async function collectPerformanceMetrics(): Promise<PerformanceMetrics> {
  const [fcp, lcp, tti, cls] = await Promise.all([
    measureFCP(),
    measureLCP(),
    measureTTI(),
    measureCLS(),
  ])
  
  const ttfb = measureTTFB()
  
  return {
    fcp: fcp ?? undefined,
    lcp: lcp ?? undefined,
    tti: tti ?? undefined,
    cls,
    ttfb: ttfb ?? undefined,
  }
}

/**
 * Benchmark a function execution time
 */
export async function benchmark<T>(
  fn: () => T | Promise<T>,
  iterations: number = 100
): Promise<{ average: number; min: number; max: number; total: number }> {
  const times: number[] = []
  
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    await fn()
    const end = performance.now()
    times.push(end - start)
  }
  
  const total = times.reduce((sum, time) => sum + time, 0)
  const average = total / iterations
  const min = Math.min(...times)
  const max = Math.max(...times)
  
  return { average, min, max, total }
}

/**
 * Measure memory usage (if available)
 */
export function measureMemoryUsage(): number | null {
  if ('memory' in performance && (performance as any).memory) {
    return (performance as any).memory.usedJSHeapSize
  }
  return null
}

/**
 * Log performance metrics to console (development only)
 */
export function logPerformanceMetrics(metrics: PerformanceMetrics) {
  if (import.meta.env.DEV) {
    console.group('Performance Metrics')
    if (metrics.fcp) console.log(`FCP: ${metrics.fcp.toFixed(2)}ms`)
    if (metrics.lcp) console.log(`LCP: ${metrics.lcp.toFixed(2)}ms`)
    if (metrics.tti) console.log(`TTI: ${metrics.tti.toFixed(2)}ms`)
    if (metrics.cls !== undefined) console.log(`CLS: ${metrics.cls.toFixed(4)}`)
    if (metrics.ttfb) console.log(`TTFB: ${metrics.ttfb.toFixed(2)}ms`)
    if (metrics.renderCount) console.log(`Render Count: ${metrics.renderCount}`)
    console.groupEnd()
  }
}
