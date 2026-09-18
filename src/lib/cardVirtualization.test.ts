import { describe, it, expect, beforeEach } from 'vitest'
import { computeVirtualizationNear } from './cardVirtualization'

function mockRect(top: number, bottom: number, width = 300, height = bottom - top): DOMRectReadOnly {
  return {
    top,
    bottom,
    left: 0,
    right: width,
    width,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }
}

describe('computeVirtualizationNear', () => {
  let el: HTMLDivElement

  beforeEach(() => {
    el = document.createElement('div')
    document.body.appendChild(el)
  })

  it('returns true for elements inside the viewport', () => {
    el.getBoundingClientRect = () => mockRect(100, 400)
    expect(computeVirtualizationNear(el, null)).toBe(true)
  })

  it('returns false for elements far above the viewport', () => {
    el.getBoundingClientRect = () => mockRect(-900, -700)
    expect(computeVirtualizationNear(el, null)).toBe(false)
  })

  it('returns true for elements within the top margin above the viewport', () => {
    const vh = window.innerHeight
    const margin = Math.floor(vh * 0.5)
    el.getBoundingClientRect = () => mockRect(-margin + 20, -margin + 120)
    expect(computeVirtualizationNear(el, null)).toBe(true)
  })

  it('uses scroll root height for margins when root is set', () => {
    const root = document.createElement('div')
    root.style.height = '400px'
    document.body.appendChild(root)
    root.getBoundingClientRect = () => mockRect(100, 500)

    const margin = Math.floor(400 * 0.5)
    el.getBoundingClientRect = () => mockRect(100 - margin - 50, 100 - margin - 10)
    expect(computeVirtualizationNear(el, root)).toBe(false)

    el.getBoundingClientRect = () => mockRect(100 - margin + 20, 100 - margin + 120)
    expect(computeVirtualizationNear(el, root)).toBe(true)

    root.remove()
  })
})
