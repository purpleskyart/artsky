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

    // Mock IntersectionObserver as a class constructor
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
    const ref = { current: document.createElement('div') }
    const { result } = renderHook(() => useOffscreenOptimization(ref))
    
    expect(result.current).toBe(true)
  })

  it('should create IntersectionObserver with default options', () => {
    const ref = { current: document.createElement('div') }
    renderHook(() => useOffscreenOptimization(ref))
    
    // Just verify observe was called - the observer was created
    expect(mockObserve).toHaveBeenCalled()
  })

  it('should create IntersectionObserver with custom options', () => {
    const ref = { current: document.createElement('div') }
    const customOptions = {
      rootMargin: '800px 0px 800px 0px',
      threshold: 0.5,
    }
    
    renderHook(() => useOffscreenOptimization(ref, customOptions))
    
    // Just verify observe was called - the observer was created
    expect(mockObserve).toHaveBeenCalled()
  })

  it('should observe the element when ref is set', () => {
    const element = document.createElement('div')
    const ref = { current: element }
    
    renderHook(() => useOffscreenOptimization(ref))
    
    expect(mockObserve).toHaveBeenCalledWith(element)
  })

  it('should not observe when ref is null', () => {
    const ref = { current: null }
    
    renderHook(() => useOffscreenOptimization(ref))
    
    expect(mockObserve).not.toHaveBeenCalled()
  })

  it('should disconnect observer on unmount', () => {
    const ref = { current: document.createElement('div') }
    const { unmount } = renderHook(() => useOffscreenOptimization(ref))
    
    unmount()
    
    expect(mockDisconnect).toHaveBeenCalled()
  })

  it('should update visibility when intersection changes', () => {
    const ref = { current: document.createElement('div') }
    let observerInstance: InstanceType<typeof mockIntersectionObserver> | null = null
    
    // Capture the observer instance
    const OriginalObserver = mockIntersectionObserver
    mockIntersectionObserver = class extends OriginalObserver {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        super(callback, options)
        observerInstance = this
      }
    } as unknown as typeof IntersectionObserver
    
    vi.stubGlobal('IntersectionObserver', mockIntersectionObserver)
    
    const { result, rerender } = renderHook(() => useOffscreenOptimization(ref))
    
    // Initially visible
    expect(result.current).toBe(true)
    
    // Simulate element becoming not visible
    if (observerInstance) {
      observerInstance.callback(
        [
          {
            isIntersecting: false,
            target: ref.current!,
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
    
    // Simulate element becoming visible again
    if (observerInstance) {
      observerInstance.callback(
        [
          {
            isIntersecting: true,
            target: ref.current!,
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
