import { getPostMediaInfo, type TimelineItem } from './bsky'

export const ESTIMATE_COL_WIDTH = 280
export const CARD_CHROME = 100

export type MasonryColumnEntry<T> = { item: T; originalIndex: number }

export type MasonryColumns<T> = Array<Array<MasonryColumnEntry<T>>>

/** Nominal column width scales with column count (matches FeedPage). */
export function estimatedColumnWidth(numCols: number): number {
  if (numCols === 1) return 580
  if (numCols === 2) return 400
  return ESTIMATE_COL_WIDTH
}

export function estimateMediaCardHeight(
  aspectRatio: number | null | undefined,
  numCols: number = 3,
  hasMedia: boolean = true,
): number {
  if (!hasMedia) return CARD_CHROME + 80
  const w = estimatedColumnWidth(numCols)
  if (aspectRatio != null && aspectRatio > 0) return CARD_CHROME + w / aspectRatio
  return CARD_CHROME + 220
}

export function estimateTimelineItemHeight(item: TimelineItem, numCols: number = 3): number {
  const media = getPostMediaInfo(item.post)
  return estimateMediaCardHeight(media?.aspectRatio, numCols, !!media)
}

function pickShortestColumnIndex(columnHeights: number[], columns: MasonryColumns<unknown>): number {
  let best = 0
  for (let c = 1; c < columnHeights.length; c++) {
    const shorter = columnHeights[c] < columnHeights[best]
    const sameHeight = Math.abs(columnHeights[c] - columnHeights[best]) < 2
    const fewerItems = columns[c].length < columns[best].length
    if (shorter || (sameHeight && fewerItems)) best = c
  }
  return best
}

function distributeFresh<T>(
  items: T[],
  numCols: number,
  estimateHeight: (item: T, numCols: number) => number,
): MasonryColumns<T> {
  const cols = Math.max(1, Math.floor(numCols))
  const columns: MasonryColumns<T> = Array.from({ length: cols }, () => [])
  const columnHeights: number[] = Array(cols).fill(0)
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const h = estimateHeight(item, cols)
    const lengths = columns.map((col) => col.length)
    const minCount = lengths.length === 0 ? 0 : Math.min(...lengths)
    let best = -1
    for (let c = 0; c < cols; c++) {
      if (columns[c].length > minCount + 1) continue
      const shorter = best === -1 || columnHeights[c] < columnHeights[best]
      const sameHeight = best >= 0 && Math.abs(columnHeights[c] - columnHeights[best]) < 2
      const fewerItems = best >= 0 && columns[c].length < columns[best].length
      if (shorter || (sameHeight && fewerItems)) best = c
    }
    if (best === -1) best = 0
    columns[best].push({ item, originalIndex: i })
    columnHeights[best] += h
  }
  return columns
}

/**
 * Distribute items into masonry columns by estimated height.
 * When `getStableKey` + `previousDistribution` are provided and column count is unchanged,
 * cards keep their column assignment across load-more (prevents layout jump).
 */
export function distributeByHeight<T>(
  items: T[],
  numCols: number,
  estimateHeight: (item: T, numCols: number) => number = (item) =>
    estimateTimelineItemHeight(item as TimelineItem, numCols),
  options?: {
    getStableKey?: (item: T) => string
    previousDistribution?: MasonryColumns<T>
  },
): MasonryColumns<T> {
  const cols = Math.max(1, Math.floor(numCols))
  if (cols < 1) return []

  const { getStableKey, previousDistribution } = options ?? {}
  if (getStableKey && previousDistribution && previousDistribution.length === cols) {
    const keyToColumn = new Map<string, number>()
    previousDistribution.forEach((col, colIndex) => {
      col.forEach(({ item }) => keyToColumn.set(getStableKey(item), colIndex))
    })

    const columns: MasonryColumns<T> = Array.from({ length: cols }, () => [])
    const columnHeights: number[] = Array(cols).fill(0)

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const h = estimateHeight(item, cols)
      const prevCol = keyToColumn.get(getStableKey(item))
      const col = prevCol !== undefined && prevCol < cols ? prevCol : pickShortestColumnIndex(columnHeights, columns)
      columns[col].push({ item, originalIndex: i })
      columnHeights[col] += h
    }
    return columns
  }

  return distributeFresh(items, cols, estimateHeight)
}

/** Distribute timeline items into masonry columns (profile/tag/search/collection grids). */
export function distributeTimelineItemsByHeight(
  items: TimelineItem[],
  numCols: number,
  previousDistribution?: MasonryColumns<TimelineItem>,
): MasonryColumns<TimelineItem> {
  return distributeByHeight(items, numCols, estimateTimelineItemHeight, {
    getStableKey: (item) => item.post.uri,
    previousDistribution,
  })
}
