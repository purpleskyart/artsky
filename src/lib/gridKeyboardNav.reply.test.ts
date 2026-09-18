import { describe, it, expect } from 'vitest'
import { buildMediaFocusIndices } from './gridFocusTargets'
import { computeFocusMoveDown, computeFocusMoveUp } from './gridKeyboardNav'

describe('grid keyboard nav — reply posts', () => {
  const layout = buildMediaFocusIndices(2, (cardIndex) => (cardIndex === 1 ? 2 : 1))

  it('lands on reply-parent strip when entering from above', () => {
    const { firstFocusIndexForCard, lastFocusIndexForCard } = layout
    expect(firstFocusIndexForCard).toEqual([0, 1])
    expect(lastFocusIndexForCard).toEqual([0, 2])

    const next = computeFocusMoveDown({
      focusIndex: 0,
      cardCount: 2,
      cols: 1,
      columns: null,
      focusTargetsLength: 3,
      firstByCard: firstFocusIndexForCard,
      lastByCard: lastFocusIndexForCard,
      currentCardIndex: 0,
      currentMediaIndex: 0,
    })
    expect(next).toBe(1)
  })

  it('lands on reply media when entering from below', () => {
    const belowLayout = buildMediaFocusIndices(2, (cardIndex) => (cardIndex === 0 ? 2 : 1))
    const { firstFocusIndexForCard, lastFocusIndexForCard } = belowLayout

    const next = computeFocusMoveUp({
      focusIndex: 2,
      cardCount: 2,
      cols: 1,
      columns: null,
      focusTargetsLength: 3,
      firstByCard: firstFocusIndexForCard,
      lastByCard: lastFocusIndexForCard,
      currentCardIndex: 1,
      currentMediaIndex: 0,
    })
    expect(next).toBe(1)
  })

  it('steps between reply parent and reply media within the card', () => {
    const { firstFocusIndexForCard, lastFocusIndexForCard } = buildMediaFocusIndices(1, () => 2)

    const down = computeFocusMoveDown({
      focusIndex: 0,
      cardCount: 1,
      cols: 1,
      columns: null,
      focusTargetsLength: 2,
      firstByCard: firstFocusIndexForCard,
      lastByCard: lastFocusIndexForCard,
      currentCardIndex: 0,
      currentMediaIndex: 0,
    })
    expect(down).toBe(1)

    const up = computeFocusMoveUp({
      focusIndex: 1,
      cardCount: 1,
      cols: 1,
      columns: null,
      focusTargetsLength: 2,
      firstByCard: firstFocusIndexForCard,
      lastByCard: lastFocusIndexForCard,
      currentCardIndex: 0,
      currentMediaIndex: 1,
    })
    expect(up).toBe(0)
  })
})
