import { describe, it, expect } from 'vitest'

describe('PostDetailPage - Layout Shift Prevention', () => {
  it('detects reply posts correctly', () => {
    const replyPost = {
      record: {
        text: 'This is a reply',
        reply: {
          parent: { uri: 'at://did:plc:test/app.bsky.feed.post/parent123', cid: 'parentcid' },
          root: { uri: 'at://did:plc:test/app.bsky.feed.post/parent123', cid: 'parentcid' },
        },
      },
    }

    const regularPost = {
      record: {
        text: 'This is a regular post',
      },
    }

    // Reply detection logic from PostDetailPage
    const isReply = (post: typeof replyPost | typeof regularPost) => 
      !!(post.record as { reply?: unknown })?.reply

    expect(isReply(replyPost)).toBe(true)
    expect(isReply(regularPost)).toBe(false)
  })

  it('checks for parent in thread correctly', () => {
    const threadWithParent = {
      $type: 'app.bsky.feed.defs#threadViewPost',
      post: { uri: 'test' },
      parent: {
        $type: 'app.bsky.feed.defs#threadViewPost',
        post: { uri: 'parent' },
      },
    }

    const threadWithoutParent = {
      $type: 'app.bsky.feed.defs#threadViewPost',
      post: { uri: 'test' },
    }

    const hasParent = (thread: typeof threadWithParent | typeof threadWithoutParent) =>
      'parent' in thread && thread.parent && thread.parent.$type === 'app.bsky.feed.defs#threadViewPost'

    expect(hasParent(threadWithParent)).toBe(true)
    expect(hasParent(threadWithoutParent)).toBe(false)
  })
})
