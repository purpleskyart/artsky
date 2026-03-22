import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { ScrollLockProvider, useScrollLock } from './ScrollLockContext'

describe('ScrollLockContext', () => {
  beforeEach(() => {
    document.body.style.position = ''
    document.body.style.top = ''
    document.body.style.width = ''
    document.body.style.overflow = ''
    document.body.style.touchAction = ''
    document.documentElement.style.overflow = ''

    Object.defineProperty(window, 'scrollY', {
      writable: true,
      configurable: true,
      value: 0,
    })
  })

  it('locks scroll when lockScroll is called', () => {
    const { result } = renderHook(() => useScrollLock(), {
      wrapper: ScrollLockProvider,
    })

    result.current?.lockScroll()

    expect(document.body.style.overflow).toBe('hidden')
    expect(document.documentElement.style.overflow).toBe('hidden')
  })

  it('unlocks scroll when unlockScroll is called', () => {
    const { result } = renderHook(() => useScrollLock(), {
      wrapper: ScrollLockProvider,
    })

    result.current?.lockScroll()
    result.current?.unlockScroll()

    expect(document.body.style.overflow).toBe('')
    expect(document.documentElement.style.overflow).toBe('')
  })

  it('handles nested lock/unlock calls correctly', () => {
    const { result } = renderHook(() => useScrollLock(), {
      wrapper: ScrollLockProvider,
    })

    result.current?.lockScroll()
    result.current?.lockScroll()

    expect(document.body.style.overflow).toBe('hidden')

    result.current?.unlockScroll()
    expect(document.body.style.overflow).toBe('hidden')

    result.current?.unlockScroll()
    expect(document.body.style.overflow).toBe('')
  })

  it('preserves scroll position when locking and restores when unlocking', () => {
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})

    Object.defineProperty(window, 'scrollY', {
      writable: true,
      configurable: true,
      value: 500,
    })

    const { result } = renderHook(() => useScrollLock(), {
      wrapper: ScrollLockProvider,
    })

    result.current?.lockScroll()

    result.current?.unlockScroll()

    expect(scrollToSpy).toHaveBeenCalledWith({ top: 500, left: 0, behavior: 'instant' })

    scrollToSpy.mockRestore()
  })
})
