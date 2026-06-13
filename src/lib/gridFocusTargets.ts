export type MediaFocusTarget = { cardIndex: number; mediaIndex: number }

export interface MediaFocusIndices {
  focusTargets: MediaFocusTarget[]
  firstFocusIndexForCard: number[]
  lastFocusIndexForCard: number[]
}

/** Build flat focus targets and per-card first/last indices for multi-image keyboard nav. */
export function buildMediaFocusIndices(
  cardCount: number,
  getMediaCount: (cardIndex: number) => number,
): MediaFocusIndices {
  const focusTargets: MediaFocusTarget[] = []
  const firstFocusIndexForCard: number[] = []
  const lastFocusIndexForCard: number[] = []
  let idx = 0
  for (let cardIndex = 0; cardIndex < cardCount; cardIndex++) {
    firstFocusIndexForCard[cardIndex] = idx
    const n = Math.max(1, getMediaCount(cardIndex))
    for (let m = 0; m < n; m++) focusTargets.push({ cardIndex, mediaIndex: m })
    lastFocusIndexForCard[cardIndex] = idx + n - 1
    idx += n
  }
  return { focusTargets, firstFocusIndexForCard, lastFocusIndexForCard }
}

/** One focus target per card (mediaIndex always 0). */
export function buildCardFocusIndices(cardCount: number): MediaFocusIndices {
  return buildMediaFocusIndices(cardCount, () => 1)
}
