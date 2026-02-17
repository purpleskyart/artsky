import { useCallback, useEffect, useState } from 'react'
import {
  getForumPost,
  listForumReplies,
  createForumReply,
  editForumPost,
  deleteForumPost,
  promoteToWiki,
} from '../lib/forum'
import { listMyDownvotes, createDownvote, deleteDownvote } from '../lib/bsky'
import { getDownvoteCounts } from '../lib/constellation'
import { useSession } from '../context/SessionContext'
import { formatRelativeTime, formatExactDateTime } from '../lib/date'
import PostText from '../components/PostText'
import ProfileLink from '../components/ProfileLink'
import type { ForumPost, ForumReply } from '../types'
import styles from './ForumPostDetailPage.module.css'
import postBlockStyles from './PostDetailPage.module.css'

const REPLY_THREAD_INDENT = 20

function isArtSkyForumUri(uri: string): boolean {
  return uri.includes('app.artsky.forum.post')
}

function buildReplyTree(replies: ForumReply[], postUri: string): { reply: ForumReply; children: { reply: ForumReply; children: unknown[] }[] }[] {
  const byParent = new Map<string, ForumReply[]>()
  for (const r of replies) {
    const parent = r.replyTo ?? postUri
    if (!byParent.has(parent)) byParent.set(parent, [])
    byParent.get(parent)!.push(r)
  }
  const sortByTime = (a: ForumReply, b: ForumReply) =>
    new Date(a.record?.createdAt ?? 0).getTime() - new Date(b.record?.createdAt ?? 0).getTime()

  function buildNodes(parentKey: string): { reply: ForumReply; children: ReturnType<typeof buildNodes> }[] {
    const list = (byParent.get(parentKey) ?? []).slice().sort(sortByTime)
    return list.map((reply) => ({
      reply,
      children: buildNodes(reply.uri),
    }))
  }
  return buildNodes(postUri)
}

function flattenReplyTree(
  nodes: { reply: ForumReply; children: unknown[] }[]
): { reply: ForumReply; depth: number }[] {
  const out: { reply: ForumReply; depth: number }[] = []
  function walk(n: { reply: ForumReply; children: unknown[] }[], depth: number) {
    for (const node of n) {
      out.push({ reply: node.reply, depth })
      walk(node.children as { reply: ForumReply; children: unknown[] }[], depth + 1)
    }
  }
  walk(nodes, 0)
  return out
}

export interface ArtSkyForumPostContentProps {
  documentUri: string
  onClose: () => void
  onRegisterRefresh?: (fn: () => void | Promise<void>) => void
}

