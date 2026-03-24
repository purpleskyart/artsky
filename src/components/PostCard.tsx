import { useRef, useEffect, useLayoutEffect, useState, useCallback, useMemo, memo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type Hls from 'hls.js'
import { loadHls } from '../lib/loadHls'
import { getPostMediaInfoForDisplay, getPostAllMediaForDisplay, getPostExternalLink, POST_MEDIA_FEED_PREVIEW, likePostWithLifecycle, unlikePostWithLifecycle, followAccountWithLifecycle, type TimelineItem } from '../lib/bsky'
import { useSession } from '../context/SessionContext'
import { useLoginModal } from '../context/LoginModalContext'
import { useArtOnly } from '../context/ArtOnlyContext'
import { useMediaOnly } from '../context/MediaOnlyContext'
import { useModeration } from '../context/ModerationContext'
import CollectionSaveMenu from './CollectionSaveMenu'
import { useProfileModal } from '../context/ProfileModalContext'
import { setInitialPostForUri } from '../lib/postCache'
import { getPostOverlayPath } from '../lib/appUrl'
import { getOverlayBackgroundLocation } from '../lib/overlayNavigation'
import { useModalScroll } from '../context/ModalScrollContext'
import { preloadPostOpen } from '../lib/modalPreload'
import PostText from './PostText'
import ProfileLink from './ProfileLink'
import PostActionsMenu from './PostActionsMenu'
import { ProgressiveImage } from './ProgressiveImage'
import styles from './PostCard.module.css'

interface Props {
  item: TimelineItem
  /** When true, show keyboard-focus ring and parent can use cardRef */
  isSelected?: boolean
  /** Optional ref (object or callback) to the card root (for scroll-into-view) */
  cardRef?: React.Ref<HTMLDivElement | null>
  /** When provided, opening the post calls this instead of navigating to /post/:uri (e.g. open in modal) */
  onPostClick?: (uri: string, options?: { openReply?: boolean; initialItem?: unknown }) => void
  /** Called when media aspect ratio is known (for bento layout) */
  onAspectRatio?: (aspect: number) => void
  /** When true, card fills grid cell height and media uses object-fit: cover (bento mode) */
  fillCell?: boolean
  /** When true, show media blurred with a "Tap to reveal" overlay (NSFW blurred mode) */
  nsfwBlurred?: boolean
  /** Called when user taps to reveal NSFW content */
  onNsfwUnblur?: () => void
  /** When passed with isRevealed, avoids subscribing to ModerationContext so only this card re-renders on unblur (perf). */
  setUnblurred?: (uri: string, revealed: boolean) => void
  /** True when this post's URI is in the unblurred set. Pass with setUnblurred to avoid context-driven re-renders. */
  isRevealed?: boolean
  /** When true, media wrap uses fixed height from --feed-card-media-max-height (no aspect-ratio resize on load) */
  constrainMediaHeight?: boolean
  /** Override liked state (e.g. from F key toggle); string = liked, null = unliked, undefined = use post.viewer.like */
  likedUriOverride?: string | null
  /** Called when like state changes from double-tap (so parent can sync likeOverrides); likeRecordUri null = unliked */
  onLikedChange?: (postUri: string, likeRecordUri: string | null) => void
  /** When true, card is marked as seen (e.g. scrolled past); shown darkened */
  seen?: boolean
  /** Called when the ... actions menu opens or closes (for parent to track which card's menu is open) */
  onActionsMenuOpenChange?: (open: boolean) => void
  /** Index of the card (for parent to signal close when focus moves to another card via A/D) */
  cardIndex?: number
  /** Index of the card whose ... menu is currently open (null = none); when this is not cardIndex, this card closes its menu */
  actionsMenuOpenForIndex?: number | null
  /** Index of the focused media within this post (for multi-image keyboard nav); undefined = whole card focused */
  focusedMediaIndex?: number
  /** Called with (mediaIndex, element) so parent can scroll the focused media into view */
  onMediaRef?: (mediaIndex: number, el: HTMLElement | null) => void
  /** Profile feed often omits post.author.viewer.following; when set, use this for follow UI if post.author.did matches. */
  profileAuthorDid?: string
  /** Follow record URI or null if not following; undefined = do not override author viewer from post */
  profileAuthorFollowingUri?: string | null
  /** When set (e.g. on your collection page), ⋮ menu includes removing this post from that collection */
  onRemovePostFromCollection?: (postUri: string) => void | Promise<void>
  /** Match homepage feed preview: centered collect / avatar / like, ⋮ on the right (also when card mode is Art Cards) */
  feedPreviewActionRow?: boolean
  /** Incrementing token from parent to open the collection picker menu programmatically. */
  openCollectionMenuSignal?: number
}

const REASON_PIN = 'app.bsky.feed.defs#reasonPin'

function RepostIcon() {
  return (
    <svg className={styles.repostIcon} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg className={styles.pinIcon} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
    </svg>
  )
}

function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?|$)/i.test(url) || url.includes('m3u8')
}

type InnerProps = Props & {
  setUnblurred: (uri: string, revealed: boolean) => void
  isRevealed: boolean
}

