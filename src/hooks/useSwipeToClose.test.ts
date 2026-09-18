import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getHomeBarGestureZonePx,
  getSafeAreaInsetBottomPx,
  resetSwipeToCloseSafeAreaCacheForTests,
  touchYInHomeBarZone,
} from './useSwipeToClose'

describe('useSwipeToClose home bar zone', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    resetSwipeToCloseSafeAreaCacheForTests()
  })

  it('returns 0 home bar zone when safe-area inset is 0', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      paddingBottom: '0px',
    } as CSSStyleDeclaration)

    expect(getSafeAreaInsetBottomPx()).toBe(0)
    expect(getHomeBarGestureZonePx()).toBe(0)
    expect(touchYInHomeBarZone(999)).toBe(false)
  })

  it('detects touches in the home indicator band using visualViewport', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      paddingBottom: '34px',
    } as CSSStyleDeclaration)
    vi.stubGlobal('visualViewport', {
      offsetTop: 0,
      height: 800,
    })

    const zone = getHomeBarGestureZonePx()
    expect(zone).toBe(46)

    expect(touchYInHomeBarZone(800 - zone)).toBe(true)
    expect(touchYInHomeBarZone(800 - zone - 1)).toBe(false)
  })
})