export function ArtSkyForumPostContent({ documentUri, onClose, onRegisterRefresh }: ArtSkyForumPostContentProps) {
  const [post, setPost] = useState<ForumPost | null>(null)
  const [replies, setReplies] = useState<ForumReply[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [posting, setPosting] = useState(false)
  const [replyingTo, setReplyingTo] = useState<ForumReply | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')

  useEffect(() => {
    if (post) {
      setEditTitle(post.title ?? '')
      setEditBody(post.body ?? '')
    }
  }, [post])
  const [editSaving, setEditSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [myDownvoteUris, setMyDownvoteUris] = useState<Record<string, string>>({})
  const [downvoteCounts, setDownvoteCounts] = useState<Record<string, number>>({})
  const { session } = useSession()

  const load = useCallback(async () => {
    if (!documentUri) return
    setLoading(true)
    setError(null)
    try {
      const [p, r] = await Promise.all([
        getForumPost(documentUri),
        listForumReplies(documentUri, session?.did ? [session.did] : []),
      ])
      setPost(p)
      setReplies(r)
      if (session?.did) {
        const downvotes = await listMyDownvotes()
        setMyDownvoteUris(downvotes)
      }
      const uris: string[] = p?.uri ? [p.uri] : []
      r.forEach((reply) => uris.push(reply.uri))
      if (uris.length > 0) {
        const counts = await getDownvoteCounts(uris)
        setDownvoteCounts(counts)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load post')
    } finally {
      setLoading(false)
    }
  }, [documentUri, session?.did])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    onRegisterRefresh?.(() => load())
  }, [onRegisterRefresh, load])

  async function handleReplySubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!session || !post || !replyText.trim() || posting) return
    setPosting(true)
    try {
      await createForumReply({
        postUri: documentUri,
        text: replyText.trim(),
        replyToUri: replyingTo?.uri,
      })
      setReplyText('')
      setReplyingTo(null)
      const r = await listForumReplies(documentUri, [session.did])
      setReplies(r)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to post')
    } finally {
      setPosting(false)
    }
  }

  async function handleEditSave() {
    if (!post || editSaving) return
    setEditSaving(true)
    try {
      await editForumPost(documentUri, { title: editTitle, body: editBody })
      const p = await getForumPost(documentUri)
      setPost(p)
      setEditMode(false)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setEditSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteConfirm || deleteLoading) return
    setDeleteLoading(true)
    try {
      await deleteForumPost(documentUri)
      onClose()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setDeleteLoading(false)
    }
  }

  async function handlePromoteWiki() {
    if (!post) return
    try {
      await promoteToWiki(documentUri)
      const p = await getForumPost(documentUri)
      setPost(p)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to promote')
    }
  }

  async function handleDownvote(subjectUri: string, subjectCid: string) {
    if (!session) return
    try {
      const uri = await createDownvote(subjectUri, subjectCid)
      setMyDownvoteUris((prev) => ({ ...prev, [subjectUri]: uri }))
      setDownvoteCounts((prev) => ({
        ...prev,
        [subjectUri]: (prev[subjectUri] ?? 0) + 1,
      }))
    } catch {
      // ignore
    }
  }

  async function handleUndoDownvote(uri: string) {
    if (!session) return
    try {
      await deleteDownvote(uri)
      const subjectUri = Object.entries(myDownvoteUris).find(([, v]) => v === uri)?.[0]
      if (subjectUri) {
        setMyDownvoteUris((prev) => {
          const next = { ...prev }
          delete next[subjectUri]
          return next
        })
        setDownvoteCounts((prev) => ({
          ...prev,
          [subjectUri]: Math.max(0, (prev[subjectUri] ?? 0) - 1),
        }))
      }
    } catch {
      // ignore
    }
  }

  if (!documentUri || !isArtSkyForumUri(documentUri)) {
    return null
  }

  if (loading) {
    return <div className={styles.loading}>Loading…</div>
  }

  if (error || !post) {
    return <p className={styles.error}>{error ?? 'Post not found'}</p>
  }

  const isOwn = session?.did === post.did
  const postDownvotes = downvoteCounts[post.uri] ?? 0
  const postDownvoted = !!myDownvoteUris[post.uri]
  const replyTreeFlat = flattenReplyTree(buildReplyTree(replies, documentUri))

  return (
    <div className={styles.wrap}>
      <article className={`${postBlockStyles.postBlock} ${postBlockStyles.rootPostBlock}`}>
        <div className={postBlockStyles.postBlockContent}>
          <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
            {post.isPinned && <span className={styles.commentBadge}>Pinned</span>}
            {post.isWiki && <span className={styles.commentBadge}>Wiki</span>}
          </div>
          <div className={postBlockStyles.postHead}>
            {post.authorAvatar ? (
              <img src={post.authorAvatar} alt="" className={postBlockStyles.avatar} loading="lazy" />
            ) : (
              <span className={styles.avatarPlaceholder} aria-hidden>
                {(post.authorHandle ?? post.did).slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className={postBlockStyles.authorRow}>
              <ProfileLink handle={post.authorHandle ?? post.did} className={postBlockStyles.handleLink}>
                @{post.authorHandle ?? post.did}
              </ProfileLink>
              {post.createdAt && (
                <span className={postBlockStyles.postTimestamp} title={formatExactDateTime(post.createdAt)}>
                  {formatRelativeTime(post.createdAt)}
                </span>
              )}
            </div>
          </div>
          {!editMode ? (
            <>
              <h1 className={styles.docTitle}>{post.title || 'Untitled'}</h1>
              {post.body && (
                <div className={styles.docBody}>
                  <PostText text={post.body} />
                </div>
              )}
              {post.tags && post.tags.length > 0 && (
                <div style={{ display: 'flex', gap: 'var(--space-xs)', marginTop: 'var(--space-md)', flexWrap: 'wrap' }}>
                  {post.tags.map((tag) => (
                    <span key={tag} className={styles.commentBadge}>
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-md)', alignItems: 'center' }}>
                <button
                  type="button"
                  className={postDownvoted ? styles.likeBtnLiked : styles.likeBtn}
                  onClick={() =>
                    postDownvoted ? handleUndoDownvote(myDownvoteUris[post.uri]) : handleDownvote(post.uri, post.cid)
                  }
                  disabled={!session}
                  title={postDownvoted ? 'Remove downvote' : 'Downvote'}
                >
                  ↓ {postDownvotes}
                </button>
                <span style={{ fontSize: 'var(--font-sm)', color: 'var(--muted)' }}>
                  {replies.length} repl{replies.length === 1 ? 'y' : 'ies'}
                </span>
              </div>
              {isOwn && (
                <div className={styles.actions} style={{ marginTop: 'var(--space-md)' }}>
                  <button type="button" className={styles.actionBtn} onClick={() => setEditMode(true)}>
                    Edit
                  </button>
                  {!post.isWiki && (
                    <button type="button" className={styles.actionBtn} onClick={handlePromoteWiki}>
                      Promote to Wiki
                    </button>
                  )}
                  {!deleteConfirm ? (
                    <button type="button" className={styles.actionBtnDanger} onClick={() => setDeleteConfirm(true)}>
                      Delete
                    </button>
                  ) : (
                    <>
                      <span className={styles.deleteConfirmText}>Delete this post?</span>
                      <button
                        type="button"
                        className={styles.actionBtn}
                        onClick={() => setDeleteConfirm(false)}
                        disabled={deleteLoading}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className={styles.actionBtnDanger}
                        onClick={handleDelete}
                        disabled={deleteLoading}
                      >
                        {deleteLoading ? 'Deleting…' : 'Yes, delete'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className={styles.editForm}>
              <label className={styles.editLabel}>
                Title
                <input
                  type="text"
                  className={styles.editInput}
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Title"
                />
              </label>
              <label className={styles.editLabel}>
                Body
                <textarea
                  className={styles.editTextarea}
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  placeholder="Write your post…"
                  rows={8}
                />
              </label>
              <div className={styles.editActions}>
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => setEditMode(false)}
                  disabled={editSaving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.actionBtnPrimary}
                  onClick={handleEditSave}
                  disabled={editSaving}
                >
                  {editSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>
      </article>

      {session && !replyingTo && (
        <section className={styles.replySection}>
          <h2 className={styles.replySectionTitle}>Reply</h2>
          <form onSubmit={handleReplySubmit} className={styles.replyForm}>
            <textarea
              className={styles.replyTextarea}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Write a reply… Use @username for mentions"
              rows={3}
              disabled={posting}
            />
            <button type="submit" className={styles.replySubmit} disabled={posting || !replyText.trim()}>
              {posting ? 'Posting…' : 'Post reply'}
            </button>
          </form>
        </section>
      )}

      <section className={styles.repliesSection}>
        <h2 className={styles.replySectionTitle}>Replies ({replies.length})</h2>
        {replyTreeFlat.length === 0 ? (
          <p className={styles.muted}>No replies yet.</p>
        ) : (
          <ul className={styles.replyList}>
            {replyTreeFlat.map(({ reply: r, depth }) => {
              const downvotes = downvoteCounts[r.uri] ?? 0
              const downvoted = !!myDownvoteUris[r.uri]
              const handle = r.author.handle ?? r.author.did
              return (
                <li
                  key={r.uri}
                  className={depth > 0 ? `${styles.replyItem} ${styles.replyItemNested}` : styles.replyItem}
                  style={{ marginLeft: depth * REPLY_THREAD_INDENT }}
                >
                  <div className={postBlockStyles.postHead}>
                    {r.author.avatar ? (
                      <img src={r.author.avatar} alt="" className={postBlockStyles.avatar} loading="lazy" />
                    ) : (
                      <span className={styles.avatarPlaceholder} aria-hidden>
                        {handle.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div className={postBlockStyles.authorRow}>
                      <ProfileLink handle={handle} className={postBlockStyles.handleLink}>
                        @{handle}
                      </ProfileLink>
                      {r.record?.createdAt && (
                        <span className={postBlockStyles.postTimestamp} title={formatExactDateTime(r.record.createdAt)}>
                          {formatRelativeTime(r.record.createdAt)}
                        </span>
                      )}
                    </div>
                  </div>
                  {r.record?.text && (
                    <div className={styles.replyText}>
                      <PostText text={r.record.text} />
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', marginTop: 'var(--space-xs)' }}>
                    {session && (
                      <button
                        type="button"
                        className={styles.replyToBtn}
                        onClick={() => setReplyingTo(r)}
                      >
                        Reply
                      </button>
                    )}
                    {session && (
                      <button
                        type="button"
                        className={downvoted ? styles.likeBtnLiked : styles.likeBtn}
                        onClick={() =>
                          downvoted ? handleUndoDownvote(myDownvoteUris[r.uri]) : handleDownvote(r.uri, r.cid)
                        }
                        title={downvoted ? 'Remove downvote' : 'Downvote'}
                      >
                        ↓ {downvotes}
                      </button>
                    )}
                  </div>
                  {session && replyingTo?.uri === r.uri && (
                    <div style={{ marginTop: 'var(--space-sm)' }}>
                      <form onSubmit={handleReplySubmit} className={styles.replyForm}>
                        <textarea
                          className={styles.replyTextarea}
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder={`Reply to @${handle}…`}
                          rows={2}
                          disabled={posting}
                          autoFocus
                        />
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.35rem' }}>
                          <button type="button" className={styles.actionBtn} onClick={() => setReplyingTo(null)}>
                            Cancel
                          </button>
                          <button type="submit" className={styles.actionBtnPrimary} disabled={posting || !replyText.trim()}>
                            {posting ? 'Posting…' : 'Post reply'}
                          </button>
                        </div>
                      </form>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
