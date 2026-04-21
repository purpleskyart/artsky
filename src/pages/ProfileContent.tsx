import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSession } from '../context/SessionContext'
// Removed useProfileModal import to break circular dependency
import { useEditProfile } from '../context/EditProfileContext'
import { useModalTopBarSlot } from '../context/ModalTopBarSlotContext'
import { agent, publicAgent, isAgentAuthenticated, getPostMediaInfo, getPostMediaInfoForDisplay, getActorFeeds, listActivitySubscriptions, putActivitySubscription, isPostNsfw, getProfileCached, likePostWithLifecycle, unlikePostWithLifecycle, followAccountWithLifecycle, unfollowAccountWithLifecycle, type TimelineItem, type ProfileViewBasic } from '../lib/bsky'
import { setInitialPostForUri } from '../lib/postCache'
import { getPreloadedProfileSnapshot, getPreloadedFeedSnapshot, preloadPostOpen } from '../lib/modalPreload'
import PostCard from '../components/PostCard'
import ProfileColumn from '../components/ProfileColumn'
import { useModalScroll } from '../context/ModalScrollContext'
import PostText from '../components/PostText'
import ProfileActionsMenu from '../components/ProfileActionsMenu'
import BlockedAndMutedModal from '../components/BlockedAndMutedModal'
import { FollowListModal } from '../components/FollowListModal'
import { useViewMode, type ViewMode } from '../context/ViewModeContext'
import { useModeration, type NsfwPreference } from '../context/ModerationContext'
import { useHideReposts } from '../context/HideRepostsContext'
import { useLikeOverrides } from '../context/LikeOverridesContext'
import { useFollowOverrides } from '../context/FollowOverridesContext'
import { useToast } from '../context/ToastContext'
import { EyeOpenIcon, EyeHalfIcon, EyeClosedIcon } from '../components/Icons'
import { useColumnCount } from '../hooks/useViewportWidth'
import { usePostCardGridPointerGate } from '../hooks/usePostCardGridPointerGate'
import { pickAdjacentCardIndexByViewport } from '../lib/masonryHorizontalNav'
import { ProgressiveImage } from '../components/ProgressiveImage'
import styles from './ProfilePage.module.css'

const REASON_REPOST = 'app.bsky.feed.defs#reasonRepost'
const REASON_PIN = 'app.bsky.feed.defs#reasonPin'

const VIEW_MODE_CYCLE: ViewMode[] = ['1', '2', '3', 'a']

/** Profile lightbox: keep the masonry grid readable (All Columns on the full page can use more). */
const PROFILE_MODAL_MAX_MASONRY_COLS = 3

/** Nominal column width for height estimation (px). */
const ESTIMATE_COL_WIDTH = 280
const CARD_CHROME = 100

function estimateItemHeight(item: TimelineItem): number {
  const media = getPostMediaInfo(item.post)
  if (!media) return CARD_CHROME + 80
  if (media.aspectRatio != null && media.aspectRatio > 0) {
    return CARD_CHROME + ESTIMATE_COL_WIDTH / media.aspectRatio
  }
  return CARD_CHROME + 220
}

/** Distribute items so no column is much longer than others: cap count difference at 1, then pick by smallest estimated height. */
function distributeByHeight(
  items: TimelineItem[],
  numCols: number
): Array<Array<{ item: TimelineItem; originalIndex: number }>> {
  if (numCols < 1) return []
  const columns: Array<Array<{ item: TimelineItem; originalIndex: number }>> = Array.from(
    { length: numCols },
    () => []
  )
  const columnHeights: number[] = Array(numCols).fill(0)
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const h = estimateItemHeight(item)
    const lengths = columns.map((col) => col.length)
    const minCount = lengths.length === 0 ? 0 : Math.min(...lengths)
    let best = -1
    for (let c = 0; c < numCols; c++) {
      if (columns[c].length > minCount + 1) continue
      if (best === -1 || columnHeights[c] < columnHeights[best]) best = c
      else if (columnHeights[c] === columnHeights[best] && columns[c].length < columns[best].length) best = c
    }
    if (best === -1) best = 0
    columns[best].push({ item, originalIndex: i })
    columnHeights[best] += h
  }
  return columns
}

function indexAbove(
  columns: Array<Array<{ item: TimelineItem; originalIndex: number }>>,
  currentIndex: number
): number {
  for (let c = 0; c < columns.length; c++) {
    const row = columns[c].findIndex((e) => e.originalIndex === currentIndex)
    if (row > 0) return columns[c][row - 1].originalIndex
    if (row === 0) return currentIndex
  }
  return currentIndex
}

function indexBelow(
  columns: Array<Array<{ item: TimelineItem; originalIndex: number }>>,
  currentIndex: number
): number {
  for (let c = 0; c < columns.length; c++) {
    const row = columns[c].findIndex((e) => e.originalIndex === currentIndex)
    if (row >= 0 && row < columns[c].length - 1) return columns[c][row + 1].originalIndex
    if (row >= 0) return currentIndex
  }
  return currentIndex
}

/** Same row index in the neighbor column as the feed grid (structural, no DOM geometry). */
function indexLeftByRow(
  columns: Array<Array<{ item: TimelineItem; originalIndex: number }>>,
  currentIndex: number
): number {
  for (let c = 0; c < columns.length; c++) {
    const row = columns[c].findIndex((e) => e.originalIndex === currentIndex)
    if (row < 0) continue
    if (c === 0) return currentIndex
    const leftCol = columns[c - 1]
    if (leftCol.length === 0) return currentIndex
    const targetRow = Math.min(row, leftCol.length - 1)
    return leftCol[targetRow].originalIndex
  }
  return currentIndex
}

function indexRightByRow(
  columns: Array<Array<{ item: TimelineItem; originalIndex: number }>>,
  currentIndex: number
): number {
  for (let c = 0; c < columns.length; c++) {
    const row = columns[c].findIndex((e) => e.originalIndex === currentIndex)
    if (row < 0) continue
    if (c === columns.length - 1) return currentIndex
    const rightCol = columns[c + 1]
    if (rightCol.length === 0) return currentIndex
    const targetRow = Math.min(row, rightCol.length - 1)
    return rightCol[targetRow].originalIndex
  }
  return currentIndex
}

