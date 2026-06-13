import type { TimelineItem } from './bsky'

type AuthorWithViewer = { did: string; handle?: string; viewer?: { following?: string } }

/** Patch `author.viewer.following` on the timeline item whose post URI matches. */
export function patchFollowingOnTimelineItem(
  items: TimelineItem[],
  postUri: string,
  followingUri: string | undefined,
): TimelineItem[] {
  return items.map((it) => {
    if (it.post.uri !== postUri) return it
    const post = it.post
    const auth = post.author as AuthorWithViewer
    return {
      ...it,
      post: {
        ...post,
        author: {
          ...auth,
          viewer: { ...auth.viewer, following: followingUri },
        },
      } as TimelineItem['post'],
    }
  })
}
