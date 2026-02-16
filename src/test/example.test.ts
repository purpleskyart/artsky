import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { benchmark } from './performanceUtils'

/**
 * Example tests demonstrating the performance testing infrastructure
 */

describe('Performance Testing Infrastructure', () => {
  describe('Unit Tests', () => {
    it('should run basic unit tests', () => {
      expect(true).toBe(true)
    })
    
    it('should measure execution time', async () => {
      const result = await benchmark(() => {
        // Simulate some work
        let sum = 0
        for (let i = 0; i < 1000; i++) {
          sum += i
        }
        return sum
      }, 10)
      
      expect(result.average).toBeGreaterThan(0)
      expect(result.min).toBeLessThanOrEqual(result.average)
      expect(result.max).toBeGreaterThanOrEqual(result.average)
    })
  })
  
  describe('Property-Based Tests', () => {
    // Feature: performance-optimization, Property: Example property test
    it('should run property-based tests with fast-check', () => {
      fc.assert(
        fc.property(
          fc.integer(),
          fc.integer(),
          (a, b) => {
            // Property: addition is commutative
            return a + b === b + a
          }
        ),
        { numRuns: 100 }
      )
    })
    
    // Feature: performance-optimization, Property: Example array property
    it('should verify array operations maintain length', () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer()),
          (arr) => {
            // Property: reversing an array twice returns the original array
            const reversed = [...arr].reverse()
            const doubleReversed = [...reversed].reverse()
            return JSON.stringify(arr) === JSON.stringify(doubleReversed)
          }
        ),
        { numRuns: 100 }
      )
    })
  })
})