function ColumnIcon({ cols }: { cols: number }) {
  const safeCols = Math.max(1, Math.min(3, Math.floor(cols)))
  const w = 14
  const h = 12
  const gap = 2
  const barW = safeCols === 1 ? 4 : (w - (safeCols - 1) * gap) / safeCols
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="currentColor" aria-hidden>
      {safeCols === 1 && <rect x={(w - barW) / 2} y={0} width={barW} height={h} rx={1} />}
      {safeCols === 2 && (
        <>
          <rect x={0} y={0} width={barW} height={h} rx={1} />
          <rect x={barW + gap} y={0} width={barW} height={h} rx={1} />
        </>
      )}
      {safeCols === 3 && (
        <>
          <rect x={0} y={0} width={barW} height={h} rx={1} />
          <rect x={barW + gap} y={0} width={barW} height={h} rx={1} />
          <rect x={(barW + gap) * 2} y={0} width={barW} height={h} rx={1} />
        </>
      )}
    </svg>
  )
}

function NsfwEyeIcon({ mode }: { mode: NsfwPreference }) {
  if (mode === 'sfw') return <EyeClosedIcon size={24} />
  if (mode === 'blurred') return <EyeHalfIcon size={24} />
  return <EyeOpenIcon size={24} />
}

type ProfileTab = 'posts' | 'videos' | 'text' | 'replies' | 'reposts' | 'feeds'
type ProfilePostsFilter = 'all' | 'liked' | 'videos'

type ProfileState = {
  displayName?: string
  avatar?: string
  description?: string
  did: string
  viewer?: { following?: string; blocking?: string }
  verification?: { verifiedStatus?: string }
  createdAt?: string
  indexedAt?: string
}

type GeneratorView = { uri: string; displayName: string; description?: string; avatar?: string; likeCount?: number }

