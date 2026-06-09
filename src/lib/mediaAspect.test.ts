import { describe, it, expect, beforeEach } from 'vitest'
import {
  resolveMediaAspect,
  initialLayoutAspect,
  shouldCorrectLayoutAspect,
  isAspectMismatch,
} from './mediaAspect'
import { getCachedMediaAspect, setCachedMediaAspect } from './mediaAspectCache'

describe('resolveMediaAspect', () => {
  it('uses measured when API aspect is missing', () => {
    expect(resolveMediaAspect(undefined, 800, 400)).toBe(2)
    expect(resolveMediaAspect(null, 300, 600)).toBe(0.5)
  })

  it('uses API when it matches measured within tolerance', () => {
    expect(resolveMediaAspect(1.5, 1500, 1000)).toBe(1.5)
    expect(resolveMediaAspect(16 / 9, 1920, 1080)).toBeCloseTo(16 / 9)
  })

  it('uses measured when API aspect is suspect', () => {
    expect(resolveMediaAspect(16 / 9, 1080, 1080)).toBe(1)
    expect(resolveMediaAspect(1, 1920, 1080)).toBeCloseTo(16 / 9)
  })

  it('falls back when measured dimensions are invalid', () => {
    expect(resolveMediaAspect(1.2, 0, 100)).toBe(1.2)
    expect(resolveMediaAspect(undefined, 0, 0)).toBe(4 / 5)
  })
})

describe('shouldCorrectLayoutAspect', () => {
  it('returns false when API matches measured', () => {
    expect(shouldCorrectLayoutAspect(1.5, 1500, 1000)).toBe(false)
  })

  it('returns true when API is missing', () => {
    expect(shouldCorrectLayoutAspect(undefined, 800, 600)).toBe(true)
  })

  it('returns true when API is suspect', () => {
    expect(shouldCorrectLayoutAspect(16 / 9, 1080, 1080)).toBe(true)
  })
})

describe('initialLayoutAspect', () => {
  beforeEach(() => {
    setCachedMediaAspect('https://cdn.example/a.jpg', 2)
  })

  it('prefers cache over API', () => {
    expect(initialLayoutAspect('https://cdn.example/a.jpg', 1)).toBe(2)
  })

  it('uses API when cache missing', () => {
    expect(initialLayoutAspect('https://cdn.example/b.jpg', 1.5)).toBe(1.5)
  })

  it('returns null when neither cache nor API', () => {
    expect(initialLayoutAspect('https://cdn.example/b.jpg', undefined)).toBeNull()
  })
})

describe('isAspectMismatch', () => {
  it('detects mismatch outside tolerance', () => {
    expect(isAspectMismatch(1, 1920, 1080)).toBe(true)
    expect(isAspectMismatch(16 / 9, 1920, 1080)).toBe(false)
  })
})
