import { describe, it, expect } from 'vitest'
import { computeVirtualizationNear } from './cardVirtualization'

const VH = 800
const BOUNDS = { top: 0, bottom: VH }

function rectAbove(distance: number, height = 200): DOMRectReadOnly {
  const bottom = BOUNDS.top - distance
  return {
    top: bottom - height,
    bottom,
    left: 0,
    right: 300,
    width: 300,
    height,
    x: 0,
    y: bottom - height,
    toJSON: () => ({}),
  }
}

function rectBelow(distance: number, height = 200): DOMRectReadOnly {
  const top = BOUNDS.bottom + distance
  return {
    top,
    bottom: top + height,
    left: 0,
    right: 300,
    width: 300,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }
}

function rectVisible(): DOMRectReadOnly {
  return {
    top: 100,
    bottom: 400,
    left: 0,
    right: 300,
    width: 300,
    height: 300,
    x: 0,
    y: 100,
    toJSON: () => ({}),
  }
}

describe('computeVirtualizationNear', () => {
  it('keeps visible cards mounted', () => {
    expect(computeVirtualizationNear(false, rectVisible(), BOUNDS, VH)).toBe(true)
    expect(computeVirtualizationNear(true, rectVisible(), BOUNDS, VH)).toBe(true)
  })

  it('unmounts scrolled-past cards after the unmount margin', () => {
    const farAbove = rectAbove(350) // past 0.4vh (320px) unmount
    expect(computeVirtualizationNear(true, farAbove, BOUNDS, VH)).toBe(false)
  })

  it('keeps mounted cards in the hysteresis band above the viewport', () => {
    const inBand = rectAbove(300) // between 0.25vh mount and 0.4vh unmount
    expect(computeVirtualizationNear(true, inBand, BOUNDS, VH)).toBe(true)
    expect(computeVirtualizationNear(false, inBand, BOUNDS, VH)).toBe(false)
  })

  it('remounts virtualized cards when close enough above the viewport', () => {
    const approaching = rectAbove(150) // within 0.25vh (200px) mount zone
    expect(computeVirtualizationNear(false, approaching, BOUNDS, VH)).toBe(true)
  })

  it('stays virtualized when far above the viewport', () => {
    const farAbove = rectAbove(500)
    expect(computeVirtualizationNear(false, farAbove, BOUNDS, VH)).toBe(false)
    expect(computeVirtualizationNear(true, farAbove, BOUNDS, VH)).toBe(false)
  })

  it('uses asymmetric bottom margins for upcoming cards', () => {
    const belowUnmount = rectBelow(650) // past 0.75vh (600px) unmount
    expect(computeVirtualizationNear(true, belowUnmount, BOUNDS, VH)).toBe(false)

    const belowMountBand = rectBelow(350) // within 0.5vh (400px) mount
    expect(computeVirtualizationNear(false, belowMountBand, BOUNDS, VH)).toBe(true)
  })
})
