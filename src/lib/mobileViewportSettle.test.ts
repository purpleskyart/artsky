import { describe, expect, it, vi } from 'vitest'
import { visualViewportBottomGap } from './mobileViewportSettle'

describe('visualViewportBottomGap', () => {
  it('returns the layout/visual viewport bottom gap', () => {
    vi.stubGlobal('visualViewport', {
      offsetTop: 50,
      height: 700,
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 800,
    })
    expect(visualViewportBottomGap()).toBe(50)
  })

  it('never returns a negative gap', () => {
    vi.stubGlobal('visualViewport', {
      offsetTop: 0,
      height: 900,
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 800,
    })
    expect(visualViewportBottomGap()).toBe(0)
  })
})
