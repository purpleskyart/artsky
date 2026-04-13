import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import type { AppBskyFeedDefs } from '@atproto/api'
import type { AtpSessionData } from '@atproto/api'
import { agent, publicAgent, postReply, getPostAllMedia, getQuotedPostView, getPostExternalLink, getSession, createQuotePost, createDownvote, deleteDownvote, listMyDownvotes, getPostThreadCached, getProfilesBatch, getProfileCached, getPostsBatch, likePostWithLifecycle, unlikePostWithLifecycle, repostPostWithLifecycle, deleteRepostWithLifecycle, followAccountWithLifecycle, unfollowAccountWithLifecycle, POST_MEDIA_FULL, POST_MEDIA_FEED_PREVIEW, type PostView } from '../lib/bsky'
import { getApiErrorMessage } from '../lib/apiErrors'
import { takeInitialPostForUri, getCachedThread, invalidateThreadCache } from '../lib/postCache'
import { getDownvoteCounts } from '../lib/constellation'
import { useSession } from '../context/SessionContext'
import { formatRelativeTime, formatExactDateTime } from '../lib/date'
import Layout from '../components/Layout'
import ProfileLink from '../components/ProfileLink'
import VideoWithHls from '../components/VideoWithHls'
import PostText from '../components/PostText'
import PostActionsMenu from '../components/PostActionsMenu'
import CollectionSaveMenu from '../components/CollectionSaveMenu'
import ComposerSuggestions from '../components/ComposerSuggestions'
import CharacterCountWithCircle from '../components/CharacterCountWithCircle'
import { useProfileModal } from '../context/ProfileModalContext'
import { getPostAppPath } from '../lib/appUrl'
import { usePostCardGridPointerGate } from '../hooks/usePostCardGridPointerGate'
import { useLoginModal } from '../context/LoginModalContext'
import { useFollowOverrides } from '../context/FollowOverridesContext'
import { useToast } from '../context/ToastContext'
import ImageLightbox from '../components/ImageLightbox'
import styles from './PostDetailPage.module.css'

const ACTION_ICON_SIZE = 18

/** Active reply composer for this parent post URI (inline vs top/bottom `.commentForm` share different class names). */
const ACTIVE_REPLY_ATTR = 'data-active-reply-target'

