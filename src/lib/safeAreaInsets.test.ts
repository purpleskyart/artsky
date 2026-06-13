import { describe, expect, it } from 'vitest'
import { estimateIosStandaloneTopInset, resolveSafeAreaInsets } from './safeAreaInsets'

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

describe('resolveSafeAreaInsets', () => {
  it('keeps measured top when env reports a real inset', () => {
    expect(resolveSafeAreaInsets({ top: 47, right: 0, bottom: 34, left: 0 }).top).toBe(47)
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
  })
})
