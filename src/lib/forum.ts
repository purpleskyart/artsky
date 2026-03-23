/**
 * PurpleSky Forum System – AT Protocol Lexicon for Forums
 *
 * Creates and lists forum posts (app.artsky.forum.post), threaded replies
 * (app.artsky.forum.reply), pinned posts, wiki pages, and draft posts.
 */

import { agent, getSession, parseAtUri, publicAgent } from './bsky'
import { FORUM_DISCOVERY_DIDS } from '../config/forumLexicon'
import type { ForumPost, ForumReply } from '../types'

const FORUM_POST_COLLECTION = 'app.artsky.forum.post'
const FORUM_REPLY_COLLECTION = 'app.artsky.forum.reply'
const FORUM_WIKI_COLLECTION = 'app.artsky.forum.wiki'
const DRAFTS_KEY = 'artsky-forum-drafts'

/** Create a new forum post. Returns the created record URI and CID. */
export async function createForumPost(opts: {
  title: string
  body: string
  tags?: string[]
}): Promise<{ uri: string; cid: string }> {
  const session = getSession()
  if (!session?.did) throw new Error('Not logged in')
  const rkey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const res = await agent.com.atproto.repo.putRecord({
    repo: session.did,
    collection: FORUM_POST_COLLECTION,
    rkey,
    record: {
      $type: FORUM_POST_COLLECTION,
      title: opts.title.trim(),
      body: opts.body.trim(),
      tags: opts.tags ?? [],
      createdAt: new Date().toISOString(),
    },
    validate: false,
  })
  return { uri: res.data.uri, cid: res.data.cid }
}

async function collectFollowingDids(actor: string, max: number): Promise<string[]> {
  if (max <= 0) return []
  const out: string[] = []
  let cursor: string | undefined
  while (out.length < max) {
    const res = await agent.app.bsky.graph.getFollows({ actor, limit: 100, cursor })
    const follows = res.data.follows ?? []
    for (const f of follows) {
      if (out.length >= max) break
      out.push(f.did)
    }
    cursor = res.data.cursor
    if (!cursor) break
  }
  return out
}

async function enrichForumPostsWithAuthors(posts: ForumPost[]): Promise<void> {
  if (posts.length === 0) return
  const client = publicAgent
  const dids = [...new Set(posts.map((p) => p.did))]
  await Promise.all(
    dids.map(async (did) => {
      try {
        const profile = await client.getProfile({ actor: did })
        const d = profile.data as { handle?: string; avatar?: string }
        for (const p of posts) {
          if (p.did === did) {
            p.authorHandle = d.handle
            p.authorAvatar = d.avatar
          }
        }
      } catch {
        /* ignore */
      }
    })
  )
}

/**
 * Merged forum thread list from your repo, people you follow, and optional discovery DIDs
 * (see FORUM_DISCOVERY_DIDS). Uses the app.artsky.forum.post lexicon (PurpleSky / ArtSky).
 */
export async function discoverForumPosts(opts?: {
  maxRepos?: number
  postsPerRepo?: number
  cursorsByDid?: Record<string, string | undefined>
  append?: boolean
}): Promise<{
  posts: ForumPost[]
  nextCursorsByDid: Record<string, string | undefined>
  hasMore: boolean
}> {
  const maxRepos = opts?.maxRepos ?? 32
  const postsPerRepo = opts?.postsPerRepo ?? 10
  const append = opts?.append ?? false
  const prevCursors = opts?.cursorsByDid ?? {}

  const session = getSession()
  const didSet = new Set<string>()
  if (session?.did) didSet.add(session.did)
  for (const d of FORUM_DISCOVERY_DIDS) didSet.add(d)

  if (session?.did) {
    const room = maxRepos - didSet.size
    if (room > 0) {
      const following = await collectFollowingDids(session.did, room)
      for (const d of following) didSet.add(d)
    }
  }

  const dids = [...didSet]
  const fetchTargets = append ? dids.filter((d) => prevCursors[d]) : dids

  if (fetchTargets.length === 0) {
    return { posts: [], nextCursorsByDid: prevCursors, hasMore: false }
  }

  const chunkSize = 8
  const merged: ForumPost[] = []
  const nextCursors: Record<string, string | undefined> = append ? { ...prevCursors } : {}

  for (let i = 0; i < fetchTargets.length; i += chunkSize) {
    const chunk = fetchTargets.slice(i, i + chunkSize)
    const results = await Promise.all(
      chunk.map(async (did) => {
        const cursor = append ? prevCursors[did] : undefined
        return listForumPosts(did, { limit: postsPerRepo, cursor })
      })
    )
    for (let j = 0; j < chunk.length; j++) {
      const did = chunk[j]!
      const { posts, cursor } = results[j]!
      merged.push(...posts)
      if (cursor) nextCursors[did] = cursor
      else delete nextCursors[did]
    }
  }

  await enrichForumPostsWithAuthors(merged)

  const hasMore = Object.keys(nextCursors).some((k) => !!nextCursors[k])
  return { posts: merged, nextCursorsByDid: nextCursors, hasMore }
}

