import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSession } from '../context/SessionContext'
// Removed useProfileModal import to break circular dependency
import { useEditProfile } from '../context/EditProfileContext'
import { useModalTopBarSlot } from '../context/ModalTopBarSlotContext'
import { agent, publicAgent, isAgentAuthenticated, getPostMediaInfo, getPostMediaInfoForDisplay, getActorFeeds, listActivitySubscriptions, putActivitySubscription, isPostNsfw, getProfileCached, likePostWithLifecycle, unlikePostWithLifecycle, followAccountWithLifecycle, unfollowAccountWithLifecycle, buildAuthorFeedQuery, authorFeedFilterForProfileTab, type TimelineItem, type ProfileViewBasic } from '../lib/bsky'
import { getConvoAvailability } from '../lib/chat'
import { useMessages } from '../context/MessagesContext'
import { setInitialPostForUri } from '../lib/postCache'
import { getPreloadedProfileSnapshot, getPreloadedFeedSnapshot, preloadPostOpen } from '../lib/modalPreload'
import PostCard from '../components/PostCard'
import ProfileColumn, { VirtualizedCell } from '../components/ProfileColumn'
import { useModalScroll } from '../context/ModalScrollContext'
import PostText from '../components/PostText'
import ProfileActionsMenu from '../components/ProfileActionsMenu'
import BlockedAndMutedModal from '../components/BlockedAndMutedModal'
import { FollowListModal } from '../components/FollowListModal'
import { useViewMode, type ViewMode } from '../context/ViewModeContext'
import { useModeration, type NsfwPreference } from '../context/ModerationContext'
import { useHideReposts } from '../context/HideRepostsContext'
import { useLikeOverridesActions } from '../context/LikeOverridesContext'
import { getLikeOverrideFromStore } from '../lib/likeOverridesStore'
import { useFollowOverrides } from '../context/FollowOverridesContext'
import { useToast } from '../context/ToastContext'
import { EyeOpenIcon, EyeHalfIcon, EyeClosedIcon } from '../components/Icons'
import { useColumnCount } from '../hooks/useViewportWidth'
import { useColumnLoadMore } from '../hooks/useColumnLoadMore'
import { useModalGridKeyboardShell, useModalScrollKeyboardFocus } from '../hooks/useModalGridKeyboardShell'
import { useMediaFocusTargets } from '../hooks/useMediaFocusTargets'
import { useKeyboardScrollIntoView } from '../hooks/useKeyboardScrollIntoView'
import { useMediaGridKeyboardNav } from '../hooks/useMediaGridKeyboardNav'
import { usePostCardGridPointerGate } from '../hooks/usePostCardGridPointerGate'
import { usePostCardDisplayContext } from '../hooks/usePostCardDisplayContext'
import { distributeTimelineItemsByHeight } from '../lib/masonryLayout'
import { getPostGridClassName } from '../lib/gridClassName'
import { patchFollowingOnTimelineItem } from '../lib/followOptimisticUpdate'
import { ProgressiveImage } from '../components/ProgressiveImage'
import styles from './ProfilePage.module.css'
import gridStyles from '../styles/postGrid.module.css'

const REASON_REPOST = 'app.bsky.feed.defs#reasonRepost'
const REASON_PIN = 'app.bsky.feed.defs#reasonPin'

/** Drop chronological duplicates when includePins adds the same post with reasonPin at the top. */
function dedupeAuthorFeedPins(items: TimelineItem[]): TimelineItem[] {
  const pinnedUris = new Set<string>()
  for (const item of items) {
    const uri = item.post?.uri
    if (uri && (item.reason as { $type?: string })?.$type === REASON_PIN) pinnedUris.add(uri)
  }
  const seen = new Set<string>()
  return items.filter((item) => {
    const uri = item.post?.uri
    if (!uri) return false
    if ((item.reason as { $type?: string })?.$type !== REASON_PIN && pinnedUris.has(uri)) return false
    if (seen.has(uri)) return false
    seen.add(uri)
    return true
  })
}

const VIEW_MODE_CYCLE: ViewMode[] = ['1', '2', '3', 'a']

