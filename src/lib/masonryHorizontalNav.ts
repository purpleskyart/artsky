/** Minimal rect for viewport-based horizontal moves in a masonry grid. */
export type ViewportRect = { top: number; left: number; width: number; height: number }

export type MasonryNavColumn = Array<{ originalIndex: number }>

function centerOf(r: ViewportRect): { cx: number; cy: number } {
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
}

/** Index of the card directly above in the same column. */
export function indexAbove(columns: MasonryNavColumn[], currentIndex: number): number {
  for (let c = 0; c < columns.length; c++) {
    const row = columns[c].findIndex((e) => e.originalIndex === currentIndex)
    if (row > 0) return columns[c][row - 1].originalIndex
    if (row === 0) return currentIndex
  }
  return currentIndex
}

/** Index of the card directly below in the same column. */
export function indexBelow(columns: MasonryNavColumn[], currentIndex: number): number {
  for (let c = 0; c < columns.length; c++) {
    const row = columns[c].findIndex((e) => e.originalIndex === currentIndex)
    if (row >= 0 && row < columns[c].length - 1) return columns[c][row + 1].originalIndex
    if (row >= 0) return currentIndex
  }
  return currentIndex
}

/**
 * Left/right nav fallback: same slot index in the adjacent column (not visual row).
 * Prefer {@link pickAdjacentCardIndexByViewport} for A/D when DOM rects are available.
 */
export function indexLeftByRow(columns: MasonryNavColumn[], currentIndex: number): number {
  for (let c = 0; c < columns.length; c++) {
    const row = columns[c].findIndex((e) => e.originalIndex === currentIndex)
    if (row < 0) continue
    if (c === 0) return currentIndex
    const leftCol = columns[c - 1]
    if (leftCol.length === 0) return currentIndex
    const targetRow = Math.min(row, leftCol.length - 1)
    return leftCol[targetRow].originalIndex
  }
  return currentIndex
}

export function indexRightByRow(columns: MasonryNavColumn[], currentIndex: number): number {
  for (let c = 0; c < columns.length; c++) {
    const row = columns[c].findIndex((e) => e.originalIndex === currentIndex)
    if (row < 0) continue
    if (c === columns.length - 1) return currentIndex
    const rightCol = columns[c + 1]
    if (rightCol.length === 0) return currentIndex
    const targetRow = Math.min(row, rightCol.length - 1)
    return rightCol[targetRow].originalIndex
  }
  return currentIndex
}

/**
 * Pick the card in the left/right column whose measured rect is closest vertically to the
 * focused card’s rect (tie-break: closer horizontally, then lower index).
 *
 * Returns `null` if the focused element cannot be measured or no neighbor has a rect — caller
 * should fall back to structural row matching.
 */
export function pickAdjacentCardIndexByViewport(
  columns: Array<Array<{ originalIndex: number }>>,
  direction: -1 | 1,
  currentCardIndex: number,
  measure: (cardIndex: number) => ViewportRect | null,
): number | null {
  let colIdx = -1
  for (let c = 0; c < columns.length; c++) {
    const row = columns[c].findIndex((e) => e.originalIndex === currentCardIndex)
    if (row >= 0) {
      colIdx = c
      break
    }
  }
  if (colIdx < 0) return null
  const adjacent = colIdx + direction
  if (adjacent < 0 || adjacent >= columns.length) return null
  const adjCol = columns[adjacent]
  if (adjCol.length === 0) return null

  const focusRect = measure(currentCardIndex)
  if (!focusRect) return null
  const { cx: fcx, cy: fcy } = centerOf(focusRect)

  let bestCard: number | null = null
  let bestDy = Infinity
  let bestDx = Infinity

  for (const { originalIndex: cardIdx } of adjCol) {
    const r = measure(cardIdx)
    if (!r) continue
    const { cx, cy } = centerOf(r)
    const dy = Math.abs(cy - fcy)
    const dx = Math.abs(cx - fcx)
    if (
      bestCard === null ||
      dy < bestDy - 0.5 ||
      (Math.abs(dy - bestDy) <= 0.5 && dx < bestDx - 0.5) ||
      (Math.abs(dy - bestDy) <= 0.5 && Math.abs(dx - bestDx) <= 0.5 && cardIdx < bestCard)
    ) {
      bestCard = cardIdx
      bestDy = dy
      bestDx = dx
    }
  }

  return bestCard
}

/**
 * Pick the media index in a card whose measured rect is closest to a source rect
 * (vertical distance first, then horizontal, then lower index).
 */
export function pickClosestMediaIndexByViewport(
  sourceRect: ViewportRect,
  mediaCount: number,
  measure: (mediaIndex: number) => ViewportRect | null,
  fallbackIndex = 0,
): number {
  if (mediaCount <= 1) return 0
  const { cx: fcx, cy: fcy } = centerOf(sourceRect)
  let bestIndex = Math.min(Math.max(0, fallbackIndex), mediaCount - 1)
  let bestDy = Infinity
  let bestDx = Infinity

  for (let m = 0; m < mediaCount; m++) {
    const r = measure(m)
    if (!r) continue
    const { cx, cy } = centerOf(r)
    const dy = Math.abs(cy - fcy)
    const dx = Math.abs(cx - fcx)
    if (
      bestDy === Infinity ||
      dy < bestDy - 0.5 ||
      (Math.abs(dy - bestDy) <= 0.5 && dx < bestDx - 0.5) ||
      (Math.abs(dy - bestDy) <= 0.5 && Math.abs(dx - bestDx) <= 0.5 && m < bestIndex)
    ) {
      bestIndex = m
      bestDy = dy
      bestDx = dx
    }
  }

  return bestIndex
}
