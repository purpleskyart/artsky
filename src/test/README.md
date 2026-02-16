# Performance Testing Infrastructure

This directory contains utilities and configuration for performance testing in the ArtSky application.

## Overview

The performance testing infrastructure supports:
- **Property-based testing** with fast-check
- **Component render tracking** for detecting unnecessary re-renders
- **Performance metrics collection** (Core Web Vitals)
- **Bundle size tracking** in CI/CD
- **Benchmarking utilities** for measuring execution time

## Files

### `setup.ts`
Test setup file that configures the testing environment. Automatically imported by vitest.

### `renderCounter.tsx`
Utilities for tracking component render counts:
- `useRenderCounter(componentName)` - Hook for tracking renders
- `withRenderCounter(Component, name)` - HOC for tracking renders
- `getRenderCount(component)` - Get current render count
- `resetRenderCount(component)` - Reset render count

**Example:**
```typescript
import { withRenderCounter, getRenderCount } from './test/renderCounter'

const TrackedComponent = withRenderCounter(MyComponent, 'MyComponent')

// In test
render(<TrackedComponent />)
expect(getRenderCount(TrackedComponent)).toBe(1)
```

### `performanceUtils.ts`
Utilities for measuring performance metrics:
- `measureFCP()` - First Contentful Paint
- `measureLCP()` - Largest Contentful Paint
- `measureTTI()` - Time to Interactive
- `measureCLS()` - Cumulative Layout Shift
- `measureTTFB()` - Time to First Byte
- `collectPerformanceMetrics()` - Collect all metrics
- `benchmark(fn, iterations)` - Benchmark function execution

**Example:**
```typescript
import { benchmark } from './test/performanceUtils'

const result = await benchmark(() => {
  // Function to benchmark
}, 100)

console.log(`Average: ${result.average}ms`)
```

### `bundleSizeTracker.ts`
Utilities for tracking bundle sizes:
- `analyzeBundles(distPath)` - Analyze bundle files
- `generateBundleSizeReport(distPath)` - Generate size report
- `compareBundleSizes(current, baseline)` - Compare reports
- `checkBundleSizeThreshold(report, maxKB)` - Check size limits
- `formatBytes(bytes)` - Format bytes to human-readable

## Running Tests

```bash
# Run tests in watch mode
npm test

# Run tests once
npm run test:run

# Run tests with UI
npm run test:ui

# Run tests with coverage
npm run test:coverage
```

## Property-Based Testing

Property-based tests use fast-check to verify properties across many randomly generated inputs.

**Example:**
```typescript
import fc from 'fast-check'

// Feature: performance-optimization, Property 1: Context Isolation
it('context changes only trigger re-renders in consuming components', () => {
  fc.assert(
    fc.property(
      fc.record({
        contextValue: fc.anything(),
        consumingComponents: fc.array(fc.string()),
      }),
      ({ contextValue, consumingComponents }) => {
        // Test implementation
        return true // Property holds
      }
    ),
    { numRuns: 100 }
  )
})
```

## Bundle Size Tracking

Bundle size is automatically tracked in CI/CD via GitHub Actions:
- Builds are analyzed on every PR and push
- Bundle size is compared against baseline
- Warnings are issued if size increases by >10%
- Builds fail if size exceeds 500KB (gzipped)

## Best Practices

1. **Tag property tests** with feature and property number:
   ```typescript
   // Feature: performance-optimization, Property 1: Context Isolation
   ```

2. **Run at least 100 iterations** for property tests:
   ```typescript
   fc.assert(fc.property(...), { numRuns: 100 })
   ```

3. **Track render counts** for optimization tests:
   ```typescript
   const TrackedComponent = withRenderCounter(Component, 'Component')
   ```

4. **Benchmark critical paths** to detect regressions:
   ```typescript
   const result = await benchmark(criticalFunction, 100)
   expect(result.average).toBeLessThan(10) // 10ms threshold
   ```

5. **Monitor bundle size** in every PR to prevent bloat

## Requirements Validation

This infrastructure validates the following requirements:
- **9.1**: Component render count tracking
- **9.2**: Time to Interactive (TTI) measurement
- **9.3**: First Contentful Paint (FCP) measurement
- **9.4**: Largest Contentful Paint (LCP) measurement
- **9.5**: Bundle size tracking in CI