/** Profile lightbox: keep the masonry grid readable (All Columns on the full page can use more). */
const PROFILE_MODAL_MAX_MASONRY_COLS = 3

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
  viewer?: { following?: string; blocking?: string; followedBy?: boolean }
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
  isTopModal = true,
  onRegisterRefresh,
}: {
  handle: string
  openProfileModal: (h: string) => void
  openPostModal: (uri: string, openReply?: boolean, focusUri?: string, authorHandle?: string) => void
  isModalOpen: boolean
  /** When true, we are the profile popup content so keyboard shortcuts apply when isTopModal. When false, skip if another modal (e.g. post) is open. */
  inModal?: boolean
  /** When inModal, only handle grid shortcuts while this profile layer is the visible top modal. */
  isTopModal?: boolean
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
  const [loading, setLoading] = useState(() => !inModal)
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
  /** Per-column card counts; empty columns keep a top sentinel — must not drive "short column" auto load-more. */
  const distributedColumnLengthsRef = useRef<number[]>([])
  const distributedColumnsRef = useRef<ReturnType<typeof distributeTimelineItemsByHeight>>([])
  const colsRef = useRef(1)
  const loadingMoreRef = useRef(false)
  const [tabsBarVisible] = useState(true)
  const [keyboardFocusIndex, setKeyboardFocusIndex] = useState(0)
  const [actionsMenuOpenForIndex, setActionsMenuOpenForIndex] = useState<number | null>(null)
  const [showBlockedMutedModal, setShowBlockedMutedModal] = useState(false)
  const [followListModal, setFollowListModal] = useState<'followers' | 'following' | 'mutuals' | 'followedByFollows' | null>(null)
  const [followeesWhoFollowPreview, setFolloweesWhoFollowPreview] = useState<ProfileViewBasic[] | null>(null)
  const [, setFolloweesWhoFollowLoading] = useState(false)
  const { setLikeOverride } = useLikeOverridesActions()
  const { setFollowOverride } = useFollowOverrides()
  const { openChat } = useMessages()
  const [messageLoading, setMessageLoading] = useState(false)
  const [canMessage, setCanMessage] = useState<boolean | null>(null)
  const existingConvoIdRef = useRef<string | undefined>(undefined)
  // openPostModal and isModalOpen are now passed as props to avoid circular dependency
  const modalScrollRef = useModalScroll()
  const keyboardShell = useModalGridKeyboardShell(inModal, isTopModal)
  useModalScrollKeyboardFocus(modalScrollRef, inModal && isTopModal, handle)
  const postCardDisplayContext = usePostCardDisplayContext(inModal)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const editProfileCtx = useEditProfile()
  const topBarSlots = useModalTopBarSlot()
  const topBarRightSlot = topBarSlots?.rightSlot ?? null
  const openEditProfile = editProfileCtx?.openEditProfile ?? (() => {})
  const editSavedVersion = editProfileCtx?.editSavedVersion ?? 0
  const cardRefsRef = useRef<(HTMLDivElement | null)[]>([])
  const mediaRefsRef = useRef<Record<number, Record<number, HTMLElement | null>>>({})
  const keyboardFocusIndexRef = useRef(0)
  const profileGridItemsRef = useRef<TimelineItem[]>([])
  const actionsMenuOpenForIndexRef = useRef<number | null>(null)
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
        const profileData = data as { did?: string; displayName?: string; avatar?: string; description?: string; viewer?: { following?: string; blocking?: string; followedBy?: boolean }; verification?: { verifiedStatus?: string }; createdAt?: string; indexedAt?: string }
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

  useEffect(() => {
    if (!session || !profile || session.did === profile.did) {
      setCanMessage(null)
      existingConvoIdRef.current = undefined
      return
    }
    let cancelled = false
    setCanMessage(null)
    existingConvoIdRef.current = undefined
    getConvoAvailability([profile.did])
      .then(({ canChat, convo }) => {
        if (cancelled) return
        setCanMessage(canChat)
        existingConvoIdRef.current = convo?.id
      })
      .catch(() => {
        if (!cancelled) setCanMessage(false)
      })
    return () => { cancelled = true }
  }, [session?.did, profile?.did, profile?.viewer?.following, followUriOverride])

  // REMOVED: getFolloweesWhoFollowTarget API call to reduce profile load requests
  // This was fetching "Followed by X, Y you follow" preview - not essential for initial load
  useEffect(() => {
    // Always set to null/false - no API call
    setFolloweesWhoFollowPreview(null)
    setFolloweesWhoFollowLoading(false)
  }, [session?.did, profile?.did])

  const load = useCallback(async (nextCursor?: string, options?: { tab?: ProfileTab }) => {
    if (!handle) return
    const feedTab = options?.tab ?? tab
    try {
      if (nextCursor) setLoadingMore(true)
      else setLoading(true)
      setError(null)

      // Check for preloaded feed data on initial load (default Posts tab only).
      if (!nextCursor && feedTab === 'posts') {
        const preloaded = getPreloadedFeedSnapshot(handle)
        if (preloaded) {
          setItems(dedupeAuthorFeedPins(preloaded.feed))
          setCursor(preloaded.cursor)
          setLoading(false)
          return
        }
      }

      const res = await readAgent.getAuthorFeed(
        buildAuthorFeedQuery(
          { actor: handle, limit: 20, cursor: nextCursor, includePins: true },
          authorFeedFilterForProfileTab(feedTab),
        ),
      )
      const feed = (res.data.feed ?? []) as TimelineItem[]
      setItems((prev) => dedupeAuthorFeedPins(nextCursor ? [...prev, ...feed] : feed))
      setCursor(res.data.cursor ?? undefined)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load profile')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [handle, readAgent, tab])

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
  const prevAuthorFeedTabRef = useRef<ProfileTab>(tab)
  const profileReady = !!profile?.did
  // Initial / refetch author feed: depend on handle, tab, and live agent auth (not React session alone — storage can be ahead of the agent after refresh).
  // In modals, wait for profile metadata before loading posts so the header paints first.
  useEffect(() => {
    if (!handle) return
    if (tab === 'feeds') return
    if (tab === 'posts' && profilePostsFilter === 'liked') return
    const prev = prevAuthorFeedHandleRef.current
    prevAuthorFeedHandleRef.current = handle
    const handleChanged = prev !== undefined && prev !== handle
    const tabChanged = prevAuthorFeedTabRef.current !== tab
    prevAuthorFeedTabRef.current = tab
    if (handleChanged) {
      setProfile((getPreloadedProfileSnapshot(handle) as ProfileState | null) ?? null)
      setFollowUriOverride(null)
      setTab('posts')
      setProfilePostsFilter('all')
      setLikedItems([])
      setLikedCursor(undefined)
      setItems([])
      setCursor(undefined)
      setLoading(inModal ? false : true)
      prevAuthorFeedTabRef.current = 'posts'
    } else if (tabChanged) {
      setItems([])
      setCursor(undefined)
      setLoading(true)
    }
    if (inModal && !profileReady) return
    loadRef.current(undefined, handleChanged ? { tab: 'posts' } : undefined)
  }, [handle, hasLiveBskyAuth, inModal, profileReady, tab, profilePostsFilter])

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

  loadingMoreRef.current = loadingMore
  const colsUncapped = useColumnCount(viewMode, 150)
  const cols = inModal ? Math.min(colsUncapped, PROFILE_MODAL_MAX_MASONRY_COLS) : colsUncapped
  const loadMoreCursor = tab === 'posts' && profilePostsFilter === 'liked' ? likedCursor : cursor
  const loadMore = tab === 'posts' && profilePostsFilter === 'liked' ? (c: string) => loadLiked(c) : load
  const gridTabActive = tab === 'posts' || tab === 'videos' || tab === 'replies' || tab === 'reposts'

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

  // Distribute items into columns and track lengths for infinite scroll
  const distributedColumns = useMemo(
    () => distributeTimelineItemsByHeight(profileGridItems, cols, distributedColumnsRef.current),
    [profileGridItems, cols],
  )
  distributedColumnsRef.current = distributedColumns
  distributedColumnLengthsRef.current = distributedColumns.map((c) => c.length)
  colsRef.current = cols

  const getMediaCount = useCallback(
    (cardIndex: number) => {
      const media = getPostMediaInfo(profileGridItems[cardIndex]?.post)
      return media ? (media.imageCount ?? 1) : 1
    },
    [profileGridItems],
  )
  const { focusTargets, firstFocusIndexForCard, lastFocusIndexForCard } = useMediaFocusTargets(
    profileGridItems.length,
    getMediaCount,
  )
  const focusTargetsRef = useRef(focusTargets)
  const firstFocusIndexForCardRef = useRef(firstFocusIndexForCard)
  const lastFocusIndexForCardRef = useRef(lastFocusIndexForCard)
  focusTargetsRef.current = focusTargets
  firstFocusIndexForCardRef.current = firstFocusIndexForCard
  lastFocusIndexForCardRef.current = lastFocusIndexForCard
  actionsMenuOpenForIndexRef.current = actionsMenuOpenForIndex
  const sessionRef = useRef(session)
  sessionRef.current = session

  const bindLoadMoreSentinelRef = useColumnLoadMore({
    cursor: loadMoreCursor,
    cols,
    itemCount: profileGridItems.length,
    loadingMoreRef,
    loadMore,
    sentinelRefs: loadMoreSentinelRefs,
    columnLengthsRef: distributedColumnLengthsRef,
    enabled: gridTabActive,
    inModal,
  })

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
    t.push('posts')
    if (tabHasContent.videos) t.push('videos')
    if (tabHasContent.text) t.push('text')
    if (tabHasContent.replies) t.push('replies')
    if (tabHasContent.reposts) t.push('reposts')
    if (tabHasContent.feeds) t.push('feeds')
    return t
  }, [tabHasContent])

  useEffect(() => {
    if (loading || visibleTabs.length === 0) return
    if (!visibleTabs.includes(tab)) setTab(visibleTabs[0])
  }, [loading, visibleTabs, tab])
  profileGridItemsRef.current = profileGridItems
  keyboardFocusIndexRef.current = keyboardFocusIndex

  useEffect(() => {
    setKeyboardFocusIndex((i) => (focusTargets.length ? Math.min(i, focusTargets.length - 1) : 0))
  }, [profileGridItems.length, focusTargets.length])

  useKeyboardScrollIntoView({
    keyboardFocusIndex,
    scrollIntoViewFromKeyboardRef,
    lastScrollIntoViewIndexRef,
    getScrollTarget: useCallback(() => {
      const target = focusTargets[keyboardFocusIndex]
      const cardIndex = target?.cardIndex ?? keyboardFocusIndex
      const mediaIndex = target?.mediaIndex ?? 0
      return mediaRefsRef.current[cardIndex]?.[mediaIndex] ?? cardRefsRef.current[cardIndex]
    }, [keyboardFocusIndex, focusTargets]),
  })

  const getColumns = useCallback(
    () => (colsRef.current >= 2 ? distributedColumnsRef.current : null),
    [],
  )

  const handleMediaRef = useCallback((index: number, mediaIndex: number, el: HTMLElement | null) => {
    if (!mediaRefsRef.current[index]) mediaRefsRef.current[index] = {}
    mediaRefsRef.current[index][mediaIndex] = el
  }, [])

  const handleProfileOpenPost = useCallback(
    (item: TimelineItem) => openPostModal(item.post.uri, undefined, undefined, item.post.author?.handle),
    [openPostModal],
  )

  const handleProfileOpenReply = useCallback(
    (item: TimelineItem) => openPostModal(item.post.uri, true, undefined, item.post.author?.handle),
    [openPostModal],
  )

  const handleProfileToggleActionsMenu = useCallback((cardIndex: number, menuOpen: boolean) => {
    setActionsMenuOpenForIndex(menuOpen ? null : cardIndex)
  }, [])

  const handleProfileToggleLike = useCallback(
    (item: TimelineItem) => {
      if (!item.post.uri || !item.post.cid) return
      const uri = item.post.uri
      const override = getLikeOverrideFromStore(uri)
      const currentLikeUri =
        override !== undefined ? (override ?? undefined) : (item.post as { viewer?: { like?: string } }).viewer?.like
      if (currentLikeUri) {
        unlikePostWithLifecycle(currentLikeUri, uri).then(() => setLikeOverride(uri, null)).catch(() => {})
      } else {
        likePostWithLifecycle(uri, item.post.cid).then((res) => setLikeOverride(uri, res.uri)).catch(() => {})
      }
    },
    [setLikeOverride],
  )

  const handleProfileToggleFollow = useCallback((item: TimelineItem) => {
    const currentSession = sessionRef.current
    if (!currentSession?.did || !item.post.author) return
    const author = item.post.author as { did: string; viewer?: { following?: string } }
    if (currentSession.did === author.did) return
    const followingUri = author.viewer?.following
    const postUri = item.post.uri
    if (followingUri) {
      unfollowAccountWithLifecycle(followingUri)
        .then(() => setItems((prev) => patchFollowingOnTimelineItem(prev, postUri, undefined)))
        .catch(() => {})
    } else {
      followAccountWithLifecycle(author.did)
        .then((res) => setItems((prev) => patchFollowingOnTimelineItem(prev, postUri, res.uri)))
        .catch(() => {})
    }
  }, [])

  useMediaGridKeyboardNav({
    enabled: gridTabActive && profileGridItems.length > 0,
    keyboardShell,
    inModal,
    isModalOpen,
    itemsRef: profileGridItemsRef,
    keyboardFocusIndexRef,
    setKeyboardFocusIndex,
    focusTargetsRef,
    firstFocusIndexForCardRef,
    lastFocusIndexForCardRef,
    colsRef,
    getColumns,
    cardRefsRef,
    mediaRefsRef,
    scrollIntoViewFromKeyboardRef,
    beginKeyboardNavigation,
    actionsMenuOpenForIndexRef,
    setActionsMenuOpenForIndex,
    onOpenPost: handleProfileOpenPost,
    onOpenReply: handleProfileOpenReply,
    onToggleActionsMenu: handleProfileToggleActionsMenu,
    onToggleLike: handleProfileToggleLike,
    onToggleFollow: handleProfileToggleFollow,
  })

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

  async function handleMessage() {
    if (!profile || messageLoading || !canMessage) return
    setMessageLoading(true)
    try {
      openChat(profile.did, handle, existingConvoIdRef.current)
    } finally {
      setMessageLoading(false)
    }
  }

  const hideReposts = useHideReposts()
  const hideRepostsFromThisUser = !!profile && hideReposts?.isHidingRepostsFrom(profile.did)
  const showNotificationBell = !!session && !!profile && !isOwnProfile && isFollowing
  const showMessageButton = canMessage === true

  return (
    <>
      <div className={`${styles.wrap} ${inModal ? styles.wrapInModal : ''}`}>
        <header className={styles.profileHeader}>
          <div className={styles.profileHeaderMain}>
            {profile?.avatar ? (
              <ProgressiveImage src={profile.avatar} alt="" className={styles.avatar} loading={inModal ? 'eager' : 'lazy'} root={modalScrollRef} />
            ) : (
              <div className={styles.avatar} style={{ backgroundColor: 'var(--glass-border)' }} aria-hidden />
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
                {profile?.viewer?.followedBy && !isOwnProfile && (
                  <span className={styles.followsYouBadge}>Follows you</span>
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
                        Unfollow
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
                  {showMessageButton && (
                    <button
                      type="button"
                      className={styles.messageBtn}
                      onClick={() => void handleMessage()}
                      disabled={messageLoading}
                      title="Send a direct message"
                    >
                      {messageLoading ? 'Opening…' : 'Message'}
                    </button>
                  )}
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
        {inModal && profileReady && (
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
        {(!inModal || profileReady) && error && <p className={styles.error}>{error}</p>}
        {(!inModal || profileReady) && <div className={styles.profileContent}>
          {tab === 'text' ? (
            textItems.length === 0 ? (
              <div className={styles.empty}>No text-only posts (no media, no replies).</div>
            ) : (
              <>
                <div className={`${gridStyles.grid} ${gridStyles.gridView1}`} data-view-mode="1">
                {textItems.map((item, index) => (
                  <VirtualizedCell key={`${item.post.uri}-${index}`} root={modalScrollRef}>
                    <PostCard
                      item={item}
                      fillCell={false}
                      onPostClick={(uri, opts) => {
                        if (opts?.initialItem) setInitialPostForUri(uri, opts.initialItem)
                        openPostModal(uri, opts?.openReply, undefined, item.post.author?.handle)
                      }}
                      nsfwBlurred={nsfwPreference === 'blurred' && isPostNsfw(item.post) && !unblurredUris.has(item.post.uri)}
                      onNsfwUnblur={() => setUnblurred(item.post.uri, true)}
                      setUnblurred={setUnblurred}
                      isRevealed={unblurredUris.has(item.post.uri)}
                      onLikedChange={(uri, likeRecordUri) => setLikeOverride(uri, likeRecordUri ?? null)}
                      profileAuthorDid={profile?.did}
                      profileAuthorFollowingUri={profile != null ? followingUri ?? null : undefined}
                      onProfileAuthorFollowChange={onProfileAuthorFollowChange}
                      displayContext={postCardDisplayContext}
                    />
                  </VirtualizedCell>
                ))}
              </div>
              {cursor && <div ref={loadMoreSentinelRef} className={gridStyles.loadMoreSentinel} aria-hidden />}
              {loadingMore && <div className={styles.loadingMore}>Loading…</div>}
              {cursor && !loadingMore && (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem 0' }}>
                  <button
                    type="button"
                    className={styles.loadMoreBtn}
                    onClick={() => {
                      if (loadMoreCursor && !loadingMore) {
                        loadingMoreRef.current = true
                        loadMore(loadMoreCursor)
                      }
                    }}
                    disabled={loadingMore}
                  >
                    Load more
                  </button>
                </div>
              )}
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
              className={getPostGridClassName(viewMode)}
              {...gridPointerGateProps}
              data-view-mode={viewMode}
            >
              {distributedColumns.map((column, colIndex) => (
                <ProfileColumn
                  key={colIndex}
                  column={column}
                  colIndex={colIndex}
                  scrollRef={modalScrollRef}
                  feedPreviewActionRow
                  loadMoreSentinelRef={loadMoreCursor ? bindLoadMoreSentinelRef(colIndex) : undefined}
                  hasCursor={!!cursor}
                  keyboardFocusIndex={keyboardFocusIndex}
                  focusTargets={focusTargets}
                  onMediaRef={handleMediaRef}
                  actionsMenuOpenForIndex={actionsMenuOpenForIndex}
                  nsfwPreference={nsfwPreference}
                  unblurredUris={unblurredUris}
                  setUnblurred={setUnblurred}
                  setLikeOverrides={setLikeOverride}
                  openPostModal={openPostModal}
                  cardRef={(index) => (el) => { cardRefsRef.current[index] = el }}
                  onActionsMenuOpenChange={(index, open) => setActionsMenuOpenForIndex(open ? index : null)}
                  onMouseEnter={(originalIndex) => {
                    tryHoverSelectCard(
                      originalIndex,
                      () => focusTargets[keyboardFocusIndexRef.current]?.cardIndex ?? -1,
                      (cardIndex) => {
                        setKeyboardFocusIndex(firstFocusIndexForCardRef.current[cardIndex] ?? 0)
                      },
                      { applyOnTouch: inModal ? false : undefined },
                    )
                  }}
                  isSelected={(index) => {
                    if (tab !== 'posts' && tab !== 'videos' && tab !== 'replies' && tab !== 'reposts') return false
                    const target = focusTargets[keyboardFocusIndex]
                    return (target?.cardIndex ?? keyboardFocusIndex) === index
                  }}
                  suppressHoverNsfwUnblur={inModal}
                  profileAuthorDid={profile?.did}
                  profileAuthorFollowingUri={profile != null ? followingUri ?? null : undefined}
                  onProfileAuthorFollowChange={onProfileAuthorFollowChange}
                  displayContext={postCardDisplayContext}
                />
              ))}
            </div>
            {loadingMore && <div className={styles.loadingMore}>Loading…</div>}
            {loadMoreCursor && !loadingMore && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem 0' }}>
                <button
                  type="button"
                  className={styles.loadMoreBtn}
                  onClick={() => {
                    if (loadMoreCursor && !loadingMore) {
                      loadingMoreRef.current = true
                      loadMore(loadMoreCursor)
                    }
                  }}
                  disabled={loadingMore}
                >
                  Load more
                </button>
              </div>
            )}
          </>
        )}
        </div>}
      </div>
    </>
  )
}
