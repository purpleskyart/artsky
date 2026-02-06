import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import type { AppBskyFeedDefs } from '@atproto/api'
import { agent, postReply, getPostAllMedia, getPostMediaUrl, getSession } from '../lib/bsky'
import { getArtboards, createArtboard, addPostToArtboard } from '../lib/artboards'
import Layout from '../components/Layout'
import VideoWithHls from '../components/VideoWithHls'
import PostText from '../components/PostText'
import styles from './PostDetailPage.module.css'

function isThreadViewPost(
  node: AppBskyFeedDefs.ThreadViewPost | AppBskyFeedDefs.NotFoundPost | AppBskyFeedDefs.BlockedPost | { $type: string }
): node is AppBskyFeedDefs.ThreadViewPost {
  return node && typeof node === 'object' && 'post' in node && !!(node as AppBskyFeedDefs.ThreadViewPost).post
}

function MediaGallery({
  items,
  autoPlayFirstVideo = false,
}: {
  items: Array<{ url: string; type: 'image' | 'video'; videoPlaylist?: string }>
  autoPlayFirstVideo?: boolean
}) {
  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null)
  const imageIndices = useMemo(
    () => items.map((m, i) => (m.type === 'image' ? i : -1)).filter((i) => i >= 0),
    [items]
  )

  useEffect(() => {
    if (fullscreenIndex === null) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setFullscreenIndex(null)
      if (e.key === 'ArrowLeft') {
        const idx = imageIndices.indexOf(fullscreenIndex!)
        if (idx > 0) setFullscreenIndex(imageIndices[idx - 1])
      }
      if (e.key === 'ArrowRight') {
        const idx = imageIndices.indexOf(fullscreenIndex!)
        if (idx >= 0 && idx < imageIndices.length - 1)
          setFullscreenIndex(imageIndices[idx + 1])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fullscreenIndex, imageIndices])

  if (items.length === 0) return null
  const firstVideoIndex = autoPlayFirstVideo
    ? items.findIndex((m) => m.type === 'video' && m.videoPlaylist)
    : -1

  const currentFullscreenItem =
    fullscreenIndex != null ? items[fullscreenIndex] : null

  return (
    <div className={styles.galleryWrap}>
      <div className={styles.gallery}>
        {items.map((m, i) => {
          if (m.type === 'video' && m.videoPlaylist) {
            return (
              <div key={i} className={styles.galleryVideoWrap}>
                <VideoWithHls
                  playlistUrl={m.videoPlaylist}
                  poster={m.url || undefined}
                  className={styles.galleryVideo}
                  autoPlay={i === firstVideoIndex}
                />
              </div>
            )
          }
          return (
            <button
              key={i}
              type="button"
              className={styles.galleryImageBtn}
              onClick={() => setFullscreenIndex(i)}
              aria-label="View full screen"
            >
              <img src={m.url} alt="" className={styles.galleryMedia} />
            </button>
          )
        })}
      </div>
      {currentFullscreenItem?.type === 'image' && (
        <div
          className={styles.fullscreenOverlay}
          onClick={() => setFullscreenIndex(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Image full screen"
        >
          <button
            type="button"
            className={styles.fullscreenClose}
            onClick={() => setFullscreenIndex(null)}
            aria-label="Close"
          >
            ×
          </button>
          {imageIndices.length > 1 && (
            <>
              <button
                type="button"
                className={styles.fullscreenPrev}
                aria-label="Previous image"
                onClick={(e) => {
                  e.stopPropagation()
                  const idx = imageIndices.indexOf(fullscreenIndex!)
                  if (idx > 0) setFullscreenIndex(imageIndices[idx - 1])
                }}
              >
                ‹
              </button>
              <button
                type="button"
                className={styles.fullscreenNext}
                aria-label="Next image"
                onClick={(e) => {
                  e.stopPropagation()
                  const idx = imageIndices.indexOf(fullscreenIndex!)
                  if (idx < imageIndices.length - 1)
                    setFullscreenIndex(imageIndices[idx + 1])
                }}
              >
                ›
              </button>
            </>
          )}
          <img
            src={currentFullscreenItem.url}
            alt=""
            className={styles.fullscreenImage}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}

function PostBlock({
  node,
  depth = 0,
  collapsedThreads,
  onToggleCollapse,
  onReply,
  rootPostUri,
  rootPostCid,
}: {
  node: AppBskyFeedDefs.ThreadViewPost | AppBskyFeedDefs.NotFoundPost | AppBskyFeedDefs.BlockedPost | { $type: string }
  depth?: number
  collapsedThreads?: Set<string>
  onToggleCollapse?: (uri: string) => void
  onReply?: (parentUri: string, parentCid: string, handle: string) => void
  rootPostUri?: string
  rootPostCid?: string
}) {
  if (!isThreadViewPost(node)) return null
  const { post } = node
  const allMedia = getPostAllMedia(post)
  const text = (post.record as { text?: string })?.text ?? ''
  const handle = post.author.handle ?? post.author.did
  const avatar = post.author.avatar ?? undefined
  const replies = 'replies' in node && Array.isArray(node.replies) ? (node.replies as (typeof node)[]) : []
  const hasReplies = replies.length > 0
  const isCollapsed = hasReplies && collapsedThreads?.has(post.uri)
  const canCollapse = hasReplies && onToggleCollapse

  return (
    <article className={styles.postBlock} style={{ marginLeft: depth * 12 }}>
      <div className={styles.postHead}>
        {avatar && <img src={avatar} alt="" className={styles.avatar} />}
        <div className={styles.authorRow}>
          <Link
            to={`/profile/${encodeURIComponent(handle)}`}
            className={styles.handleLink}
          >
            @{handle}
          </Link>
          {onReply && (
            <button
              type="button"
              className={styles.replyBtn}
              onClick={() => onReply(post.uri, post.cid, handle)}
            >
              Reply
            </button>
          )}
        </div>
      </div>
      {text && (
        <p className={styles.postText}>
          <PostText text={text} />
        </p>
      )}
      {allMedia.length > 0 && <MediaGallery items={allMedia} />}
      {hasReplies && (
        <div className={styles.repliesContainer}>
          <button
            type="button"
            className={styles.repliesBar}
            onClick={() => canCollapse && onToggleCollapse(post.uri)}
            aria-label={isCollapsed ? 'Expand replies' : 'Collapse replies'}
            title={isCollapsed ? 'Expand replies' : 'Collapse replies'}
          />
          {isCollapsed ? (
            <button
              type="button"
              className={styles.repliesCollapsed}
              onClick={() => onToggleCollapse?.(post.uri)}
            >
              {replies.length} reply{replies.length !== 1 ? 's' : ''}
            </button>
          ) : (
            <div className={styles.replies}>
              {replies.map((r) => (
                <PostBlock
                  key={isThreadViewPost(r) ? r.post.uri : Math.random()}
                  node={r}
                  depth={depth + 1}
                  collapsedThreads={collapsedThreads}
                  onToggleCollapse={onToggleCollapse}
                  onReply={onReply}
                  rootPostUri={rootPostUri}
                  rootPostCid={rootPostCid}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  )
}

export default function PostDetailPage() {
  const { uri } = useParams<{ uri: string }>()
  const navigate = useNavigate()
  const decodedUri = uri ? decodeURIComponent(uri) : ''
  const [thread, setThread] = useState<
    AppBskyFeedDefs.ThreadViewPost | AppBskyFeedDefs.NotFoundPost | AppBskyFeedDefs.BlockedPost | { $type: string } | null
  >(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [posting, setPosting] = useState(false)
  const [addToBoardId, setAddToBoardId] = useState<string | null>(null)
  const [addedToBoard, setAddedToBoard] = useState<string | null>(null)
  const [collapsedThreads, setCollapsedThreads] = useState<Set<string>>(() => new Set())
  const [followLoading, setFollowLoading] = useState(false)
  const [authorFollowed, setAuthorFollowed] = useState(false)
  const [replyingTo, setReplyingTo] = useState<{ uri: string; cid: string; handle: string } | null>(null)
  const [newBoardName, setNewBoardName] = useState('')
  const [showNewBoardForm, setShowNewBoardForm] = useState(false)
  const commentFormRef = useRef<HTMLFormElement>(null)
  const boards = getArtboards()
  const session = getSession()
  const isOwnPost = thread && isThreadViewPost(thread) && session?.did === thread.post.author.did
  const alreadyFollowing =
    (thread && isThreadViewPost(thread) && !!thread.post.author.viewer?.following) || authorFollowed

  function toggleCollapse(uri: string) {
    setCollapsedThreads((prev) => {
      const next = new Set(prev)
      if (next.has(uri)) next.delete(uri)
      else next.add(uri)
      return next
    })
  }

  async function handleFollowAuthor() {
    if (!thread || !isThreadViewPost(thread) || followLoading || alreadyFollowing) return
    setFollowLoading(true)
    try {
      await agent.follow(thread.post.author.did)
      setAuthorFollowed(true)
    } catch {
      // leave button state unchanged so user can retry
    } finally {
      setFollowLoading(false)
    }
  }

  const load = useCallback(async () => {
    if (!decodedUri) return
    setLoading(true)
    setError(null)
    try {
      const res = await agent.app.bsky.feed.getPostThread({ uri: decodedUri, depth: 10 })
      const th = res.data.thread
      setThread(th)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load post')
    } finally {
      setLoading(false)
    }
  }, [decodedUri])

  useEffect(() => {
    load()
  }, [load])

  async function handlePostReply(e: React.FormEvent) {
    e.preventDefault()
    if (!thread || !isThreadViewPost(thread) || !comment.trim()) return
    const rootPost = thread.post
    const parent = replyingTo ?? { uri: rootPost.uri, cid: rootPost.cid }
    setPosting(true)
    try {
      await postReply(rootPost.uri, rootPost.cid, parent.uri, parent.cid, comment.trim())
      setComment('')
      setReplyingTo(null)
      await load()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to post comment')
    } finally {
      setPosting(false)
    }
  }

  function handleReplyTo(parentUri: string, parentCid: string, handle: string) {
    setReplyingTo({ uri: parentUri, cid: parentCid, handle })
    const form = document.querySelector(`.${styles.commentForm} textarea`) as HTMLTextAreaElement | null
    form?.focus()
  }

  function handleCreateArtboardAndAdd() {
    if (!thread || !isThreadViewPost(thread) || !newBoardName.trim()) return
    const post = thread.post
    const media = getPostMediaUrl(post)
    const board = createArtboard(newBoardName.trim())
    addPostToArtboard(board.id, {
      uri: post.uri,
      cid: post.cid,
      authorHandle: post.author.handle,
      text: (post.record as { text?: string })?.text?.slice(0, 200),
      thumb: media?.url,
    })
    setAddedToBoard(board.id)
    setNewBoardName('')
    setShowNewBoardForm(false)
  }

  function handleAddToArtboard() {
    if (!thread || !isThreadViewPost(thread) || !addToBoardId) return
    const post = thread.post
    const media = getPostMediaUrl(post)
    addPostToArtboard(addToBoardId, {
      uri: post.uri,
      cid: post.cid,
      authorHandle: post.author.handle,
      text: (post.record as { text?: string })?.text?.slice(0, 200),
      thumb: media?.url,
    })
    setAddedToBoard(addToBoardId)
    setAddToBoardId(null)
  }

  if (!decodedUri) {
    navigate('/feed', { replace: true })
    return null
  }

  const rootMedia =
    thread && isThreadViewPost(thread) ? getPostAllMedia(thread.post) : []

  return (
    <Layout title="Post" showNav>
      <div className={styles.wrap}>
        {loading && <div className={styles.loading}>Loading…</div>}
        {error && <p className={styles.error}>{error}</p>}
        {thread && isThreadViewPost(thread) && (
          <>
            <article className={styles.postBlock}>
              <div className={styles.postHead}>
                {thread.post.author.avatar && (
                  <img src={thread.post.author.avatar} alt="" className={styles.avatar} />
                )}
                <div className={styles.authorRow}>
                  <Link
                    to={`/profile/${encodeURIComponent(thread.post.author.handle ?? thread.post.author.did)}`}
                    className={styles.handleLink}
                  >
                    @{thread.post.author.handle ?? thread.post.author.did}
                  </Link>
                  {!isOwnPost && (
                    alreadyFollowing ? (
                      <span className={styles.followingLabel}>Following</span>
                    ) : (
                      <button
                        type="button"
                        className={styles.followBtn}
                        onClick={handleFollowAuthor}
                        disabled={followLoading}
                      >
                        {followLoading ? 'Following…' : 'Follow'}
                      </button>
                    )
                  )}
                </div>
              </div>
              {(thread.post.record as { text?: string })?.text && (
                <p className={styles.postText}>
                  <PostText text={(thread.post.record as { text?: string }).text!} />
                </p>
              )}
              {rootMedia.length > 0 && <MediaGallery items={rootMedia} autoPlayFirstVideo />}
            </article>
            <section className={styles.actions} aria-label="Add to artboard">
              <div className={styles.addToBoard}>
                <label htmlFor="board-select">Add to artboard:</label>
                <select
                  id="board-select"
                  value={addToBoardId ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === '__new__') {
                      setShowNewBoardForm(true)
                      setAddToBoardId(null)
                    } else {
                      setAddToBoardId(v || null)
                      setShowNewBoardForm(false)
                    }
                  }}
                  className={styles.select}
                >
                  <option value="">Choose…</option>
                  {boards.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                  <option value="__new__">+ New artboard…</option>
                </select>
                {addToBoardId && (
                  <button type="button" className={styles.addBtn} onClick={handleAddToArtboard}>
                    Add
                  </button>
                )}
              </div>
              {showNewBoardForm && (
                <div className={styles.newBoardForm}>
                  <input
                    type="text"
                    placeholder="Artboard name"
                    value={newBoardName}
                    onChange={(e) => setNewBoardName(e.target.value)}
                    className={styles.newBoardInput}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleCreateArtboardAndAdd())}
                  />
                  <div className={styles.newBoardActions}>
                    <button type="button" className={styles.addBtn} onClick={handleCreateArtboardAndAdd} disabled={!newBoardName.trim()}>
                      Create &amp; add
                    </button>
                    <button type="button" className={styles.cancelBtn} onClick={() => { setShowNewBoardForm(false); setNewBoardName('') }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {addedToBoard && (
                <p className={styles.added}>
                  Added to {boards.find((b) => b.id === addedToBoard)?.name}
                </p>
              )}
            </section>
            {'replies' in thread && Array.isArray(thread.replies) && thread.replies.length > 0 && (
              <div className={styles.replies}>
                {(thread.replies as (typeof thread)[]).map((r) => (
                  <PostBlock
                    key={isThreadViewPost(r) ? r.post.uri : Math.random()}
                    node={r}
                    depth={0}
                    collapsedThreads={collapsedThreads}
                    onToggleCollapse={toggleCollapse}
                    onReply={handleReplyTo}
                    rootPostUri={thread.post.uri}
                    rootPostCid={thread.post.cid}
                  />
                ))}
              </div>
            )}
            <form ref={commentFormRef} onSubmit={handlePostReply} className={styles.commentForm}>
              {replyingTo && (
                <p className={styles.replyingTo}>
                  Replying to @{replyingTo.handle}
                  <button type="button" className={styles.cancelReply} onClick={() => setReplyingTo(null)} aria-label="Cancel reply">
                    ×
                  </button>
                </p>
              )}
              <textarea
                placeholder={replyingTo ? `Reply to @${replyingTo.handle}…` : 'Write a comment…'}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.metaKey) {
                    e.preventDefault()
                    if (comment.trim() && !posting) commentFormRef.current?.requestSubmit()
                  }
                }}
                className={styles.textarea}
                rows={3}
                maxLength={300}
              />
              <p className={styles.hint}>⌘ Enter to post</p>
              <button type="submit" className={styles.submit} disabled={posting || !comment.trim()}>
                {posting ? 'Posting…' : replyingTo ? 'Post reply' : 'Post comment'}
              </button>
            </form>
          </>
        )}
      </div>
    </Layout>
  )
}