/** List forum posts from a user's repo. Reads via `publicAgent` so OAuth (PDS-scoped) sessions still fetch other users' repos. */
export async function listForumPosts(
  did: string,
  opts?: { limit?: number; cursor?: string }
): Promise<{ posts: ForumPost[]; cursor?: string }> {
  try {
    const res = await publicAgent.com.atproto.repo.listRecords({
      repo: did,
      collection: FORUM_POST_COLLECTION,
      limit: opts?.limit ?? 30,
      cursor: opts?.cursor,
      reverse: true,
    })
    const posts: ForumPost[] = (res.data.records ?? []).map(
      (r: { uri: string; cid: string; value: Record<string, unknown> }) => {
        const v = r.value as {
          title?: string
          body?: string
          tags?: string[]
          createdAt?: string
          isPinned?: boolean
          isWiki?: boolean
        }
        const rkey = r.uri.split('/').pop() ?? ''
        return {
          uri: r.uri,
          cid: r.cid,
          did,
          rkey,
          title: v.title,
          body: v.body,
          tags: v.tags,
          createdAt: v.createdAt,
          isPinned: v.isPinned,
          isWiki: v.isWiki,
        }
      }
    )
    return { posts, cursor: res.data.cursor }
  } catch {
    return { posts: [], cursor: undefined }
  }
}

/** Get a single forum post by URI. */
export async function getForumPost(uri: string): Promise<ForumPost | null> {
  const parsed = parseAtUri(uri)
  if (!parsed) return null
  try {
    const res = await publicAgent.com.atproto.repo.getRecord({
      repo: parsed.did,
      collection: FORUM_POST_COLLECTION,
      rkey: parsed.rkey,
    })
    const v = res.data.value as {
      title?: string
      body?: string
      tags?: string[]
      createdAt?: string
      isPinned?: boolean
      isWiki?: boolean
    }
    let authorHandle: string | undefined
    let authorAvatar: string | undefined
    try {
      const profile = await publicAgent.getProfile({ actor: parsed.did })
      const d = profile.data as { handle?: string; avatar?: string }
      authorHandle = d.handle
      authorAvatar = d.avatar
    } catch {
      /* ignore */
    }
    return {
      uri: res.data.uri as string,
      cid: res.data.cid as string,
      did: parsed.did,
      rkey: parsed.rkey,
      title: v.title,
      body: v.body,
      tags: v.tags,
      createdAt: v.createdAt,
      isPinned: v.isPinned,
      isWiki: v.isWiki,
      authorHandle,
      authorAvatar,
    }
  } catch {
    return null
  }
}

/** Edit a forum post. Only the author can edit. */
export async function editForumPost(
  uri: string,
  opts: { title?: string; body?: string; tags?: string[] }
): Promise<void> {
  const post = await getForumPost(uri)
  if (!post) throw new Error('Post not found')
  const session = getSession()
  if (!session?.did || session.did !== post.did) throw new Error('Not authorized')
  await agent.com.atproto.repo.putRecord({
    repo: session.did,
    collection: FORUM_POST_COLLECTION,
    rkey: post.rkey,
    record: {
      $type: FORUM_POST_COLLECTION,
      title: (opts.title ?? post.title ?? '').trim(),
      body: (opts.body ?? post.body ?? '').trim(),
      tags: opts.tags ?? post.tags ?? [],
      createdAt: post.createdAt,
      isPinned: post.isPinned,
      isWiki: post.isWiki,
      editedAt: new Date().toISOString(),
    },
    validate: false,
  })
}

/** Delete a forum post. Only the author can delete. */
export async function deleteForumPost(uri: string): Promise<void> {
  const session = getSession()
  if (!session?.did) throw new Error('Not logged in')
  const parsed = parseAtUri(uri)
  if (!parsed) throw new Error('Invalid URI')
  await agent.com.atproto.repo.deleteRecord({
    repo: session.did,
    collection: FORUM_POST_COLLECTION,
    rkey: parsed.rkey,
  })
}

/** Toggle pin status for a forum post. */
export async function togglePinForumPost(uri: string, isPinned: boolean): Promise<void> {
  const post = await getForumPost(uri)
  if (!post) throw new Error('Post not found')
  const session = getSession()
  if (!session?.did || session.did !== post.did) throw new Error('Not authorized')
  await agent.com.atproto.repo.putRecord({
    repo: session.did,
    collection: FORUM_POST_COLLECTION,
    rkey: post.rkey,
    record: {
      $type: FORUM_POST_COLLECTION,
      title: post.title,
      body: post.body,
      tags: post.tags,
      createdAt: post.createdAt,
      isPinned,
      isWiki: post.isWiki,
    },
    validate: false,
  })
}

