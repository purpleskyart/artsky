/** Minimal rect for viewport-based horizontal moves in a masonry grid. */
export type ViewportRect = { top: number; left: number; width: number; height: number }

function centerOf(r: ViewportRect): { cx: number; cy: number } {
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
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
