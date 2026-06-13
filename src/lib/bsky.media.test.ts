import { describe, it, expect } from 'vitest'
import {
  getPostAllMedia,
  getPostExternalLink,
  getPostMediaInfo,
  isGifExternalUri,
  type PostView,
} from './bsky'

function gifPost(overrides?: Partial<PostView>): PostView {
  return {
    uri: 'at://did:plc:test/app.bsky.feed.post/gif1',
    cid: 'bafytest',
    author: { did: 'did:plc:test', handle: 'test.bsky.social' },
    record: { text: '', createdAt: new Date().toISOString() },
    indexedAt: new Date().toISOString(),
    ...overrides,
  } as PostView
}

describe('isGifExternalUri', () => {
  it('detects Bluesky Tenor GIF media URLs', () => {
    expect(
      isGifExternalUri('https://media.tenor.com/ZttURy99Kn8AAAAC/good-great.gif?hh=172&ww=250'),
    ).toBe(true)
  })

  it('detects direct .gif URLs', () => {
    expect(isGifExternalUri('https://example.com/animation.gif')).toBe(true)
  })

  it('rejects regular link previews', () => {
    expect(isGifExternalUri('https://example.com/article')).toBe(false)
  })
})

describe('getPostMediaInfo gif externals', () => {
  it('treats Tenor GIF embeds as image media', () => {
    const post = gifPost({
      embed: {
        $type: 'app.bsky.embed.external#view',
        external: {
          uri: 'https://media.tenor.com/ZttURy99Kn8AAAAC/good-great.gif?hh=172&ww=250',
          title: 'Totally GIF',
          description: 'ALT: Totally GIF',
          thumb: 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:test/bafythumb@jpeg',
        },
      },
    })

    const media = getPostMediaInfo(post)
    expect(media).toEqual({
      url: 'https://media.tenor.com/ZttURy99Kn8AAAAC/good-great.gif?hh=172&ww=250',
      type: 'image',
      imageCount: 1,
      aspectRatio: 250 / 172,
    })
    expect(getPostAllMedia(post)).toHaveLength(1)
    expect(getPostExternalLink(post)).toBeNull()
  })

  it('supports legacy flat external embed shape', () => {
    const post = gifPost({
      embed: {
        $type: 'app.bsky.embed.external#view',
        uri: 'https://media.tenor.com/abcAAAAC/test.gif?hh=100&ww=200',
        title: 'GIF',
        description: '',
        thumb: 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:test/bafy@jpeg',
      },
    })

    expect(getPostMediaInfo(post)?.type).toBe('image')
    expect(getPostExternalLink(post)).toBeNull()
  })

  it('still returns regular external links for non-GIF embeds', () => {
    const post = gifPost({
      embed: {
        $type: 'app.bsky.embed.external#view',
        external: {
          uri: 'https://example.com/article',
          title: 'Example',
          description: 'Read this',
          thumb: 'https://example.com/thumb.jpg',
        },
      },
    })

    expect(getPostMediaInfo(post)).toBeNull()
    expect(getPostExternalLink(post)).toMatchObject({
      uri: 'https://example.com/article',
      title: 'Example',
    })
  })
})
