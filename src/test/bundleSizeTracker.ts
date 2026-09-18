/**
 * Bundle size tracking utilities for CI/CD
 * 
 * This module provides utilities to track and compare bundle sizes
 * across builds to detect performance regressions.
 * 
 * Note: File system operations are handled by separate Node.js scripts.
 * This module provides the data structures and comparison logic.
 */

export interface BundleInfo {
  name: string
  size: number // bytes
  gzipSize: number // bytes
}

export interface BundleSizeReport {
  timestamp: string
  commit?: string
  bundles: BundleInfo[]
  totalSize: number
  totalGzipSize: number
}

/**
 * Analyze bundle files in the dist directory
 * Note: This is a placeholder for browser environment.
 * Actual implementation is in scripts/analyze-bundle-size.js
 */
export function analyzeBundles(distPath: string = 'dist'): BundleInfo[] {
  console.warn('analyzeBundles should be called from Node.js environment')
  return []
}

/**
 * Calculate gzip size of content
 * Note: This is a placeholder for browser environment.
 * Actual implementation is in scripts/analyze-bundle-size.js
 */
export function calculateGzipSize(content: string): number {
  // Rough estimation: gzip typically achieves 70-80% compression for JS
  return Math.floor(content.length * 0.3)
}

/**
 * Generate bundle size report
 */
export function generateBundleSizeReport(
  distPath: string = 'dist',
  commit?: string
): BundleSizeReport {
  const bundles = analyzeBundles(distPath)
  const totalSize = bundles.reduce((sum, bundle) => sum + bundle.size, 0)
  const totalGzipSize = bundles.reduce((sum, bundle) => sum + bundle.gzipSize, 0)
  
  return {
    timestamp: new Date().toISOString(),
    commit,
    bundles,
    totalSize,
    totalGzipSize,
  }
}

/**
 * Compare two bundle size reports
 */
export function compareBundleSizes(
  current: BundleSizeReport,
  baseline: BundleSizeReport
): {
  totalSizeDiff: number
  totalGzipSizeDiff: number
  totalSizeDiffPercent: number
  totalGzipSizeDiffPercent: number
  bundleDiffs: Array<{
    name: string
    sizeDiff: number
    gzipSizeDiff: number
    sizeDiffPercent: number
    gzipSizeDiffPercent: number
  }>
} {
  const totalSizeDiff = current.totalSize - baseline.totalSize
  const totalGzipSizeDiff = current.totalGzipSize - baseline.totalGzipSize
  const totalSizeDiffPercent = (totalSizeDiff / baseline.totalSize) * 100
  const totalGzipSizeDiffPercent = (totalGzipSizeDiff / baseline.totalGzipSize) * 100
  
  const bundleDiffs = current.bundles.map(currentBundle => {
    const baselineBundle = baseline.bundles.find(b => b.name === currentBundle.name)
    
    if (!baselineBundle) {
      return {
        name: currentBundle.name,
        sizeDiff: currentBundle.size,
        gzipSizeDiff: currentBundle.gzipSize,
        sizeDiffPercent: 100,
        gzipSizeDiffPercent: 100,
      }
    }
    
    const sizeDiff = currentBundle.size - baselineBundle.size
    const gzipSizeDiff = currentBundle.gzipSize - baselineBundle.gzipSize
    const sizeDiffPercent = (sizeDiff / baselineBundle.size) * 100
    const gzipSizeDiffPercent = (gzipSizeDiff / baselineBundle.gzipSize) * 100
    
    return {
      name: currentBundle.name,
      sizeDiff,
      gzipSizeDiff,
      sizeDiffPercent,
      gzipSizeDiffPercent,
    }
  })
  
  return {
    totalSizeDiff,
    totalGzipSizeDiff,
    totalSizeDiffPercent,
    totalGzipSizeDiffPercent,
    bundleDiffs,
  }
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

/**
 * Check if bundle size exceeds threshold
 */
export function checkBundleSizeThreshold(
  report: BundleSizeReport,
  maxGzipSizeKB: number = 500
): { passed: boolean; message: string } {
  const maxGzipSizeBytes = maxGzipSizeKB * 1024
  const totalGzipSize = report.totalGzipSize
  
  if (totalGzipSize > maxGzipSizeBytes) {
    return {
      passed: false,
      message: `Bundle size ${formatBytes(totalGzipSize)} exceeds threshold of ${formatBytes(maxGzipSizeBytes)}`,
    }
  }
  
  return {
    passed: true,
    message: `Bundle size ${formatBytes(totalGzipSize)} is within threshold of ${formatBytes(maxGzipSizeBytes)}`,
  }
}

/**
 * Save bundle size report to file
 * Note: This is a placeholder for browser environment.
 * Use scripts/analyze-bundle-size.js for actual file operations.
 */
export function saveBundleSizeReport(report: BundleSizeReport, outputPath: string) {
  console.warn('saveBundleSizeReport should be called from Node.js environment')
  console.log('Report:', JSON.stringify(report, null, 2))
}

/**
 * Load bundle size report from file
 * Note: This is a placeholder for browser environment.
 * Use scripts/analyze-bundle-size.js for actual file operations.
 */
export function loadBundleSizeReport(inputPath: string): BundleSizeReport | null {
  console.warn('loadBundleSizeReport should be called from Node.js environment')
  return null
}
