import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { ScrollLockProvider, useScrollLock } from './ScrollLockContext'

describe('ScrollLockContext', () => {
  beforeEach(() => {
    // Reset body styles
    document.body.style.position = ''
    document.body.style.top = ''
    document.body.style.width = ''
    document.body.style.overflow = ''
    document.body.style.touchAction = ''
    document.documentElement.style.overflow = ''
    
    // Mock window.scrollY
    Object.defineProperty(window, 'scrollY', {
      writable: true,
      value: 0,
    })
  })

  it('locks scroll when lockScroll is called', () => {
    const { result } = renderHook(() => useScrollLock(), {
      wrapper: ScrollLockProvider,
    })

    result.current?.lockScroll()

    expect(document.body.style.position).toBe('fixed')
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.body.style.touchAction).toBe('none')
    expect(document.documentElement.style.overflow).toBe('hidden')
  })

  it('unlocks scroll when unlockScroll is called', () => {
    const { result } = renderHook(() => useScrollLock(), {
      wrapper: ScrollLockProvider,
    })

    result.current?.lockScroll()
    result.current?.unlockScroll()

    expect(document.body.style.position).toBe('')
    expect(document.body.style.overflow).toBe('')
    expect(document.body.style.touchAction).toBe('')
    expect(document.documentElement.style.overflow).toBe('')
  })

  it('handles nested lock/unlock calls correctly', () => {
    const { result } = renderHook(() => useScrollLock(), {
      wrapper: ScrollLockProvider,
    })

    // Lock twice
    result.current?.lockScroll()
    result.current?.lockScroll()

    expect(document.body.style.position).toBe('fixed')

    // First unlock should not release
    result.current?.unlockScroll()
    expect(document.body.style.position).toBe('fixed')

    // Second unlock should release
    result.current?.unlockScroll()
    expect(document.body.style.position).toBe('')
  })

  it('preserves scroll position when locking and restores when unlocking', () => {
    const scrollToSpy = vi.spyOn(window, 'scrollTo')
    
    // Set initial scroll position
    Object.defineProperty(window, 'scrollY', {
      writable: true,
      value: 500,
    })

    const { result } = renderHook(() => useScrollLock(), {
      wrapper: ScrollLockProvider,
    })

    result.current?.lockScroll()
    
    // Should set top to negative scroll position
    expect(document.body.style.top).toBe('-500px')

    result.current?.unlockScroll()

    // Should restore scroll position
    expect(scrollToSpy).toHaveBeenCalledWith(0, 500)
  })
})