function queryReplyComposerTextarea(parentPostUri: string): HTMLTextAreaElement | null {
  if (typeof document === 'undefined') return null
  try {
    const esc = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(parentPostUri) : parentPostUri.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return document.querySelector(`[${ACTIVE_REPLY_ATTR}="${esc}"] textarea`)
  } catch {
    return null
  }
}
function RepostIcon() {
  return (
    <svg width={ACTION_ICON_SIZE} height={ACTION_ICON_SIZE} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
    </svg>
  )
}
function QuotesIcon() {
  return (
    <svg width={ACTION_ICON_SIZE} height={ACTION_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H3c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2z" />
      <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-5c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2z" />
    </svg>
  )
}

export function ReplyAsRow({
  replyAs,
  sessionsList,
  switchAccount,
  currentDid,
  label = 'Replying as',
}: {
  replyAs: { handle: string; avatar?: string }
  sessionsList: AtpSessionData[]
  switchAccount: (did: string) => Promise<boolean>
  currentDid: string
  /** Optional label (e.g. "Posting as" for new thread composer). */
  label?: string
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [accountProfiles, setAccountProfiles] = useState<Record<string, { avatar?: string; handle?: string }>>({})
  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!dropdownOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return
      setDropdownOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [dropdownOpen])
  const sessionsDidKey = useMemo(() => sessionsList.map((s) => s.did).sort().join(','), [sessionsList])
  useEffect(() => {
    if (sessionsList.length === 0) {
      setAccountProfiles({})
      return
    }
    let cancelled = false
    const dids = sessionsList.map((s) => s.did)
    getProfilesBatch(dids, true).then((profiles) => {
      if (cancelled) return
      const updated: Record<string, { avatar?: string; handle?: string }> = {}
      for (const [did, profile] of profiles.entries()) {
        updated[did] = { avatar: profile.avatar, handle: profile.handle }
      }
      setAccountProfiles(updated)
    }).catch((err) => {
      console.warn('Failed to fetch account profiles:', err)
    })
    return () => { cancelled = true }
  }, [sessionsDidKey, sessionsList])
  const { openLoginModal } = useLoginModal()
  const toast = useToast()
  return (
    <div className={styles.replyAs}>
      <span className={styles.replyAsLabel}>{label}</span>
      <span className={styles.replyAsUserChip}>
        <div className={styles.replyAsHandleWrap} ref={wrapRef}>
          <button
            type="button"
            className={styles.replyAsHandleBtn}
            onClick={() => setDropdownOpen((o) => !o)}
            aria-expanded={dropdownOpen}
            aria-haspopup="true"
            aria-label={`Switch account. Currently @${replyAs.handle}`}
          >
            {replyAs.avatar ? (
              <img src={replyAs.avatar} alt="" className={styles.replyAsAvatar} loading="lazy" />
            ) : (
              <span className={styles.replyAsAvatarPlaceholder} aria-hidden>{replyAs.handle.slice(0, 1).toUpperCase()}</span>
            )}
            @{replyAs.handle}
          </button>
          {dropdownOpen && (
            <div className={styles.replyAsDropdown} role="menu">
              {sessionsList.map((s) => {
                const profile = accountProfiles[s.did]
                const handle = profile?.handle ?? (s as { handle?: string }).handle ?? s.did
                const isCurrent = s.did === currentDid
                return (
                  <button
                    key={s.did}
                    type="button"
                    role="menuitem"
                    className={isCurrent ? styles.replyAsDropdownItemActive : styles.replyAsDropdownItem}
                    onClick={async () => {
                      const ok = await switchAccount(s.did)
                      if (ok) setDropdownOpen(false)
                      else toast?.showToast('Could not switch account. Try again or sign in again.')
                    }}
                  >
                    {profile?.avatar ? (
                      <img src={profile.avatar} alt="" className={styles.replyAsDropdownAvatar} loading="lazy" />
                    ) : (
                      <span className={styles.replyAsDropdownAvatarPlaceholder} aria-hidden>{(handle || s.did).slice(0, 1).toUpperCase()}</span>
                    )}
                    <span className={styles.replyAsDropdownHandle}>@{handle}</span>
                    {isCurrent && <span className={styles.replyAsDropdownCheck} aria-hidden>✓</span>}
                  </button>
                )
              })}
              <button
                type="button"
                role="menuitem"
                className={styles.replyAsDropdownAddAccount}
                onClick={() => {
                  setDropdownOpen(false)
                  openLoginModal()
                }}
              >
                + Add account
              </button>
            </div>
          )}
        </div>
      </span>
    </div>
  )
}

function isThreadViewPost(
  node: AppBskyFeedDefs.ThreadViewPost | AppBskyFeedDefs.NotFoundPost | AppBskyFeedDefs.BlockedPost | { $type: string }
): node is AppBskyFeedDefs.ThreadViewPost {
  return node && typeof node === 'object' && 'post' in node && !!(node as AppBskyFeedDefs.ThreadViewPost).post
}

/** Flatten visible comments in display order (expanded threads include nested replies). */
function flattenVisibleReplies(
  replies: AppBskyFeedDefs.ThreadViewPost[],
  collapsed: Set<string>
): { uri: string; handle: string }[] {
  return replies.flatMap((r) => {
    const uri = r.post.uri
    const handle = r.post.author?.handle ?? r.post.author?.did ?? ''
    if (collapsed.has(uri)) return [{ uri, handle }]
    const nested =
      'replies' in r && Array.isArray(r.replies)
        ? (r.replies as unknown[]).filter((x): x is AppBskyFeedDefs.ThreadViewPost => isThreadViewPost(x as Parameters<typeof isThreadViewPost>[0]))
        : []
    return [{ uri, handle }, ...flattenVisibleReplies(nested, collapsed)]
  })
}

function findReplyByUri(
  replies: AppBskyFeedDefs.ThreadViewPost[],
  uri: string
): AppBskyFeedDefs.ThreadViewPost | null {
  for (const r of replies) {
    if (r.post.uri === uri) return r
    const nested =
      'replies' in r && Array.isArray(r.replies)
        ? (r.replies as unknown[]).filter((x): x is AppBskyFeedDefs.ThreadViewPost => isThreadViewPost(x as Parameters<typeof isThreadViewPost>[0]))
        : []
    const found = findReplyByUri(nested, uri)
    if (found) return found
  }
  return null
}

/** Top-level thread root URI for a comment that may be nested under `tops`. */
function topLevelUriForCommentUri(uri: string, tops: AppBskyFeedDefs.ThreadViewPost[]): string | null {
  for (const t of tops) {
    if (t.post.uri === uri) return t.post.uri
    const nested =
      'replies' in t && Array.isArray(t.replies)
        ? (t.replies as unknown[]).filter((x): x is AppBskyFeedDefs.ThreadViewPost => isThreadViewPost(x as Parameters<typeof isThreadViewPost>[0]))
        : []
    if (findReplyByUri(nested, uri)) return t.post.uri
  }
  return null
}

function filterThreadReplies(thread: AppBskyFeedDefs.ThreadViewPost): AppBskyFeedDefs.ThreadViewPost[] {
  return 'replies' in thread && Array.isArray(thread.replies)
    ? (thread.replies as unknown[]).filter((x): x is AppBskyFeedDefs.ThreadViewPost => isThreadViewPost(x as Parameters<typeof isThreadViewPost>[0]))
    : []
}

/** Insert a new reply under `parentUri` (or at root replies if parent not found in subtree). */
function mergeReplyIntoThread(
  thread: AppBskyFeedDefs.ThreadViewPost,
  newReply: AppBskyFeedDefs.ThreadViewPost,
  parentUri: string,
): AppBskyFeedDefs.ThreadViewPost {
  if (collectThreadPostUris(thread).includes(newReply.post.uri)) return thread
  if (thread.post.uri === parentUri) {
    const existing = filterThreadReplies(thread)
    return { ...thread, replies: [...existing, newReply] } as AppBskyFeedDefs.ThreadViewPost
  }
  const replies = filterThreadReplies(thread)
  let childChanged = false
  const nextReplies = replies.map((r) => {
    const merged = mergeReplyIntoThread(r, newReply, parentUri)
    if (merged !== r) childChanged = true
    return merged
  })
  if (childChanged) return { ...thread, replies: nextReplies } as AppBskyFeedDefs.ThreadViewPost
  return { ...thread, replies: [...replies, newReply] } as AppBskyFeedDefs.ThreadViewPost
}

async function fetchNewPostViewAfterComment(postUri: string): Promise<PostView | null> {
  const delayMs = 400
  const maxAttempts = 8
  for (let i = 0; i < maxAttempts; i++) {
    const map = await getPostsBatch([postUri])
    const p = map.get(postUri)
    if (p) return p
    await new Promise((r) => setTimeout(r, delayMs))
  }
  return null
}

/** Collect all post URIs from a thread (root + nested replies) for Constellation downvote count fetch. */
function collectThreadPostUris(
  node: AppBskyFeedDefs.ThreadViewPost | AppBskyFeedDefs.NotFoundPost | AppBskyFeedDefs.BlockedPost | { $type: string }
): string[] {
  if (!isThreadViewPost(node)) return []
  const uris: string[] = [node.post.uri]
  const replies = 'replies' in node && Array.isArray(node.replies)
    ? (node.replies as unknown[]).filter((x): x is AppBskyFeedDefs.ThreadViewPost => isThreadViewPost(x as Parameters<typeof isThreadViewPost>[0]))
    : []
  for (const r of replies) uris.push(...collectThreadPostUris(r))
  return uris
}

/**
 * Thread/feed snapshots can omit image `fullsize` URLs.
 * Only hydrate with getPosts when at least one embedded image is missing fullsize.
 */
function rootPostNeedsCanonicalHydration(post: AppBskyFeedDefs.PostView): boolean {
  const embed = post.embed as
    | {
        $type?: string
        images?: Array<{ fullsize?: string; thumb?: string }>
        media?: {
          $type?: string
          images?: Array<{ fullsize?: string; thumb?: string }>
        }
      }
    | undefined
  if (!embed) return false

  const hasMissingFullsize = (images: Array<{ fullsize?: string; thumb?: string }> | undefined): boolean =>
    Array.isArray(images) && images.some((img) => !!img?.thumb && !img?.fullsize)

  if (embed.$type === 'app.bsky.embed.images#view' && hasMissingFullsize(embed.images)) return true
  if (embed.$type === 'app.bsky.embed.recordWithMedia#view') {
    const media = embed.media
    if (media?.$type === 'app.bsky.embed.images#view' && hasMissingFullsize(media.images)) return true
  }
  return false
}

const DESKTOP_BREAKPOINT = 768
function subscribeDesktop(cb: () => void) {
  if (typeof window === 'undefined') return () => {}
  const mq = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
function getDesktopSnapshot() {
  return typeof window !== 'undefined' ? window.innerWidth >= DESKTOP_BREAKPOINT : false
}

function MediaGallery({
  items,
  autoPlayFirstVideo = false,
  hideVideoControlsUntilTap = false,
  onFocusItem,
  onDoubleTapLike,
  /** No per-item tab stops — use inside clickable preview cards (parent post / quote). */
  forEmbeddedPreview = false,
  /** Called when user clicks on an image to open fullscreen viewer. */
  onImageClick,
}: {
  items: Array<{ url: string; type: 'image' | 'video'; videoPlaylist?: string; aspectRatio?: number }>
  autoPlayFirstVideo?: boolean
  /** On mobile: hide native video controls until user taps the video. */
  hideVideoControlsUntilTap?: boolean
  onFocusItem?: (index: number) => void
  /** Called when user double-taps or double-clicks on media to like the post. */
  onDoubleTapLike?: () => void
  forEmbeddedPreview?: boolean
  onImageClick?: (url: string, index: number) => void
}) {
  const lastTapRef = useRef(0)
  const lastClickRef = useRef(0)

  if (items.length === 0) return null
  const firstVideoIndex = autoPlayFirstVideo
    ? items.findIndex((m) => m.type === 'video' && m.videoPlaylist)
    : -1

  const handleMediaTouchEnd = (e: React.TouchEvent) => {
    if (!onDoubleTapLike || e.changedTouches.length !== 1) return
    const now = Date.now()
    if (now - lastTapRef.current < 400) {
      lastTapRef.current = 0
      e.preventDefault()
      onDoubleTapLike()
    } else {
      lastTapRef.current = now
    }
  }

  const handleMediaClick = (e: React.MouseEvent) => {
    if (!onDoubleTapLike) return
    const now = Date.now()
    if (now - lastClickRef.current < 400) {
      lastClickRef.current = 0
      e.stopPropagation()
      e.preventDefault()
      onDoubleTapLike()
    } else {
      lastClickRef.current = now
    }
  }

  return (
    <div
      className={styles.galleryWrap}
      onTouchEnd={handleMediaTouchEnd}
      onClick={handleMediaClick}
    >
      <div className={styles.gallery}>
        {items.map((m, i) => {
          if (m.type === 'video' && m.videoPlaylist) {
            const videoAspect = m.aspectRatio ?? 16 / 9
            return (
              <div
                key={i}
                className={styles.galleryVideoWrap}
                style={{ aspectRatio: videoAspect }}
                data-media-item={i}
                tabIndex={forEmbeddedPreview ? undefined : 0}
                onFocus={forEmbeddedPreview ? undefined : () => onFocusItem?.(i)}
              >
                <VideoWithHls
                  playlistUrl={m.videoPlaylist}
                  poster={m.url || undefined}
                  className={styles.galleryVideo}
                  autoPlay={i === firstVideoIndex}
                  preload={i === firstVideoIndex ? 'metadata' : 'none'}
                  controlsHiddenUntilTap={hideVideoControlsUntilTap}
                />
              </div>
            )
          }
          const aspect = m.type === 'image' && m.aspectRatio != null ? m.aspectRatio : 1
          const handleImageClick = (_e: React.MouseEvent) => {
            // Prevent triggering when double-clicking for like
            if (lastClickRef.current && Date.now() - lastClickRef.current < 400) return
            onImageClick?.(m.url, i)
          }
          return (
            <div
              key={i}
              className={`${styles.galleryImageBtn} ${onImageClick ? styles.galleryImageBtnClickable : ''}`}
              style={{ aspectRatio: aspect, ['--media-aspect']: aspect } as React.CSSProperties}
              data-media-item={i}
              tabIndex={forEmbeddedPreview ? undefined : 0}
              onFocus={forEmbeddedPreview ? undefined : () => onFocusItem?.(i)}
              onClick={handleImageClick}
              role={onImageClick ? 'button' : undefined}
              aria-label={onImageClick ? 'Open image fullscreen' : undefined}
            >
              <img src={m.url} alt="" className={styles.galleryMedia} loading="lazy" />
            </div>
          )
        })}
      </div>
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
  replyingTo,
  replyComment,
  setReplyComment,
  onReplySubmit,
  replyPosting,
  clearReplyingTo,
  commentFormRef,
  replyAs,
  sessionsList,
  switchAccount,
  currentDid,
  focusedCommentUri,
  onCommentMediaFocus,
  onLike,
  onDownvote,
  likeOverrides,
  myDownvotes,
  downvoteCounts,
  downvoteCountOptimisticDelta,
  likeLoadingUri,
  downvoteLoadingUri,
  openActionsMenuCommentUri,
  onActionsMenuOpenChange,
  onViewQuotes,
  onImageClick,
}: {
  node: AppBskyFeedDefs.ThreadViewPost | AppBskyFeedDefs.NotFoundPost | AppBskyFeedDefs.BlockedPost | { $type: string }
  depth?: number
  collapsedThreads?: Set<string>
  onToggleCollapse?: (uri: string) => void
  onReply?: (parentUri: string, parentCid: string, handle: string) => void
  rootPostUri?: string
  rootPostCid?: string
  replyingTo?: { uri: string; cid: string; handle: string } | null
  replyComment?: string
  setReplyComment?: (v: string) => void
  onReplySubmit?: (e: React.FormEvent) => void
  replyPosting?: boolean
  clearReplyingTo?: () => void
  commentFormRef?: React.RefObject<HTMLFormElement | null>
  replyAs?: { handle: string; avatar?: string } | null
  sessionsList?: AtpSessionData[]
  switchAccount?: (did: string) => Promise<boolean>
  currentDid?: string
  focusedCommentUri?: string
  onCommentMediaFocus?: (commentUri: string, mediaIndex: number) => void
  onLike?: (uri: string, cid: string, currentLikeUri: string | null) => Promise<void>
  onDownvote?: (uri: string, cid: string, currentDownvoteUri: string | null) => Promise<void>
  likeOverrides?: Record<string, string | null>
  myDownvotes?: Record<string, string>
  /** Downvote counts from Constellation; when present, used instead of post.downvoteCount. */
  downvoteCounts?: Record<string, number>
  /** Optimistic +1/-1 when user adds/removes downvote before Constellation indexes. */
  downvoteCountOptimisticDelta?: Record<string, number>
  likeLoadingUri?: string | null
  downvoteLoadingUri?: string | null
  /** When set, which comment's actions menu is open (used to show like/downvote counts on that comment) */
  openActionsMenuCommentUri?: string | null
  onActionsMenuOpenChange?: (uri: string, open: boolean) => void
  /** When set, show "View Quotes" in the post actions menu and call this with post URI */
  onViewQuotes?: (postUri: string) => void
  /** Called when user clicks on an image to open fullscreen viewer */
  onImageClick?: (url: string, index: number) => void
}) {
  const [commentRepostDropdownOpen, setCommentRepostDropdownOpen] = useState<string | null>(null)
  const commentRepostDropdownRef = useRef<HTMLDivElement>(null)
  const [showQuoteComposer, setShowQuoteComposer] = useState(false)
  const [quoteText, setQuoteText] = useState('')
  const [quoteImages, setQuoteImages] = useState<File[]>([])
  const [quoteImageAlts, setQuoteImageAlts] = useState<string[]>([])
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [quotePosting, setQuotePosting] = useState(false)
  const quoteFileInputRef = useRef<HTMLInputElement>(null)
  const repostDropdownRef = useRef<HTMLDivElement>(null)
  const QUOTE_MAX_LENGTH = 300
  const QUOTE_IMAGE_MAX = 4
  const QUOTE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

  useEffect(() => {
    if (!commentRepostDropdownOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (commentRepostDropdownRef.current?.contains(e.target as Node)) return
      setCommentRepostDropdownOpen(null)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [commentRepostDropdownOpen])

  useEffect(() => {
    if (!showQuoteComposer) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      if (repostDropdownRef.current?.contains(target)) return
      setShowQuoteComposer(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [showQuoteComposer])

  function openQuoteComposer() {
    setCommentRepostDropdownOpen(null)
    setShowQuoteComposer(true)
    setQuoteText('')
    setQuoteImages([])
    setQuoteImageAlts([])
    setQuoteError(null)
  }

  function closeQuoteComposer() {
    setShowQuoteComposer(false)
    setQuoteError(null)
  }

  function addQuoteImages(files: FileList) {
    const newImages = Array.from(files).filter((f) => QUOTE_IMAGE_TYPES.includes(f.type))
    setQuoteImages((prev) => [...prev, ...newImages].slice(0, 4))
    setQuoteImageAlts((prev) => [...prev, ...new Array(newImages.length).fill('')])
  }

  function removeQuoteImage(index: number) {
    setQuoteImages((prev) => prev.filter((_, i) => i !== index))
    setQuoteImageAlts((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleQuoteSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isThreadViewPost(node) || quotePosting || !currentDid) return
    const canSubmit = quoteText.trim() || quoteImages.length > 0
    if (!canSubmit) return
    setQuoteError(null)
    setQuotePosting(true)
    try {
      await createQuotePost(
        node.post.uri,
        node.post.cid,
        quoteText,
        quoteImages.length > 0 ? quoteImages : undefined,
        quoteImageAlts.length > 0 ? quoteImageAlts : undefined,
      )
      closeQuoteComposer()
    } catch (err: unknown) {
      setQuoteError(err instanceof Error ? err.message : 'Failed to post quote')
    } finally {
      setQuotePosting(false)
    }
  }

  const quotePreviewUrls = useMemo(
    () => quoteImages.map((f) => URL.createObjectURL(f)),
    [quoteImages],
  )
  useEffect(() => {
    return () => quotePreviewUrls.forEach((u) => URL.revokeObjectURL(u))
  }, [quotePreviewUrls])

  if (!isThreadViewPost(node)) return null
  const { post } = node
  const postViewer = post as { viewer?: { like?: string }; likeCount?: number; downvoteCount?: number }
  const likedUri = likeOverrides?.[post.uri] !== undefined ? likeOverrides[post.uri] : postViewer.viewer?.like
  const downvotedUri = myDownvotes?.[post.uri]
  const baseLikeCount = postViewer.likeCount ?? 0
  const wasLikedByApi = !!postViewer.viewer?.like
  const isLikedNow = !!likedUri
  const likeCountDelta = (isLikedNow ? 1 : 0) - (wasLikedByApi ? 1 : 0)
  const likeCount = Math.max(0, baseLikeCount + likeCountDelta)
  const baseDown = downvoteCounts?.[post.uri] ?? postViewer.downvoteCount ?? 0
  const downDelta = downvoteCountOptimisticDelta?.[post.uri] ?? 0
  const downvoteCount = Math.max(0, baseDown + downDelta)
  const allMedia = getPostAllMedia(post, POST_MEDIA_FULL)
  const text = (post.record as { text?: string })?.text ?? ''
  const handle = post.author.handle ?? post.author.did
  const avatar = post.author.avatar ?? undefined
  const createdAt = (post.record as { createdAt?: string })?.createdAt
  const rawReplies = 'replies' in node && Array.isArray(node.replies) ? (node.replies as (typeof node)[]) : []
  const replies = rawReplies
  const hasReplies = replies.length > 0
  const isCollapsed = hasReplies && collapsedThreads?.has(post.uri)
  const canCollapse = !!onToggleCollapse
  const isReplyTarget = replyingTo?.uri === post.uri
  const isFocused = focusedCommentUri === post.uri
  const likeLoading = likeLoadingUri === post.uri
  const downvoteLoading = downvoteLoadingUri === post.uri
  const showCommentCounts = true

  return (
    <article
      className={`${styles.postBlock} ${styles.threadedCommentArticle} ${isFocused ? styles.commentFocused : ''}`}
      data-thread-depth={depth}
      data-comment-uri={post.uri}
      tabIndex={-1}
    >
      {canCollapse && (
        <div className={styles.collapseColumn}>
          <button
            type="button"
            className={styles.collapseBtn}
            onClick={() => onToggleCollapse?.(post.uri)}
            aria-label={isCollapsed ? 'Expand this comment' : 'Collapse this comment'}
            title={isCollapsed ? 'Expand this comment' : 'Collapse this comment'}
          >
            <span className={styles.collapseIcon} aria-hidden>−</span>
          </button>
          <button
            type="button"
            className={styles.collapseStrip}
            onClick={() => onToggleCollapse?.(post.uri)}
            aria-label={isCollapsed ? 'Expand this comment' : 'Collapse this comment'}
            title={isCollapsed ? 'Expand this comment' : 'Collapse this comment'}
          />
        </div>
      )}
      <div className={styles.postBlockContent}>
      <div className={styles.commentContentWrap} data-comment-content={post.uri} tabIndex={-1}>
      <div className={styles.postHead}>
        {avatar && <img src={avatar} alt="" className={styles.avatar} loading="lazy" />}
        <div className={styles.authorRow}>
          <ProfileLink handle={handle} className={styles.handleLink}>
            @{handle}
          </ProfileLink>
          {createdAt && (
            <span
              className={styles.postTimestamp}
              title={formatExactDateTime(createdAt)}
            >
              {formatRelativeTime(createdAt)}
            </span>
          )}
        </div>
      </div>
      {allMedia.length > 0 && (
        <MediaGallery
          items={allMedia}
          onFocusItem={(i) => onCommentMediaFocus?.(post.uri, i)}
          onDoubleTapLike={onLike ? () => onLike(post.uri, post.cid, likedUri ?? null) : undefined}
          onImageClick={onImageClick}
        />
      )}
      {text && (
        <p className={styles.postText}>
          <PostText text={text} facets={(post.record as { facets?: unknown[] })?.facets} interactive />
        </p>
      )}
      {(onReply || onLike || onDownvote) && (
        <div className={styles.replyBtnRow}>
          {onReply && (
            <button
              type="button"
              className={styles.replyBtn}
              onClick={() => onReply(post.uri, post.cid, handle)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
              <span>Reply</span>
            </button>
          )}
          {onLike && (
            <button
              type="button"
              className={likedUri ? styles.commentLikeBtnLiked : styles.commentLikeBtn}
              onClick={() => onLike(post.uri, post.cid, likedUri ?? null)}
              disabled={likeLoading}
              title={likedUri ? 'Remove like' : 'Like'}
              aria-label={likedUri ? 'Remove like' : 'Like'}
            >
              ↑{showCommentCounts ? ` ${likeCount}` : ''}
            </button>
          )}
          {onDownvote && (
            <button
              type="button"
              className={downvotedUri ? styles.commentDownvoteBtnActive : styles.commentDownvoteBtn}
              onClick={() => onDownvote(post.uri, post.cid, downvotedUri ?? null)}
              disabled={downvoteLoading}
              title={downvotedUri ? 'Remove downvote' : 'Downvote (syncs across AT Protocol)'}
              aria-label={downvotedUri ? 'Remove downvote' : 'Downvote'}
            >
              ↓{showCommentCounts ? ` ${downvoteCount}` : ''}
            </button>
          )}
          {currentDid && (
            <div className={styles.commentRepostWrap} ref={commentRepostDropdownRef}>
              <button
                type="button"
                className={styles.commentRepostBtn}
                onClick={() => setCommentRepostDropdownOpen(commentRepostDropdownOpen === post.uri ? null : post.uri)}
                aria-expanded={commentRepostDropdownOpen === post.uri}
                aria-haspopup="true"
                title="Repost or quote"
                aria-label="Repost or quote"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
                </svg>
              </button>
              {commentRepostDropdownOpen === post.uri && (
                <div className={styles.commentRepostDropdown} role="menu">
                  <button
                    type="button"
                    className={styles.commentRepostDropdownItem}
                    role="menuitem"
                    onClick={async () => {
                      setCommentRepostDropdownOpen(null)
                      try {
                        const postViewer = post as { viewer?: { repost?: string } }
                        if (postViewer.viewer?.repost) {
                          await deleteRepostWithLifecycle(postViewer.viewer.repost)
                        } else {
                          await repostPostWithLifecycle(post.uri, post.cid)
                        }
                      } catch (err) {
                        console.error('Failed to repost:', err)
                      }
                    }}
                  >
                    {(post as { viewer?: { repost?: string } }).viewer?.repost ? 'Remove repost' : 'Repost'}
                  </button>
                  <button
                    type="button"
                    className={styles.commentRepostDropdownItem}
                    role="menuitem"
                    onClick={openQuoteComposer}
                    disabled={!currentDid}
                  >
                    Quote post
                  </button>
                </div>
              )}
            </div>
          )}
          <div className={styles.commentActionsWrap}>
            <PostActionsMenu
              postUri={post.uri}
              postCid={post.cid}
              authorDid={post.author.did}
              shareAuthorHandle={post.author.handle}
              rootUri={rootPostUri ?? post.uri}
              isOwnPost={currentDid === post.author.did}
              compact
              verticalIcon
              className={styles.commentActionsMenu}
              open={onActionsMenuOpenChange ? openActionsMenuCommentUri === post.uri : undefined}
              onOpenChange={onActionsMenuOpenChange ? (open) => onActionsMenuOpenChange(post.uri, open) : undefined}
              postedAt={(post.record as { createdAt?: string })?.createdAt}
              onViewQuotes={onViewQuotes}
            />
          </div>
        </div>
      )}
      {isReplyTarget && replyingTo && setReplyComment && onReplySubmit && clearReplyingTo && commentFormRef && (
        <div className={styles.inlineReplyFormWrap} data-active-reply-target={post.uri}>
          <form ref={commentFormRef} onSubmit={onReplySubmit} className={styles.inlineReplyForm}>
            <div className={styles.inlineReplyFormHeader}>
              <button type="button" className={styles.cancelReply} onClick={clearReplyingTo} aria-label="Cancel reply">
                ×
              </button>
              {replyAs && (sessionsList && switchAccount && currentDid ? (
                <ReplyAsRow replyAs={replyAs} sessionsList={sessionsList} switchAccount={switchAccount} currentDid={currentDid} />
              ) : (
                <p className={styles.replyAs}>
                  <span className={styles.replyAsLabel}>Replying as</span>
                  <span className={styles.replyAsUserChip}>
                    {replyAs.avatar ? (
                      <img src={replyAs.avatar} alt="" className={styles.replyAsAvatar} loading="lazy" />
                    ) : (
                      <span className={styles.replyAsAvatarPlaceholder} aria-hidden>{replyAs.handle.slice(0, 1).toUpperCase()}</span>
                    )}
                    <span className={styles.replyAsHandle}>@{replyAs.handle}</span>
                  </span>
                </p>
              ))}
            </div>
            <ComposerSuggestions
              placeholder={`Reply to @${replyingTo.handle}…`}
              value={replyComment ?? ''}
              onChange={(v) => setReplyComment?.(v)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === 'E') && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  if ((replyComment ?? '').trim() && !replyPosting) commentFormRef.current?.requestSubmit()
                }
              }}
              className={styles.textarea}
              rows={2}
              maxLength={300}
              autoFocus
            />
            <div className={styles.commentFormFooter}>
              <CharacterCountWithCircle used={(replyComment ?? '').length} max={300} />
              <p className={styles.hint}>⌘ Enter or ⌘ E to post</p>
            </div>
            <button type="submit" className={styles.submit} disabled={replyPosting || !(replyComment ?? '').trim()}>
              {replyPosting ? 'Posting…' : 'Post reply'}
            </button>
          </form>
        </div>
      )}
      </div>
      {hasReplies && (
        <div className={styles.repliesContainer}>
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
              {replies.map((r, rIndex) => {
                if (!isThreadViewPost(r)) return null
                const replyDepth = depth + 1
                if (collapsedThreads?.has(r.post.uri)) {
                  const replyCount = 'replies' in r && Array.isArray(r.replies) ? (r.replies as unknown[]).length : 0
                  const label = replyCount === 0 ? 'Comment' : `${replyCount} reply${replyCount !== 1 ? 's' : ''}`
                  const replyHandle = r.post.author?.handle ?? r.post.author?.did ?? ''
                  return (
                    <div
                      key={`${r.post.uri}-${rIndex}`}
                      className={styles.collapsedCommentWrap}
                      style={{ marginLeft: Math.min(replyDepth * 6, 28) }}
                      data-comment-uri={r.post.uri}
                      tabIndex={-1}
                    >
                      <button type="button" className={styles.collapsedCommentBtn} onClick={() => onToggleCollapse?.(r.post.uri)}>
                        <span className={styles.collapsedCommentExpandIcon} aria-hidden>+</span>
                        {r.post.author?.avatar ? (
                          <img src={r.post.author.avatar} alt="" className={styles.collapsedCommentAvatar} loading="lazy" />
                        ) : (
                          <span className={styles.collapsedCommentAvatarPlaceholder} aria-hidden>{replyHandle.slice(0, 1).toUpperCase()}</span>
                        )}
                        <span className={styles.collapsedCommentHandle}>@{replyHandle}</span>
                        <span className={styles.collapsedCommentLabel}>{label}</span>
                      </button>
                    </div>
                  )
                }
                return (
                  <PostBlock
                    key={`${r.post.uri}-${rIndex}`}
                    node={r}
                    depth={replyDepth}
                    collapsedThreads={collapsedThreads}
                    onToggleCollapse={onToggleCollapse}
                    onReply={onReply}
                    rootPostUri={rootPostUri}
                    rootPostCid={rootPostCid}
                    replyingTo={replyingTo}
                    replyComment={replyComment}
                    setReplyComment={setReplyComment}
                    onReplySubmit={onReplySubmit}
                    replyPosting={replyPosting}
                    clearReplyingTo={clearReplyingTo}
                    commentFormRef={commentFormRef}
                    replyAs={replyAs}
                    sessionsList={sessionsList}
                    switchAccount={switchAccount}
                    currentDid={currentDid}
                    focusedCommentUri={focusedCommentUri}
                    onCommentMediaFocus={onCommentMediaFocus}
                    onLike={onLike}
                    onDownvote={onDownvote}
                    likeOverrides={likeOverrides}
                    myDownvotes={myDownvotes}
                    downvoteCounts={downvoteCounts}
                    downvoteCountOptimisticDelta={downvoteCountOptimisticDelta}
                    likeLoadingUri={likeLoadingUri}
                    downvoteLoadingUri={downvoteLoadingUri}
                    openActionsMenuCommentUri={openActionsMenuCommentUri}
                    onActionsMenuOpenChange={onActionsMenuOpenChange}
                    onViewQuotes={onViewQuotes}
                    onImageClick={onImageClick}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}
      </div>
      {showQuoteComposer && isThreadViewPost(node) && (() => {
        const post = node.post
        const handle = post.author?.handle ?? post.author?.did ?? ''
        const text = (post.record as { text?: string })?.text ?? ''
        const mediaList = getPostAllMedia(post, POST_MEDIA_FEED_PREVIEW)
        const firstMedia = mediaList[0]
        return (
          <>
            <div className={styles.quoteComposerBackdrop} onClick={closeQuoteComposer} aria-hidden />
            <div
              className={styles.quoteComposerOverlay}
              role="dialog"
              aria-label="Quote post"
              onClick={closeQuoteComposer}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
              onDrop={(e) => { e.preventDefault(); if (e.dataTransfer?.files?.length) addQuoteImages(e.dataTransfer.files) }}
            >
              <div className={styles.quoteComposerCard} onClick={(e) => e.stopPropagation()}>
                <h2 className={styles.quoteComposerTitle}>Quote post</h2>
                {!currentDid ? (
                  <p className={styles.quoteComposerSignIn}>Log in to quote posts.</p>
                ) : (
                  <>
                    <div className={styles.quoteComposerQuotedWrap}>
                      <p className={styles.quotedPostLabel}>Quoting</p>
                      <div className={styles.quoteComposerQuotedCard}>
                        <div className={styles.quotedPostHead}>
                          {post.author?.avatar ? (
                            <img src={post.author.avatar} alt="" className={styles.quotedPostAvatar} loading="lazy" />
                          ) : (
                            <span className={styles.quotedPostAvatarPlaceholder} aria-hidden>{handle.slice(0, 1).toUpperCase()}</span>
                          )}
                          <span className={styles.quotedPostHandle}>@{handle}</span>
                          {(post.record as { createdAt?: string })?.createdAt && (
                            <span className={styles.quotedPostTime} title={formatExactDateTime((post.record as { createdAt: string }).createdAt)}>
                              {formatRelativeTime((post.record as { createdAt: string }).createdAt)}
                            </span>
                          )}
                        </div>
                        {firstMedia && (
                          <div className={styles.quotedPostMedia}>
                            {firstMedia.type === 'image' ? (
                              <img src={firstMedia.url} alt="" loading="lazy" className={styles.quotedPostThumb} />
                            ) : firstMedia.videoPlaylist ? (
                              <div className={styles.quotedPostVideoThumb}>
                                <VideoWithHls
                                  playlistUrl={firstMedia.videoPlaylist}
                                  poster={firstMedia.url || undefined}
                                  className={styles.quotedPostVideo}
                                  loop
                                  autoPlay
                                  preload="metadata"
                                />
                              </div>
                            ) : null}
                          </div>
                        )}
                        {text ? (
                          <p className={styles.quotedPostText}>
                            <PostText text={text} facets={(post.record as { facets?: unknown[] })?.facets} maxLength={300} stopPropagation />
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <form
                      onSubmit={handleQuoteSubmit}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                          e.preventDefault()
                          handleQuoteSubmit(e as unknown as React.FormEvent)
                        }
                      }}
                    >
                      <ComposerSuggestions
                        className={styles.quoteComposerTextarea}
                        value={quoteText}
                        onChange={setQuoteText}
                        placeholder="Add your thoughts..."
                        rows={4}
                        maxLength={QUOTE_MAX_LENGTH}
                        disabled={quotePosting}
                        autoFocus
                      />
                      {quoteImages.length > 0 && (
                        <div className={styles.quoteComposerMediaSection}>
                          <div className={styles.quoteComposerPreviews}>
                            {quoteImages.map((_, i) => (
                              <div key={i} className={styles.quoteComposerPreviewWrap}>
                                <img src={quotePreviewUrls[i]} alt="" className={styles.quoteComposerPreviewImg} />
                                <button
                                  type="button"
                                  className={styles.quoteComposerPreviewRemove}
                                  onClick={() => removeQuoteImage(i)}
                                  aria-label="Remove image"
                                  disabled={quotePosting}
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                          <p className={styles.quoteComposerAltPrompt}>Describe each image for accessibility (alt text).</p>
                          <div className={styles.quoteComposerAltFields}>
                            {quoteImages.map((_, i) => (
                              <div key={i} className={styles.quoteComposerAltRow}>
                                <label htmlFor={`quote-alt-${i}`} className={styles.quoteComposerAltLabel}>Image {i + 1}</label>
                                <input
                                  id={`quote-alt-${i}`}
                                  type="text"
                                  className={styles.quoteComposerAltInput}
                                  placeholder="Describe this image"
                                  value={quoteImageAlts[i] ?? ''}
                                  onChange={(e) => {
                                    const val = e.target.value.slice(0, 1000)
                                    setQuoteImageAlts((prev) => {
                                      const next = [...prev]
                                      while (next.length < quoteImages.length) next.push('')
                                      next[i] = val
                                      return next
                                    })
                                  }}
                                  maxLength={1000}
                                  disabled={quotePosting}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className={styles.quoteComposerFooter}>
                        <div className={styles.quoteComposerFooterLeft}>
                          <input
                            ref={quoteFileInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/gif,image/webp"
                            multiple
                            className={styles.quoteComposerFileInput}
                            onChange={(e) => {
                              if (e.target.files?.length) addQuoteImages(e.target.files)
                              e.target.value = ''
                            }}
                          />
                          <button
                            type="button"
                            className={styles.quoteComposerAddMedia}
                            onClick={() => quoteFileInputRef.current?.click()}
                            disabled={quotePosting || quoteImages.length >= QUOTE_IMAGE_MAX}
                            title="Add photo"
                            aria-label="Add photo"
                          >
                            Add media
                          </button>
                          <CharacterCountWithCircle used={quoteText.length} max={QUOTE_MAX_LENGTH} />
                        </div>
                        <div className={styles.quoteComposerActions}>
                          <button type="button" className={styles.quoteComposerCancel} onClick={closeQuoteComposer} disabled={quotePosting}>
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className={styles.quoteComposerSubmit}
                            disabled={quotePosting || (!quoteText.trim() && quoteImages.length === 0)}
                          >
                            {quotePosting ? 'Posting…' : 'Quote post'}
                          </button>
                        </div>
                      </div>
                      {quoteError && <p className={styles.quoteComposerError}>{quoteError}</p>}
                    </form>
                  </>
                )}
              </div>
            </div>
          </>
        )
      })()}
    </article>
  )
}

export interface PostDetailContentProps {
  /** Decoded post URI */
  uri: string
  /** When true, open the reply form focused on load */
  initialOpenReply?: boolean
  /** When set, scroll to and focus this reply/comment in the thread (e.g. from notification) */
  initialFocusedCommentUri?: string
  /** When provided, render in modal mode (no Layout). Call when uri is empty to close. */
  onClose?: () => void
  /** Called when thread loads with the root post author handle (e.g. for swipe-left-to-open-profile). */
  onAuthorHandle?: (handle: string) => void
  /** When in a modal, call with a function that refreshes the thread (used for pull-to-refresh). */
  onRegisterRefresh?: (refresh: () => void | Promise<void>) => void
}

export function PostDetailContent({ uri: uriProp, initialOpenReply, initialFocusedCommentUri, onClose, onAuthorHandle, onRegisterRefresh }: PostDetailContentProps) {
  const navigate = useNavigate()
  const { openProfileModal, openPostModal, openQuotesModal } = useProfileModal()
  const { beginKeyboardNavigation, tryHoverSelectCard, gridPointerGateProps } = usePostCardGridPointerGate()
  const isDesktop = useSyncExternalStore(subscribeDesktop, getDesktopSnapshot, () => false)
  const decodedUri = uriProp
  const [thread, setThread] = useState<
    AppBskyFeedDefs.ThreadViewPost | AppBskyFeedDefs.NotFoundPost | AppBskyFeedDefs.BlockedPost | { $type: string } | null
  >(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [posting, setPosting] = useState(false)
  const [collapsedThreads, setCollapsedThreads] = useState<Set<string>>(() => new Set())
  const [followLoading, setFollowLoading] = useState(false)
  const [authorFollowed, setAuthorFollowed] = useState(false)
  const [followUriOverride, setFollowUriOverride] = useState<string | null>(null)
  const [likeLoading, setLikeLoading] = useState(false)
  const [repostLoading, setRepostLoading] = useState(false)
  /** undefined = follow thread `viewer.like`; null = explicitly unliked; string = liked (incl. `'pending'` while API runs). */
  const [likeUriOverride, setLikeUriOverride] = useState<string | null | undefined>(undefined)
  const [repostUriOverride, setRepostUriOverride] = useState<string | null>(null)
  const [replyingTo, setReplyingTo] = useState<{ uri: string; cid: string; handle: string } | null>(null)
  const [commentLikeOverrides, setCommentLikeOverrides] = useState<Record<string, string | null>>({})
  const [myDownvotes, setMyDownvotes] = useState<Record<string, string>>({})
  /** Downvote counts from Microcosm Constellation (app.purplesky.feed.downvote backlinks). */
  const [downvoteCounts, setDownvoteCounts] = useState<Record<string, number>>({})
  /** Optimistic delta when user adds/removes a downvote before Constellation has indexed it. */
  const [downvoteCountOptimisticDelta, setDownvoteCountOptimisticDelta] = useState<Record<string, number>>({})
  const [commentLikeLoadingUri, setCommentLikeLoadingUri] = useState<string | null>(null)
  const [commentDownvoteLoadingUri, setCommentDownvoteLoadingUri] = useState<string | null>(null)
  const [openActionsMenuUri, setOpenActionsMenuUri] = useState<string | null>(null)
  const [showRepostDropdown, setShowRepostDropdown] = useState(false)
  const [showQuoteComposer, setShowQuoteComposer] = useState(false)
  const [quoteText, setQuoteText] = useState('')
  const [quoteImages, setQuoteImages] = useState<File[]>([])
  const [quoteImageAlts, setQuoteImageAlts] = useState<string[]>([])
  const [quotePosting, setQuotePosting] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const quoteFileInputRef = useRef<HTMLInputElement>(null)
  const repostDropdownRef = useRef<HTMLDivElement>(null)
  const [postSectionIndex, setPostSectionIndex] = useState(0)
  const commentFormRef = useRef<HTMLFormElement>(null)
  const commentFormWrapRef = useRef<HTMLDivElement>(null)
  const mediaSectionRef = useRef<HTMLDivElement>(null)
  const descriptionSectionRef = useRef<HTMLDivElement>(null)
  const parentPostCardRef = useRef<HTMLDivElement>(null)
  const quotedPostCardRef = useRef<HTMLDivElement>(null)
  const commentsSectionRef = useRef<HTMLDivElement>(null)
  const downvoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Invalidates in-flight load() when URI changes or the effect cleans up — avoids wrong thread after rapid post switches. */
  const loadGenRef = useRef(0)
  const [focusedCommentIndex, setFocusedCommentIndex] = useState(0)
  const [commentFormFocused, setCommentFormFocused] = useState(false)
  const commentFormTopRef = useRef<HTMLFormElement>(null)
  type CommentSortMode = 'newest' | 'oldest' | 'likes' | 'score' | 'controversial' | 'best'
  const [commentSortOrder, setCommentSortOrder] = useState<CommentSortMode>('score')
  const [keyboardFocusIndex, setKeyboardFocusIndex] = useState(0)
  const keyboardFocusIndexRef = useRef(0)
  const scrollIntoViewFromKeyboardRef = useRef(false)
  const appliedInitialFocusUriRef = useRef<string | null>(null)
  const prevSectionIndexRef = useRef(0)
  const session = getSession()
  const { session: sessionFromContext, sessionsList, switchAccount } = useSession()
  const toast = useToast()
  const { setFollowOverride } = useFollowOverrides()
  const [replyAsProfile, setReplyAsProfile] = useState<{ handle: string; avatar?: string } | null>(null)

  // Image lightbox state
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const openLightbox = useCallback((url: string, index?: number) => {
    setLightboxImage(url)
    if (index !== undefined) setLightboxIndex(index)
  }, [])
  const closeLightbox = useCallback(() => {
    setLightboxImage(null)
    setLightboxIndex(0)
  }, [])
  const handleLightboxNext = useCallback(() => {
    if (thread && isThreadViewPost(thread)) {
      const media = getPostAllMedia(thread.post, POST_MEDIA_FULL)
      if (lightboxIndex < media.length - 1) {
        setLightboxIndex(lightboxIndex + 1)
        setLightboxImage(media[lightboxIndex + 1].url)
      }
    }
  }, [lightboxIndex, thread])
  const handleLightboxPrevious = useCallback(() => {
    if (thread && isThreadViewPost(thread)) {
      const media = getPostAllMedia(thread.post, POST_MEDIA_FULL)
      if (lightboxIndex > 0) {
        setLightboxIndex(lightboxIndex - 1)
        setLightboxImage(media[lightboxIndex - 1].url)
      }
    }
  }, [lightboxIndex, thread])

  useEffect(() => {
    const s = sessionFromContext ?? session
    if (!s?.did) {
      setReplyAsProfile(null)
      return
    }
    const handle = (s as { handle?: string }).handle ?? s.did
    getProfileCached(s.did)
      .then((res) => setReplyAsProfile({ handle: res.handle ?? handle, avatar: res.avatar }))
      .catch(() => setReplyAsProfile({ handle }))
  }, [sessionFromContext?.did, session?.did])

  useEffect(() => {
    setFollowUriOverride(null)
    setAuthorFollowed(false)
  }, [sessionFromContext?.did, session?.did])

  useEffect(() => {
    setLikeUriOverride(undefined)
  }, [decodedUri])

  // Update Open Graph meta tags for link previews when post data loads
  useEffect(() => {
    if (!thread || !isThreadViewPost(thread)) return

    const post = thread.post
    const text = (post.record as { text?: string })?.text ?? ''
    const handle = post.author.handle ?? post.author.did
    const authorDisplayName = post.author.displayName ?? handle
    const allMedia = getPostAllMedia(post, POST_MEDIA_FULL)
    const firstImage = allMedia.find(m => m.type === 'image')?.url || ''

    // Create a description from the post text (truncated to ~200 characters)
    const description = text ? text.slice(0, 200) + (text.length > 200 ? '...' : '') : `Post by @${handle}`

    // Update document title
    const title = text ? text.slice(0, 60) + (text.length > 60 ? '...' : '') : `Post by @${handle}`
    document.title = `${title} · PurpleSky`

    // Update Open Graph meta tags
    const updateMetaTag = (property: string, content: string) => {
      const meta = document.querySelector(`meta[property="${property}"]`) || document.querySelector(`meta[name="${property}"]`)
      if (meta) meta.setAttribute('content', content)
    }

    updateMetaTag('og:title', `${authorDisplayName} on PurpleSky`)
    updateMetaTag('og:description', description)
    updateMetaTag('og:image', firstImage)
    updateMetaTag('og:url', window.location.href)

    updateMetaTag('twitter:title', `${authorDisplayName} on PurpleSky`)
    updateMetaTag('twitter:description', description)
    updateMetaTag('twitter:image', firstImage)

    // Cleanup function to reset meta tags when component unmounts
    return () => {
      document.title = 'PurpleSky'
      updateMetaTag('og:title', 'PurpleSky')
      updateMetaTag('og:description', 'A Bluesky client focused on art')
      updateMetaTag('og:image', '')
      updateMetaTag('og:url', '')
      updateMetaTag('twitter:title', 'PurpleSky')
      updateMetaTag('twitter:description', 'A Bluesky client focused on art')
      updateMetaTag('twitter:image', '')
    }
  }, [thread])

  const replyAs = replyAsProfile ?? (session ? { handle: (session as { handle?: string }).handle ?? session.did } : null)
  const isOwnPost = thread && isThreadViewPost(thread) && session?.did === thread.post.author.did
  const authorViewer = thread && isThreadViewPost(thread) ? (thread.post.author as { viewer?: { following?: string } }).viewer : undefined
  const followingUri = authorViewer?.following ?? followUriOverride
  const alreadyFollowing = !!followingUri || authorFollowed
  const postViewer = thread && isThreadViewPost(thread) ? (thread.post as { viewer?: { like?: string; repost?: string } }).viewer : undefined
  const likedUri =
    likeUriOverride !== undefined ? likeUriOverride : postViewer?.like ?? null
  const repostedUri = postViewer?.repost ?? repostUriOverride
  const isLiked = !!likedUri
  const isReposted = !!repostedUri

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
      const res = await followAccountWithLifecycle(thread.post.author.did)
      setFollowUriOverride(res.uri)
      setFollowOverride(thread.post.author.did, res.uri)
      setAuthorFollowed(true)
    } catch {
      // leave button state unchanged so user can retry
    } finally {
      setFollowLoading(false)
    }
  }

  async function handleUnfollowAuthor() {
    if (!followingUri || followLoading) return
    if (!thread || !isThreadViewPost(thread)) return
    setFollowLoading(true)
    try {
      await unfollowAccountWithLifecycle(followingUri)
      setFollowUriOverride(null)
      setFollowOverride(thread.post.author.did, null)
      setAuthorFollowed(false)
      setThread((prev) => {
        if (!prev || !isThreadViewPost(prev)) return prev
        const author = prev.post.author as { viewer?: { following?: string } }
        return {
          ...prev,
          post: {
            ...prev.post,
            author: {
              ...prev.post.author,
              viewer: { ...author.viewer, following: undefined },
            },
          },
        }
      })
    } catch {
      // leave state unchanged so user can retry
    } finally {
      setFollowLoading(false)
    }
  }

  async function handleLike() {
    if (!thread || !isThreadViewPost(thread) || likeLoading) return
    const { uri, cid } = thread.post
    const viewerLike = postViewer?.like
    const wasLiked = likeUriOverride !== undefined ? !!likeUriOverride : !!viewerLike
    const unlikeRecordUri =
      likeUriOverride !== undefined &&
      likeUriOverride !== null &&
      likeUriOverride !== 'pending'
        ? likeUriOverride
        : viewerLike
    setLikeLoading(true)
    if (wasLiked) {
      setLikeUriOverride(null)
    } else {
      setLikeUriOverride('pending')
    }
    try {
      if (wasLiked) {
        if (!unlikeRecordUri) throw new Error('No like to remove')
        await unlikePostWithLifecycle(unlikeRecordUri, uri)
        setLikeUriOverride(null)
      } else {
        const res = await likePostWithLifecycle(uri, cid)
        setLikeUriOverride(res.uri)
      }
    } catch {
      setLikeUriOverride(undefined)
    } finally {
      setLikeLoading(false)
    }
  }

  const QUOTE_MAX_LENGTH = 300
  const QUOTE_IMAGE_MAX = 4
  const QUOTE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

  async function handleRepost() {
    if (!thread || !isThreadViewPost(thread) || repostLoading) return
    const { uri, cid } = thread.post
    setRepostLoading(true)
    try {
      if (isReposted) {
        await deleteRepostWithLifecycle(repostedUri!)
        setRepostUriOverride(null)
      } else {
        const res = await repostPostWithLifecycle(uri, cid)
        setRepostUriOverride(res.uri)
      }
    } catch {
      // leave state unchanged
    } finally {
      setRepostLoading(false)
    }
  }

  function addQuoteImages(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => QUOTE_IMAGE_TYPES.includes(f.type))
    const take = Math.min(list.length, QUOTE_IMAGE_MAX - quoteImages.length)
    if (take <= 0) return
    setQuoteImages((prev) => [...prev, ...list.slice(0, take)])
    setQuoteImageAlts((prev) => [...prev, ...list.slice(0, take).map(() => '')])
  }

  function removeQuoteImage(index: number) {
    setQuoteImages((prev) => prev.filter((_, i) => i !== index))
    setQuoteImageAlts((prev) => prev.filter((_, i) => i !== index))
  }

  function openQuoteComposer() {
    setShowRepostDropdown(false)
    setShowQuoteComposer(true)
    setQuoteText('')
    setQuoteImages([])
    setQuoteImageAlts([])
    setQuoteError(null)
  }

  function closeQuoteComposer() {
    setShowQuoteComposer(false)
    setQuoteError(null)
  }

  async function handleQuoteSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!thread || !isThreadViewPost(thread) || quotePosting || !session?.did) return
    const canSubmit = quoteText.trim() || quoteImages.length > 0
    if (!canSubmit) return
    setQuoteError(null)
    setQuotePosting(true)
    try {
      await createQuotePost(
        thread.post.uri,
        thread.post.cid,
        quoteText,
        quoteImages.length > 0 ? quoteImages : undefined,
        quoteImageAlts.length > 0 ? quoteImageAlts : undefined,
      )
      closeQuoteComposer()
      navigate('/feed')
    } catch (err: unknown) {
      setQuoteError(err instanceof Error ? err.message : 'Failed to post quote')
    } finally {
      setQuotePosting(false)
    }
  }

  const load = useCallback(async () => {
    if (!decodedUri) return
    const gen = ++loadGenRef.current
    if (downvoteTimerRef.current != null) {
      clearTimeout(downvoteTimerRef.current)
      downvoteTimerRef.current = null
    }
    setError(null)
    const api = getSession() ? agent : publicAgent
    let hadInstantData = false
    const initialPost = takeInitialPostForUri(decodedUri)
    const cached = getCachedThread(decodedUri)
    if (initialPost) {
      const post = (initialPost as { post?: unknown }).post ?? initialPost
      if (post && typeof post === 'object' && (post as { uri?: string }).uri === decodedUri) {
        const minimal: AppBskyFeedDefs.ThreadViewPost = {
          $type: 'app.bsky.feed.defs#threadViewPost',
          post: post as AppBskyFeedDefs.PostView,
          replies: [],
        }
        setThread(minimal)
        // Keep loading true if this is a reply so we show parent skeleton
        const isReply = (post as { record?: { reply?: unknown } }).record?.reply
        setLoading(isReply ? true : false)
        hadInstantData = true
      }
    } else if (cached && isThreadViewPost(cached as AppBskyFeedDefs.ThreadViewPost)) {
      setThread(cached as AppBskyFeedDefs.ThreadViewPost)
      setLoading(false)
      hadInstantData = true
    }
    if (!hadInstantData) setLoading(true)
    try {
      const threadRes = await getPostThreadCached(decodedUri, api)
      if (gen !== loadGenRef.current) return
      const threadData = threadRes.data.thread as AppBskyFeedDefs.ThreadViewPost | AppBskyFeedDefs.NotFoundPost | AppBskyFeedDefs.BlockedPost | { $type: string }
      setThread(threadData)
      /* Canonical post view: only fetch when snapshot embed lacks image fullsize URLs. */
      if (isThreadViewPost(threadData) && rootPostNeedsCanonicalHydration(threadData.post)) {
        const hydrateCanonicalPost = () => {
          void getPostsBatch([decodedUri]).then((map) => {
            if (gen !== loadGenRef.current) return
            const fresh = map.get(decodedUri)
            if (!fresh) return
            setThread((prev) => {
              if (!prev || !isThreadViewPost(prev) || prev.post.uri !== decodedUri) return prev
              return { ...prev, post: fresh }
            })
          })
        }
        const browser = typeof window !== 'undefined' ? (window as Window & { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number }) : null
        if (browser?.requestIdleCallback) {
          browser.requestIdleCallback(hydrateCanonicalPost, { timeout: 900 })
        } else {
          globalThis.setTimeout(hydrateCanonicalPost, 50)
        }
      }
      setDownvoteCountOptimisticDelta({})
      const uris = isThreadViewPost(threadData) ? collectThreadPostUris(threadData) : []
      const scheduleBackground = (task: () => void, timeout = 1200) => {
        const browser = typeof window !== 'undefined' ? (window as Window & { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number }) : null
        if (browser?.requestIdleCallback) {
          browser.requestIdleCallback(task, { timeout })
          return
        }
        globalThis.setTimeout(task, 0)
      }
      if (uris.length > 0) {
        const downvoteTimer = window.setTimeout(() => {
          if (gen !== loadGenRef.current) return
          scheduleBackground(() => {
            if (gen !== loadGenRef.current) return
            getDownvoteCounts(uris)
              .then((counts) => {
                if (gen !== loadGenRef.current) return
                setDownvoteCounts(counts)
              })
              .catch(() => {})
          })
        }, 2000)
        downvoteTimerRef.current = downvoteTimer
      } else {
        setDownvoteCounts({})
      }
      if (getSession()) {
        scheduleBackground(() => {
          if (gen !== loadGenRef.current) return
          listMyDownvotes()
            .then((votes) => {
              if (gen !== loadGenRef.current) return
              setMyDownvotes(votes)
            })
            .catch(() => {})
        }, 2000)
      } else {
        setMyDownvotes({})
      }
    } catch (err: unknown) {
      if (gen === loadGenRef.current) {
        setError(getApiErrorMessage(err, 'load post'))
      }
    } finally {
      if (gen === loadGenRef.current) {
        setLoading(false)
      }
    }
  }, [decodedUri, sessionFromContext?.did])

  useEffect(() => {
    load()
    return () => {
      loadGenRef.current += 1
      if (downvoteTimerRef.current != null) {
        clearTimeout(downvoteTimerRef.current)
        downvoteTimerRef.current = null
      }
    }
  }, [load])

  useEffect(() => {
    onRegisterRefresh?.(() => load())
  }, [onRegisterRefresh, load])

  useEffect(() => {
    if (!thread || !isThreadViewPost(thread) || !initialOpenReply) return
    const handle = thread.post.author?.handle ?? thread.post.author?.did ?? ''
    setReplyingTo({ uri: thread.post.uri, cid: thread.post.cid, handle })
  }, [thread, initialOpenReply])

  useEffect(() => {
    if (!replyingTo) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setReplyingTo(null)
        const el = document.activeElement
        if (el instanceof HTMLElement) el.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [replyingTo])

  /* Focus the real reply composer textarea so the mobile keyboard opens.
   * ComposerSuggestions.handleFocus handles scrollFieldAboveKeyboard with
   * proper cleanup — calling it here too would create leaked viewport
   * listeners that fight over scroll position and misplace the caret. */
  useEffect(() => {
    if (!replyingTo) return
    const uri = replyingTo.uri
    let cancelled = false
    let focused = false
    const run = () => {
      if (cancelled || focused) return
      const ta = queryReplyComposerTextarea(uri)
      if (!ta) return
      focused = true
      ta.focus({ preventScroll: true })
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(run)
    })
    const t1 = window.setTimeout(run, 0)
    const t2 = window.setTimeout(run, 120)
    const t3 = window.setTimeout(run, 400)
    return () => {
      cancelled = true
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(t3)
    }
  }, [replyingTo])

  function notifyCommentError(message: string) {
    if (toast) toast.showToast(message)
    else alert(message)
  }

  async function submitThreadComment(parentUri: string, parentCid: string) {
    if (!thread || !isThreadViewPost(thread) || !comment.trim()) return
    if (!getSession()?.did) {
      notifyCommentError('Log in to post a comment.')
      return
    }
    const rootPost = thread.post
    const text = comment.trim()
    setPosting(true)
    try {
      const res = await postReply(rootPost.uri, rootPost.cid, parentUri, parentCid, text)
      setComment('')
      setReplyingTo(null)
      invalidateThreadCache(decodedUri)
      const newPostView = await fetchNewPostViewAfterComment(res.uri)
      await load()
      setThread((prev) => {
        if (!prev || !isThreadViewPost(prev)) return prev
        if (collectThreadPostUris(prev).includes(res.uri)) return prev
        if (!newPostView) return prev
        const newNode: AppBskyFeedDefs.ThreadViewPost = {
          $type: 'app.bsky.feed.defs#threadViewPost',
          post: newPostView,
          replies: [],
        }
        return mergeReplyIntoThread(prev, newNode, parentUri)
      })
      if (toast) toast.showToast('Comment posted.')
    } catch (err: unknown) {
      notifyCommentError(err instanceof Error ? err.message : 'Failed to post comment')
    } finally {
      setPosting(false)
    }
  }

  function handlePostReply(e: React.FormEvent) {
    e.preventDefault()
    if (!thread || !isThreadViewPost(thread) || !comment.trim()) return
    const rootPost = thread.post
    const parent = replyingTo ?? { uri: rootPost.uri, cid: rootPost.cid }
    void submitThreadComment(parent.uri, parent.cid)
  }

  function handlePostReplyFromTop(e: React.FormEvent) {
    e.preventDefault()
    if (!thread || !isThreadViewPost(thread) || !comment.trim()) return
    const rootPost = thread.post
    void submitThreadComment(rootPost.uri, rootPost.cid)
  }

  function handleReplyTo(parentUri: string, parentCid: string, handle: string) {
    setReplyingTo({ uri: parentUri, cid: parentCid, handle })
  }

  async function handleCommentLike(uri: string, cid: string, currentLikeUri: string | null) {
    setCommentLikeLoadingUri(uri)
    try {
      if (currentLikeUri) {
        await unlikePostWithLifecycle(currentLikeUri, uri)
        setCommentLikeOverrides((m) => ({ ...m, [uri]: null }))
      } else {
        const res = await likePostWithLifecycle(uri, cid)
        setCommentLikeOverrides((m) => ({ ...m, [uri]: res.uri }))
      }
      /* Thread cache is keyed by the opened post URI; nested reply likes do not clear it via subject uri alone. */
      invalidateThreadCache(decodedUri)
    } catch {
      // leave state unchanged
    } finally {
      setCommentLikeLoadingUri(null)
    }
  }

  async function handleCommentDownvote(uri: string, cid: string, currentDownvoteUri: string | null) {
    setCommentDownvoteLoadingUri(uri)
    try {
      if (currentDownvoteUri) {
        await deleteDownvote(currentDownvoteUri)
        setMyDownvotes((m) => {
          const next = { ...m }
          delete next[uri]
          return next
        })
        setDownvoteCountOptimisticDelta((d) => ({ ...d, [uri]: (d[uri] ?? 0) - 1 }))
      } else {
        const recordUri = await createDownvote(uri, cid)
        setMyDownvotes((m) => ({ ...m, [uri]: recordUri }))
        setDownvoteCountOptimisticDelta((d) => ({ ...d, [uri]: (d[uri] ?? 0) + 1 }))
      }
    } catch {
      // leave state unchanged
    } finally {
      setCommentDownvoteLoadingUri(null)
    }
  }

  const quotePreviewUrls = useMemo(
    () => quoteImages.map((f) => URL.createObjectURL(f)),
    [quoteImages],
  )
  useEffect(() => {
    return () => quotePreviewUrls.forEach((u) => URL.revokeObjectURL(u))
  }, [quotePreviewUrls])

  useEffect(() => {
    if (!showRepostDropdown) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      if (repostDropdownRef.current?.contains(target)) return
      setShowRepostDropdown(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [showRepostDropdown])

  const rootMediaForNav =
    thread && isThreadViewPost(thread) ? getPostAllMedia(thread.post, POST_MEDIA_FULL) : []
  const hasMediaSection = rootMediaForNav.length > 0
  const hasRepliesSection =
    thread && isThreadViewPost(thread) && 'replies' in thread &&
    Array.isArray(thread.replies) && thread.replies.length > 0
  const postSectionCount = (hasMediaSection ? 1 : 0) + 1 + (hasRepliesSection ? 1 : 0)

  const threadReplies = thread && isThreadViewPost(thread) && 'replies' in thread && Array.isArray(thread.replies)
    ? (thread.replies as (typeof thread)[]).filter((r): r is AppBskyFeedDefs.ThreadViewPost => isThreadViewPost(r))
    : []

  const getReplyLikeCount = useCallback((r: AppBskyFeedDefs.ThreadViewPost) => {
    const postViewer = r.post as { viewer?: { like?: string }; likeCount?: number }
    const base = postViewer.likeCount ?? 0
    const wasLiked = !!postViewer.viewer?.like
    const likedUri = commentLikeOverrides[r.post.uri] !== undefined ? commentLikeOverrides[r.post.uri] : postViewer.viewer?.like
    const isLikedNow = !!likedUri
    const delta = (isLikedNow ? 1 : 0) - (wasLiked ? 1 : 0)
    return Math.max(0, base + delta)
  }, [commentLikeOverrides])

  const getReplyDownvoteCount = useCallback((r: AppBskyFeedDefs.ThreadViewPost) => {
    const base = downvoteCounts[r.post.uri] ?? 0
    const delta = downvoteCountOptimisticDelta[r.post.uri] ?? 0
    return base + delta
  }, [downvoteCounts, downvoteCountOptimisticDelta])

  /** Wilson score lower bound (z=1.96) for "best" sort – confidence that true ratio is high. */
  const wilsonLower = useCallback((up: number, down: number) => {
    const n = up + down
    if (n === 0) return 0
    const z = 1.96
    const p = up / n
    const denom = 1 + (z * z) / n
    const centre = p + (z * z) / (2 * n)
    const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)
    return Math.max(0, (centre - spread) / denom)
  }, [])

  const threadRepliesVisible = useMemo(() => {
    const createdAt = (r: AppBskyFeedDefs.ThreadViewPost) => (r.post.record as { createdAt?: string })?.createdAt ?? ''
    const tieBreak = (a: AppBskyFeedDefs.ThreadViewPost, b: AppBskyFeedDefs.ThreadViewPost) => createdAt(b).localeCompare(createdAt(a))

    if (commentSortOrder === 'newest') {
      return [...threadReplies].sort((a, b) => createdAt(b).localeCompare(createdAt(a)))
    }
    if (commentSortOrder === 'oldest') {
      return [...threadReplies].sort((a, b) => createdAt(a).localeCompare(createdAt(b)))
    }
    return [...threadReplies].sort((a, b) => {
      const upA = getReplyLikeCount(a)
      const upB = getReplyLikeCount(b)
      const downA = getReplyDownvoteCount(a)
      const downB = getReplyDownvoteCount(b)
      if (commentSortOrder === 'likes') {
        if (upB !== upA) return upB - upA
        return tieBreak(a, b)
      }
      if (commentSortOrder === 'score') {
        const scoreA = upA - downA
        const scoreB = upB - downB
        if (scoreB !== scoreA) return scoreB - scoreA
        return tieBreak(a, b)
      }
      if (commentSortOrder === 'controversial') {
        const nA = upA + downA
        const nB = upB + downB
        const contA = nA > 0 ? (upA * downA) / nA : 0
        const contB = nB > 0 ? (upB * downB) / nB : 0
        if (contB !== contA) return contB - contA
        return tieBreak(a, b)
      }
      /* best: Wilson score lower bound */
      const wA = wilsonLower(upA, downA)
      const wB = wilsonLower(upB, downB)
      if (wB !== wA) return wB - wA
      return tieBreak(a, b)
    })
  }, [threadReplies, commentSortOrder, getReplyLikeCount, getReplyDownvoteCount, wilsonLower])

  const threadRepliesFlat = useMemo(
    () => flattenVisibleReplies(threadRepliesVisible, collapsedThreads),
    [threadRepliesVisible, collapsedThreads]
  )
  const threadRepliesFlatRef = useRef(threadRepliesFlat)
  threadRepliesFlatRef.current = threadRepliesFlat
  keyboardFocusIndexRef.current = keyboardFocusIndex

  type FocusItem = { type: 'rootMedia'; index: number } | { type: 'description' } | { type: 'parentPost' } | { type: 'quotedPost' } | { type: 'commentMedia'; commentUri: string; mediaIndex: number } | { type: 'comment'; commentUri: string } | { type: 'replyForm' }
  const focusItems = useMemo((): FocusItem[] => {
    const items: FocusItem[] = []
    for (let i = 0; i < rootMediaForNav.length; i++) items.push({ type: 'rootMedia', index: i })
    items.push({ type: 'description' })
    // Add parent post preview card if it exists
    if (thread && 'parent' in thread && thread.parent && isThreadViewPost(thread.parent)) {
      items.push({ type: 'parentPost' })
    }
    // Add quoted post preview card if it exists
    if (thread && isThreadViewPost(thread) && getQuotedPostView(thread.post)) {
      items.push({ type: 'quotedPost' })
    }
    for (const flat of threadRepliesFlat) {
      const node = findReplyByUri(threadRepliesVisible, flat.uri)
      const media = node ? getPostAllMedia(node.post, POST_MEDIA_FULL) : []
      for (let i = 0; i < media.length; i++) items.push({ type: 'commentMedia', commentUri: flat.uri, mediaIndex: i })
      items.push({ type: 'comment', commentUri: flat.uri })
    }
    items.push({ type: 'replyForm' })
    return items
  }, [rootMediaForNav.length, threadRepliesFlat, threadRepliesVisible, thread])

  /** First keyboard focus index for each top-level comment (media slots, then body, per focusItems order). */
  const topLevelCommentFirstFocusIndices = useMemo(() => {
    return threadRepliesVisible.map((top) => {
      const u = top.post.uri
      const mediaIdx = focusItems.findIndex((it) => it.type === 'commentMedia' && it.commentUri === u)
      if (mediaIdx >= 0) return mediaIdx
      return focusItems.findIndex((it) => it.type === 'comment' && it.commentUri === u)
    })
  }, [focusItems, threadRepliesVisible])

  const navTotalItems = focusItems.length
  const handleCommentMediaFocus = useCallback((commentUri: string, mediaIndex: number) => {
    const idx = focusItems.findIndex((it) => it.type === 'commentMedia' && it.commentUri === commentUri && it.mediaIndex === mediaIndex)
    if (idx >= 0) {
      setKeyboardFocusIndex(idx)
      const commentIdx = threadRepliesFlat.findIndex((f) => f.uri === commentUri)
      if (commentIdx >= 0) setFocusedCommentIndex(commentIdx)
    }
  }, [focusItems, threadRepliesFlat])
  const handleParentPostHover = useCallback(() => {
    if (!onClose) {
      const idx = focusItems.findIndex((it) => it.type === 'parentPost')
      if (idx >= 0) {
        setKeyboardFocusIndex(idx)
        requestAnimationFrame(() => {
          parentPostCardRef.current?.focus()
        })
      }
    }
  }, [focusItems, onClose])
  const handleQuotedPostHover = useCallback(() => {
    if (!onClose) {
      const idx = focusItems.findIndex((it) => it.type === 'quotedPost')
      if (idx >= 0) {
        setKeyboardFocusIndex(idx)
        requestAnimationFrame(() => {
          quotedPostCardRef.current?.focus()
        })
      }
    }
  }, [focusItems, onClose])
  const postUri = thread && isThreadViewPost(thread) ? thread.post.uri : null
  useEffect(() => {
    if (thread && isThreadViewPost(thread) && onAuthorHandle) {
      const handle = thread.post.author?.handle ?? thread.post.author?.did ?? ''
      if (handle) onAuthorHandle(handle)
    }
  }, [thread, onAuthorHandle])
  useEffect(() => {
    if (postUri) setKeyboardFocusIndex(0)
  }, [postUri])
  useEffect(() => {
    if (navTotalItems <= 0) return
    setKeyboardFocusIndex((i) => Math.min(Math.max(0, i), navTotalItems - 1))
  }, [navTotalItems])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) {
        if (e.key === 'Escape') {
          e.preventDefault()
          target.blur()
        }
        return
      }
      if (e.ctrlKey || e.metaKey) return
      const key = e.key.toLowerCase()
      if (key === 'f' || e.code === 'Space') {
        e.preventDefault()
        const currentIdx = keyboardFocusIndexRef.current
        const currentItem = focusItems[currentIdx]
        if (currentItem && (currentItem.type === 'comment' || currentItem.type === 'commentMedia')) {
          const commentUri = currentItem.commentUri
          const replyNode = findReplyByUri(threadReplies, commentUri)
          if (replyNode) {
            const currentLikeUri = commentLikeOverrides[commentUri] ?? replyNode.post.viewer?.like ?? null
            handleCommentLike(commentUri, replyNode.post.cid, currentLikeUri)
          }
        } else if (thread && isThreadViewPost(thread)) {
          handleLike()
        }
        return
      }
      if (key === 'r') {
        const t = thread
        if (!t || !isThreadViewPost(t)) return
        e.preventDefault()
        const inCommentsSection = hasRepliesSection && postSectionIndex === postSectionCount - 1
        if (inCommentsSection && threadRepliesFlat.length > 0 && focusedCommentIndex >= 0 && focusedCommentIndex < threadRepliesFlat.length) {
          const focused = threadRepliesFlat[focusedCommentIndex]
          const replyNode = findReplyByUri(threadReplies, focused.uri)
          if (replyNode) handleReplyTo(replyNode.post.uri, replyNode.post.cid, focused.handle)
        } else if (postSectionIndex === (hasMediaSection ? 1 : 0)) {
          const handle = t.post.author?.handle ?? t.post.author?.did ?? ''
          handleReplyTo(t.post.uri, t.post.cid, handle)
        }
        return
      }

      const inCommentsSection = hasRepliesSection && (postSectionIndex === postSectionCount - 1 || (commentsSectionRef.current?.contains(target) ?? false))
      const inDescriptionSection = descriptionSectionRef.current?.contains(target) ?? false
      const inMediaSection = mediaSectionRef.current?.contains(target) ?? false
      const inCommentFormWrap = commentFormWrapRef.current?.contains(target) ?? false

      if (key === 'e' || key === 'enter') {
        e.preventDefault()
        if ((commentFormFocused || inCommentFormWrap) && commentFormRef.current) {
          const ta = commentFormRef.current.querySelector('textarea')
          if (ta) {
            (ta as HTMLTextAreaElement).focus()
            setCommentFormFocused(true)
          }
          return
        }
        if (inCommentsSection && threadRepliesFlat.length > 0 && focusedCommentIndex >= 0 && focusedCommentIndex < threadRepliesFlat.length) {
          const focused = threadRepliesFlat[focusedCommentIndex]
          if (focused?.handle) openProfileModal(focused.handle)
          return
        }
        if ((inDescriptionSection || inMediaSection) && thread && isThreadViewPost(thread)) {
          const authorHandle = thread.post.author?.handle ?? thread.post.author?.did ?? ''
          if (authorHandle) openProfileModal(authorHandle)
          return
        }
        return
      }

      if (key === 'm' || key === '`') {
        const focusInActionsMenu = (document.activeElement as HTMLElement)?.closest?.('[role="menu"]')
        if (focusInActionsMenu && openActionsMenuUri != null) {
          e.preventDefault()
          setOpenActionsMenuUri(null)
          return
        }
        if (thread && isThreadViewPost(thread) && focusItems.length > 0) {
          const i = keyboardFocusIndexRef.current
          const item = focusItems[i]
          if (item) {
            let uri: string | null = null
            if (item.type === 'description' || item.type === 'rootMedia') {
              uri = thread.post.uri
            } else if (item.type === 'comment' || item.type === 'commentMedia') {
              uri = item.commentUri
            }
            if (uri != null) {
              e.preventDefault()
              if (openActionsMenuUri === uri) {
                setOpenActionsMenuUri(null)
              } else {
                setOpenActionsMenuUri(uri)
              }
            }
          }
        }
        return
      }

      const isStepPrev = key === 'w' || e.key === 'ArrowUp' || e.key === 'ArrowLeft'
      const isStepNext = key === 's' || e.key === 'ArrowDown' || e.key === 'ArrowRight'
      const isTopLevelPrev = key === 'a'
      const isTopLevelNext = key === 'd'
      if (!isStepPrev && !isStepNext && !isTopLevelPrev && !isTopLevelNext) return
      if (!thread || !isThreadViewPost(thread)) return
      beginKeyboardNavigation()

      const totalItems = focusItems.length
      if (totalItems <= 0) return

      const focusItemAtIndex = (idx: number, prevIndex?: number) => {
        const item = focusItems[idx]
        if (!item) return
        setCommentFormFocused(item.type === 'replyForm')
        if (item.type === 'rootMedia') {
          setPostSectionIndex(0)
          setFocusedCommentIndex(0)
          const items = mediaSectionRef.current?.querySelectorAll<HTMLElement>('[data-media-item]')
          const el = items?.[item.index]
          if (el) {
            requestAnimationFrame(() => {
              el.focus()
              el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            })
          }
        } else if (item.type === 'description') {
          setPostSectionIndex(hasMediaSection ? 1 : 0)
          setFocusedCommentIndex(0)
          requestAnimationFrame(() => {
            descriptionSectionRef.current?.focus()
            descriptionSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          })
        } else if (item.type === 'parentPost') {
          setPostSectionIndex(hasMediaSection ? 1 : 0)
          setFocusedCommentIndex(0)
          requestAnimationFrame(() => {
            parentPostCardRef.current?.focus()
            parentPostCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          })
        } else if (item.type === 'quotedPost') {
          setPostSectionIndex(hasMediaSection ? 1 : 0)
          setFocusedCommentIndex(0)
          requestAnimationFrame(() => {
            quotedPostCardRef.current?.focus()
            quotedPostCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          })
        } else if (item.type === 'commentMedia') {
          setPostSectionIndex(postSectionCount - 1)
          const commentIdx = threadRepliesFlat.findIndex((f) => f.uri === item.commentUri)
          setFocusedCommentIndex(commentIdx >= 0 ? commentIdx : 0)
          requestAnimationFrame(() => {
            const commentsSection = commentsSectionRef.current
            if (!commentsSection) return
            const commentEl = Array.from(commentsSection.querySelectorAll<HTMLElement>('[data-comment-uri]')).find((n) => n.getAttribute('data-comment-uri') === item.commentUri)
            const mediaEl = commentEl?.querySelectorAll<HTMLElement>('[data-media-item]')?.[item.mediaIndex]
            if (mediaEl) {
              mediaEl.focus({ preventScroll: true })
              mediaEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
          })
        } else if (item.type === 'comment') {
          const mediaCount = focusItems.filter((it) => it.type === 'commentMedia' && it.commentUri === item.commentUri).length
          const prevItem = prevIndex !== undefined ? focusItems[prevIndex] : undefined
          const cameFromSameCommentLastMedia =
            prevItem?.type === 'commentMedia' &&
            prevItem.commentUri === item.commentUri &&
            mediaCount > 0 &&
            prevItem.mediaIndex === mediaCount - 1
          if (cameFromSameCommentLastMedia && idx + 1 < focusItems.length) {
            setKeyboardFocusIndex(idx + 1)
            focusItemAtIndex(idx + 1, idx)
            return
          }
          setPostSectionIndex(postSectionCount - 1)
          const commentIdx = threadRepliesFlat.findIndex((f) => f.uri === item.commentUri)
          setFocusedCommentIndex(commentIdx >= 0 ? commentIdx : 0)
          const focusMediaInstead = mediaCount > 0 && prevIndex !== undefined
          const mediaIndexToFocus = focusMediaInstead ? (idx < prevIndex ? mediaCount - 1 : 0) : -1
          if (mediaIndexToFocus >= 0) {
            const commentMediaIdx = focusItems.findIndex(
              (it) => it.type === 'commentMedia' && it.commentUri === item.commentUri && it.mediaIndex === mediaIndexToFocus
            )
            if (commentMediaIdx >= 0) setKeyboardFocusIndex(commentMediaIdx)
          }
          requestAnimationFrame(() => {
            const commentsSection = commentsSectionRef.current
            if (!commentsSection) return
            const commentEl = Array.from(commentsSection.querySelectorAll<HTMLElement>('[data-comment-uri]')).find((n) => n.getAttribute('data-comment-uri') === item.commentUri)
            if (!commentEl) return
            // Focus the comment content wrapper, not the entire article with nested replies
            const contentEl = commentEl.querySelector<HTMLElement>('[data-comment-content]')
            const targetEl = contentEl || commentEl
            if (mediaIndexToFocus >= 0) {
              const mediaEl = targetEl.querySelectorAll<HTMLElement>('[data-media-item]')?.[mediaIndexToFocus]
              if (mediaEl) {
                mediaEl.focus({ preventScroll: true })
                mediaEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }
            } else {
              targetEl.focus({ preventScroll: true })
              targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
          })
        } else {
          setPostSectionIndex(postSectionCount - 1)
          setFocusedCommentIndex(threadRepliesFlat.length - 1)
          requestAnimationFrame(() => {
            commentFormWrapRef.current?.focus()
            commentFormWrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          })
        }
      }

      const current = keyboardFocusIndexRef.current
      const currentItem = focusItems[current]

      if (isTopLevelPrev || isTopLevelNext) {
        if (currentItem?.type !== 'comment' && currentItem?.type !== 'commentMedia') return
        const topUri = topLevelUriForCommentUri(currentItem.commentUri, threadRepliesVisible)
        if (topUri == null) return
        const topUris = threadRepliesVisible.map((r) => r.post.uri)
        const ti = topUris.indexOf(topUri)
        if (ti < 0) return
        const newTi = isTopLevelPrev ? ti - 1 : ti + 1
        if (newTi < 0 || newTi >= topLevelCommentFirstFocusIndices.length) return
        const next = topLevelCommentFirstFocusIndices[newTi]
        if (next < 0 || next === current) return
        e.preventDefault()
        e.stopPropagation()
        scrollIntoViewFromKeyboardRef.current = true
        setKeyboardFocusIndex(next)
        focusItemAtIndex(next, current)
        return
      }

      if (!isStepPrev && !isStepNext) return
      const next = isStepPrev ? Math.max(0, current - 1) : Math.min(totalItems - 1, current + 1)
      if (next !== current) {
        e.preventDefault()
        e.stopPropagation()
        scrollIntoViewFromKeyboardRef.current = true
        setKeyboardFocusIndex(next)
        focusItemAtIndex(next, current)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [postSectionCount, postSectionIndex, hasRepliesSection, threadRepliesFlat, focusedCommentIndex, commentFormFocused, thread, hasMediaSection, handleReplyTo, rootMediaForNav.length, openProfileModal, focusItems, handleLike, handleCommentLike, commentLikeOverrides, openActionsMenuUri, threadRepliesVisible, topLevelCommentFirstFocusIndices, threadReplies, findReplyByUri])

  useEffect(() => {
    if (postSectionCount <= 1) return
    /* Only scroll when user has moved focus to a different section (e.g. comments). Don't scroll on initial load so the post stays at the top. */
    const onPostSection = postSectionIndex === 0 || (hasMediaSection && postSectionIndex === 1)
    if (onPostSection) return
    let ref: HTMLDivElement | null = null
    if (hasRepliesSection && postSectionIndex === postSectionCount - 1) ref = commentsSectionRef.current
    if (ref) ref.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [postSectionIndex, hasMediaSection, hasRepliesSection, postSectionCount])

  useEffect(() => {
    if (postSectionIndex === postSectionCount - 1 && hasRepliesSection && prevSectionIndexRef.current !== postSectionCount - 1) {
      setFocusedCommentIndex(0)
    }
    prevSectionIndexRef.current = postSectionIndex
  }, [postSectionIndex, postSectionCount, hasRepliesSection])

  useEffect(() => {
    if (threadRepliesFlat.length > 0) {
      setFocusedCommentIndex((i) => Math.min(i, threadRepliesFlat.length - 1))
    }
  }, [threadRepliesFlat.length])

  /* When opened with initialFocusedCommentUri (e.g. from notification), scroll to that reply */
  useEffect(() => {
    if (!initialFocusedCommentUri || !thread || !isThreadViewPost(thread) || threadRepliesFlat.length === 0) return
    if (appliedInitialFocusUriRef.current === initialFocusedCommentUri) return
    appliedInitialFocusUriRef.current = initialFocusedCommentUri
    const commentIdx = threadRepliesFlat.findIndex((f) => f.uri === initialFocusedCommentUri)
    if (commentIdx < 0) return
    setFocusedCommentIndex(commentIdx)
    const focusIdx = focusItems.findIndex((it) => (it.type === 'comment' || it.type === 'commentMedia') && it.commentUri === initialFocusedCommentUri)
    if (focusIdx >= 0) setKeyboardFocusIndex(focusIdx)
    requestAnimationFrame(() => {
      const commentsSection = commentsSectionRef.current
      if (!commentsSection) return
      const el = Array.from(commentsSection.querySelectorAll('[data-comment-uri]')).find(
        (n) => n.getAttribute('data-comment-uri') === initialFocusedCommentUri
      )
      if (el) {
        // Scroll to the comment content, not the entire article with nested replies
        const contentEl = (el as HTMLElement).querySelector<HTMLElement>('[data-comment-content]')
        const targetEl = contentEl || (el as HTMLElement)
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
      }
    })
  }, [initialFocusedCommentUri, thread, threadRepliesFlat, focusItems])

  /* Consume keyboard scroll ref when focused comment changes (scroll is done in focusItemAtIndex for comments) */
  useEffect(() => {
    if (!scrollIntoViewFromKeyboardRef.current) return
    const inCommentsSection = hasRepliesSection && postSectionIndex === postSectionCount - 1
    if (!inCommentsSection || postSectionCount <= 1) return
    const flat = threadRepliesFlatRef.current
    if (focusedCommentIndex < 0 || focusedCommentIndex >= flat.length) return
    scrollIntoViewFromKeyboardRef.current = false
  }, [focusedCommentIndex, hasRepliesSection, postSectionIndex, postSectionCount])

  /* Scroll focused comment into view when focus changed by keyboard (W/S/A/D) – comment/commentMedia scroll is done in focusItemAtIndex so we only consume the ref here to avoid double-scroll */
  useEffect(() => {
    if (!scrollIntoViewFromKeyboardRef.current) return
    const item = focusItems[keyboardFocusIndex]
    if (!item || (item.type !== 'comment' && item.type !== 'commentMedia')) return
    scrollIntoViewFromKeyboardRef.current = false
  }, [keyboardFocusIndex, focusItems])

  if (!decodedUri) {
    if (onClose) onClose()
    return null
  }

  const rootMedia =
    thread && isThreadViewPost(thread) ? getPostAllMedia(thread.post, POST_MEDIA_FULL) : []

  const content = (
      <div className={`${styles.wrap}${onClose ? ` ${styles.wrapInModal}` : ''}${loading ? ` ${styles.wrapLoading}` : ''}`} {...gridPointerGateProps}>
        {loading && !thread && <div className={styles.loading} aria-live="polite">Loading…</div>}
        {error && <p className={styles.error}>{error}</p>}
        {thread && isThreadViewPost(thread) && (
          <>
            {(() => {
              // Check if this post is a reply
              const isReply = (thread.post.record as { reply?: unknown })?.reply
              const hasParent = 'parent' in thread && thread.parent && isThreadViewPost(thread.parent)
              
              // Show skeleton if loading and post is a reply but parent not loaded yet
              if (loading && isReply && !hasParent) {
                return (
                  <div className={styles.parentPostWrap}>
                    <p className={styles.quotedPostLabel}>Replying to</p>
                    <div className={`${styles.quotedPostCard} ${styles.parentSkeleton}`}>
                      <div className={styles.quotedPostHead}>
                        <span className={styles.quotedPostAvatarPlaceholder} aria-hidden>•</span>
                        <span className={styles.quotedPostHandle}>Loading…</span>
                      </div>
                    </div>
                  </div>
                )
              }
              
              // Show actual parent if loaded
              if (hasParent) {
                return (() => {
                  const parentNode = thread.parent
                  const parentPost = parentNode && 'post' in parentNode ? parentNode.post : undefined
                  if (!parentPost) return null
                  const parentHandle = parentPost.author?.handle ?? parentPost.author?.did ?? ''
                  const parentText = (parentPost.record as { text?: string })?.text ?? ''
                  const parentMediaFull = getPostAllMedia(parentPost, POST_MEDIA_FULL)
                  const openParentPost = () => {
                    if (onClose) {
                      openPostModal(parentPost.uri, undefined, undefined, parentPost.author?.handle)
                    } else {
                      navigate(getPostAppPath(parentPost.uri, parentPost.author?.handle))
                    }
                  }
                  return (
                    <div className={styles.parentPostWrap}>
                      <p className={styles.quotedPostLabel}>Replying to</p>
                      <div
                        ref={parentPostCardRef}
                        className={styles.quotedPostCard}
                        role="button"
                        tabIndex={0}
                        aria-label={`Open post by @${parentHandle}`}
                        onClick={openParentPost}
                        onMouseEnter={handleParentPostHover}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return
                          e.preventDefault()
                          openParentPost()
                        }}
                      >
                        <div className={styles.quotedPostHead}>
                          {parentPost.author?.avatar ? (
                            <img src={parentPost.author.avatar} alt="" className={styles.quotedPostAvatar} loading="lazy" />
                          ) : (
                            <span className={styles.quotedPostAvatarPlaceholder} aria-hidden>{parentHandle.slice(0, 1).toUpperCase()}</span>
                          )}
                          <ProfileLink handle={parentHandle} className={styles.quotedPostHandle} onClick={(e) => e.stopPropagation()}>
                            @{parentHandle}
                          </ProfileLink>
                          {(parentPost.record as { createdAt?: string })?.createdAt && (
                            <span className={styles.quotedPostTime} title={formatExactDateTime((parentPost.record as { createdAt: string }).createdAt)}>
                              {formatRelativeTime((parentPost.record as { createdAt: string }).createdAt)}
                            </span>
                          )}
                        </div>
                        {parentMediaFull.length > 0 && (
                          <div className={styles.quotedPostGallery} onClick={(e) => e.stopPropagation()}>
                            <MediaGallery
                              items={parentMediaFull}
                              forEmbeddedPreview
                              hideVideoControlsUntilTap={!isDesktop}
                            />
                          </div>
                        )}
                        {parentText ? (
                          <p className={styles.quotedPostText}>
                            <PostText text={parentText} facets={(parentPost.record as { facets?: unknown[] })?.facets} maxLength={200} stopPropagation />
                          </p>
                        ) : null}
                      </div>
                    </div>
                  )
                })()
              }
              
              return null
            })()}
            <article className={`${styles.postBlock} ${styles.rootPostBlock}`}>
              {rootMedia.length > 0 && (
                <div
                  ref={mediaSectionRef}
                  onMouseEnter={() => !onClose && rootMediaForNav.length > 0 && setKeyboardFocusIndex(0)}
                >
                  <MediaGallery
                    items={rootMedia}
                    autoPlayFirstVideo
                    hideVideoControlsUntilTap={!isDesktop}
                    onFocusItem={(i) => !onClose && setKeyboardFocusIndex(i)}
                    onDoubleTapLike={!onClose ? handleLike : undefined}
                    onImageClick={openLightbox}
                  />
                </div>
              )}
              <div
                ref={descriptionSectionRef}
                className={styles.rootPostDescription}
                tabIndex={-1}
                onFocus={() => !onClose && setKeyboardFocusIndex(rootMediaForNav.length)}
                onMouseEnter={() => !onClose && setKeyboardFocusIndex(rootMediaForNav.length)}
              >
                <div className={styles.postHead}>
                  {thread.post.author.avatar && (
                    <img src={thread.post.author.avatar} alt="" className={styles.avatar} loading="lazy" />
                  )}
                  <div className={styles.authorRow}>
                    <ProfileLink
                      handle={thread.post.author.handle ?? thread.post.author.did}
                      className={styles.handleLink}
                    >
                      @{thread.post.author.handle ?? thread.post.author.did}
                    </ProfileLink>
                    {!isOwnPost && (
                      alreadyFollowing ? (
                        <button
                          type="button"
                          className={`${styles.followBtn} ${styles.followBtnFollowing}`}
                          onClick={handleUnfollowAuthor}
                          disabled={followLoading}
                          title="Unfollow"
                        >
                          <span className={styles.followLabelDefault}>Following</span>
                          <span className={styles.followLabelHover}>Unfollow</span>
                        </button>
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
                    {(thread.post.record as { createdAt?: string })?.createdAt && (
                      <span
                        className={styles.postTimestamp}
                        title={formatExactDateTime((thread.post.record as { createdAt: string }).createdAt)}
                      >
                        {formatRelativeTime((thread.post.record as { createdAt: string }).createdAt)}
                      </span>
                    )}
                  </div>
                </div>
                {(thread.post.record as { text?: string })?.text && (
                  <p className={styles.postText}>
                    <PostText text={(thread.post.record as { text?: string }).text!} facets={(thread.post.record as { facets?: unknown[] })?.facets} interactive />
                  </p>
                )}
                {(() => {
                  const ext = getPostExternalLink(thread.post)
                  if (!ext) return null
                  return (
                    <div className={styles.quotedPostWrap}>
                      <p className={styles.quotedPostLabel}>Link</p>
                      <a
                        href={ext.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.quotedPostCard}
                      >
                        {ext.thumb ? (
                          <div className={styles.quotedPostMedia}>
                            <img src={ext.thumb} alt="" loading="lazy" className={styles.quotedPostThumb} />
                          </div>
                        ) : null}
                        <p className={styles.quotedPostText}>{ext.title}</p>
                        {ext.description ? (
                          <p className={styles.quotedPostText}>
                            <PostText text={ext.description} maxLength={200} stopPropagation />
                          </p>
                        ) : null}
                      </a>
                    </div>
                  )
                })()}
                {(() => {
                  const quoted = getQuotedPostView(thread.post)
                  if (!quoted) return null
                  const quotedHandle = quoted.author?.handle ?? quoted.author?.did ?? ''
                  const quotedText = (quoted.record as { text?: string })?.text ?? ''
                  const quotedMediaFull = getPostAllMedia(quoted, POST_MEDIA_FULL)
                  const openQuotedPost = () => {
                    if (onClose) {
                      openPostModal(quoted.uri, undefined, undefined, quoted.author?.handle)
                    } else {
                      navigate(getPostAppPath(quoted.uri, quoted.author?.handle))
                    }
                  }
                  return (
                    <div className={styles.quotedPostWrap}>
                      <p className={styles.quotedPostLabel}>Quoting</p>
                      <div
                        ref={quotedPostCardRef}
                        className={styles.quotedPostCard}
                        role="button"
                        tabIndex={0}
                        aria-label={`Open quoted post by @${quotedHandle}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          openQuotedPost()
                        }}
                        onMouseEnter={handleQuotedPostHover}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return
                          e.preventDefault()
                          e.stopPropagation()
                          openQuotedPost()
                        }}
                      >
                        <div className={styles.quotedPostHead}>
                          {quoted.author?.avatar ? (
                            <img src={quoted.author.avatar} alt="" className={styles.quotedPostAvatar} loading="lazy" />
                          ) : (
                            <span className={styles.quotedPostAvatarPlaceholder} aria-hidden>{quotedHandle.slice(0, 1).toUpperCase()}</span>
                          )}
                          <ProfileLink handle={quotedHandle} className={styles.quotedPostHandle} onClick={(e) => e.stopPropagation()}>
                            @{quotedHandle}
                          </ProfileLink>
                          {(quoted.record as { createdAt?: string })?.createdAt && (
                            <span className={styles.quotedPostTime} title={formatExactDateTime((quoted.record as { createdAt: string }).createdAt)}>
                              {formatRelativeTime((quoted.record as { createdAt: string }).createdAt)}
                            </span>
                          )}
                        </div>
                        {quotedMediaFull.length > 0 && (
                          <div className={styles.quotedPostGallery} onClick={(e) => e.stopPropagation()}>
                            <MediaGallery
                              items={quotedMediaFull}
                              forEmbeddedPreview
                              hideVideoControlsUntilTap={!isDesktop}
                            />
                          </div>
                        )}
                        {quotedText ? (
                          <p className={styles.quotedPostText}>
                            <PostText text={quotedText} facets={(quoted.record as { facets?: unknown[] })?.facets} maxLength={200} stopPropagation />
                          </p>
                        ) : null}
                      </div>
                    </div>
                  )
                })()}
              </div>
            <section className={styles.actions} aria-label="Post actions">
              <div className={styles.actionRow}>
                {onClose && thread && isThreadViewPost(thread) && (
                  <span className={styles.actionRowCollectWrap}>
                    <CollectionSaveMenu postUri={thread.post.uri} variant="detail" />
                  </span>
                )}
                <button
                  type="button"
                  className={`${styles.likeRepostBtn} ${isLiked ? styles.likeRepostBtnActive : ''}`}
                  style={{ order: onClose ? 3 : 1 }}
                  onClick={handleLike}
                  disabled={likeLoading}
                  title={isLiked ? 'Remove like' : 'Like'}
                >
                  {isLiked ? '♥' : '♡'} Like
                </button>
                <div className={styles.repostWrap} ref={repostDropdownRef} style={{ order: 2 }}>
                  <button
                    type="button"
                    className={`${styles.likeRepostBtn} ${isReposted ? styles.likeRepostBtnActive : ''} ${showRepostDropdown ? styles.repostTriggerOpen : ''}`}
                    onClick={() => setShowRepostDropdown((v) => !v)}
                    disabled={repostLoading}
                    title={isReposted ? 'Remove repost' : 'Repost or quote'}
                    aria-expanded={showRepostDropdown}
                    aria-haspopup="true"
                  >
                    <span className={styles.likeRepostBtnIcon} aria-hidden><RepostIcon /></span>
                    {repostLoading ? '…' : 'Repost ▾'}
                  </button>
                  {showRepostDropdown && (
                    <div className={styles.repostDropdown} role="menu">
                      <button
                        type="button"
                        className={styles.repostDropdownItem}
                        role="menuitem"
                        onClick={() => {
                          setShowRepostDropdown(false)
                          handleRepost()
                        }}
                        disabled={repostLoading}
                      >
                        {isReposted ? 'Remove repost' : 'Repost'}
                      </button>
                      <button
                        type="button"
                        className={styles.repostDropdownItem}
                        role="menuitem"
                        onClick={openQuoteComposer}
                        disabled={!session?.did}
                      >
                        Quote post
                      </button>
                    </div>
                  )}
                </div>
                {thread && isThreadViewPost(thread) && !onClose && (
                  <button
                    type="button"
                    className={styles.likeRepostBtn}
                    style={{ order: 3 }}
                    onClick={() => openQuotesModal(thread.post.uri)}
                    title="View posts that quote this"
                    aria-label="View quotes"
                  >
                    <span className={styles.likeRepostBtnIcon} aria-hidden><QuotesIcon /></span>
                    View Quotes
                  </button>
                )}
                {thread && isThreadViewPost(thread) && (
                  <span className={styles.actionRowMenuWrap}>
                    <PostActionsMenu
                      postUri={thread.post.uri}
                      postCid={thread.post.cid}
                      authorDid={thread.post.author.did}
                      shareAuthorHandle={thread.post.author.handle}
                      rootUri={thread.post.uri}
                      isOwnPost={session?.did === thread.post.author.did}
                      compact
                      verticalIcon
                      open={openActionsMenuUri === thread.post.uri}
                      onOpenChange={(open) => setOpenActionsMenuUri(open ? thread.post.uri : null)}
                      onHidden={() => navigate('/feed')}
                      postedAt={(thread.post.record as { createdAt?: string })?.createdAt}
                      onViewQuotes={openQuotesModal}
                    />
                  </span>
                )}
              </div>
            </section>
            </article>
            {thread && isThreadViewPost(thread) && (
              <div
                className={styles.inlineReplyFormWrap}
                data-active-reply-target={
                  !replyingTo || replyingTo.uri === thread.post.uri ? thread.post.uri : undefined
                }
              >
                <div>
                  <form ref={commentFormTopRef} onSubmit={handlePostReplyFromTop} className={styles.commentForm}>
                    {replyAs && (
                      <div className={styles.inlineReplyFormHeader}>
                        {sessionsList && sessionFromContext?.did ? (
                          <ReplyAsRow replyAs={replyAs} sessionsList={sessionsList} switchAccount={switchAccount} currentDid={sessionFromContext.did} />
                        ) : (
                          <p className={styles.replyAs}>
                            <span className={styles.replyAsLabel}>Replying as</span>
                            <span className={styles.replyAsUserChip}>
                              {replyAs.avatar ? (
                                <img src={replyAs.avatar} alt="" className={styles.replyAsAvatar} loading="lazy" />
                              ) : (
                                <span className={styles.replyAsAvatarPlaceholder} aria-hidden>{replyAs.handle.slice(0, 1).toUpperCase()}</span>
                              )}
                              <span className={styles.replyAsHandle}>@{replyAs.handle}</span>
                            </span>
                          </p>
                        )}
                      </div>
                    )}
                    <ComposerSuggestions
                      placeholder="Write a comment…"
                      value={comment}
                      onChange={setComment}
                      onKeyDown={(e) => {
                        if ((e.key === 'Enter' || e.key === 'E') && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault()
                          if (comment.trim() && !posting) commentFormTopRef.current?.requestSubmit()
                        }
                      }}
                      className={styles.textarea}
                      rows={3}
                      maxLength={300}
                    />
                    <p className={styles.hint}>⌘ Enter or ⌘ E to post</p>
                    <button type="submit" className={styles.submit} disabled={posting || !comment.trim()}>
                      {posting ? 'Posting…' : 'Post comment'}
                    </button>
                  </form>
                </div>
              </div>
            )}
            {'replies' in thread && Array.isArray(thread.replies) && thread.replies.length > 0 && (
              <div
                ref={commentsSectionRef}
                className={`${styles.replies} ${styles.repliesTopLevel}`}
              >
                <div className={styles.commentSortRow}>
                  <label htmlFor="comment-sort" className={styles.commentSortLabel}>Sort:</label>
                  <select
                    id="comment-sort"
                    className={styles.commentSortSelect}
                    value={commentSortOrder}
                    onChange={(e) => setCommentSortOrder(e.target.value as CommentSortMode)}
                    aria-label="Comment sort order"
                  >
                    <option value="newest">Newest</option>
                    <option value="oldest">Oldest</option>
                    <option value="likes">Most liked</option>
                    <option value="score">Score (↑ − ↓)</option>
                    <option value="controversial">Controversial</option>
                    <option value="best">Best</option>
                  </select>
                </div>
                <div
                  onFocusCapture={(e) => {
                  if (onClose) return
                  const target = e.target as HTMLElement
                  const commentEl = target.closest?.('[data-comment-uri]') as HTMLElement | null
                  if (!commentEl) return
                  const uri = commentEl.getAttribute('data-comment-uri')
                  if (!uri) return
                  const mediaEl = target.closest?.('[data-media-item]') as HTMLElement | null
                  if (mediaEl) {
                    const mi = mediaEl.getAttribute('data-media-item')
                    if (mi != null) {
                      const idx = focusItems.findIndex((it) => it.type === 'commentMedia' && it.commentUri === uri && it.mediaIndex === parseInt(mi, 10))
                      if (idx >= 0) setKeyboardFocusIndex(idx)
                    }
                    return
                  }
                  const idx = focusItems.findIndex((it) => it.type === 'comment' && it.commentUri === uri)
                  if (idx >= 0) {
                    setKeyboardFocusIndex(idx)
                    const commentIdx = threadRepliesFlat.findIndex((f) => f.uri === uri)
                    if (commentIdx >= 0) setFocusedCommentIndex(commentIdx)
                  }
                }}
              >
                {threadRepliesVisible.map((r, rIndex) => {
                  const currentItem = focusItems[keyboardFocusIndex]
                  const focusedCommentUri = (currentItem?.type === 'comment' || currentItem?.type === 'commentMedia') ? currentItem.commentUri : undefined
                  const commentContentFocusIndex = focusItems.findIndex((it) => it.type === 'comment' && it.commentUri === r.post.uri)
                  const isFocusedCollapsed = hasRepliesSection && currentItem?.type === 'comment' && currentItem.commentUri === r.post.uri
                  if (collapsedThreads.has(r.post.uri)) {
                    const replyCount = 'replies' in r && Array.isArray(r.replies) ? (r.replies as unknown[]).length : 0
                    const label = replyCount === 0 ? 'Comment' : `${replyCount} reply${replyCount !== 1 ? 's' : ''}`
                    const replyHandle = r.post.author?.handle ?? r.post.author?.did ?? ''
                    return (
                      <div
                        key={`${r.post.uri}-${rIndex}`}
                        className={styles.topLevelCommentWrap}
                        data-comment-uri={r.post.uri}
                        tabIndex={-1}
                        onMouseEnter={() => {
                          if (!onClose && commentContentFocusIndex >= 0) {
                            setKeyboardFocusIndex(commentContentFocusIndex)
                            setFocusedCommentIndex(threadRepliesFlat.findIndex((f) => f.uri === r.post.uri))
                          }
                        }}
                      >
                      <div
                        className={`${styles.collapsedCommentWrap} ${isFocusedCollapsed ? styles.commentFocused : ''}`}
                        style={{ marginLeft: 0 }}
                        onFocus={() => !onClose && commentContentFocusIndex >= 0 && setKeyboardFocusIndex(commentContentFocusIndex)}
                      >
                        <button type="button" className={styles.collapsedCommentBtn} onClick={() => toggleCollapse(r.post.uri)}>
                          <span className={styles.collapsedCommentExpandIcon} aria-hidden>+</span>
                          {r.post.author?.avatar ? (
                            <img src={r.post.author.avatar} alt="" className={styles.collapsedCommentAvatar} loading="lazy" />
                          ) : (
                            <span className={styles.collapsedCommentAvatarPlaceholder} aria-hidden>{replyHandle.slice(0, 1).toUpperCase()}</span>
                          )}
                          <span className={styles.collapsedCommentHandle}>@{replyHandle}</span>
                          <span className={styles.collapsedCommentLabel}>{label}</span>
                        </button>
                      </div>
                      </div>
                    )
                  }
                  return (
                    <div
                      key={`${r.post.uri}-${rIndex}`}
                      className={styles.topLevelCommentWrap}
                      onMouseEnter={() => {
                        if (!onClose && commentContentFocusIndex >= 0) {
                          setKeyboardFocusIndex(commentContentFocusIndex)
                          setFocusedCommentIndex(threadRepliesFlat.findIndex((f) => f.uri === r.post.uri))
                        }
                      }}
                    >
                    <PostBlock
                        node={r}
                        depth={0}
                        collapsedThreads={collapsedThreads}
                        onToggleCollapse={toggleCollapse}
                        onReply={handleReplyTo}
                        rootPostUri={thread.post.uri}
                        rootPostCid={thread.post.cid}
                        replyingTo={replyingTo}
                        replyComment={comment}
                        setReplyComment={setComment}
                        onReplySubmit={handlePostReply}
                        replyPosting={posting}
                        clearReplyingTo={() => setReplyingTo(null)}
                        commentFormRef={commentFormRef}
                        replyAs={replyAs}
                        sessionsList={sessionsList}
                        switchAccount={switchAccount}
                        currentDid={sessionFromContext?.did ?? undefined}
                        focusedCommentUri={focusedCommentUri}
                        onCommentMediaFocus={handleCommentMediaFocus}
                        onLike={sessionFromContext ? handleCommentLike : undefined}
                        onDownvote={sessionFromContext ? handleCommentDownvote : undefined}
                        likeOverrides={commentLikeOverrides}
                        myDownvotes={myDownvotes}
                        downvoteCounts={downvoteCounts}
                        downvoteCountOptimisticDelta={downvoteCountOptimisticDelta}
                        likeLoadingUri={commentLikeLoadingUri}
                        downvoteLoadingUri={commentDownvoteLoadingUri}
                        openActionsMenuCommentUri={openActionsMenuUri}
                        onActionsMenuOpenChange={(uri, open) => setOpenActionsMenuUri(open ? uri : null)}
                        onViewQuotes={openQuotesModal}
                        onImageClick={openLightbox}
                      />
                    </div>
                  )
                })}
                </div>
              </div>
            )}
            {(thread && isThreadViewPost(thread) && 'replies' in thread && Array.isArray(thread.replies) && thread.replies.length >= 6 && (!replyingTo || replyingTo.uri === thread.post.uri)) && (
              <div className={styles.inlineReplyFormWrap} data-active-reply-target={thread.post.uri}>
                <div
                  ref={commentFormWrapRef}
                  tabIndex={-1}
                  className={commentFormFocused ? styles.commentFormWrapFocused : undefined}
                  onFocus={() => !onClose && setKeyboardFocusIndex(focusItems.length - 1)}
                  onMouseEnter={() => !onClose && setKeyboardFocusIndex(focusItems.length - 1)}
                  onBlur={() => {
                    requestAnimationFrame(() => {
                      if (!commentFormRef.current?.contains(document.activeElement)) setCommentFormFocused(false)
                    })
                  }}
                >
                <form ref={commentFormRef} onSubmit={handlePostReply} className={styles.commentForm}>
                  {replyAs && (
                    <div className={styles.inlineReplyFormHeader}>
                      {replyingTo && (
                        <button type="button" className={styles.cancelReply} onClick={() => setReplyingTo(null)} aria-label="Cancel reply">
                          ×
                        </button>
                      )}
                      {sessionsList && sessionFromContext?.did ? (
                        <ReplyAsRow replyAs={replyAs} sessionsList={sessionsList} switchAccount={switchAccount} currentDid={sessionFromContext.did} />
                      ) : (
                        <p className={styles.replyAs}>
                          <span className={styles.replyAsLabel}>Replying as</span>
                          <span className={styles.replyAsUserChip}>
                            {replyAs.avatar ? (
                              <img src={replyAs.avatar} alt="" className={styles.replyAsAvatar} loading="lazy" />
                            ) : (
                              <span className={styles.replyAsAvatarPlaceholder} aria-hidden>{replyAs.handle.slice(0, 1).toUpperCase()}</span>
                            )}
                            <span className={styles.replyAsHandle}>@{replyAs.handle}</span>
                          </span>
                        </p>
                      )}
                    </div>
                  )}
                  <ComposerSuggestions
                  placeholder={replyingTo ? `Reply to @${replyingTo.handle}…` : 'Write a comment…'}
                  value={comment}
                  onChange={setComment}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === 'E') && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      if (comment.trim() && !posting) commentFormRef.current?.requestSubmit()
                    }
                  }}
                  className={styles.textarea}
                  rows={3}
                  maxLength={300}
                />
                <p className={styles.hint}>⌘ Enter or ⌘ E to post</p>
                <button type="submit" className={styles.submit} disabled={posting || !comment.trim()}>
                  {posting ? 'Posting…' : 'Post comment'}
                </button>
              </form>
                </div>
              </div>
            )}
          </>
        )}
        {showQuoteComposer && (
          <>
            <div className={styles.quoteComposerBackdrop} onClick={closeQuoteComposer} aria-hidden />
            <div
              className={styles.quoteComposerOverlay}
              role="dialog"
              aria-label="Quote post"
              onClick={closeQuoteComposer}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
              onDrop={(e) => { e.preventDefault(); if (e.dataTransfer?.files?.length) addQuoteImages(e.dataTransfer.files) }}
            >
              <div className={styles.quoteComposerCard} onClick={(e) => e.stopPropagation()}>
                <h2 className={styles.quoteComposerTitle}>Quote post</h2>
                {!session?.did ? (
                  <p className={styles.quoteComposerSignIn}>Log in to quote posts.</p>
                ) : (
                  <>
                    {thread && isThreadViewPost(thread) && (() => {
                      const post = thread.post
                      const handle = post.author?.handle ?? post.author?.did ?? ''
                      const text = (post.record as { text?: string })?.text ?? ''
                      const mediaList = getPostAllMedia(post, POST_MEDIA_FEED_PREVIEW)
                      const firstMedia = mediaList[0]
                      return (
                        <div className={styles.quoteComposerQuotedWrap}>
                          <p className={styles.quotedPostLabel}>Quoting</p>
                          <div className={styles.quoteComposerQuotedCard}>
                            <div className={styles.quotedPostHead}>
                              {post.author?.avatar ? (
                                <img src={post.author.avatar} alt="" className={styles.quotedPostAvatar} loading="lazy" />
                              ) : (
                                <span className={styles.quotedPostAvatarPlaceholder} aria-hidden>{handle.slice(0, 1).toUpperCase()}</span>
                              )}
                              <span className={styles.quotedPostHandle}>@{handle}</span>
                              {(post.record as { createdAt?: string })?.createdAt && (
                                <span className={styles.quotedPostTime} title={formatExactDateTime((post.record as { createdAt: string }).createdAt)}>
                                  {formatRelativeTime((post.record as { createdAt: string }).createdAt)}
                                </span>
                              )}
                            </div>
                            {firstMedia && (
                              <div className={styles.quotedPostMedia}>
                                {firstMedia.type === 'image' ? (
                                  <img src={firstMedia.url} alt="" loading="lazy" className={styles.quotedPostThumb} />
                                ) : firstMedia.videoPlaylist ? (
                                  <div className={styles.quotedPostVideoThumb}>
                                    <VideoWithHls
                                      playlistUrl={firstMedia.videoPlaylist}
                                      poster={firstMedia.url || undefined}
                                      className={styles.quotedPostVideo}
                                      loop
                                      autoPlay
                                      preload="metadata"
                                    />
                                  </div>
                                ) : null}
                              </div>
                            )}
                            {text ? (
                              <p className={styles.quotedPostText}>
                                <PostText text={text} facets={(post.record as { facets?: unknown[] })?.facets} maxLength={300} stopPropagation />
                              </p>
                            ) : null}
                          </div>
                        </div>
                      )
                    })()}
                  <form
                    onSubmit={handleQuoteSubmit}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault()
                        handleQuoteSubmit(e as unknown as React.FormEvent)
                      }
                    }}
                  >
                    <ComposerSuggestions
                      className={styles.quoteComposerTextarea}
                      value={quoteText}
                      onChange={setQuoteText}
                      placeholder="Add your thoughts..."
                      rows={4}
                      maxLength={QUOTE_MAX_LENGTH}
                      disabled={quotePosting}
                      autoFocus
                    />
                    {quoteImages.length > 0 && (
                      <div className={styles.quoteComposerMediaSection}>
                        <div className={styles.quoteComposerPreviews}>
                          {quoteImages.map((_, i) => (
                            <div key={i} className={styles.quoteComposerPreviewWrap}>
                              <img src={quotePreviewUrls[i]} alt="" className={styles.quoteComposerPreviewImg} />
                              <button
                                type="button"
                                className={styles.quoteComposerPreviewRemove}
                                onClick={() => removeQuoteImage(i)}
                                aria-label="Remove image"
                                disabled={quotePosting}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                        <p className={styles.quoteComposerAltPrompt}>Describe each image for accessibility (alt text).</p>
                        <div className={styles.quoteComposerAltFields}>
                          {quoteImages.map((_, i) => (
                            <div key={i} className={styles.quoteComposerAltRow}>
                              <label htmlFor={`quote-alt-${i}`} className={styles.quoteComposerAltLabel}>Image {i + 1}</label>
                              <input
                                id={`quote-alt-${i}`}
                                type="text"
                                className={styles.quoteComposerAltInput}
                                placeholder="Describe this image"
                                value={quoteImageAlts[i] ?? ''}
                                onChange={(e) => {
                                  const val = e.target.value.slice(0, 1000)
                                  setQuoteImageAlts((prev) => {
                                    const next = [...prev]
                                    while (next.length < quoteImages.length) next.push('')
                                    next[i] = val
                                    return next
                                  })
                                }}
                                maxLength={1000}
                                disabled={quotePosting}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className={styles.quoteComposerFooter}>
                      <div className={styles.quoteComposerFooterLeft}>
                        <input
                          ref={quoteFileInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/gif,image/webp"
                          multiple
                          className={styles.quoteComposerFileInput}
                          onChange={(e) => {
                            if (e.target.files?.length) addQuoteImages(e.target.files)
                            e.target.value = ''
                          }}
                        />
                        <button
                          type="button"
                          className={styles.quoteComposerAddMedia}
                          onClick={() => quoteFileInputRef.current?.click()}
                          disabled={quotePosting || quoteImages.length >= QUOTE_IMAGE_MAX}
                          title="Add photo"
                          aria-label="Add photo"
                        >
                          Add media
                        </button>
                        <CharacterCountWithCircle used={quoteText.length} max={QUOTE_MAX_LENGTH} />
                      </div>
                      <div className={styles.quoteComposerActions}>
                        <button type="button" className={styles.quoteComposerCancel} onClick={closeQuoteComposer} disabled={quotePosting}>
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className={styles.quoteComposerSubmit}
                          disabled={quotePosting || (!quoteText.trim() && quoteImages.length === 0)}
                        >
                          {quotePosting ? 'Posting…' : 'Quote post'}
                        </button>
                      </div>
                    </div>
                    {quoteError && <p className={styles.quoteComposerError}>{quoteError}</p>}
                  </form>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      {lightboxImage && (
        <ImageLightbox
          imageUrl={lightboxImage}
          onClose={closeLightbox}
          onPrevious={rootMedia.length > 1 ? handleLightboxPrevious : undefined}
          onNext={rootMedia.length > 1 ? handleLightboxNext : undefined}
        />
      )}
    </div>
  )

  return onClose ? content : <Layout title="Post" showNav>{content}</Layout>
}

export default function PostDetailPage() {
  const { uri, handle, rkey } = useParams<{ uri?: string; handle?: string; rkey?: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [resolvedUri, setResolvedUri] = useState<string | null>(() =>
    uri ? decodeURIComponent(uri) : null
  )
  const [resolving, setResolving] = useState(() => !uri && !!(handle && rkey))

  useEffect(() => {
    if (uri) {
      setResolvedUri(decodeURIComponent(uri))
      setResolving(false)
      return
    }
    if (!handle || !rkey) {
      setResolvedUri(null)
      setResolving(false)
      return
    }
    let cancelled = false
    setResolving(true)
    getProfileCached(handle)
      .then((p) => {
        if (cancelled) return
        if (!p?.did) {
          navigate('/feed', { replace: true })
          return
        }
        setResolvedUri(`at://${p.did}/app.bsky.feed.post/${rkey}`)
        setResolving(false)
      })
      .catch(() => {
        if (!cancelled) navigate('/feed', { replace: true })
      })
    return () => {
      cancelled = true
    }
  }, [uri, handle, rkey, navigate])

  if (resolving || (resolvedUri == null && (handle || rkey))) {
    return (
      <Layout title="Post" showNav>
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>
      </Layout>
    )
  }
  if (!resolvedUri) {
    navigate('/feed', { replace: true })
    return null
  }
  const fromState = (location.state as { openReply?: boolean })?.openReply
  const initialOpenReply = searchParams.get('reply') === '1' || fromState
  const initialFocusedCommentUri = searchParams.get('focus') ?? undefined

  return (
    <Layout title="Post" showNav>
      <PostDetailContent
        uri={resolvedUri}
        initialOpenReply={initialOpenReply}
        initialFocusedCommentUri={initialFocusedCommentUri}
      />
    </Layout>
  )
}
