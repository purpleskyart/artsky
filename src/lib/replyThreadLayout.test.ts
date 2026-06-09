import { describe, it, expect } from 'vitest'
import type { AppBskyFeedDefs } from '@atproto/api'
import { shouldGateReplyThread } from './replyThreadLayout'

function isThreadViewPost(node: unknown): node is AppBskyFeedDefs.ThreadViewPost {
  return typeof node === 'object' && node !== null && 'post' in node && !!(node as AppBskyFeedDefs.ThreadViewPost).post
}

function getThreadReplies(node: AppBskyFeedDefs.ThreadViewPost): AppBskyFeedDefs.ThreadViewPost[] {
  if (!('replies' in node) || !Array.isArray(node.replies)) return []
  return (node.replies as unknown[]).filter((x): x is AppBskyFeedDefs.ThreadViewPost => isThreadViewPost(x))
}

function flattenVisibleReplies(
  replies: AppBskyFeedDefs.ThreadViewPost[],
  collapsed: Set<string>,
  threadAreaWidth: number,
  layoutDepth = 0,
): { uri: string; handle: string }[] {
  return replies.flatMap((r) => {
    const uri = r.post.uri
    const handle = r.post.author?.handle ?? r.post.author?.did ?? ''
    if (collapsed.has(uri)) return [{ uri, handle }]
    if (shouldGateReplyThread(threadAreaWidth, layoutDepth)) return []
    const nested = getThreadReplies(r)
    return [{ uri, handle }, ...flattenVisibleReplies(nested, collapsed, threadAreaWidth, layoutDepth + 1)]
  })
}

function makeReply(uri: string, nested: AppBskyFeedDefs.ThreadViewPost[] = []): AppBskyFeedDefs.ThreadViewPost {
  return {
    $type: 'app.bsky.feed.defs#threadViewPost',
    post: { uri, cid: uri, author: { did: 'did:test', handle: 'user.test' }, record: { $type: 'app.bsky.feed.post', text: uri, createdAt: '' } },
    replies: nested,
  } as AppBskyFeedDefs.ThreadViewPost
}

function buildChain(length: number, id = 0): AppBskyFeedDefs.ThreadViewPost {
  const uri = `c-${id}`
  if (length <= 1) return makeReply(uri)
  return makeReply(uri, [buildChain(length - 1, id + 1)])
}

describe('replyThreadLayout', () => {
  it('does not gate shallow depths on a wide thread column', () => {
    expect(shouldGateReplyThread(600, 4)).toBe(false)
  })

  it('gates when cumulative layout leaves too little text width', () => {
    expect(shouldGateReplyThread(320, 4)).toBe(true)
    expect(shouldGateReplyThread(400, 5)).toBe(true)
  })
})

describe('PostDetailPage - deep reply thread gating', () => {
  it('omits comments behind Read More from the flat keyboard-nav list on narrow widths', () => {
    const deep = buildChain(6)
    const flat = flattenVisibleReplies([deep], new Set(), 320)
    expect(flat.map((f) => f.uri)).toEqual(['c-0', 'c-1', 'c-2'])
    expect(flat.some((f) => f.uri === 'c-3')).toBe(false)
    expect(flat.some((f) => f.uri === 'c-4')).toBe(false)
    expect(flat.some((f) => f.uri === 'c-5')).toBe(false)
  })

  it('shows deeper chains on wide thread columns', () => {
    const deep = buildChain(6)
    const flat = flattenVisibleReplies([deep], new Set(), 600)
    expect(flat.map((f) => f.uri)).toEqual(['c-0', 'c-1', 'c-2', 'c-3', 'c-4', 'c-5'])
  })

  it('includes shallow targets in the flat list', () => {
    const deep = buildChain(6)
    const flat = flattenVisibleReplies([deep], new Set(), 320)
    expect(flat.some((f) => f.uri === 'c-2')).toBe(true)
  })
})
