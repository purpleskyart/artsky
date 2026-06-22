import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getMobileKeyboardInsetPx, isMobileKeyboardLikelyOpen } from './mobileKeyboardInset'

describe('mobileKeyboardInset', () => {
  beforeEach(() => {
    vi.stubGlobal('innerHeight', 800)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns zero inset when visual viewport fills the window', () => {
    vi.stubGlobal('visualViewport', { offsetTop: 60, height: 740 })
    expect(getMobileKeyboardInsetPx()).toBe(0)
    expect(isMobileKeyboardLikelyOpen()).toBe(false)
  })

  it('detects keyboard from bottom inset, not offsetTop alone', () => {
    vi.stubGlobal('visualViewport', { offsetTop: 60, height: 400 })
    expect(getMobileKeyboardInsetPx()).toBe(340)
    expect(isMobileKeyboardLikelyOpen()).toBe(true)
  })
})
