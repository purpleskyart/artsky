import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  applySafeAreaInsets,
  estimateIosStandaloneBottomInset,
  estimateIosStandaloneTopInset,
  initSafeAreaInsets,
  isLikelyKeyboardOpen,
  measureEnvSafeAreaInsets,
  resetSessionSafeAreaInsets,
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
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does not subscribe to visualViewport resize (keyboard/toolbar would churn safe area)', async () => {
    const vvAdd = vi.fn()
    vi.stubGlobal('visualViewport', { addEventListener: vvAdd, removeEventListener: vi.fn() })
    const { bindSafeAreaInsetListeners } = await import('./safeAreaInsets')
    bindSafeAreaInsetListeners()
    expect(vvAdd).not.toHaveBeenCalled()
  })
})

describe('session safe area insets', () => {
  beforeEach(() => {
    resetSessionSafeAreaInsets()
    document.documentElement.style.removeProperty('--app-safe-bottom')
  })

  it('never decreases bottom inset during the session', () => {
    applySafeAreaInsets({ top: 0, right: 0, bottom: 34, left: 0 })
    applySafeAreaInsets({ top: 0, right: 0, bottom: 0, left: 0 })
    expect(document.documentElement.style.getPropertyValue('--app-safe-bottom')).toBe('34px')
  })

  it('skips env remeasure while the keyboard is likely open', () => {
    applySafeAreaInsets({ top: 0, right: 0, bottom: 34, left: 0 })
    vi.stubGlobal('visualViewport', {
      offsetTop: 0,
      height: 400,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 800,
    })
    expect(isLikelyKeyboardOpen()).toBe(true)
    const measured = measureEnvSafeAreaInsets()
    expect(measured.bottom).toBe(0)
    initSafeAreaInsets()
    expect(document.documentElement.style.getPropertyValue('--app-safe-bottom')).toBe('34px')
  })
})

describe('restoreMobileLayoutAfterPopup', () => {
  it('restores scroll position immediately and again after keyboard teardown', async () => {
    vi.useFakeTimers()
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const { restoreMobileLayoutAfterPopup } = await import('./safeAreaInsets')

    restoreMobileLayoutAfterPopup(420)
    expect(scrollTo).toHaveBeenCalledWith({ top: 420, left: 0, behavior: 'instant' })

    await vi.runAllTimersAsync()
    expect(scrollTo.mock.calls.length).toBeGreaterThanOrEqual(3)

    scrollTo.mockRestore()
    vi.useRealTimers()
  })
})
