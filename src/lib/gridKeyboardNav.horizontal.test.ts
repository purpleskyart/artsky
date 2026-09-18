import { describe, it, expect } from 'vitest'
import { buildMediaFocusIndices } from './gridFocusTargets'
import { computeFocusMoveHorizontal } from './gridKeyboardNav'
import type { ViewportRect } from './masonryHorizontalNav'
import { pickClosestMediaIndexByViewport } from './masonryHorizontalNav'

describe('pickClosestMediaIndexByViewport', () => {
  it('picks the vertically closest image', () => {
    const source: ViewportRect = { top: 100, left: 0, width: 80, height: 80 }
    const rects: ViewportRect[] = [
      { top: 0, left: 200, width: 80, height: 80 },
      { top: 120, left: 200, width: 80, height: 80 },
      { top: 240, left: 200, width: 80, height: 80 },
    ]
    const picked = pickClosestMediaIndexByViewport(source, rects.length, (m) => rects[m] ?? null, 0)
    expect(picked).toBe(1)
  })

  it('uses horizontal distance as tie-breaker', () => {
    const source: ViewportRect = { top: 100, left: 0, width: 80, height: 80 }
    const rects: ViewportRect[] = [
      { top: 100, left: 300, width: 80, height: 80 },
      { top: 100, left: 180, width: 80, height: 80 },
    ]
    const picked = pickClosestMediaIndexByViewport(source, rects.length, (m) => rects[m] ?? null, 0)
    expect(picked).toBe(1)
  })
})

describe('computeFocusMoveHorizontal', () => {
  const layout = buildMediaFocusIndices(2, (cardIndex) => (cardIndex === 1 ? 3 : 1))
  const { firstFocusIndexForCard, lastFocusIndexForCard } = layout
  const columns = [[{ originalIndex: 0 }], [{ originalIndex: 1 }]]

  const rects: Record<number, Record<number, ViewportRect>> = {
    0: {
      0: { top: 100, left: 20, width: 80, height: 80 },
    },
    1: {
      0: { top: 40, left: 220, width: 80, height: 80 },
      1: { top: 110, left: 220, width: 80, height: 80 },
      2: { top: 190, left: 220, width: 80, height: 80 },
    },
  }

  const measureMedia = (cardIdx: number, mediaIdx: number) => rects[cardIdx]?.[mediaIdx] ?? null
  const measureCard = (cardIdx: number) => measureMedia(cardIdx, 0)

  it('focuses the closest image on the adjacent card, not just the same index', () => {
    const next = computeFocusMoveHorizontal(
      {
        focusIndex: 0,
        cardCount: 2,
        cols: 2,
        columns,
        focusTargetsLength: 4,
        firstByCard: firstFocusIndexForCard,
        lastByCard: lastFocusIndexForCard,
        currentCardIndex: 0,
        currentMediaIndex: 0,
      },
      false,
      measureCard,
      measureMedia,
    )
    expect(next).toBe(firstFocusIndexForCard[1] + 1)
  })

  it('falls back to clamped index when rects are unavailable', () => {
    const next = computeFocusMoveHorizontal(
      {
        focusIndex: 2,
        cardCount: 2,
        cols: 2,
        columns,
        focusTargetsLength: 4,
        firstByCard: firstFocusIndexForCard,
        lastByCard: lastFocusIndexForCard,
        currentCardIndex: 1,
        currentMediaIndex: 2,
      },
      true,
      () => null,
    )
    expect(next).toBe(firstFocusIndexForCard[0])
  })
})
