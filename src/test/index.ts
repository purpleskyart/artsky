/**
 * Performance testing utilities
 * 
 * This module exports all testing utilities for performance optimization
 */

// Render counter utilities
export {
  useRenderCounter,
  withRenderCounter,
  resetRenderCount,
  getRenderCount,
} from './renderCounter'

// Performance measurement utilities
export {
  measureFCP,
  measureLCP,
  measureTTI,
  measureCLS,
  measureTTFB,
  collectPerformanceMetrics,
  benchmark,
  measureMemoryUsage,
  logPerformanceMetrics,
  type PerformanceMetrics,
} from './performanceUtils'

// Bundle size tracking utilities
export {
  analyzeBundles,
  generateBundleSizeReport,
  compareBundleSizes,
  checkBundleSizeThreshold,
  formatBytes,
  saveBundleSizeReport,
  loadBundleSizeReport,
  calculateGzipSize,
  type BundleInfo,
  type BundleSizeReport,
} from './bundleSizeTracker'
