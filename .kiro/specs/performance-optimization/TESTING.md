# Performance Testing Guide

This document provides guidance on testing the performance optimization features.

## Testing Infrastructure

The performance testing infrastructure has been set up with the following components:

### 1. Property-Based Testing with fast-check

**Library**: `fast-check` v4.5.3 (already installed)

**Configuration**: Minimum 100 iterations per property test

**Usage Example**:
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

### 2. Render Counter Utilities

**Location**: `src/test/renderCounter.tsx`

**Purpose**: Track component re-renders to verify optimization effectiveness

**API**:
- `useRenderCounter(componentName)` - Hook for tracking renders
- `withRenderCounter(Component, name)` - HOC for tracking renders
- `getRenderCount(component)` - Get current render count
- `resetRenderCount(component)` - Reset render count

**Example**:
```typescript
import { withRenderCounter, getRenderCount } from '@/test/renderCounter'

const TrackedPostCard = withRenderCounter(PostCard, 'PostCard')

// In test
render(<TrackedPostCard {...props} />)
rerender(<TrackedPostCard {...props} />) // Same props
expect(getRenderCount(TrackedPostCard)).toBe(1) // Should not re-render
```

### 3. Performance Metrics Collection

**Location**: `src/test/performanceUtils.ts`

**Purpose**: Measure Core Web Vitals and custom performance metrics

**API**:
- `measureFCP()` - First Contentful Paint
- `measureLCP()` - Largest Contentful Paint
- `measureTTI()` - Time to Interactive
- `measureCLS()` - Cumulative Layout Shift
- `measureTTFB()` - Time to First Byte
- `collectPerformanceMetrics()` - Collect all metrics
- `benchmark(fn, iterations)` - Benchmark function execution

**Example**:
```typescript
import { benchmark, collectPerformanceMetrics } from '@/test/performanceUtils'

// Benchmark a function
const result = await benchmark(() => {
  // Function to test
}, 100)

expect(result.average).toBeLessThan(10) // 10ms threshold

// Collect Core Web Vitals
const metrics = await collectPerformanceMetrics()
expect(metrics.fcp).toBeLessThan(1500) // 1.5s threshold
```

### 4. Bundle Size Tracking

**Location**: `scripts/analyze-bundle-size.js`

**Purpose**: Track bundle sizes and enforce size limits in CI

**Usage**:
```bash
# Build and analyze
npm run build
npm run analyze:bundle

# Output will show:
# - Individual bundle sizes
# - Total size (raw and gzipped)
# - Threshold check (500KB gzipped)
```

**CI Integration**: GitHub Actions workflow at `.github/workflows/bundle-size.yml`
- Runs on every PR and push
- Compares against baseline
- Fails if size exceeds 500KB gzipped
- Warns if size increases by >10%

## Running Tests

```bash
# Run all tests in watch mode
npm test

# Run tests once (for CI)
npm run test:run

# Run tests with UI
npm run test:ui

# Run tests with coverage
npm run test:coverage
```

## Test Organization

Tests should be co-located with source files using the `.test.ts` or `.test.tsx` suffix:

```
src/
  components/
    PostCard.tsx
    PostCard.test.tsx
  context/
    ThemeContext.tsx
    ThemeContext.test.tsx
```

## Property Test Requirements

All property tests must:

1. **Reference the property number** from the design document:
   ```typescript
   // Feature: performance-optimization, Property 1: Context Isolation
   ```

2. **Run at least 100 iterations**:
   ```typescript
   fc.assert(fc.property(...), { numRuns: 100 })
   ```

3. **Validate the specified requirements**:
   ```typescript
   // **Validates: Requirements 1.1, 1.3**
   ```

## Unit Test Requirements

Unit tests should:

1. **Test specific examples** that demonstrate correct behavior
2. **Test edge cases** (empty inputs, boundary values, error conditions)
3. **Use descriptive names** that explain what is being tested
4. **Be fast** (< 100ms per test)

## Performance Benchmarking

When benchmarking performance-critical code:

1. **Use the benchmark utility**:
   ```typescript
   const result = await benchmark(criticalFunction, 100)
   ```

2. **Set reasonable thresholds**:
   ```typescript
   expect(result.average).toBeLessThan(10) // 10ms
   ```

3. **Run multiple iterations** (at least 100) to account for variance

4. **Warm up the code** before benchmarking:
   ```typescript
   // Warm up
   for (let i = 0; i < 10; i++) {
     await criticalFunction()
   }
   
   // Benchmark
   const result = await benchmark(criticalFunction, 100)
   ```

## Validating Requirements

Each requirement from the requirements document should be validated by tests:

| Requirement | Test Type | Location |
|-------------|-----------|----------|
| 9.1 - Render count tracking | Unit | `src/test/renderCounter.test.tsx` |
| 9.2 - TTI measurement | Unit | `src/test/performanceUtils.test.ts` |
| 9.3 - FCP measurement | Unit | `src/test/performanceUtils.test.ts` |
| 9.4 - LCP measurement | Unit | `src/test/performanceUtils.test.ts` |
| 9.5 - Bundle size tracking | CI | `.github/workflows/bundle-size.yml` |

## Best Practices

1. **Isolate tests**: Each test should be independent and not rely on other tests
2. **Clean up**: Use `afterEach` to clean up resources (React Testing Library does this automatically)
3. **Mock sparingly**: Prefer testing real functionality over mocks
4. **Test behavior, not implementation**: Focus on what the code does, not how it does it
5. **Keep tests simple**: Complex tests are hard to maintain and understand
6. **Use meaningful assertions**: Prefer specific assertions over generic ones
7. **Document complex tests**: Add comments explaining non-obvious test logic

## Troubleshooting

### Tests are slow
- Check if you're running too many iterations in property tests
- Use `test.only` to run a single test during development
- Consider using `test.skip` to temporarily disable slow tests

### Tests are flaky
- Check for race conditions in async code
- Ensure proper cleanup in `afterEach`
- Use `waitFor` from React Testing Library for async updates

### Bundle size check fails
- Run `npm run analyze:bundle` locally to see which bundles are large
- Check if new dependencies were added
- Verify code splitting is working correctly
- Consider lazy loading heavy dependencies

## Resources

- [fast-check documentation](https://github.com/dubzzz/fast-check)
- [Vitest documentation](https://vitest.dev/)
- [React Testing Library](https://testing-library.com/react)
- [Web Vitals](https://web.dev/vitals/)
