import { describe, expect, it } from 'vitest'
import { postUriToQuotesParam, quotesParamToPostUri } from './appUrl'

describe('quotes URL param', () => {
  const at =
    'at://did:plc:gzfhndscqjomdke676lzxvho/app.bsky.feed.post/3mesviewezk2m'

  it('round-trips compact did/rkey', () => {
    const compact = postUriToQuotesParam(at)
    expect(compact).toBe('did:plc:gzfhndscqjomdke676lzxvho/3mesviewezk2m')
    expect(quotesParamToPostUri(compact)).toBe(at)
  })

  it('accepts legacy full at-uri in param', () => {
    expect(quotesParamToPostUri(at)).toBe(at)
  })

  it('preserves non-feed-post URIs in param value', () => {
    const other = 'at://did:plc:x/app.bsky.feed.generator/abc'
    expect(postUriToQuotesParam(other)).toBe(other)
    expect(quotesParamToPostUri(other)).toBe(other)
  })
})
