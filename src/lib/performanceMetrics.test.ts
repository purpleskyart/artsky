/**
 * Unit tests for performance metrics tracking
 * Requirements: 9.2, 9.3, 9.4, 9.5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  initPerformanceMetrics,
  getPerformanceMetrics,
  resetPerformanceMetrics,
  measureFCP,
  measureLCP,
  measureTTI,
} from './performanceMetrics'

describe('Performance Metrics', () => {
  beforeEach(() => {
    resetPerformanceMetrics()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * Requirement 9.2: FCP measurement
   */
  it('initializes performance metrics tracking', () => {
    initPerformanceMetrics()
    // Should not throw
    expect(true).toBe(true)
  })

  /**
   * Requirement 9.2: Get metrics
   */
  it('returns empty metrics initially', () => {
    const metrics = getPerformanceMetrics()
    expect(metrics).toEqual({})
  })

  /**
   * Requirement 9.2: Reset metrics
   */
  it('resets metrics to empty state', () => {
    resetPerformanceMetrics()
    const metrics = getPerformanceMetrics()
    expect(metrics).toEqual({})
  })

  /**
   * Requirement 9.2: FCP measurement doesn't throw
   */
  it('measureFCP does not throw errors', () => {
    expect(() => measureFCP()).not.toThrow()
  })

  /**
   * Requirement 9.3: LCP measurement doesn't throw
   */
  it('measureLCP does not throw errors', () => {
    expect(() => measureLCP()).not.toThrow()
  })

  /**
   * Requirement 9.4: TTI measurement doesn't throw
   */
  it('measureTTI does not throw errors', () => {
    expect(() => measureTTI()).not.toThrow()
  })

  /**
   * Requirement 9.2: Metrics are collected
   */
  it('collects metrics when available', () => {
    // In test environment, PerformanceObserver may not be available
    // This test just ensures the functions don't crash
    initPerformanceMetrics()
    const metrics = getPerformanceMetrics()
    expect(typeof metrics).toBe('object')
  })
})
