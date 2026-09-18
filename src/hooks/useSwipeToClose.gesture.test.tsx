import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  resetSwipeToCloseSafeAreaCacheForTests,
  useSwipeToClose,
  type UseSwipeToCloseResult,
} from './useSwipeToClose'

/** Renders a pane that attaches the hook’s React handlers; captures the latest result. */
function renderPane(options: Parameters<typeof useSwipeToClose>[0]) {
  let latest: UseSwipeToCloseResult
  function Probe() {
    latest = useSwipeToClose(options)
    return (
      <div
        data-testid="pane"
        onTouchStart={latest.onTouchStart}
        onTouchMove={latest.onTouchMove}
        onTouchEnd={latest.onTouchEnd}
        onTouchCancel={latest.onTouchCancel}
      />
    )
  }
  render(<Probe />)
  return {
    el: screen.getByTestId('pane'),
    result: () => latest,
  }
}

describe('useSwipeToClose gesture lifecycle', () => {
  beforeEach(() => {
    // Sanitize state leaked from other suites (getComputedStyle spies, vv stubs, inset cache).
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    resetSwipeToCloseSafeAreaCacheForTests()
  })

  it('drags with the finger and completes a swipe right', () => {
    const onSwipeRight = vi.fn()
    const { el, result } = renderPane({ enabled: true, onSwipeRight })

    fireEvent.touchStart(el, { touches: [{ identifier: 1, clientX: 200, clientY: 300 }] })
    fireEvent.touchMove(el, { touches: [{ identifier: 1, clientX: 240, clientY: 300 }] })
    expect(result().translateX).toBe(40)
    expect(result().style).toEqual({ transform: 'translateX(40px)' })

    fireEvent.touchEnd(el, {
      touches: [],
      changedTouches: [{ identifier: 1, clientX: 300, clientY: 300 }],
    })
    expect(onSwipeRight).toHaveBeenCalledTimes(1)
    expect(result().translateX).toBe(0)
  })

  it('resets the drag on touchcancel without triggering the swipe', () => {
    const onSwipeRight = vi.fn()
    const { el, result } = renderPane({ enabled: true, onSwipeRight })

    fireEvent.touchStart(el, { touches: [{ identifier: 1, clientX: 200, clientY: 300 }] })
    fireEvent.touchMove(el, { touches: [{ identifier: 1, clientX: 260, clientY: 300 }] })
    expect(result().translateX).toBe(60)

    // OS/browser takes over the gesture mid-drag: no stuck halfway offset.
    fireEvent.touchCancel(el, {
      touches: [],
      changedTouches: [{ identifier: 1, clientX: 260, clientY: 300 }],
    })
    expect(onSwipeRight).not.toHaveBeenCalled()
    expect(result().translateX).toBe(0)
    expect(result().style).toBeUndefined()
    expect(result().isReturning).toBe(true)
  })

  it('ignores moves from a touch whose start was never seen (stale coordinates)', () => {
    const onSwipeRight = vi.fn()
    const { el, result } = renderPane({ enabled: true, onSwipeRight })

    // touchstart stopped from bubbling (e.g. NSFW overlay): move must not use stale start.
    fireEvent.touchMove(el, { touches: [{ identifier: 7, clientX: 400, clientY: 300 }] })
    expect(result().translateX).toBe(0)

    // A different finger than the one that started also moves nothing.
    fireEvent.touchStart(el, { touches: [{ identifier: 1, clientX: 200, clientY: 300 }] })
    fireEvent.touchMove(el, { touches: [{ identifier: 2, clientX: 400, clientY: 300 }] })
    expect(result().translateX).toBe(0)
  })

  it('binds native listeners with a non-passive touchmove when targetRef is provided', () => {
    const addEventListener = vi.fn()
    const removeEventListener = vi.fn()
    const targetRef = {
      current: ({ addEventListener, removeEventListener } as unknown) as HTMLElement,
    }
    const { unmount } = renderPane({ enabled: true, targetRef })

    const moveCall = addEventListener.mock.calls.find(([name]) => name === 'touchmove')
    expect(moveCall).toBeTruthy()
    expect(moveCall?.[2]).toEqual({ passive: false })
    expect(addEventListener.mock.calls.find(([name]) => name === 'touchcancel')).toBeTruthy()

    unmount()
    expect(removeEventListener).toHaveBeenCalledWith('touchmove', expect.any(Function))
    expect(removeEventListener).toHaveBeenCalledWith('touchcancel', expect.any(Function))
  })
})
