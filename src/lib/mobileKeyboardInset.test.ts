import { describe, expect, it, vi } from 'vitest'
import {
  applyModalKeyboardInset,
  estimateMobileKeyboardInset,
  inferMobileKeyboardInset,
  MODAL_KEYBOARD_AWARE_ATTR,
  MODAL_KEYBOARD_INSET_VAR,
} from './mobileKeyboardInset'

describe('estimateMobileKeyboardInset', () => {
  it('returns a value between 200 and 340 based on viewport height', () => {
    expect(estimateMobileKeyboardInset(800)).toBe(280)
    expect(estimateMobileKeyboardInset(500)).toBe(200)
    expect(estimateMobileKeyboardInset(1200)).toBe(340)
  })
})

describe('inferMobileKeyboardInset', () => {
  it('returns the gap between layout and visual viewport bottoms', () => {
    vi.stubGlobal('visualViewport', { offsetTop: 0, height: 500 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    expect(inferMobileKeyboardInset()).toBe(300)
  })
})

describe('applyModalKeyboardInset', () => {
  it('sets bottom, CSS var, and keyboard-aware attribute when inset > 0', () => {
    const el = document.createElement('div')
    applyModalKeyboardInset(el, 280)
    expect(el.style.bottom).toBe('280px')
    expect(el.style.getPropertyValue(MODAL_KEYBOARD_INSET_VAR)).toBe('280px')
    expect(el.hasAttribute(MODAL_KEYBOARD_AWARE_ATTR)).toBe(true)
  })

  it('clears inset styles when keyboard dismisses', () => {
    const el = document.createElement('div')
    applyModalKeyboardInset(el, 280)
    applyModalKeyboardInset(el, 0)
    expect(el.style.bottom).toBe('')
    expect(el.style.getPropertyValue(MODAL_KEYBOARD_INSET_VAR)).toBe('')
    expect(el.hasAttribute(MODAL_KEYBOARD_AWARE_ATTR)).toBe(false)
  })
})
