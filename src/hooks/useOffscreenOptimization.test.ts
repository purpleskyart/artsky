import { renderHook } from '@testing-library/react'
import { useOffscreenOptimization } from './useOffscreenOptimization'
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('useOffscreenOptimization', () => {
  let mockObserve: ReturnType<typeof vi.fn>
  let mockDisconnect: ReturnType<typeof vi.fn>
  let mockIntersectionObserver: typeof IntersectionObserver

  beforeEach(() => {
    mockObserve = vi.fn()
    mockDisconnect = vi.fn()

    mockIntersectionObserver = class {
      observe = mockObserve
      disconnect = mockDisconnect
      unobserve = vi.fn()
      takeRecords = vi.fn()
      root = null
      rootMargin = ''
      thresholds = []

      constructor(public callback: IntersectionObserverCallback, public options?: IntersectionObserverInit) {}
    } as unknown as typeof IntersectionObserver

    vi.stubGlobal('IntersectionObserver', mockIntersectionObserver)
  })

  it('should return true initially (visible by default)', () => {
    const el = document.createElement('div')
    const { result } = renderHook(() => useOffscreenOptimization(el))

    expect(result.current).toBe(true)
  })

  it('should create IntersectionObserver with default options', () => {
    const el = document.createElement('div')
    renderHook(() => useOffscreenOptimization(el))

    expect(mockObserve).toHaveBeenCalled()
  })

  it('should create IntersectionObserver with custom options', () => {
    const el = document.createElement('div')
    const customOptions = {
      rootMargin: '800px 0px 800px 0px',
      threshold: 0.5,
    }

    renderHook(() => useOffscreenOptimization(el, customOptions))

    expect(mockObserve).toHaveBeenCalled()
  })

  it('should observe the element when provided', () => {
    const element = document.createElement('div')

    renderHook(() => useOffscreenOptimization(element))

    expect(mockObserve).toHaveBeenCalledWith(element)
  })

  it('should not observe when element is null', () => {
    renderHook(() => useOffscreenOptimization(null))

    expect(mockObserve).not.toHaveBeenCalled()
  })

  it('should disconnect observer on unmount', () => {
    const el = document.createElement('div')
    const { unmount } = renderHook(() => useOffscreenOptimization(el))

    unmount()

    expect(mockDisconnect).toHaveBeenCalled()
  })

  it('should update visibility when intersection changes', () => {
    const el = document.createElement('div')
    let observerInstance: InstanceType<typeof mockIntersectionObserver> | null = null

    const OriginalObserver = mockIntersectionObserver
    mockIntersectionObserver = class extends OriginalObserver {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        super(callback, options)
        observerInstance = this
      }
    } as unknown as typeof IntersectionObserver

    vi.stubGlobal('IntersectionObserver', mockIntersectionObserver)

    const { result, rerender } = renderHook(() => useOffscreenOptimization(el))

    expect(result.current).toBe(true)

    if (observerInstance) {
      observerInstance.callback(
        [
          {
            isIntersecting: false,
            target: el,
            boundingClientRect: {} as DOMRectReadOnly,
            intersectionRatio: 0,
            intersectionRect: {} as DOMRectReadOnly,
            rootBounds: null,
            time: Date.now(),
          },
        ],
        observerInstance as unknown as IntersectionObserver
      )
    }

    rerender()
    expect(result.current).toBe(false)

    if (observerInstance) {
      observerInstance.callback(
        [
          {
            isIntersecting: true,
            target: el,
            boundingClientRect: {} as DOMRectReadOnly,
            intersectionRatio: 1,
            intersectionRect: {} as DOMRectReadOnly,
            rootBounds: null,
            time: Date.now(),
          },
        ],
        observerInstance as unknown as IntersectionObserver
      )
    }

    rerender()
    expect(result.current).toBe(true)
  })
})
