import { useMemo } from 'react'
import { buildMediaFocusIndices, type MediaFocusIndices } from '../lib/gridFocusTargets'

/** Focus targets for multi-image keyboard navigation in masonry grids. */
export function useMediaFocusTargets(
  cardCount: number,
  getMediaCount: (cardIndex: number) => number,
): MediaFocusIndices {
  return useMemo(() => buildMediaFocusIndices(cardCount, getMediaCount), [cardCount, getMediaCount])
}
