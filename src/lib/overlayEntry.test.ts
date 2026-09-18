import { describe, expect, it } from 'vitest'
import type { Location } from 'react-router-dom'
import { resolvePostOverlayNavigation, resolveProfileOverlayNavigation } from './overlayEntry'

const POST_URI = 'at://did:plc:abc/app.bsky.feed.post/xyz123'

function loc(
  pathname: string,
  search = '',
  state: Location['state'] = null,
): Location {
  return {
    pathname,
    search,
    hash: '',
    key: 'test',
    state,
  }
}

function feedBg(): Location {
  return loc('/', '', null)
}

describe('resolvePostOverlayNavigation', () => {
  it('opens path overlay from feed with author handle', () => {
    const target = resolvePostOverlayNavigation(loc('/'), {
      uri: POST_URI,
      authorHandle: 'alice.bsky.social',
    })
    expect(target.pathname).toBe('/profile/alice.bsky.social/post/xyz123')
    expect(target.search).toBe('')
    expect(target.state?.backgroundLocation.pathname).toBe('/')
  })

  it('stacks post on query when search modal is open', () => {
    const bg = feedBg()
    const target = resolvePostOverlayNavigation(
      loc('/', '?search=art', { backgroundLocation: bg }),
      { uri: POST_URI, authorHandle: 'alice.bsky.social' },
    )
    expect(target.pathname).toBe('/')
    expect(target.search).toContain('search=art')
    expect(target.search).toContain(encodeURIComponent(POST_URI))
    expect(target.state?.backgroundLocation).toEqual(bg)
  })

  it('stacks post on query when tag modal is open', () => {
    const bg = feedBg()
    const target = resolvePostOverlayNavigation(
      loc('/', '?tag=photography', { backgroundLocation: bg }),
      { uri: POST_URI },
    )
    expect(target.pathname).toBe('/')
    expect(target.search).toContain('tag=photography')
    expect(target.search).toContain(encodeURIComponent(POST_URI))
  })

  it('encodes profile+post on frozen pathname from path-based profile overlay', () => {
    const bg = feedBg()
    const target = resolvePostOverlayNavigation(
      loc('/profile/bob.bsky.social', '', { backgroundLocation: bg }),
      { uri: POST_URI },
    )
    expect(target.pathname).toBe('/')
    expect(target.search).toContain('profile=bob.bsky.social')
    expect(target.search).toContain(encodeURIComponent(POST_URI))
    expect(target.state?.backgroundLocation).toEqual(bg)
  })

  it('encodes post on frozen pathname from path-based post overlay', () => {
    const bg = feedBg()
    const target = resolvePostOverlayNavigation(
      loc('/profile/alice.bsky.social/post/oldrkey', '', { backgroundLocation: bg }),
      { uri: POST_URI, openReply: true },
    )
    expect(target.pathname).toBe('/')
    expect(target.search).toContain(encodeURIComponent(POST_URI))
    expect(target.search).toContain('reply=1')
  })

  it('replaces post in query stack when another post is already open', () => {
    const bg = feedBg()
    const existing = `${encodeURIComponent(POST_URI)}`
    const target = resolvePostOverlayNavigation(
      loc('/', `?post=${existing}`, { backgroundLocation: bg }),
      { uri: 'at://did:plc:abc/app.bsky.feed.post/newpost' },
    )
    expect(target.pathname).toBe('/')
    expect(target.search).toContain('newpost')
    expect(target.state?.backgroundLocation).toEqual(bg)
  })
})

describe('resolveProfileOverlayNavigation', () => {
  it('opens path overlay from feed', () => {
    const target = resolveProfileOverlayNavigation(loc('/'), 'alice.bsky.social')
    expect(target.pathname).toBe('/profile/alice.bsky.social')
    expect(target.state?.backgroundLocation.pathname).toBe('/')
  })

  it('preserves unrelated query params like search', () => {
    const bg = feedBg()
    const target = resolveProfileOverlayNavigation(
      loc('/', '?search=art', { backgroundLocation: bg }),
      'bob.bsky.social',
    )
    expect(target.pathname).toBe('/profile/bob.bsky.social')
    expect(target.search).toBe('?search=art')
  })

  it('clears modal query params when opening profile', () => {
    const bg = feedBg()
    const target = resolveProfileOverlayNavigation(
      loc('/', '?profile=old&post=at%3A%2F%2Ffoo', { backgroundLocation: bg }),
      'bob.bsky.social',
    )
    expect(target.pathname).toBe('/profile/bob.bsky.social')
    expect(target.search).toBe('')
  })
})
