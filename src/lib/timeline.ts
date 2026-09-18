import type { AppBskyFeedDefs } from '@atproto/api'
import type { TimelineItem } from './bsky'

/** Wrap PostView into TimelineItem shape for PostCard. */
export function postViewToTimelineItem(post: AppBskyFeedDefs.PostView): TimelineItem {
  return { post }
}

/** Map PostView[] to TimelineItem[]. */
export function postViewsToTimelineItems(posts: AppBskyFeedDefs.PostView[]): TimelineItem[] {
  return posts.map(postViewToTimelineItem)
}
