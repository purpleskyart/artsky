import { getPostMediaInfo, isPostNsfw, type TimelineItem } from './bsky'
import type { NsfwPreference } from '../context/ModerationContext'

export interface FilterMediaGridItemsOptions {
  nsfwPreference: NsfwPreference
  blockedDids?: Set<string>
  mutedDids?: Set<string>
  /** When false, include text-only posts. Default true (media grids only). */
  mediaOnly?: boolean
}

/** Filter timeline items for masonry media grids (media + NSFW + optional block/mute). */
export function filterMediaGridItems(
  items: TimelineItem[],
  { nsfwPreference, blockedDids, mutedDids, mediaOnly = true }: FilterMediaGridItemsOptions,
): TimelineItem[] {
  return items
    .filter((item) => !mediaOnly || getPostMediaInfo(item.post))
    .filter((item) => nsfwPreference !== 'sfw' || !isPostNsfw(item.post))
    .filter((item) => {
      const authorDid = item.post.author?.did
      if (!authorDid || (!blockedDids && !mutedDids)) return true
      if (blockedDids?.has(authorDid)) return false
      if (mutedDids?.has(authorDid)) return false
      return true
    })
}
