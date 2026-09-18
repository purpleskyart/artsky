/** Bluesky `app.bsky.feed.getAuthorFeed` filter values. */
export type AuthorFeedFilter =
  | 'posts_with_replies'
  | 'posts_no_replies'
  | 'posts_with_media'
  | 'posts_and_author_threads'
  | 'posts_with_video'

export type MediaFilterMode = 'mediaText' | 'media' | 'video' | 'text'

export type ProfileAuthorFeedTab = 'posts' | 'videos' | 'text' | 'replies' | 'reposts' | 'feeds'

export function authorFeedFilterForMediaMode(mode: MediaFilterMode): AuthorFeedFilter | undefined {
  if (mode === 'media') return 'posts_with_media'
  if (mode === 'video') return 'posts_with_video'
  return undefined
}

export function authorFeedFilterForProfileTab(tab: ProfileAuthorFeedTab): AuthorFeedFilter | undefined {
  if (tab === 'posts') return 'posts_with_media'
  if (tab === 'videos') return 'posts_with_video'
  return undefined
}

export type AuthorFeedQuery = {
  actor: string
  limit?: number
  cursor?: string
  includePins?: boolean
  filter?: AuthorFeedFilter
}

/** Build getAuthorFeed params; omits filter when undefined (API default). */
export function buildAuthorFeedQuery(
  base: Omit<AuthorFeedQuery, 'filter'>,
  filter?: AuthorFeedFilter,
): AuthorFeedQuery {
  return filter ? { ...base, filter } : base
}

/** Stable segment for response-cache keys. */
export function authorFeedFilterCacheKey(filter?: AuthorFeedFilter): string {
  return filter ?? 'all'
}