function PostCardInner({
  item,
  isSelected,
  cardRef: cardRefProp,
  onPostClick,
  onAspectRatio,
  fillCell,
  nsfwBlurred,
  onNsfwUnblur,
  constrainMediaHeight,
  likedUriOverride,
  onLikedChange,
  seen,
  onActionsMenuOpenChange,
  cardIndex,
  actionsMenuOpenForIndex,
  focusedMediaIndex,
  onMediaRef,
  setUnblurred,
  isRevealed,
  profileAuthorDid,
  profileAuthorFollowingUri,
  onRemovePostFromCollection,
  feedPreviewActionRow = false,
  openCollectionMenuSignal,
}: InnerProps) {
  const TOUCH_OPEN_DELAY_MS = 180
  const TOUCH_DOUBLE_TAP_WINDOW_MS = 320
  const MEDIA_CLICK_DOUBLE_TAP_WINDOW_MS = 320

  const navigate = useNavigate()
  const { session } = useSession()
  const { openLoginModal } = useLoginModal()
  const { artOnly, minimalist } = useArtOnly()
  const showFeedStyleActionRow = feedPreviewActionRow || !artOnly || minimalist
  const showArtOnlyCornerActions = artOnly && !minimalist && !feedPreviewActionRow
  const { mediaMode } = useMediaOnly()
  const { openQuotesModal, openPostModal, isModalOpen } = useProfileModal()
  const location = useLocation()
  const modalScrollRef = useModalScroll()
  const videoRef = useRef<HTMLVideoElement>(null)
  const mediaWrapRef = useRef<HTMLDivElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const [videoInLoadRange, setVideoInLoadRange] = useState(false)
  const { post, reason } = item as { post: typeof item.post; reason?: { $type?: string; by?: { handle?: string; did?: string } } }
  const feedSource = (item as { _feedSource?: { kind?: string; label?: string } })._feedSource
  const feedLabel = feedSource?.label ?? (feedSource?.kind === 'timeline' ? 'Following' : undefined)
  
  // Memoize derived state to prevent unnecessary recalculations
  const media = useMemo(() => getPostMediaInfoForDisplay(post, POST_MEDIA_FEED_PREVIEW), [post])
  const hasMedia = !!media
  const text = (post.record as { text?: string })?.text ?? ''
  const externalLink = useMemo(() => getPostExternalLink(post), [post])
  const allMedia = useMemo(() => getPostAllMediaForDisplay(post, POST_MEDIA_FEED_PREVIEW), [post])
  const handle = post.author.handle ?? post.author.did
  const repostedByHandle = reason?.by ? (reason.by.handle ?? reason.by.did) : null
  const isQuotePost = (() => {
    const embed = (post as { embed?: { $type?: string } })?.embed
    return !!embed && (embed.$type === 'app.bsky.embed.record#view' || embed.$type === 'app.bsky.embed.recordWithMedia#view')
  })()
  const isPinned = reason?.$type === REASON_PIN
  const authorViewer = (post.author as { viewer?: { following?: string } }).viewer
  const initialFollowingUri = useMemo(() => {
    if (
      profileAuthorDid != null &&
      post.author.did === profileAuthorDid &&
      profileAuthorFollowingUri !== undefined
    ) {
      return profileAuthorFollowingUri || undefined
    }
    return authorViewer?.following
  }, [profileAuthorDid, post.author.did, profileAuthorFollowingUri, authorViewer?.following])
  const [followUriOverride, setFollowUriOverride] = useState<string | null>(initialFollowingUri ?? null)
  const effectiveFollowingUri = followUriOverride ?? initialFollowingUri ?? null
  const isFollowingAuthor = !!effectiveFollowingUri
  const isOwnPost = session?.did === post.author.did
  const [followLoading, setFollowLoading] = useState(false)
  const postViewer = (post as { viewer?: { like?: string } }).viewer
  const initialLikedUri = postViewer?.like
  const [likedUri, setLikedUri] = useState<string | undefined>(initialLikedUri)
  const [likeLoading, setLikeLoading] = useState(false)
  const effectiveLikedUri = likedUriOverride !== undefined ? (likedUriOverride ?? undefined) : likedUri
  const isLiked = !!effectiveLikedUri

  const [mediaAspect, setMediaAspect] = useState<number | null>(() =>
    hasMedia && media?.aspectRatio != null ? media.aspectRatio : null
  )
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false)
  const actionsMenuDropdownRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const prevSelectedRef = useRef(isSelected)
  const lastTapRef = useRef(0)
  const lastMediaClickRef = useRef(0)
  const didDoubleTapRef = useRef(false)
  const touchSessionRef = useRef(false)
  const mediaClickFromTouchRef = useRef(false)
  const openDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mediaOpenDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const nsfwOverlayHandledRef = useRef(false)
  /** On mobile, first tap on NSFW overlay only unblurs; set so synthetic click doesn't open. */
  const nsfwTouchUnblurOnlyRef = useRef(false)
  /* Close ... menu when parent says focus moved to another card (e.g. A/D) */
  useEffect(() => {
    if (cardIndex == null) return
    if (actionsMenuOpenForIndex === cardIndex) return
    if (actionsMenuOpen) setActionsMenuOpen(false)
  }, [actionsMenuOpenForIndex, cardIndex, actionsMenuOpen])

  /* Open ... menu when parent requests it (e.g. M key on focused card) */
  const prevActionsMenuOpenForIndexRef = useRef<number | null>(null)
  useEffect(() => {
    if (cardIndex == null) return
    if (actionsMenuOpenForIndex === cardIndex && prevActionsMenuOpenForIndexRef.current !== cardIndex) {
      setActionsMenuOpen(true)
    }
    prevActionsMenuOpenForIndexRef.current = actionsMenuOpenForIndex ?? null
  }, [actionsMenuOpenForIndex, cardIndex])

  /* Close ... menu when focus, pointer, or mouse goes to another item (e.g. another card) */
  useEffect(() => {
    if (!actionsMenuOpen) return
    const isOutside = (target: Node | null) => {
      if (!target) return true
      if (cardRef.current?.contains(target)) return false
      if (actionsMenuDropdownRef.current?.contains(target)) return false
      return true
    }
    const onFocusIn = (e: FocusEvent) => {
      if (isOutside(e.target as Node)) setActionsMenuOpen(false)
    }
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = (e as MouseEvent).target ?? (e as TouchEvent).target
      if (isOutside(target as Node)) setActionsMenuOpen(false)
    }
    const onMouseOver = (e: MouseEvent) => {
      if (isOutside(e.target as Node)) setActionsMenuOpen(false)
    }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown, { passive: true })
    document.addEventListener('mouseover', onMouseOver)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('mouseover', onMouseOver)
    }
  }, [actionsMenuOpen])

  useEffect(() => {
    if (likedUriOverride !== undefined) {
      setLikedUri(likedUriOverride ?? undefined)
    } else {
      setLikedUri(initialLikedUri)
    }
  }, [post.uri, initialLikedUri, likedUriOverride])

  useEffect(() => {
    setFollowUriOverride(initialFollowingUri ?? null)
  }, [post.uri, initialFollowingUri])

  // Memoize event handlers to prevent unnecessary re-renders
  const handleFollowClick = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (followLoading || isOwnPost || !session?.did || isFollowingAuthor) return
    
    // Optimistic update: immediately update UI before API call completes
    setFollowLoading(true)
    const pendingUri = `pending:follow:${post.author.did}:${Date.now()}`
    setFollowUriOverride(pendingUri)
    
    try {
      const res = await followAccountWithLifecycle(post.author.did)
      setFollowUriOverride(res.uri)
    } catch {
      // Revert optimistic update on failure
      setFollowUriOverride(null)
    } finally {
      setFollowLoading(false)
    }
  }, [followLoading, isOwnPost, session?.did, isFollowingAuthor, post.author.did])

  const handleLikeClick = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!session?.did) {
      openLoginModal()
      return
    }
    if (likeLoading) return
    const wasLiked = !!effectiveLikedUri
    const previousLikedUri = effectiveLikedUri || undefined
    setLikeLoading(true)
    if (wasLiked) {
      setLikedUri(undefined)
    } else {
      setLikedUri('pending')
    }
    try {
      if (wasLiked) {
        await unlikePostWithLifecycle(previousLikedUri!)
        setLikedUri(undefined)
        onLikedChange?.(post.uri, null)
      } else {
        const res = await likePostWithLifecycle(post.uri, post.cid)
        setLikedUri(res.uri)
        onLikedChange?.(post.uri, res.uri)
      }
    } catch {
      setLikedUri(previousLikedUri)
    } finally {
      setLikeLoading(false)
    }
  }, [session?.did, openLoginModal, likeLoading, effectiveLikedUri, post.uri, post.cid, onLikedChange])

  useEffect(() => {
    return () => {
      if (openDelayTimerRef.current) {
        clearTimeout(openDelayTimerRef.current)
        openDelayTimerRef.current = null
      }
      if (mediaOpenDelayTimerRef.current) {
        clearTimeout(mediaOpenDelayTimerRef.current)
        mediaOpenDelayTimerRef.current = null
      }
    }
  }, [])

  // Reset touch state when modal opens/closes to prevent stuck touch sessions
  useEffect(() => {
    touchSessionRef.current = false
    mediaClickFromTouchRef.current = false
    didDoubleTapRef.current = false
  }, [isModalOpen])

  const isVideo = hasMedia && media!.type === 'video' && media!.videoPlaylist
  const isMultipleImages = hasMedia && media!.type === 'image' && (media!.imageCount ?? 0) > 1
  const imageItems = useMemo(() => allMedia.filter((m) => m.type === 'image'), [allMedia])
  /** Indices in allMedia for each image (for onMediaRef / focusedMediaIndex when multi-image) */
  const imageMediaIndices = useMemo(
    () => allMedia.map((m, i) => (m.type === 'image' ? i : -1)).filter((i): i is number => i >= 0),
    [allMedia]
  )
  const currentImageUrl = isMultipleImages && imageItems.length ? imageItems[0]?.url : (media?.url ?? '')

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    if (!img.naturalWidth || !img.naturalHeight) return
    /* For multi-image posts, set aspect only once (from whichever image loads first)
       so the container doesn't resize when cycling – keeps prev/next arrow positions fixed. */
    if (isMultipleImages) {
      setMediaAspect((prev) => (prev != null ? prev : img.naturalWidth! / img.naturalHeight!))
      return
    }
    /* Don't overwrite when we already have API aspect – avoids layout shift when image loads */
    setMediaAspect((prev) => (prev != null ? prev : img.naturalWidth / img.naturalHeight))
  }, [isMultipleImages])

  useEffect(() => {
    if (!hasMedia) return
    if (media?.aspectRatio != null) setMediaAspect((prev) => prev ?? media.aspectRatio!)
    else if (!isVideo) setMediaAspect((prev) => prev ?? null)
  }, [hasMedia, media?.aspectRatio, media?.videoPlaylist, isVideo])

  /* When post changes (e.g. virtualized list), reset aspect to new post's so reserved size is correct */
  useEffect(() => {
    if (!hasMedia) setMediaAspect(null)
    else if (media?.aspectRatio != null) setMediaAspect(media.aspectRatio)
    else if (!isVideo) setMediaAspect(null)
    else setMediaAspect(null)
  }, [post.uri])

  /* Keep previous aspect when switching images so the container doesn't flash to 3/4 and back */

  useEffect(() => {
    if (mediaAspect != null && onAspectRatio) onAspectRatio(mediaAspect)
  }, [mediaAspect, onAspectRatio])

  /* Only attach HLS / src when the clip is near the viewport to save bandwidth and memory */
  useEffect(() => {
    if (!isVideo || !mediaWrapRef.current) {
      setVideoInLoadRange(false)
      return
    }
    const el = mediaWrapRef.current
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) return
        setVideoInLoadRange(entry.isIntersecting)
      },
      { rootMargin: '320px 0px 320px 0px', threshold: 0 }
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
      setVideoInLoadRange(false)
    }
  }, [isVideo, post.uri])

  useEffect(() => {
    if (!isVideo || !media?.videoPlaylist || !videoInLoadRange) {
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
      const v = videoRef.current
      if (v) {
        v.pause()
        v.removeAttribute('src')
      }
      return
    }

    const video = videoRef.current
    if (!video) return
    const src = media!.videoPlaylist
    let cancelled = false

    if (isHlsUrl(src)) {
      loadHls()
        .then((Hls) => {
          if (cancelled || !videoRef.current) return
          const v = videoRef.current
          if (Hls.isSupported()) {
            const hls = new Hls()
            hlsRef.current = hls
            hls.loadSource(src)
            hls.attachMedia(v)
            hls.on(Hls.Events.ERROR, () => {})
          } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
            v.src = src
          }
        })
        .catch(() => {
          if (!cancelled && videoRef.current?.canPlayType('application/vnd.apple.mpegurl')) {
            videoRef.current.src = src
          }
        })
    } else {
      video.src = src
    }

    return () => {
      cancelled = true
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
      const v = videoRef.current
      if (v) {
        v.pause()
        v.removeAttribute('src')
      }
    }
  }, [isVideo, media?.videoPlaylist, videoInLoadRange])

  /* Autoplay video when in view, pause when out of view or when modal opens */
  const isModalOpenRef = useRef(isModalOpen)
  isModalOpenRef.current = isModalOpen
  useEffect(() => {
    if (!isVideo || !mediaWrapRef.current || !videoRef.current) return
    const el = mediaWrapRef.current
    const video = videoRef.current
    if (isModalOpen) video.pause()
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry || !video) return
        if (isModalOpenRef.current) {
          video.pause()
          return
        }
        if (entry.isIntersecting) {
          video.play().catch(() => {})
        } else {
          video.pause()
        }
      },
      { threshold: 0.25, rootMargin: '0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [isVideo, isModalOpen])

  /* Unblur NSFW when this card gains focus; reblur when it loses selection. Reused across feed, profile, tag, popups. useLayoutEffect so unblur runs before paint (fixes profile modal). */
  useLayoutEffect(() => {
    const wasSelected = prevSelectedRef.current
    prevSelectedRef.current = isSelected
    if (isSelected && nsfwBlurred && onNsfwUnblur) {
      onNsfwUnblur()
    }
    if (wasSelected && !isSelected && isRevealed) {
      setUnblurred(post.uri, false)
    }
  }, [isSelected, post.uri, isRevealed, setUnblurred, nsfwBlurred, onNsfwUnblur])

  /* Unblur NSFW when the card (or a child) receives DOM focus (tab/click). Use refs so handler always sees current values. */
  const nsfwBlurredRef = useRef(nsfwBlurred)
  const onNsfwUnblurRef = useRef(onNsfwUnblur)
  nsfwBlurredRef.current = nsfwBlurred
  onNsfwUnblurRef.current = onNsfwUnblur
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const onFocusIn = () => {
      if (nsfwBlurredRef.current && onNsfwUnblurRef.current) onNsfwUnblurRef.current()
    }
    el.addEventListener('focusin', onFocusIn)
    return () => el.removeEventListener('focusin', onFocusIn)
  }, [])

  /* Reblur NSFW when focus leaves the card (click/tab outside). focusout bubbles so we listen on the card root. */
  useEffect(() => {
    const el = cardRef.current
    if (!el || !isRevealed) return
    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null
      if (next != null && el.contains(next)) return
      setUnblurred(post.uri, false)
    }
    el.addEventListener('focusout', onFocusOut)
    return () => el.removeEventListener('focusout', onFocusOut)
  }, [post.uri, isRevealed, setUnblurred])

  /* Reblur NSFW when media scrolls out of view. Use modal scroll root when inside a modal so we only reblur when media leaves the modal's visible area (fixes hover/keyboard unblur in profile modal). */
  const nsfwHasBeenVisibleRef = useRef(false)
  useEffect(() => {
    if (!hasMedia || !isRevealed || !mediaWrapRef.current) return
    nsfwHasBeenVisibleRef.current = false
    const el = mediaWrapRef.current
    const root = modalScrollRef?.current ?? null
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) return
        if (entry.intersectionRatio > 0) {
          nsfwHasBeenVisibleRef.current = true
          return
        }
        /* Only reblur after we've seen the element visible at least once; the first callback can report 0 before layout (e.g. profile modal). */
        if (!nsfwHasBeenVisibleRef.current) return
        setUnblurred(post.uri, false)
      },
      { threshold: 0, rootMargin: '0px', root }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMedia, post.uri, isRevealed, setUnblurred, modalScrollRef])

  const onMediaEnter = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.play().catch(() => {})
    }
  }, [])

  const onMediaLeave = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.currentTime = 0
    }
  }, [])

  /** Open post in modal (profile page) or navigate to feed with post param (other pages). Same behavior as when onPostClick is provided. */
  const openPostInModalOrFeed = useCallback(() => {
    preloadPostOpen(post.uri)
    /* Mobile: touch unblur runs before paint; synthetic click can fire after nsfwBlurred is already false — suppress opening. */
    if (nsfwTouchUnblurOnlyRef.current) {
      nsfwTouchUnblurOnlyRef.current = false
      return
    }
    if (nsfwBlurred && onNsfwUnblur) {
      onNsfwUnblur()
      return
    }
    if (onPostClick) {
      onPostClick(post.uri, { initialItem: item })
      return
    }
    if (location.pathname.startsWith('/profile/')) {
      setInitialPostForUri(post.uri, item)
      openPostModal(post.uri, undefined, undefined, post.author.handle)
    } else {
      const path = getPostOverlayPath(post.uri)
      navigate(path, { state: { backgroundLocation: getOverlayBackgroundLocation(location) } })
    }
  }, [onPostClick, post.uri, item, navigate, location, openPostModal, nsfwBlurred, onNsfwUnblur])

  const handleCardClick = useCallback((e: React.MouseEvent) => {
    if (nsfwTouchUnblurOnlyRef.current) {
      nsfwTouchUnblurOnlyRef.current = false
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (nsfwBlurred && onNsfwUnblur) {
      onNsfwUnblur()
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (didDoubleTapRef.current) {
      didDoubleTapRef.current = false
      e.preventDefault()
      e.stopPropagation()
      return
    }
    /* On touch devices the synthetic click fires ~300ms after touchEnd; we delay open by 400ms so double-tap can register. Ignore this click and let the timer open. */
    if (touchSessionRef.current) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    e.preventDefault()
    e.stopPropagation()
    openPostInModalOrFeed()
  }, [openPostInModalOrFeed, nsfwBlurred, onNsfwUnblur])

  const openPost = useCallback(() => {
    openPostInModalOrFeed()
  }, [openPostInModalOrFeed])

  const handleMediaDoubleTapLike = useCallback(() => {
    if (!session?.did) {
      openLoginModal()
      return
    }
    if (effectiveLikedUri) {
      setLikedUri(undefined)
      unlikePostWithLifecycle(effectiveLikedUri).then(() => {
        onLikedChange?.(post.uri, null)
      }).catch(() => setLikedUri(effectiveLikedUri))
    } else {
      setLikedUri('pending')
      likePostWithLifecycle(post.uri, post.cid).then((res) => {
        setLikedUri(res.uri)
        onLikedChange?.(post.uri, res.uri)
      }).catch(() => setLikedUri(undefined))
    }
  }, [session?.did, openLoginModal, effectiveLikedUri, post.uri, post.cid, onLikedChange])

  const handleMediaClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    /* Blurred + synthetic click before parent re-renders: unblur only, do not open post */
    if (nsfwBlurred && onNsfwUnblur) {
      onNsfwUnblur()
      nsfwTouchUnblurOnlyRef.current = true
      setTimeout(() => {
        nsfwTouchUnblurOnlyRef.current = false
      }, 450)
      if (mediaOpenDelayTimerRef.current) {
        clearTimeout(mediaOpenDelayTimerRef.current)
        mediaOpenDelayTimerRef.current = null
      }
      lastMediaClickRef.current = 0
      return
    }
    if (mediaClickFromTouchRef.current) return
    // Mouse users expect immediate open. Keep double-tap-like behavior touch-only.
    if (e.nativeEvent.detail <= 1) {
      openPost()
      return
    }
    const now = Date.now()
    if (now - lastMediaClickRef.current < MEDIA_CLICK_DOUBLE_TAP_WINDOW_MS) {
      lastMediaClickRef.current = 0
      if (mediaOpenDelayTimerRef.current) {
        clearTimeout(mediaOpenDelayTimerRef.current)
        mediaOpenDelayTimerRef.current = null
      }
      handleMediaDoubleTapLike()
    } else {
      lastMediaClickRef.current = now
      if (mediaOpenDelayTimerRef.current) clearTimeout(mediaOpenDelayTimerRef.current)
      mediaOpenDelayTimerRef.current = setTimeout(() => {
        mediaOpenDelayTimerRef.current = null
        openPost()
      }, TOUCH_OPEN_DELAY_MS)
    }
  }, [mediaClickFromTouchRef, lastMediaClickRef, handleMediaDoubleTapLike, openPost, nsfwBlurred, onNsfwUnblur])

  const setCardRef = useCallback(
    (el: HTMLDivElement | null) => {
      (cardRef as React.MutableRefObject<HTMLDivElement | null>).current = el
      if (cardRefProp) {
        if (typeof cardRefProp === 'function') cardRefProp(el)
        else (cardRefProp as React.MutableRefObject<HTMLDivElement | null>).current = el
      }
    },
    [cardRefProp],
  )

  return (
    <div
      ref={setCardRef}
      data-post-uri={post.uri}
      className={`${styles.card} ${nsfwBlurred ? styles.cardNsfwBlurred : ''} ${isSelected ? styles.cardSelected : ''} ${isLiked ? styles.cardLiked : ''} ${seen && !isSelected ? styles.cardSeen : ''} ${fillCell ? styles.cardFillCell : ''} ${artOnly ? styles.cardArtOnly : ''} ${minimalist ? styles.cardMinimalist : ''} ${feedPreviewActionRow ? styles.cardFeedPreviewActions : ''}`}
    >
      <div
        role="button"
        tabIndex={0}
        className={styles.cardLink}
        onMouseDown={() => preloadPostOpen(post.uri)}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          handleCardClick(e)
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          if (nsfwBlurred && onNsfwUnblur) {
            onNsfwUnblur()
            return
          }
          openPost()
        }}
        onTouchStart={(e) => {
          touchSessionRef.current = true
          mediaClickFromTouchRef.current = true
          preloadPostOpen(post.uri)
          const t = e.touches[0]
          touchStartRef.current = t ? { x: t.clientX, y: t.clientY } : null
        }}
        onTouchEnd={(e) => {
          const start = touchStartRef.current
          touchStartRef.current = null
          const end = e.changedTouches[0]
          const moved =
            start && end
              ? Math.hypot(end.clientX - start.x, end.clientY - start.y)
              : 0
          const isScroll = moved > 12
          if (isScroll) {
            if (openDelayTimerRef.current) {
              clearTimeout(openDelayTimerRef.current)
              openDelayTimerRef.current = null
            }
            touchSessionRef.current = false
            mediaClickFromTouchRef.current = false
            return
          }
          const now = Date.now()
          if (now - lastTapRef.current < TOUCH_DOUBLE_TAP_WINDOW_MS) {
            lastTapRef.current = 0
            didDoubleTapRef.current = true
            if (openDelayTimerRef.current) {
              clearTimeout(openDelayTimerRef.current)
              openDelayTimerRef.current = null
            }
            e.preventDefault()
            /* Don’t register double-tap like until blurred content is revealed */
            if (nsfwBlurred && onNsfwUnblur) {
              onNsfwUnblur()
              nsfwTouchUnblurOnlyRef.current = true
              setTimeout(() => {
                touchSessionRef.current = false
                mediaClickFromTouchRef.current = false
                didDoubleTapRef.current = false
                nsfwTouchUnblurOnlyRef.current = false
              }, 450)
              return
            }
            if (effectiveLikedUri) {
              setLikedUri(undefined)
              unlikePostWithLifecycle(effectiveLikedUri).then(() => {
                onLikedChange?.(post.uri, null)
              }).catch(() => setLikedUri(effectiveLikedUri))
            } else {
              setLikedUri('pending')
              likePostWithLifecycle(post.uri, post.cid).then((res) => {
                setLikedUri(res.uri)
                onLikedChange?.(post.uri, res.uri)
              }).catch(() => setLikedUri(undefined))
            }
            setTimeout(() => { 
              touchSessionRef.current = false
              mediaClickFromTouchRef.current = false
              didDoubleTapRef.current = false
            }, 500)
          } else {
            lastTapRef.current = now
            if (nsfwBlurred && onNsfwUnblur) {
              /* preventDefault stops the delayed synthetic click from opening the post under the removed overlay */
              e.preventDefault()
              onNsfwUnblur()
              nsfwTouchUnblurOnlyRef.current = true
              openDelayTimerRef.current = setTimeout(() => {
                openDelayTimerRef.current = null
                touchSessionRef.current = false
                mediaClickFromTouchRef.current = false
                nsfwTouchUnblurOnlyRef.current = false
              }, TOUCH_OPEN_DELAY_MS)
            } else {
              if (openDelayTimerRef.current) clearTimeout(openDelayTimerRef.current)
              openDelayTimerRef.current = setTimeout(() => {
                openDelayTimerRef.current = null
                touchSessionRef.current = false
                mediaClickFromTouchRef.current = false
                openPost()
              }, TOUCH_OPEN_DELAY_MS)
            }
          }
        }}
      >
        <div
          ref={(el) => {
            ;(mediaWrapRef as React.MutableRefObject<HTMLDivElement | null>).current = el
            if (onMediaRef && (mediaMode === 'text' || (hasMedia && !(isMultipleImages && imageItems.length > 1)))) onMediaRef(0, el)
          }}
          className={`${styles.mediaWrap} ${fillCell ? styles.mediaWrapFillCell : ''} ${constrainMediaHeight ? styles.mediaWrapConstrained : ''} ${isMultipleImages && imageItems.length > 1 ? styles.mediaWrapMultiStack : ''}`}
          style={
            fillCell || constrainMediaHeight ||
            (isMultipleImages && imageItems.length > 1)
              ? undefined
              : {
                  aspectRatio:
                    !hasMedia ? '1' : mediaAspect != null ? String(mediaAspect) : isVideo ? '1' : undefined,
                }
          }
          onMouseEnter={onMediaEnter}
          onMouseLeave={onMediaLeave}
          {...(hasMedia && { onClick: handleMediaClick })}
        >
          <div className={styles.mediaNsfwBlurTarget}>
          {(!hasMedia || mediaMode === 'text') ? (
            <div className={styles.textOnlyPreview}>
              {text ? (
                <div className={styles.textOnlyPreviewText} onClick={(e) => { e.stopPropagation(); handleCardClick(e); }}>
                  <PostText
                    text={text}
                    facets={(post.record as { facets?: unknown[] })?.facets}
                    maxLength={500}
                    stopPropagation
                    interactive={false}
                  />
                </div>
              ) : null}
              {externalLink ? (
                <a
                  href={externalLink.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.textOnlyPreviewLink}
                  onClick={(e) => {
                    if (nsfwBlurred && onNsfwUnblur) {
                      e.preventDefault()
                      e.stopPropagation()
                      onNsfwUnblur()
                      return
                    }
                    e.stopPropagation()
                  }}
                >
                  {externalLink.thumb ? (
                    <ProgressiveImage src={externalLink.thumb} alt="" className={styles.textOnlyPreviewLinkThumb} loading="lazy" />
                  ) : null}
                  <span className={styles.textOnlyPreviewLinkTitle}>{externalLink.title}</span>
                  {externalLink.description ? (
                    <span className={styles.textOnlyPreviewLinkDesc}>{externalLink.description}</span>
                  ) : null}
                </a>
              ) : null}
              {!text && !externalLink ? (
                <span className={styles.textOnlyPreviewEmpty}>Text post</span>
              ) : null}
            </div>
          ) : isVideo ? (
            <div className={styles.mediaVideoWrap}>
              <video
                ref={videoRef}
                className={styles.media}
                poster={media!.url || undefined}
                muted
                playsInline
                loop
                preload={videoInLoadRange ? 'metadata' : 'none'}
                style={{ aspectRatio: mediaAspect != null ? `${mediaAspect}` : undefined }}
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget
                  if (!v.videoWidth || !v.videoHeight) return
                  /* Set aspect once from video dimensions so vertical/landscape scale correctly; don't overwrite if already set (e.g. from API). */
                  setMediaAspect((prev) => (prev != null ? prev : v.videoWidth / v.videoHeight))
                }}
              />
            </div>
          ) : isMultipleImages && imageItems.length > 1 ? (
            <>
              {/* Spacer height = sum of each image's height at full width so all images fit without cropping */}
                {(() => {
                  const totalInverseAspect = imageItems.reduce((s, m) => s + 1 / (m.aspectRatio || 1), 0)
                  const combinedAspect = 1 / totalInverseAspect
                  return (
                    <div className={styles.mediaWrapGridSpacer} style={{ aspectRatio: String(combinedAspect) }} aria-hidden />
                  )
                })()}
                <div className={styles.mediaWrapGrid}>
                  <div className={styles.mediaGrid} style={{ minHeight: 0 }}>
                    {imageItems.map((imgItem, idx) => {
                      const mediaIndex = imageMediaIndices[idx] ?? idx
                      const isFocused = focusedMediaIndex === mediaIndex
                      return (
                        <div
                          key={idx}
                          ref={(el) => onMediaRef?.(mediaIndex, el)}
                          className={`${styles.mediaGridCell} ${isFocused ? styles.mediaGridCellFocused : ''}`}
                          style={{ flex: `${1 / (imgItem.aspectRatio || 1)} 1 0` }}
                        >
                          <ProgressiveImage
                            src={imgItem.url}
                            alt=""
                            className={styles.mediaGridImg}
                            loading="lazy"
                            onLoad={idx === 0 ? handleImageLoad : undefined}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
            </>
          ) : (
            <>
              <ProgressiveImage
                src={currentImageUrl}
                alt=""
                className={styles.media}
                loading={isSelected ? 'eager' : 'lazy'}
                onLoad={handleImageLoad}
              />
            </>
          )}
          </div>
          {nsfwBlurred && onNsfwUnblur && (
            <div
              className={styles.nsfwOverlay}
              onTouchStart={(e) => {
                e.stopPropagation()
              }}
              onTouchEnd={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onNsfwUnblur()
                nsfwTouchUnblurOnlyRef.current = true
              }}
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (e.pointerType === 'touch') {
                  onNsfwUnblur()
                  nsfwTouchUnblurOnlyRef.current = true
                  return
                }
                if (nsfwOverlayHandledRef.current) return
                nsfwOverlayHandledRef.current = true
                onNsfwUnblur()
                setTimeout(() => { nsfwOverlayHandledRef.current = false }, 400)
              }}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (nsfwTouchUnblurOnlyRef.current) {
                  nsfwTouchUnblurOnlyRef.current = false
                  return
                }
                if (nsfwOverlayHandledRef.current) return
                nsfwOverlayHandledRef.current = true
                onNsfwUnblur()
                setTimeout(() => { nsfwOverlayHandledRef.current = false }, 400)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onNsfwUnblur()
                }
              }}
              role="button"
              tabIndex={0}
              aria-label="Reveal sensitive content"
            >
              <span className={styles.nsfwOverlayText}>NSFW</span>
            </div>
          )}
        </div>
        {showArtOnlyCornerActions && (
          <div className={styles.artOnlyActions} onClick={(e) => e.stopPropagation()}>
            <CollectionSaveMenu postUri={post.uri} openSignal={openCollectionMenuSignal} />
            <PostActionsMenu
              postUri={post.uri}
              postCid={post.cid}
              authorDid={post.author.did}
              shareAuthorHandle={post.author.handle}
              rootUri={post.uri}
              isOwnPost={isOwnPost}
              compact
              verticalIcon
              className={styles.cardActionsMenu}
              open={actionsMenuOpen}
              onOpenChange={(open) => {
                setActionsMenuOpen(open)
                onActionsMenuOpenChange?.(open)
              }}
              dropdownRef={actionsMenuDropdownRef}
              feedLabel={feedLabel}
              postedAt={(post.record as { createdAt?: string })?.createdAt}
              onViewQuotes={openQuotesModal}
              onRemoveFromThisCollection={
                onRemovePostFromCollection ? () => onRemovePostFromCollection(post.uri) : undefined
              }
            />
          </div>
        )}
        {showFeedStyleActionRow && (
        <div className={styles.meta}>
          <div className={styles.cardActionRow} onClick={(e) => e.stopPropagation()}>
            <div className={styles.cardActionRowSpacer} aria-hidden="true" />
            <div className={styles.cardActionRowCenter}>
              <CollectionSaveMenu postUri={post.uri} openSignal={openCollectionMenuSignal} />
              {post.author.avatar && (
                isOwnPost || !session || isFollowingAuthor ? (
                  <ProfileLink
                    handle={handle}
                    className={styles.cardActionRowAvatar}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`View @${handle} profile`}
                  >
                    <ProgressiveImage src={post.author.avatar} alt="" loading="lazy" />
                  </ProfileLink>
                ) : (
                  <button
                    type="button"
                    className={`${styles.cardActionRowAvatar} ${styles.cardActionRowAvatarFollow}`}
                    onTouchStart={(e) => e.stopPropagation()}
                    onTouchEnd={(e) => e.stopPropagation()}
                    onClick={handleFollowClick}
                    disabled={followLoading}
                    aria-label={`Follow @${handle}`}
                    title={`Follow @${handle}`}
                  >
                    <ProgressiveImage src={post.author.avatar} alt="" loading="lazy" />
                    <span className={styles.cardActionRowAvatarPlus} aria-hidden>
                      <svg viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 2v4M2 4h4" />
                      </svg>
                    </span>
                  </button>
                )
              )}
              <button
                type="button"
                className={`${styles.cardLikeRepostBtn} ${isLiked ? styles.cardLikeRepostBtnActive : ''}`}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                onClick={handleLikeClick}
                disabled={likeLoading}
                title={isLiked ? 'Remove like' : 'Like'}
                aria-label={isLiked ? 'Remove like' : 'Like'}
              >
                {isLiked ? '♥' : '♡'}
              </button>
            </div>
            <div className={styles.cardActionRowRight}>
              <PostActionsMenu
                postUri={post.uri}
                postCid={post.cid}
                authorDid={post.author.did}
                shareAuthorHandle={post.author.handle}
                rootUri={post.uri}
                isOwnPost={isOwnPost}
                compact
                verticalIcon
                className={styles.cardActionsMenu}
                open={actionsMenuOpen}
                onOpenChange={(open) => {
                  setActionsMenuOpen(open)
                  onActionsMenuOpenChange?.(open)
                }}
                dropdownRef={actionsMenuDropdownRef}
                feedLabel={feedLabel}
                postedAt={(post.record as { createdAt?: string })?.createdAt}
                onViewQuotes={openQuotesModal}
                onRemoveFromThisCollection={
                  onRemovePostFromCollection ? () => onRemovePostFromCollection(post.uri) : undefined
                }
              />
            </div>
          </div>
          {!minimalist && (!artOnly || !feedPreviewActionRow) && (
          <div className={styles.handleBlock}>
            <div className={styles.handleRow}>
              {post.author.avatar ? (
                <ProgressiveImage src={post.author.avatar} alt="" className={styles.authorAvatar} loading="lazy" />
              ) : post.author.did ? (
                <span className={styles.authorAvatarPlaceholder} aria-hidden>
                  {(handle || post.author.did).slice(0, 1).toUpperCase()}
                </span>
              ) : null}
              <span className={styles.handleRowMain}>
                <span className={effectiveLikedUri ? styles.handleLinkWrapLiked : styles.handleLinkWrap}>
                  <ProfileLink
                    handle={handle}
                    className={styles.handleLink}
                    onClick={(e) => e.stopPropagation()}
                  >
                    @{handle}
                  </ProfileLink>
                </span>
                {(repostedByHandle || isQuotePost) && (
                  <span
                    className={styles.repostIconLink}
                    role="button"
                    tabIndex={0}
                    title={repostedByHandle ? `Reposted by @${repostedByHandle}` : 'Quote post'}
                    aria-label={repostedByHandle ? `Reposted by @${repostedByHandle}` : 'Quote post'}
                    onClick={(e) => { e.stopPropagation(); handleCardClick(e); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        openPost()
                      }
                    }}
                  >
                    <RepostIcon />
                  </span>
                )}
              </span>
              {isPinned ? (
                <span className={styles.handleRowMeta}>
                  <span className={styles.pinIconWrap} title="Pinned">
                    <PinIcon />
                  </span>
                </span>
              ) : null}
            </div>
          </div>
          )}
          {!minimalist && (!artOnly || !feedPreviewActionRow) && hasMedia && text ? (
            <p className={styles.text} onClick={(e) => { e.stopPropagation(); handleCardClick(e); }}>
              <PostText text={text} facets={(post.record as { facets?: unknown[] })?.facets} maxLength={80} stopPropagation interactive={false} />
            </p>
          ) : null}
        </div>
        )}
      </div>
    </div>
  )
}