export default function ProfileContent({
  handle,
  openProfileModal: _openProfileModal,
  openPostModal,
  isModalOpen,
  inModal = false,
  onRegisterRefresh,
}: {
  handle: string
  openProfileModal: (h: string) => void
  openPostModal: (uri: string, openReply?: boolean, focusUri?: string, authorHandle?: string) => void
  isModalOpen: boolean
  /** When true, we are the profile popup content so keyboard shortcuts always apply. When false, skip if another modal (e.g. post) is open. */
  inModal?: boolean
  /** When in a modal, call with a function that refreshes this view (used for pull-to-refresh). */
  onRegisterRefresh?: (refresh: () => void | Promise<void>) => void
}) {
  const [tab, setTab] = useState<ProfileTab>('posts')
  const [profilePostsFilter, setProfilePostsFilter] = useState<ProfilePostsFilter>('all')
  const [items, setItems] = useState<TimelineItem[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [likedItems, setLikedItems] = useState<TimelineItem[]>([])
  const [likedCursor, setLikedCursor] = useState<string | undefined>()
  const [feeds, setFeeds] = useState<GeneratorView[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<ProfileState | null>(
    () => (getPreloadedProfileSnapshot(handle) as ProfileState | null) ?? null
  )
  const [followLoading, setFollowLoading] = useState(false)
  const [followUriOverride, setFollowUriOverride] = useState<string | null>(null)
  const [notificationSubscribed, setNotificationSubscribed] = useState<boolean | null>(null)
  const [notificationLoading, setNotificationLoading] = useState(false)
  const { session, sessionsList, switchAccount } = useSession()
  const toast = useToast()
  const { viewMode, setViewMode } = useViewMode()
  /** Use the live API agent only when it is actually authenticated (JWT or OAuth), not when storage is ahead of the agent after refresh/deploy. */
  const hasLiveBskyAuth = isAgentAuthenticated()
  const readAgent = hasLiveBskyAuth ? agent : publicAgent
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null)
  /** One sentinel per column so we load more when the user nears the bottom of any column (avoids blank space in short columns). */
  const loadMoreSentinelRefs = useRef<(HTMLDivElement | null)[]>([])
  const loadingMoreRef = useRef(false)
  const [tabsBarVisible] = useState(true)
  const [keyboardFocusIndex, setKeyboardFocusIndex] = useState(0)
  const [actionsMenuOpenForIndex, setActionsMenuOpenForIndex] = useState<number | null>(null)
  const [showBlockedMutedModal, setShowBlockedMutedModal] = useState(false)
  const [followListModal, setFollowListModal] = useState<'followers' | 'following' | 'mutuals' | 'followedByFollows' | null>(null)
  const [followeesWhoFollowPreview, setFolloweesWhoFollowPreview] = useState<ProfileViewBasic[] | null>(null)
  const [, setFolloweesWhoFollowLoading] = useState(false)
  const { likeOverrides, setLikeOverride } = useLikeOverrides()
  const { setFollowOverride } = useFollowOverrides()
  // openPostModal and isModalOpen are now passed as props to avoid circular dependency
  const modalScrollRef = useModalScroll()
  const gridRef = useRef<HTMLDivElement | null>(null)
  const editProfileCtx = useEditProfile()
  const topBarSlots = useModalTopBarSlot()
  const topBarRightSlot = topBarSlots?.rightSlot ?? null
  const openEditProfile = editProfileCtx?.openEditProfile ?? (() => {})
  const editSavedVersion = editProfileCtx?.editSavedVersion ?? 0
  const cardRefsRef = useRef<(HTMLDivElement | null)[]>([])
  const keyboardFocusIndexRef = useRef(0)
  const profileGridItemsRef = useRef<TimelineItem[]>([])
  const scrollIntoViewFromKeyboardRef = useRef(false)
  const lastScrollIntoViewIndexRef = useRef(-1)
  const { beginKeyboardNavigation, tryHoverSelectCard, gridPointerGateProps } = usePostCardGridPointerGate()

  /** Bumped after follow/unfollow (and grid follow sync) so a slow in-flight getProfile cannot overwrite viewer state. */
  const profileFetchGenRef = useRef(0)

  useEffect(() => {
    setFollowUriOverride(null)
  }, [session?.did])

  useEffect(() => {
    setProfile((getPreloadedProfileSnapshot(handle) as ProfileState | null) ?? null)
    if (!handle) return
    const gen = ++profileFetchGenRef.current
    let cancelled = false
    getProfileCached(handle, !session)
      .then((data) => {
        if (cancelled || gen !== profileFetchGenRef.current) return
        const profileData = data as { did?: string; displayName?: string; avatar?: string; description?: string; viewer?: { following?: string; blocking?: string }; verification?: { verifiedStatus?: string }; createdAt?: string; indexedAt?: string }
        if (!profileData.did) return
        setProfile({
          displayName: profileData.displayName,
          avatar: profileData.avatar,
          description: profileData.description,
          did: profileData.did,
          viewer: profileData.viewer,
          verification: profileData.verification,
          createdAt: profileData.createdAt,
          indexedAt: profileData.indexedAt,
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [handle, session?.did, editSavedVersion])

  // Lazy-load notification subscription status only when user hovers/focuses the bell (saves 1 API call per profile open)
  const notificationStatusFetchedRef = useRef(false)
  const fetchNotificationStatus = useCallback(() => {
    if (!session || !profile || session.did === profile.did || notificationStatusFetchedRef.current) return
    notificationStatusFetchedRef.current = true
    listActivitySubscriptions()
      .then((subs) => setNotificationSubscribed(subs.some((s) => s.did === profile.did)))
      .catch(() => setNotificationSubscribed(null))
  }, [session, profile?.did])
  useEffect(() => {
    if (!session || !profile) setNotificationSubscribed(null)
    notificationStatusFetchedRef.current = false
  }, [session?.did, profile?.did])

  // REMOVED: getFolloweesWhoFollowTarget API call to reduce profile load requests
  // This was fetching "Followed by X, Y you follow" preview - not essential for initial load
  useEffect(() => {
    // Always set to null/false - no API call
    setFolloweesWhoFollowPreview(null)
    setFolloweesWhoFollowLoading(false)
  }, [session?.did, profile?.did])

  const load = useCallback(async (nextCursor?: string) => {
    if (!handle) return
    try {
      if (nextCursor) setLoadingMore(true)
      else setLoading(true)
      setError(null)

      // Check for preloaded feed data on initial load
      if (!nextCursor) {
        const preloaded = getPreloadedFeedSnapshot(handle)
        if (preloaded) {
          setItems(preloaded.feed)
          setCursor(preloaded.cursor)
          setLoading(false)
          return
        }
      }

      const res = await readAgent.getAuthorFeed({ actor: handle, limit: 20, cursor: nextCursor, includePins: true })
      const feed = (res.data.feed ?? []) as TimelineItem[]
      setItems((prev) => (nextCursor ? [...prev, ...feed] : feed))
      setCursor(res.data.cursor ?? undefined)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load profile')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [handle, readAgent])

  /** Ref for initial load so we only run once per handle (avoids duplicate getAuthorFeed when session loads after mount). */
  const loadRef = useRef(load)
  loadRef.current = load

  const loadFeeds = useCallback(async () => {
    if (!handle) return
    try {
      setLoading(true)
      setError(null)
      const list = await getActorFeeds(handle, 20)
      setFeeds(list)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load feeds')
      setFeeds([])
    } finally {
      setLoading(false)
    }
  }, [handle])

  const loadLiked = useCallback(async (nextCursor?: string) => {
    if (!handle || !session || !profile || session.did !== profile.did) return
    try {
      if (nextCursor) setLoadingMore(true)
      else setLoading(true)
      setError(null)
      const res = await agent.getActorLikes({ actor: handle, limit: 30, cursor: nextCursor })
      const feed = (res.data.feed ?? []) as TimelineItem[]
      setLikedItems((prev) => (nextCursor ? [...prev, ...feed] : feed))
      setLikedCursor(res.data.cursor ?? undefined)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load liked posts')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [handle, profile?.did, session?.did])

  const prevAuthorFeedHandleRef = useRef<string | undefined>(undefined)
  // Initial / refetch author feed: depend on handle and live agent auth (not React session alone — storage can be ahead of the agent after refresh).
  useEffect(() => {
    if (!handle) return
    const prev = prevAuthorFeedHandleRef.current
    prevAuthorFeedHandleRef.current = handle
    const handleChanged = prev !== undefined && prev !== handle
    if (handleChanged) {
      setProfile(null)
      setFollowUriOverride(null)
      setTab('posts')
      setProfilePostsFilter('all')
      setLikedItems([])
      setLikedCursor(undefined)
    }
    loadRef.current()
  }, [handle, hasLiveBskyAuth])

  useEffect(() => {
    if (profilePostsFilter === 'liked' && handle && session && profile && session.did === profile.did) {
      loadLiked()
    }
  }, [profilePostsFilter, handle, profile?.did, session?.did, loadLiked])

  useEffect(() => {
    if (tab === 'feeds') loadFeeds()
  }, [tab, loadFeeds])

  // Pull-to-refresh: only refresh the active tab (1 request instead of 4) to avoid rate limits.
  // Store latest handlers in refs so we don't depend on onRegisterRefresh (parent often passes inline fn → new ref every render → loop).
  const onRegisterRefreshRef = useRef(onRegisterRefresh)
  onRegisterRefreshRef.current = onRegisterRefresh
  const refreshImplRef = useRef<() => void | Promise<void>>(() => Promise.resolve())
  refreshImplRef.current = async () => {
    if (tab === 'feeds') await loadFeeds()
    else if (tab === 'posts' && profilePostsFilter === 'liked') await loadLiked()
    else await load()
  }
  useEffect(() => {
    onRegisterRefreshRef.current?.(() => refreshImplRef.current?.())
  }, [tab, profilePostsFilter])

  // Infinite scroll: load more when any column's sentinel is about to enter view (posts, reposts tabs).
  // Per-column sentinels when cols >= 2 so short columns trigger load before blank space; 800px
  // rootMargin to load before user sees empty space. Fallback timer handles the case where a very
  // tall post pushes short-column sentinels beyond rootMargin and the observer never sees them.
  loadingMoreRef.current = loadingMore
  const colsUncapped = useColumnCount(viewMode, 150)
  const cols = inModal ? Math.min(colsUncapped, PROFILE_MODAL_MAX_MASONRY_COLS) : colsUncapped
  const loadMoreCursor = tab === 'posts' && profilePostsFilter === 'liked' ? likedCursor : cursor
  const loadMore = tab === 'posts' && profilePostsFilter === 'liked' ? (c: string) => loadLiked(c) : load
  useEffect(() => {
    if (tab !== 'posts' && tab !== 'videos' && tab !== 'replies' && tab !== 'reposts') return
    if (!loadMoreCursor) return
    const firstSentinel = cols >= 2 ? loadMoreSentinelRefs.current[0] : loadMoreSentinelRef.current
    const root = inModal ? firstSentinel?.closest('[data-modal-scroll]') ?? null : null
    let retryId = 0
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !loadingMoreRef.current) {
            loadingMoreRef.current = true
            loadMore(loadMoreCursor)
            break
          }
        }
      },
      { root: root ?? undefined, rootMargin: '800px', threshold: 0 }
    )
    if (cols >= 2) {
      const refs = loadMoreSentinelRefs.current
      for (let c = 0; c < cols; c++) {
        const el = refs[c]
        if (el) observer.observe(el)
      }
      // Fallback: if any column's sentinel scrolled beyond rootMargin (very tall post), check after a short delay.
      retryId = window.setTimeout(() => {
        if (loadingMoreRef.current) return
        const rootBottom = root ? root.getBoundingClientRect().bottom : window.innerHeight
        for (let c = 0; c < cols; c++) {
          const el = refs[c]
          if (!el) continue
          if (el.getBoundingClientRect().bottom < rootBottom) {
            loadingMoreRef.current = true
            loadMore(loadMoreCursor)
            return
          }
        }
      }, 200)
    } else {
      const sentinel = loadMoreSentinelRef.current
      if (sentinel) observer.observe(sentinel)
    }
    return () => {
      observer.disconnect()
      clearTimeout(retryId)
    }
  }, [tab, profilePostsFilter, loadMoreCursor, load, loadLiked, loadMore, inModal, cols])

  const followingUri = profile?.viewer?.following ?? followUriOverride
  const isFollowing = !!followingUri
  const isOwnProfile = !!session && !!profile && session.did === profile.did
  const showFollowButton = !!session && !!profile && !isOwnProfile

  // Check if this profile's handle matches a saved account that can be switched to
  const matchingSavedAccount = useMemo(() => {
    if (!handle || !sessionsList.length) return null
    const normalizedHandle = handle.toLowerCase().replace(/^@/, '')
    return sessionsList.find(s => {
      const sessionHandle = (s as { handle?: string }).handle?.toLowerCase()
      return sessionHandle === normalizedHandle
    })
  }, [handle, sessionsList])

  const canSwitchToAccount = matchingSavedAccount && !isOwnProfile

  const handleSwitchToAccount = useCallback(async () => {
    if (!matchingSavedAccount) return
    const ok = await switchAccount(matchingSavedAccount.did)
    if (!ok && toast) {
      toast.showToast('Could not switch account. Sign in again.')
    }
  }, [matchingSavedAccount, switchAccount, toast])

  const isRepost = (item: TimelineItem) => (item.reason as { $type?: string })?.$type === REASON_REPOST
  const isPinned = (item: TimelineItem) => (item.reason as { $type?: string })?.$type === REASON_PIN
  const isQuotePost = (item: TimelineItem) => {
    const embed = (item.post as { embed?: { $type?: string } })?.embed
    return !!embed && (embed.$type === 'app.bsky.embed.record#view' || embed.$type === 'app.bsky.embed.recordWithMedia#view')
  }
  const isVideoPost = (item: TimelineItem) => {
    const mediaInfo = getPostMediaInfoForDisplay(item.post)
    return mediaInfo?.type === 'video'
  }
  const isReply = (item: TimelineItem) => !!(item.post.record as { reply?: unknown })?.reply
  /* Posts tab: original posts with media (no replies, no reposts) + quote posts with media.
     Videos tab: video posts only (no replies, no reposts).
     Text tab: text-only posts (no media, no replies, no reposts).
     Replies tab: reply posts.
     Reposts tab: reposts only.
  */
  const postsSource = profilePostsFilter === 'liked' ? likedItems : items
  const authorFeedItemsRaw =
    tab === 'posts'
      ? profilePostsFilter === 'liked'
        ? likedItems
        : postsSource.filter((i) => !isRepost(i) && !isReply(i) && (!isQuotePost(i) || !!getPostMediaInfo(i.post)))
      : tab === 'videos'
        ? postsSource.filter((i) => !isRepost(i) && !isReply(i) && isVideoPost(i))
        : tab === 'text'
          ? postsSource.filter((i) => !isRepost(i) && !isReply(i) && !getPostMediaInfoForDisplay(i.post))
          : tab === 'replies'
            ? items.filter((i) => isReply(i) && !isRepost(i))
            : tab === 'reposts'
              ? items.filter((i) => isRepost(i))
              : items
  const authorFeedItems =
    tab === 'posts' || tab === 'videos'
      ? [...authorFeedItemsRaw].sort((a, b) => (isPinned(b) ? 1 : 0) - (isPinned(a) ? 1 : 0))
      : authorFeedItemsRaw
  const mediaByPostUri = useMemo(() => {
    const out = new Map<string, ReturnType<typeof getPostMediaInfoForDisplay>>()
    const record = (list: TimelineItem[]) => {
      for (const item of list) {
        const uri = item.post.uri
        if (!uri || out.has(uri)) continue
        out.set(uri, getPostMediaInfoForDisplay(item.post))
      }
    }
    record(items)
    record(likedItems)
    record(authorFeedItems)
    return out
  }, [items, likedItems, authorFeedItems])
  const { nsfwPreference, cycleNsfwPreference, unblurredUris, setUnblurred } = useModeration()
  const mediaItems = authorFeedItems
    .filter((item) => mediaByPostUri.get(item.post.uri))
    .filter((item) => nsfwPreference !== 'sfw' || !isPostNsfw(item.post))
  const profileGridItems = mediaItems

  // Prefetch first few posts when profile loads for instant feel on first clicks
  useEffect(() => {
    if (profileGridItems.length === 0) return
    // Prefetch first 5 posts (mobile users scroll more, need more coverage)
    const itemsToPrefetch = profileGridItems.slice(0, 5)
    for (const item of itemsToPrefetch) {
      preloadPostOpen(item.post.uri)
    }
  }, [profileGridItems])

  /* For modal: which tabs have content (hide empty categories) */
  const tabHasContent = useMemo(() => {
    const postsSource = profilePostsFilter === 'liked' ? likedItems : items
    // Posts: all media posts (images + videos)
    const postsMedia = profilePostsFilter === 'liked'
      ? postsSource
      : postsSource.filter((i) => !isRepost(i) && !isReply(i) && (!isQuotePost(i) || !!getPostMediaInfo(i.post)))
        .filter((i) => mediaByPostUri.get(i.post.uri))
        .filter((i) => nsfwPreference !== 'sfw' || !isPostNsfw(i.post))
    // Videos: video posts only
    const videoPosts = postsSource.filter((i) => !isRepost(i) && !isReply(i) && isVideoPost(i))
      .filter((i) => nsfwPreference !== 'sfw' || !isPostNsfw(i.post))
    // Text: text-only posts (no media, no replies, no reposts)
    const textOnly = postsSource.filter((i) => !isRepost(i) && !isReply(i) && !mediaByPostUri.get(i.post.uri))
      .filter((i) => {
        const text = (i.post.record as { text?: string })?.text?.trim() ?? ''
        return text.length > 0
      })
    // Replies: reply posts (not reposts)
    const repliesOnly = items.filter((i) => isReply(i) && !isRepost(i))
    // Reposts: reposts only
    const repostsOnly = items.filter((i) => isRepost(i))
    return {
      posts: postsMedia.length > 0,
      videos: videoPosts.length > 0,
      text: textOnly.length > 0,
      replies: repliesOnly.length > 0,
      reposts: repostsOnly.length > 0,
      feeds: feeds.length > 0,
    }
  }, [items, likedItems, profilePostsFilter, feeds, nsfwPreference, mediaByPostUri])

  const visibleTabs = useMemo((): ProfileTab[] => {
    const t: ProfileTab[] = []
    if (tabHasContent.posts || isOwnProfile) t.push('posts')
    if (tabHasContent.videos) t.push('videos')
    if (tabHasContent.text) t.push('text')
    if (tabHasContent.replies) t.push('replies')
    if (tabHasContent.reposts) t.push('reposts')
    if (tabHasContent.feeds) t.push('feeds')
    return t
  }, [tabHasContent, isOwnProfile])

  useEffect(() => {
    if (loading || visibleTabs.length === 0) return
    if (!visibleTabs.includes(tab)) setTab(visibleTabs[0])
  }, [loading, visibleTabs, tab])
  profileGridItemsRef.current = profileGridItems
  keyboardFocusIndexRef.current = keyboardFocusIndex

  useEffect(() => {
    setKeyboardFocusIndex((i) => (profileGridItems.length ? Math.min(i, profileGridItems.length - 1) : 0))
  }, [profileGridItems.length])

  useEffect(() => {
    if (!scrollIntoViewFromKeyboardRef.current) return
    scrollIntoViewFromKeyboardRef.current = false
    if (keyboardFocusIndex === lastScrollIntoViewIndexRef.current) return
    lastScrollIntoViewIndexRef.current = keyboardFocusIndex
    const index = keyboardFocusIndex
    const raf = requestAnimationFrame(() => {
      const el = cardRefsRef.current[index]
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    })
    return () => cancelAnimationFrame(raf)
  }, [keyboardFocusIndex])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      /* When on full page, don't steal keys if another modal (e.g. post) is open. When we are the profile popup (inModal), always handle. */
      if (!inModal && isModalOpen) return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) {
        if (e.key === 'Escape') {
          e.preventDefault()
          target.blur()
        }
        return
      }
      if (e.ctrlKey || e.metaKey) return
      const gridTab = tab === 'posts' || tab === 'videos' || tab === 'replies' || tab === 'reposts'
      if (!gridTab) return

      const items = profileGridItemsRef.current
      if (items.length === 0) return
      const i = keyboardFocusIndexRef.current
      const key = e.key.toLowerCase()
      const focusInNotificationsMenu = (document.activeElement as HTMLElement)?.closest?.('[data-notifications-list]')
      const notificationsMenuOpen = document.querySelector('[data-notifications-list]') != null
      if ((focusInNotificationsMenu || notificationsMenuOpen) && (key === 'w' || key === 's' || key === 'e' || key === 'o' || key === 'enter' || key === 'q' || key === 'u' || key === 'backspace' || key === 'escape' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        return
      }
      if (key === 'w' || key === 's' || key === 'a' || key === 'd' || key === 'i' || key === 'j' || key === 'k' || key === 'l' || key === 'e' || key === 'o' || key === 'enter' || key === 'f' || key === 'm' || key === '`' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.preventDefault()

      if (key === 'w' || key === 'i' || e.key === 'ArrowUp') {
        beginKeyboardNavigation()
        scrollIntoViewFromKeyboardRef.current = true
        if (cols >= 2) {
          const columns = distributeByHeight(items, cols)
          setKeyboardFocusIndex((idx) => indexAbove(columns, idx))
        } else {
          setKeyboardFocusIndex((idx) => Math.max(0, idx - 1))
        }
        return
      }
      if (key === 's' || key === 'k' || e.key === 'ArrowDown') {
        beginKeyboardNavigation()
        scrollIntoViewFromKeyboardRef.current = true
        if (cols >= 2) {
          const columns = distributeByHeight(items, cols)
          setKeyboardFocusIndex((idx) => indexBelow(columns, idx))
        } else {
          setKeyboardFocusIndex((idx) => Math.min(items.length - 1, idx + 1))
        }
        return
      }
      if (key === 'a' || key === 'j' || e.key === 'ArrowLeft' || key === 'd' || key === 'l' || e.key === 'ArrowRight') {
        beginKeyboardNavigation()
        scrollIntoViewFromKeyboardRef.current = true
        setActionsMenuOpenForIndex(null)
        const goLeft = key === 'a' || key === 'j' || e.key === 'ArrowLeft'
        if (cols >= 2) {
          const columns = distributeByHeight(items, cols)
          const idx = keyboardFocusIndexRef.current
          const measure = (cardIndex: number) => {
            const el = cardRefsRef.current[cardIndex]
            if (!el) return null
            const r = el.getBoundingClientRect()
            if (r.width <= 0 && r.height <= 0) return null
            return { top: r.top, left: r.left, width: r.width, height: r.height }
          }
          setKeyboardFocusIndex(
            pickAdjacentCardIndexByViewport(columns, goLeft ? -1 : 1, idx, measure) ??
              (goLeft ? indexLeftByRow(columns, idx) : indexRightByRow(columns, idx)),
          )
        } else {
          setKeyboardFocusIndex((idx) =>
            goLeft ? Math.max(0, idx - 1) : Math.min(items.length - 1, idx + 1),
          )
        }
        return
      }
      if ((key === 'm' || key === '`') && i >= 0) {
        const menuOpenForFocusedCard = actionsMenuOpenForIndex === i
        if (menuOpenForFocusedCard) {
          setActionsMenuOpenForIndex(null)
        } else {
          setActionsMenuOpenForIndex(i)
        }
        return
      }
      if (key === 'e' || key === 'o' || key === 'enter') {
        const item = items[i]
        if (item) openPostModal(item.post.uri, undefined, undefined, item.post.author?.handle)
        return
      }
      if (key === 'f') {
        const item = items[i]
        if (!item?.post?.author) return
        const author = item.post.author as { did: string; viewer?: { following?: string } }
        if (!session || session.did === author.did) return
        const followingUri = author.viewer?.following
        if (followingUri) {
          unfollowAccountWithLifecycle(followingUri).then(() => {
            setItems((prev) =>
              prev.map((it) => {
                if (it.post.uri !== item.post.uri) return it
                const post = it.post
                const auth = post.author as { did: string; handle?: string; viewer?: { following?: string } }
                return {
                  ...it,
                  post: {
                    ...post,
                    author: {
                      ...auth,
                      viewer: { ...auth.viewer, following: undefined },
                    },
                  } as TimelineItem['post'],
                }
              })
            )
          }).catch(() => {})
        } else {
          followAccountWithLifecycle(author.did).then((res) => {
            setItems((prev) =>
              prev.map((it) => {
                if (it.post.uri !== item.post.uri) return it
                const post = it.post
                const auth = post.author as { did: string; handle?: string; viewer?: { following?: string } }
                return {
                  ...it,
                  post: {
                    ...post,
                    author: {
                      ...auth,
                      viewer: { ...auth.viewer, following: res.uri },
                    },
                  } as TimelineItem['post'],
                }
              })
            )
          }).catch(() => {})
        }
        return
      }
      if (e.code === 'Space' && inModal) {
        const item = items[i]
        if (!item?.post?.uri || !item?.post?.cid) return
        const uri = item.post.uri
        const currentLikeUri = uri in likeOverrides ? (likeOverrides[uri] ?? undefined) : (item.post as { viewer?: { like?: string } }).viewer?.like
        if (currentLikeUri) {
          unlikePostWithLifecycle(currentLikeUri, uri).then(() => {
            setLikeOverride(uri, null)
          }).catch(() => {})
        } else {
          likePostWithLifecycle(uri, item.post.cid).then((res) => {
            setLikeOverride(uri, res.uri)
          }).catch(() => {})
        }
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [beginKeyboardNavigation, tab, cols, isModalOpen, openPostModal, inModal, likeOverrides, actionsMenuOpenForIndex, setLikeOverride, session, setItems])

  const postText = (post: TimelineItem['post']) => (post.record as { text?: string })?.text?.trim() ?? ''
  const textItems = authorFeedItems.filter(
    (item) =>
      postText(item.post).length > 0 &&
      !mediaByPostUri.get(item.post.uri) &&
      !isReply(item),
  )

  async function handleFollow() {
    if (!profile || followLoading || isFollowing) return
    setFollowLoading(true)
    try {
      const res = await followAccountWithLifecycle(profile.did)
      profileFetchGenRef.current += 1
      setFollowUriOverride(res.uri)
      setFollowOverride(profile.did, res.uri)
    } catch {
      // leave state unchanged so user can retry
    } finally {
      setFollowLoading(false)
    }
  }

  async function handleUnfollow() {
    if (!followingUri || followLoading) return
    setFollowLoading(true)
    try {
      await unfollowAccountWithLifecycle(followingUri)
      profileFetchGenRef.current += 1
      setFollowUriOverride(null)
      setFollowOverride(profile!.did, null)
      setProfile((prev) =>
        prev ? { ...prev, viewer: { ...prev.viewer, following: undefined } } : null,
      )
    } catch {
      // leave state unchanged so user can retry
    } finally {
      setFollowLoading(false)
    }
  }

  const onProfileAuthorFollowChange = useCallback((followRecordUri: string | null) => {
    profileFetchGenRef.current += 1
    setFollowUriOverride(followRecordUri)
    setProfile((prev) =>
      prev ? { ...prev, viewer: { ...prev.viewer, following: followRecordUri ?? undefined } } : null,
    )
  }, [])

  async function handleNotificationToggle() {
    if (!profile || notificationLoading) return
    const next = !notificationSubscribed
    setNotificationLoading(true)
    try {
      await putActivitySubscription(profile.did, next)
      setNotificationSubscribed(next)
    } catch {
      // leave state unchanged so user can retry
    } finally {
      setNotificationLoading(false)
    }
  }

  const hideReposts = useHideReposts()
  const hideRepostsFromThisUser = !!profile && hideReposts?.isHidingRepostsFrom(profile.did)
  const showNotificationBell = !!session && !!profile && !isOwnProfile && isFollowing

  return (
    <>
      <div className={`${styles.wrap} ${inModal ? styles.wrapInModal : ''}`}>
        <header className={styles.profileHeader}>
          <div className={styles.profileHeaderMain}>
            {profile?.avatar && (
              <ProgressiveImage src={profile.avatar} alt="" className={styles.avatar} loading="lazy" root={modalScrollRef} />
            )}
            <div className={styles.profileMeta}>
              {profile?.displayName && (
                <h2 className={styles.displayName}>{profile.displayName}</h2>
              )}
              <div className={styles.handleRow}>
                {canSwitchToAccount ? (
                  <button
                    type="button"
                    className={`${styles.handle} ${styles.handleClickable}`}
                    onClick={handleSwitchToAccount}
                    title={`Switch to @${handle}`}
                  >
                    @{handle}
                  </button>
                ) : (
                  <p className={styles.handle}>
                    @{handle}
                  </p>
                )}
                {isOwnProfile && (
                  <>
                    <button
                      type="button"
                      className={styles.followBtn}
                      onClick={openEditProfile}
                      title="Edit profile"
                    >
                      Edit profile
                    </button>
                    <button
                      type="button"
                      className={styles.blockedMutedBtn}
                      onClick={() => setShowBlockedMutedModal(true)}
                      title="View blocked accounts and muted words"
                    >
                      Blocked & muted
                    </button>
                  </>
                )}
                <div className={styles.followNotifyRow}>
                  {showFollowButton &&
                    (isFollowing ? (
                      <button
                        type="button"
                        className={`${styles.followBtn} ${styles.followBtnFollowing}`}
                        onClick={handleUnfollow}
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
                        onClick={handleFollow}
                        disabled={followLoading}
                      >
                        {followLoading ? 'Following…' : 'Follow'}
                      </button>
                    ))}
                  {showNotificationBell && (
                    <button
                      type="button"
                      className={`${styles.notificationBellBtn} ${notificationSubscribed ? styles.notificationBellBtnActive : ''}`}
                      onClick={handleNotificationToggle}
                      onMouseEnter={fetchNotificationStatus}
                      onFocus={fetchNotificationStatus}
                      disabled={notificationLoading}
                      title={notificationSubscribed ? 'Stop notifications for this account' : 'Get notifications when this account posts'}
                      aria-label={notificationSubscribed ? 'Stop notifications' : 'Notify when they post'}
                    >
                      {notificationSubscribed ? (
                        <svg className={styles.notificationBellIcon} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                          <path d="M12 2C10.9 2 10 2.9 10 4v.7c-2.5.4-4.4 2.6-4.4 5.2v4.4l-1.8 1.8c-.4.4-.4 1 0 1.4.2.2.5.3.7.3s.5-.1.7-.3l.2-.2h7.2l.2.2c.4.4 1 .4 1.4 0s.4-1 0-1.4l-1.8-1.8V9.9c0-2.6-1.9-4.8-4.4-5.2V4c0-1.1-.9-2-2-2zm0 18c-1.1 0-2-.9-2-2h4c0 1.1-.9 2-2 2z" />
                        </svg>
                      ) : (
                        <svg className={styles.notificationBellIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                        </svg>
                      )}
                    </button>
                  )}
                </div>
              </div>
              {profile?.description && (
                <p className={styles.description}>
                  <PostText text={profile.description} />
                </p>
              )}
              {profile && (
                <>
                  <div className={styles.followListRow} role="group" aria-label="Followers, following, and mutuals">
                    <button
                      type="button"
                      className={styles.followListBtn}
                      onClick={() => setFollowListModal('followers')}
                    >
                      Followers
                    </button>
                    <button
                      type="button"
                      className={styles.followListBtn}
                      onClick={() => setFollowListModal('following')}
                    >
                      Following
                    </button>
                    {isOwnProfile && (
                      <button
                        type="button"
                        className={styles.followListBtn}
                        onClick={() => setFollowListModal('mutuals')}
                      >
                        Mutuals
                      </button>
                    )}
                  </div>
                  {!isOwnProfile && followeesWhoFollowPreview && followeesWhoFollowPreview.length > 0 && (
                    <button
                      type="button"
                      className={styles.followedByFollowsPreview}
                      onClick={() => setFollowListModal('followedByFollows')}
                    >
                      <span className={styles.followedByFollowsAvatars}>
                        {followeesWhoFollowPreview.slice(0, 2).map((p) =>
                          p.avatar ? (
                            <ProgressiveImage
                              key={p.did}
                              src={p.avatar}
                              alt=""
                              className={styles.followedByFollowsAvatar}
                              loading="lazy"
                              root={modalScrollRef}
                            />
                          ) : (
                            <span
                              key={p.did}
                              className={styles.followedByFollowsAvatarPlaceholder}
                              aria-hidden
                            >
                              {(p.displayName ?? p.handle ?? p.did).slice(0, 1).toUpperCase()}
                            </span>
                          )
                        )}
                      </span>
                      <span className={styles.followedByFollowsText}>
                        {followeesWhoFollowPreview.length === 1
                          ? `Followed by @${followeesWhoFollowPreview[0].handle ?? followeesWhoFollowPreview[0].did} you follow`
                          : followeesWhoFollowPreview.length === 2
                            ? `Followed by @${followeesWhoFollowPreview[0].handle ?? followeesWhoFollowPreview[0].did}, @${followeesWhoFollowPreview[1].handle ?? followeesWhoFollowPreview[1].did} you follow`
                            : `Followed by @${followeesWhoFollowPreview[0].handle ?? followeesWhoFollowPreview[0].did}, @${followeesWhoFollowPreview[1].handle ?? followeesWhoFollowPreview[1].did} + ${followeesWhoFollowPreview.length - 2} more you follow`}
                      </span>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          {profile && (
            <ProfileActionsMenu
              profileDid={profile.did}
              profileHandle={handle}
              isOwnProfile={isOwnProfile}
              isFollowing={isFollowing}
              hideRepostsFromThisUser={hideRepostsFromThisUser}
              onToggleHideReposts={hideReposts ? () => hideReposts.toggleHideRepostsFrom(profile.did) : undefined}
              initialProfileMeta={{ createdAt: profile.createdAt, indexedAt: profile.indexedAt }}
              initialAuthorBlockingUri={profile.viewer?.blocking ?? null}
              className={styles.profileMenu}
            />
          )}
        </header>
        {showBlockedMutedModal && (
          <BlockedAndMutedModal onClose={() => setShowBlockedMutedModal(false)} />
        )}
        {followListModal && profile && (
          <FollowListModal
            mode={followListModal}
            actor={profile.did}
            onClose={() => setFollowListModal(null)}
            viewerDid={followListModal === 'followedByFollows' ? session?.did : undefined}
            authenticatedClient={followListModal === 'followedByFollows' ? agent : undefined}
          />
        )}
        {inModal && topBarRightSlot
          ? createPortal(
              <div className={styles.modalBottomBarButtons}>
                <button
                  type="button"
                  className={`${styles.toggleBtn} ${styles.toggleBtnBottomBar} ${styles.toggleBtnIcon}`}
                  onClick={() => {
                    const i = VIEW_MODE_CYCLE.indexOf(viewMode)
                    setViewMode(VIEW_MODE_CYCLE[(i + 1) % VIEW_MODE_CYCLE.length])
                  }}
                  title={`${viewMode} column(s). Click to cycle.`}
                  aria-label={`${viewMode} columns`}
                >
                  <ColumnIcon cols={cols} />
                </button>
                <button
                  type="button"
                  className={`${styles.toggleBtn} ${styles.toggleBtnBottomBar} ${styles.toggleBtnIcon} ${nsfwPreference !== 'sfw' ? styles.toggleBtnActive : ''}`}
                  onClick={(e) => cycleNsfwPreference(e.currentTarget)}
                  title={`${nsfwPreference}. Click to cycle: SFW → Blurred → NSFW`}
                  aria-label={`NSFW filter: ${nsfwPreference}`}
                >
                  <NsfwEyeIcon mode={nsfwPreference} />
                </button>
              </div>,
              topBarRightSlot,
            )
          : null}
        {!inModal && (
          <div className={`${styles.tabsSticky} ${tabsBarVisible ? '' : styles.tabsBarHidden}`}>
            <nav className={styles.tabs} aria-label="Profile sections">
              {visibleTabs.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
                  onClick={() => setTab(t)}
                >
                  {t === 'posts' ? 'Posts' : t === 'videos' ? 'Videos' : t === 'text' ? 'Text' : t === 'replies' ? 'Replies' : t === 'reposts' ? 'Reposts' : 'Feeds'}
                </button>
              ))}
              {isOwnProfile && (
                <button
                  type="button"
                  className={`${styles.tab} ${profilePostsFilter === 'liked' ? styles.tabActive : ''}`}
                  onClick={() => {
                    setProfilePostsFilter((prev) => (prev === 'liked' ? 'all' : 'liked'))
                    setTab('posts')
                  }}
                  title={profilePostsFilter === 'liked' ? 'Show my posts' : 'Show liked posts'}
                >
                  Liked
                </button>
              )}
            </nav>
          </div>
        )}
        {inModal && (
          <div className={styles.tabsRowInModal}>
            <nav className={`${styles.tabs} ${styles.tabsInModal}`} aria-label="Profile sections">
              {visibleTabs.map((t) => (
              <button
                key={t}
                type="button"
                className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
                onClick={() => setTab(t)}
              >
                {t === 'posts' ? 'Posts' : t === 'videos' ? 'Videos' : t === 'text' ? 'Text' : t === 'replies' ? 'Replies' : t === 'reposts' ? 'Reposts' : 'Feeds'}
              </button>
              ))}
              {isOwnProfile && (
                <button
                  type="button"
                  className={`${styles.tab} ${profilePostsFilter === 'liked' ? styles.tabActive : ''}`}
                  onClick={() => {
                    setProfilePostsFilter((prev) => (prev === 'liked' ? 'all' : 'liked'))
                    setTab('posts')
                  }}
                  title={profilePostsFilter === 'liked' ? 'Show my posts' : 'Show liked posts'}
                >
                  Liked
                </button>
              )}
            </nav>
          </div>
        )}
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.profileContent}>
          {tab === 'text' ? (
            textItems.length === 0 ? (
              <div className={styles.empty}>No text-only posts (no media, no replies).</div>
            ) : (
              <>
                <div className={`${styles.grid} ${styles.gridView1}`} data-view-mode="1">
                {textItems.map((item, index) => (
                  <div key={`${item.post.uri}-${index}`}>
                    <PostCard
                      item={item}
                      onPostClick={(uri, opts) => {
                        if (opts?.initialItem) setInitialPostForUri(uri, opts.initialItem)
                        openPostModal(uri, opts?.openReply, undefined, item.post.author?.handle)
                      }}
                      nsfwBlurred={nsfwPreference === 'blurred' && isPostNsfw(item.post) && !unblurredUris.has(item.post.uri)}
                      onNsfwUnblur={() => setUnblurred(item.post.uri, true)}
                      setUnblurred={setUnblurred}
                      isRevealed={unblurredUris.has(item.post.uri)}
                      likedUriOverride={likeOverrides[item.post.uri]}
                      onLikedChange={(uri, likeRecordUri) => setLikeOverride(uri, likeRecordUri ?? null)}
                      profileAuthorDid={profile?.did}
                      profileAuthorFollowingUri={profile != null ? followingUri ?? null : undefined}
                      onProfileAuthorFollowChange={onProfileAuthorFollowChange}
                    />
                  </div>
                ))}
              </div>
              {cursor && <div ref={loadMoreSentinelRef} className={styles.loadMoreSentinel} aria-hidden />}
              {loadingMore && <div className={styles.loadingMore}>Loading…</div>}
            </>
            )
          ) : tab === 'feeds' ? (
            feeds.length === 0 ? (
            <div className={styles.empty}>No feeds.</div>
          ) : (
            <ul className={styles.feedsList}>
              {feeds.map((f) => {
                const feedSlug = f.uri.split('/').pop() ?? ''
                const feedUrl = feedSlug
                  ? `https://bsky.app/profile/${encodeURIComponent(handle)}/feed/${encodeURIComponent(feedSlug)}`
                  : f.uri
                return (
                  <li key={f.uri}>
                    <a
                      href={feedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.feedLink}
                    >
                      <span className={styles.feedName}>{f.displayName}</span>
                      {f.description && <span className={styles.feedDesc}>{f.description}</span>}
                    </a>
                  </li>
                )
              })}
            </ul>
          )
        ) : loading ? (
          <div className={styles.loading}>Loading…</div>
        ) : mediaItems.length === 0 ? (
          <div className={styles.empty}>
            {tab === 'posts'
              ? profilePostsFilter === 'liked'
                ? 'No liked posts with images or videos.'
                : 'No posts with images or videos.'
              : tab === 'videos'
                ? 'No video posts.'
                : tab === 'replies'
                  ? 'No replies.'
                  : tab === 'reposts'
                    ? 'No reposts.'
                    : 'No feeds.'}
          </div>
        ) : (
          <>
            <div
              ref={gridRef}
              className={`${styles.gridColumns} ${viewMode === 'a' ? styles.gridView3 : styles[`gridView${viewMode}`]}`}
              {...gridPointerGateProps}
              data-view-mode={viewMode}
            >
              {distributeByHeight(mediaItems, cols).map((column, colIndex) => (
                <ProfileColumn
                  key={colIndex}
                  column={column}
                  colIndex={colIndex}
                  scrollRef={modalScrollRef}
                  loadMoreSentinelRef={
                    cursor
                      ? (el) => {
                          if (cols >= 2) loadMoreSentinelRefs.current[colIndex] = el
                          else ((loadMoreSentinelRef as unknown) as { current: HTMLDivElement | null }).current = el
                        }
                      : undefined
                  }
                  hasCursor={!!cursor}
                  keyboardFocusIndex={keyboardFocusIndex}
                  actionsMenuOpenForIndex={actionsMenuOpenForIndex}
                  nsfwPreference={nsfwPreference}
                  unblurredUris={unblurredUris}
                  setUnblurred={setUnblurred}
                  likeOverrides={likeOverrides}
                  setLikeOverrides={setLikeOverride}
                  openPostModal={openPostModal}
                  cardRef={(index) => (el) => { cardRefsRef.current[index] = el }}
                  onActionsMenuOpenChange={(index, open) => setActionsMenuOpenForIndex(open ? index : null)}
                  onMouseEnter={(originalIndex) => {
                    tryHoverSelectCard(
                      originalIndex,
                      () => keyboardFocusIndexRef.current,
                      (idx) => setKeyboardFocusIndex(idx),
                    )
                  }}
                  isSelected={(index) => (tab === 'posts' || tab === 'videos' || tab === 'replies' || tab === 'reposts') && index === keyboardFocusIndex}
                  suppressHoverNsfwUnblur={inModal}
                  profileAuthorDid={profile?.did}
                  profileAuthorFollowingUri={profile != null ? followingUri ?? null : undefined}
                  onProfileAuthorFollowChange={onProfileAuthorFollowChange}
                />
              ))}
            </div>
            {loadingMore && <div className={styles.loadingMore}>Loading…</div>}
          </>
        )}
        </div>
      </div>
    </>
  )
}
