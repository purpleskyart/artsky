import { describe, it, expect } from 'vitest'
import type { AppBskyFeedDefs } from '@atproto/api'

const REPLY_THREAD_MAX_LAYOUT_DEPTH = 4

function isThreadViewPost(node: unknown): node is AppBskyFeedDefs.ThreadViewPost {
  return typeof node === 'object' && node !== null && 'post' in node && !!(node as AppBskyFeedDefs.ThreadViewPost).post
}

function getThreadReplies(node: AppBskyFeedDefs.ThreadViewPost): AppBskyFeedDefs.ThreadViewPost[] {
  if (!('replies' in node) || !Array.isArray(node.replies)) return []
  return (node.replies as unknown[]).filter((x): x is AppBskyFeedDefs.ThreadViewPost => isThreadViewPost(x))
}

function findRequiredDeepExpansionsInNode(
  node: AppBskyFeedDefs.ThreadViewPost,
  targetUri: string,
  layoutDepth: number,
  expandedAlongPath: Set<string>,
): Set<string> | null {
  if (node.post.uri === targetUri) return expandedAlongPath
  for (const child of getThreadReplies(node)) {
    const childUri = child.post.uri
    const childLayoutDepth = expandedAlongPath.has(node.post.uri) ? 1 : layoutDepth + 1
    if (childLayoutDepth >= REPLY_THREAD_MAX_LAYOUT_DEPTH && !expandedAlongPath.has(childUri)) {
      const withExpand = new Set(expandedAlongPath)
      withExpand.add(childUri)
      const found = findRequiredDeepExpansionsInNode(child, targetUri, 0, withExpand)
      if (found) return found
    } else {
      const found = findRequiredDeepExpansionsInNode(child, targetUri, childLayoutDepth, expandedAlongPath)
      if (found) return found
    }
  }
  return null
}

function findRequiredDeepExpansions(
  replies: AppBskyFeedDefs.ThreadViewPost[],
  targetUri: string,
): Set<string> {
  for (const r of replies) {
    const found = findRequiredDeepExpansionsInNode(r, targetUri, 0, new Set())
    if (found) return found
  }
  return new Set()
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

describe('PostDetailPage - deep reply thread gating', () => {
  it('requires expansion when target is beyond max layout depth', () => {
    const deep = buildChain(6)
    const required = findRequiredDeepExpansions([deep], 'c-5')
    expect(required.has('c-4')).toBe(true)
  })

  it('does not require expansion for shallow targets', () => {
    const deep = buildChain(6)
    const required = findRequiredDeepExpansions([deep], 'c-2')
    expect(required.size).toBe(0)
  })
})