/** Create a reply to a forum post (or to another reply for threading). */
export async function createForumReply(opts: {
  postUri: string
  text: string
  replyToUri?: string
}): Promise<{ uri: string; cid: string }> {
  const session = getSession()
  if (!session?.did) throw new Error('Not logged in')
  const rkey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const res = await agent.com.atproto.repo.putRecord({
    repo: session.did,
    collection: FORUM_REPLY_COLLECTION,
    rkey,
    record: {
      $type: FORUM_REPLY_COLLECTION,
      subject: opts.postUri,
      replyTo: opts.replyToUri,
      text: opts.text.trim(),
      createdAt: new Date().toISOString(),
    },
    validate: false,
  })
  return { uri: res.data.uri, cid: res.data.cid }
}

/** List replies for a forum post. Aggregates from multiple repos. */
export async function listForumReplies(
  postUri: string,
  knownDids: string[] = []
): Promise<ForumReply[]> {
  const session = getSession()
  const didsToCheck = [...new Set([...(session?.did ? [session.did] : []), ...knownDids])]

  const allReplies: ForumReply[] = []
  const seenUris = new Set<string>()

  for (const did of didsToCheck) {
    try {
      const res = await publicAgent.com.atproto.repo.listRecords({
        repo: did,
        collection: FORUM_REPLY_COLLECTION,
        limit: 100,
      })
      for (const r of res.data.records ?? []) {
        const v = r.value as {
          subject?: string
          replyTo?: string
          text?: string
          createdAt?: string
        }
        if (v.subject !== postUri || seenUris.has(r.uri)) continue
        seenUris.add(r.uri)
        let author = { did, handle: did } as ForumReply['author']
        try {
          const profile = await publicAgent.getProfile({ actor: did })
          const d = profile.data as { handle?: string; avatar?: string; displayName?: string }
          author = { did, handle: d.handle ?? did, avatar: d.avatar, displayName: d.displayName }
        } catch {
          /* ignore */
        }
        allReplies.push({
          uri: r.uri,
          cid: r.cid,
          replyTo: v.replyTo,
          author,
          record: { text: v.text, createdAt: v.createdAt },
          isComment: true,
        })
      }
    } catch {
      /* ignore */
    }
  }

  allReplies.sort((a, b) => {
    const ta = new Date(a.record?.createdAt ?? 0).getTime()
    const tb = new Date(b.record?.createdAt ?? 0).getTime()
    return ta - tb
  })
  return allReplies
}

/** Promote a forum post to a wiki page. */
export async function promoteToWiki(postUri: string): Promise<void> {
  const post = await getForumPost(postUri)
  if (!post) throw new Error('Post not found')
  const session = getSession()
  if (!session?.did) throw new Error('Not logged in')

  const rkey = `wiki-${Date.now().toString(36)}`
  await agent.com.atproto.repo.putRecord({
    repo: session.did,
    collection: FORUM_WIKI_COLLECTION,
    rkey,
    record: {
      $type: FORUM_WIKI_COLLECTION,
      sourcePost: postUri,
      title: post.title,
      body: post.body,
      tags: post.tags,
      createdAt: new Date().toISOString(),
      lastEditedAt: new Date().toISOString(),
    },
    validate: false,
  })

  await agent.com.atproto.repo.putRecord({
    repo: session.did,
    collection: FORUM_POST_COLLECTION,
    rkey: post.rkey,
    record: {
      $type: FORUM_POST_COLLECTION,
      title: post.title,
      body: post.body,
      tags: post.tags,
      createdAt: post.createdAt,
      isPinned: post.isPinned,
      isWiki: true,
    },
    validate: false,
  })
}

export interface ForumDraft {
  id: string
  title: string
  body: string
  tags: string[]
  savedAt: string
}

/** Save a draft forum post locally. */
export function saveDraft(draft: Omit<ForumDraft, 'id' | 'savedAt'>): ForumDraft {
  const drafts = getDrafts()
  const newDraft: ForumDraft = {
    id: `draft-${Date.now()}`,
    ...draft,
    savedAt: new Date().toISOString(),
  }
  drafts.push(newDraft)
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts))
  } catch {
    /* ignore */
  }
  return newDraft
}

/** Get all saved drafts. */
export function getDrafts(): ForumDraft[] {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

/** Delete a draft by ID. */
export function deleteDraft(id: string): void {
  const drafts = getDrafts().filter((d) => d.id !== id)
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts))
  } catch {
    /* ignore */
  }
}
