/**
 * jsdom omits several browser APIs used by the app and @atproto/oauth-client-browser.
 * Load polyfills/mocks before any tests so imports and effects don't throw.
 */
import 'fake-indexeddb/auto'

import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { imageLoadQueue } from '../lib/ImageLoadQueue'

class IntersectionObserverMock implements IntersectionObserver {
  readonly root: Element | Document | null = null
  rootMargin = ''
  readonly thresholds: ReadonlyArray<number> = []
  private readonly callback: IntersectionObserverCallback

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    if (options?.rootMargin != null) this.rootMargin = options.rootMargin
    if (options?.threshold != null) {
      ;(this as unknown as { thresholds: readonly number[] }).thresholds = Array.isArray(options.threshold)
        ? options.threshold
        : [options.threshold]
    }
  }

  disconnect(): void {}

  observe(element: Element): void {
    queueMicrotask(() => {
      const rect =
        typeof element.getBoundingClientRect === 'function'
          ? element.getBoundingClientRect()
          : new DOMRect()
      this.callback(
        [
          {
            isIntersecting: true,
            target: element,
            intersectionRatio: 1,
            boundingClientRect: rect,
            intersectionRect: rect,
            rootBounds: null,
            time: Date.now(),
          } as IntersectionObserverEntry,
        ],
        this,
      )
    })
  }

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }

  unobserve(): void {}
}

if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver =
    IntersectionObserverMock as unknown as typeof IntersectionObserver
}

afterEach(() => {
  cleanup()
  imageLoadQueue.clear()
})
