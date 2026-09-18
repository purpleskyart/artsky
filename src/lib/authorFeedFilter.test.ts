import { describe, expect, it } from 'vitest'
import {
  authorFeedFilterCacheKey,
  authorFeedFilterForMediaMode,
  authorFeedFilterForProfileTab,
  buildAuthorFeedQuery,
} from './authorFeedFilter'

describe('authorFeedFilterForMediaMode', () => {
  it('maps media and video modes to server filters', () => {
    expect(authorFeedFilterForMediaMode('media')).toBe('posts_with_media')
    expect(authorFeedFilterForMediaMode('video')).toBe('posts_with_video')
  })

  it('returns undefined for modes that need the full author feed', () => {
    expect(authorFeedFilterForMediaMode('mediaText')).toBeUndefined()
    expect(authorFeedFilterForMediaMode('text')).toBeUndefined()
  })
})

describe('authorFeedFilterForProfileTab', () => {
  it('maps posts and videos tabs to server filters', () => {
    expect(authorFeedFilterForProfileTab('posts')).toBe('posts_with_media')
    expect(authorFeedFilterForProfileTab('videos')).toBe('posts_with_video')
  })

  it('returns undefined for tabs that need client-side filtering', () => {
    expect(authorFeedFilterForProfileTab('text')).toBeUndefined()
    expect(authorFeedFilterForProfileTab('replies')).toBeUndefined()
    expect(authorFeedFilterForProfileTab('reposts')).toBeUndefined()
    expect(authorFeedFilterForProfileTab('feeds')).toBeUndefined()
  })
})

describe('buildAuthorFeedQuery', () => {
  it('includes filter only when set', () => {
    expect(buildAuthorFeedQuery({ actor: 'alice.bsky.social', limit: 20 }, 'posts_with_media')).toEqual({
      actor: 'alice.bsky.social',
      limit: 20,
      filter: 'posts_with_media',
    })
    expect(buildAuthorFeedQuery({ actor: 'alice.bsky.social', limit: 20 })).toEqual({
      actor: 'alice.bsky.social',
      limit: 20,
    })
  })
})

describe('authorFeedFilterCacheKey', () => {
  it('uses all for unfiltered requests', () => {
    expect(authorFeedFilterCacheKey()).toBe('all')
    expect(authorFeedFilterCacheKey(undefined)).toBe('all')
    expect(authorFeedFilterCacheKey('posts_with_video')).toBe('posts_with_video')
  })
})