/** When parent passes setUnblurred + isRevealed, we don't subscribe to ModerationContext so only this card re-renders on unblur (avoids slow profile-modal unblur). */
function PostCardWithContext(props: Props) {
  const { unblurredUris, setUnblurred } = useModeration()
  const isRevealed = unblurredUris.has(props.item.post.uri)
  return (
    <PostCardInner
      {...props}
      setUnblurred={setUnblurred}
      isRevealed={isRevealed}
    />
  )
}

function PostCard(props: Props) {
  if (props.setUnblurred != null && typeof props.isRevealed === 'boolean') {
    return (
      <PostCardInner
        {...props}
        setUnblurred={props.setUnblurred}
        isRevealed={props.isRevealed}
      />
    )
  }
  return <PostCardWithContext {...props} />
}

// Wrap PostCard with React.memo and custom comparison function
// to prevent re-renders when props haven't meaningfully changed
export default memo(PostCard, (prevProps, nextProps) => {
  // Return true if props are equal (should NOT re-render)
  // Return false if props are different (should re-render)
  
  // Check critical props that affect rendering
  if (prevProps.item.post.uri !== nextProps.item.post.uri) return false
  if (prevProps.isSelected !== nextProps.isSelected) return false
  if (prevProps.likedUriOverride !== nextProps.likedUriOverride) return false
  if (prevProps.seen !== nextProps.seen) return false
  if (prevProps.nsfwBlurred !== nextProps.nsfwBlurred) return false
  if (prevProps.isRevealed !== nextProps.isRevealed) return false
  if (prevProps.fillCell !== nextProps.fillCell) return false
  if (prevProps.constrainMediaHeight !== nextProps.constrainMediaHeight) return false
  if (prevProps.cardIndex !== nextProps.cardIndex) return false
  if (prevProps.actionsMenuOpenForIndex !== nextProps.actionsMenuOpenForIndex) return false
  if (prevProps.focusedMediaIndex !== nextProps.focusedMediaIndex) return false
  if (prevProps.profileAuthorDid !== nextProps.profileAuthorDid) return false
  if (prevProps.profileAuthorFollowingUri !== nextProps.profileAuthorFollowingUri) return false
  if (prevProps.onRemovePostFromCollection !== nextProps.onRemovePostFromCollection) return false
  if (prevProps.feedPreviewActionRow !== nextProps.feedPreviewActionRow) return false
  if (prevProps.openCollectionMenuSignal !== nextProps.openCollectionMenuSignal) return false

  // Check if the post content has changed (cid is the content identifier)
  if (prevProps.item.post.cid !== nextProps.item.post.cid) return false
  
  // Check if like/repost counts changed
  const prevLikeCount = prevProps.item.post.likeCount
  const nextLikeCount = nextProps.item.post.likeCount
  if (prevLikeCount !== nextLikeCount) return false
  
  const prevRepostCount = prevProps.item.post.repostCount
  const nextRepostCount = nextProps.item.post.repostCount
  if (prevRepostCount !== nextRepostCount) return false
  
  // All critical props are equal, skip re-render
  return true
})
