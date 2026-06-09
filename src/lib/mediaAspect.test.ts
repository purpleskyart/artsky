import { describe, it, expect, beforeEach } from 'vitest'
import { resolveMediaAspect, initialLayoutAspect } from './mediaAspect'
import { setCachedMediaAspect } from './mediaAspectCache'

describe('resolveMediaAspect', () => {
  it('uses measured when dimensions are available', () => {
    expect(resolveMediaAspect(undefined, 800, 400)).toBe(2)
    expect(resolveMediaAspect(null, 300, 600)).toBe(0.5)
    expect(resolveMediaAspect(16 / 9, 1080, 1080)).toBe(1)
    expect(resolveMediaAspect(1, 1920, 1080)).toBeCloseTo(16 / 9)
  })

  it('uses API when measured dimensions are invalid', () => {
    expect(resolveMediaAspect(1.2, 0, 100)).toBe(1.2)
    expect(resolveMediaAspect(1.5, 1500, 0)).toBe(1.5)
  })

  it('falls back to placeholder when neither measured nor API', () => {
    expect(resolveMediaAspect(undefined, 0, 0)).toBe(4 / 5)
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
