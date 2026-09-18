import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  estimateIosStandaloneBottomInset,
  estimateIosStandaloneTopInset,
  resolveSafeAreaInsets,
} from './safeAreaInsets'

describe('estimateIosStandaloneTopInset', () => {
  it('returns 59px for Dynamic Island width class', () => {
    Object.defineProperty(window, 'screen', {
      configurable: true,
      value: { width: 393, height: 852 },
    })
    expect(estimateIosStandaloneTopInset()).toBe(59)
  })

  it('returns 62px for Pro Max width class (430pt)', () => {
    Object.defineProperty(window, 'screen', {
      configurable: true,
      value: { width: 430, height: 932 },
    })
    expect(estimateIosStandaloneTopInset()).toBe(62)
  })

  it('returns 47px for notch iPhone X width', () => {
    Object.defineProperty(window, 'screen', {
      configurable: true,
      value: { width: 375, height: 812 },
    })
    expect(estimateIosStandaloneTopInset()).toBe(47)
  })

  it('returns 20px for classic iPhone SE width', () => {
    Object.defineProperty(window, 'screen', {
      configurable: true,
      value: { width: 375, height: 667 },
    })
    expect(estimateIosStandaloneTopInset()).toBe(20)
  })
})

describe('estimateIosStandaloneBottomInset', () => {
  it('returns 34px for home-indicator iPhones', () => {
    Object.defineProperty(window, 'screen', {
      configurable: true,
      value: { width: 393, height: 852 },
    })
    expect(estimateIosStandaloneBottomInset()).toBe(34)
  })

  it('returns 0 for classic home-button iPhones', () => {
    Object.defineProperty(window, 'screen', {
      configurable: true,
      value: { width: 375, height: 667 },
    })
    expect(estimateIosStandaloneBottomInset()).toBe(0)
  })
})

describe('resolveSafeAreaInsets', () => {
  it('keeps measured top when env reports a real inset', () => {
    expect(resolveSafeAreaInsets({ top: 47, right: 0, bottom: 34, left: 0 }).top).toBe(47)
  })

  it('keeps measured bottom when env reports a real inset', () => {
    expect(resolveSafeAreaInsets({ top: 47, right: 0, bottom: 34, left: 0 }).bottom).toBe(34)
  })

  it('does not override insets outside iOS standalone', () => {
    expect(resolveSafeAreaInsets({ top: 0, right: 0, bottom: 0, left: 0 }).top).toBe(0)
  })

  it('estimates top inset for iOS standalone when env reports 0', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    })
    Object.defineProperty(window.navigator, 'standalone', {
      configurable: true,
      value: true,
    })
    Object.defineProperty(window, 'screen', {
      configurable: true,
      value: { width: 393, height: 852 },
    })
    expect(resolveSafeAreaInsets({ top: 0, right: 0, bottom: 0, left: 0 }).top).toBe(59)
    expect(resolveSafeAreaInsets({ top: 0, right: 0, bottom: 0, left: 0 }).bottom).toBe(34)
  })
})

describe('bindSafeAreaInsetListeners', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'requestAnimationFrame',
        'cancelAnimationFrame',
      ],
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.documentElement.removeAttribute('data-standalone-pwa')
    document.documentElement.style.removeProperty('--app-safe-bottom')
    Object.defineProperty(window.navigator, 'standalone', {
      configurable: true,
      value: undefined,
    })
  })

  it('subscribes to visualViewport resize/scroll for the early window, then detaches', async () => {
    const vvAdd = vi.fn()
    const vvRemove = vi.fn()
    vi.stubGlobal('visualViewport', { addEventListener: vvAdd, removeEventListener: vvRemove, height: 800 })
    const { bindSafeAreaInsetListeners } = await import('./safeAreaInsets')
    bindSafeAreaInsetListeners()
    expect(vvAdd).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(vvAdd).toHaveBeenCalledWith('scroll', expect.any(Function))

    vi.advanceTimersByTime(1500)
    expect(vvRemove).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(vvRemove).toHaveBeenCalledWith('scroll', expect.any(Function))
  })

  it('skips the early remeasure while the keyboard shrinks the visual viewport', async () => {
    const vv: { addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn>; height: number } = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      height: 400, // keyboard open: well below jsdom's default 768px innerHeight
    }
    vi.stubGlobal('visualViewport', vv)
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      paddingTop: '24px',
      paddingRight: '24px',
      paddingBottom: '24px',
      paddingLeft: '24px',
    } as CSSStyleDeclaration)
    Object.defineProperty(window.navigator, 'standalone', {
      configurable: true,
      value: true,
    })
    const { bindSafeAreaInsetListeners } = await import('./safeAreaInsets')
    bindSafeAreaInsetListeners()
    document.documentElement.style.setProperty('--app-safe-bottom', '9px')

    const resizeHandler = vv.addEventListener.mock.calls.find(([name]) => name === 'resize')?.[1] as () => void
    resizeHandler()
    vi.advanceTimersByTime(32) // let any (wrongly scheduled) rAF run
    expect(document.documentElement.style.getPropertyValue('--app-safe-bottom')).toBe('9px')

    // Keyboard closed: visual viewport restored → remeasure applies.
    vv.height = 800
    resizeHandler()
    vi.advanceTimersByTime(32)
    expect(document.documentElement.style.getPropertyValue('--app-safe-bottom')).toBe('24px')
  })
})
