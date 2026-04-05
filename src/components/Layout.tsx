import React, { useState, useRef, useEffect, useMemo, useCallback, useSyncExternalStore, lazy, Suspense } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../context/SessionContext'
import { useTheme, type ThemeMode } from '../context/ThemeContext'
import { useViewMode, VIEW_LABELS } from '../context/ViewModeContext'
import { useArtOnly, CARD_VIEW_LABELS } from '../context/ArtOnlyContext'
import { useProfileModal } from '../context/ProfileModalContext'
import { useLoginModal } from '../context/LoginModalContext'
import { useEditProfile } from '../context/EditProfileContext'
import { useModeration, NSFW_LABELS } from '../context/ModerationContext'
import { useMediaOnly, MEDIA_MODE_LABELS, type MediaMode } from '../context/MediaOnlyContext'
import { useScrollLock } from '../context/ScrollLockContext'
import { useSeenPosts } from '../context/SeenPostsContext'
import { useToast } from '../context/ToastContext'
import {
  createPost,
  postReply,
  getNotifications,
  getUnreadNotificationCount,
  updateSeenNotifications,
  getSavedFeedsFromPreferences,
  getFeedDisplayName,
  getFeedDisplayNamesBatch,
  resolveFeedUri,
  addSavedFeed,
  removeSavedFeedByUri,
  getFeedShareUrl,
  getProfilesBatch,
  getPersistedActiveDid,
} from '../lib/bsky'
import { requestDeduplicator } from '../lib/RequestDeduplicator'
import type { FeedSource } from '../types'
import { GUEST_FEED_SOURCES, GUEST_MIX_ENTRIES } from '../config/feedSources'
import { isHandleBoardPath, isMultiColumnGridRoute } from '../lib/routes'
import { getPostAppPath, parseBskyFeedPostUri } from '../lib/appUrl'
import { useFeedMix } from '../context/FeedMixContext'
import { FeedSwipeProvider } from '../context/FeedSwipeContext'
import SearchBar from './SearchBar'
import FeedSelector from './FeedSelector'
import type { ComposeSegment } from './LayoutComposerForm'
import { CardDefaultIcon, CardMinimalistIcon, CardArtOnlyIcon, EyeOpenIcon, EyeHalfIcon, EyeClosedIcon } from './Icons'
import SWUpdateToast from './SWUpdateToast'
import PurpleSkyLogo from './PurpleSkyLogo'
import styles from './Layout.module.css'

const LayoutComposerForm = lazy(() => import('./LayoutComposerForm'))
const SettingsModalLazy = lazy(() => import('./SettingsModal'))

const PRESET_FEED_SOURCES: FeedSource[] = [
  { kind: 'timeline', label: 'Following' },
  { kind: 'custom', label: "What's Hot", uri: 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot' },
]

const HIDDEN_PRESET_FEEDS_PREFIX = 'artsky-hidden-preset-feeds'
const FEED_ORDER_PREFIX = 'artsky-feed-order'

function hiddenPresetKey(did: string): string {
  return `${HIDDEN_PRESET_FEEDS_PREFIX}-${did || 'guest'}`
}

function feedOrderKey(did: string): string {
  return `${FEED_ORDER_PREFIX}-${did || 'guest'}`
}

function feedSourceId(s: FeedSource): string {
  return s.uri ?? (s.kind === 'timeline' ? 'timeline' : s.label ?? '')
}

function loadHiddenPresetUris(did: string): Set<string> {
  try {
    const key = hiddenPresetKey(did)
    let raw = localStorage.getItem(key)
    let fromLegacy = false
    if (!raw && did !== 'guest') {
      raw = localStorage.getItem(HIDDEN_PRESET_FEEDS_PREFIX)
      fromLegacy = !!raw
    }
    if (!raw) return new Set<string>()
    const arr = JSON.parse(raw) as string[]
    const result = Array.isArray(arr) ? new Set<string>(arr) : new Set<string>()
    if (fromLegacy && did !== 'guest') {
      try {
        localStorage.setItem(key, JSON.stringify([...result]))
      } catch {
        // ignore
      }
    }
    return result
  } catch {
    return new Set<string>()
  }
}

function loadFeedOrder(did: string): string[] {
  try {
    const key = feedOrderKey(did)
    let raw = localStorage.getItem(key)
    let fromLegacy = false
    if (!raw && did !== 'guest') {
      raw = localStorage.getItem(FEED_ORDER_PREFIX)
      fromLegacy = !!raw
    }
    if (!raw) return []
    const arr = JSON.parse(raw) as string[]
    const result = Array.isArray(arr) ? arr : []
    if (fromLegacy && did !== 'guest') {
      try {
        localStorage.setItem(key, JSON.stringify(result))
      } catch {
        // ignore
      }
    }
    return result
  } catch {
    return []
  }
}

interface Props {
  title: string
  children: React.ReactNode
  showNav?: boolean
}

/** Handlers for pull-to-refresh on the feed page; when set, Layout attaches them to the feed wrapper so the top strip is included. */
export interface FeedPullRefreshHandlers {
  onTouchStart: (e: React.TouchEvent) => void
  onTouchMove: (e: React.TouchEvent) => void
  onTouchEnd: (e: React.TouchEvent) => void
}

export const FeedPullRefreshContext = React.createContext<{
  wrapperRef: React.RefObject<HTMLDivElement | null> | null
  setHandlers: ((handlers: FeedPullRefreshHandlers | null) => void) | null
  /** FeedPage reports pull distance so Layout can translate the whole main column (selector + cards), not only the card grid. */
  setPullOffsetPx: ((px: number) => void) | null
}>({ wrapperRef: null, setHandlers: null, setPullOffsetPx: null })

/** Home icon (purplesky-style: roof house); filled when selected like other nav icons */
function HomeIcon({ active }: { active?: boolean }) {
  if (active) {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
        <path
          fill="currentColor"
          fillRule="evenodd"
          clipRule="evenodd"
          d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 12h6v10H9z"
        />
      </svg>
    )
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}

/** Eye-off icon for read-posts button (tap = hide read, hold = show read) */
function SeenPostsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

function SearchIcon({ active }: { active?: boolean }) {
  const sw = active ? 2.5 : 2
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  )
}

/** Same bookmark shape as post “save to collection” (CollectionSaveMenu) */
function CollectionsBookmarkNavIcon({ active }: { active?: boolean }) {
  const sw = active ? 2.5 : 2
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      {active ? (
        <path fill="currentColor" d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2v16z" />
      ) : (
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2v16z"
        />
      )}
    </svg>
  )
}

function FeedsIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  )
}

function AccountIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}

/** Eye icon for NSFW preference: closed = SFW, half = Blurred, open = NSFW. Inline SVG matching public/icons/eye-*.svg */
function NsfwEyeIcon({ mode }: { mode: 'open' | 'half' | 'closed' }) {
  if (mode === 'open') return <EyeOpenIcon size={24} />
  if (mode === 'half') return <EyeHalfIcon size={24} />
  return <EyeClosedIcon size={24} />
}

/** Preview card mode icons: full card (show all), compact (minimalist), image only (art only). Inline SVG matching public/icons/card-*.svg */
function CardModeIcon({ mode }: { mode: 'default' | 'minimalist' | 'artOnly' }) {
  if (mode === 'default') return <CardDefaultIcon size={20} />
  if (mode === 'minimalist') return <CardMinimalistIcon size={20} />
  return <CardArtOnlyIcon size={20} />
}

function Column1Icon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="7" y="3" width="10" height="18" rx="1" />
    </svg>
  )
}
function Column2Icon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="8" height="18" rx="1" />
      <rect x="13" y="3" width="8" height="18" rx="1" />
    </svg>
  )
}
function Column3Icon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="3" width="5" height="18" rx="1" />
      <rect x="9.5" y="3" width="5" height="18" rx="1" />
      <rect x="17" y="3" width="5" height="18" rx="1" />
    </svg>
  )
}
function ColumnAutoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="4" width="4" height="16" rx="1" />
      <rect x="8" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
      <path d="M21 8v8M19 10l2-2 2 2M19 14l2 2 2-2" />
    </svg>
  )
}
function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
function ChevronDownIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}
function LogInIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  )
}

function ThemeSunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  )
}

function ThemeMoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

/** Half sun, half moon – standard for "follow system" theme. */
function ThemeAutoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18" />
      <path d="M6 12a6 6 0 0 1 6-6 6 6 0 0 1 6 6" />
      <circle cx="16.5" cy="12" r="2" />
    </svg>
  )
}

function cycleThemeMode(theme: ThemeMode): ThemeMode {
  if (theme === 'light') return 'system'
  if (theme === 'system') return 'dark'
  return 'light'
}

function ThemeGearGlyph({ theme }: { theme: ThemeMode }) {
  if (theme === 'light') return <ThemeSunIcon />
  if (theme === 'dark') return <ThemeMoonIcon />
  return <ThemeAutoIcon />
}

function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function AboutIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  )
}

/** Settings / cache icon (database cylinder) — sized to match theme icons in gear menu */
function SettingsStorageIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
    </svg>
  )
}

/** All posts: same image frame as Media Posts, with the Text Posts lines stacked underneath */
function MediaModeAllPostsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="2" width="18" height="10" rx="2" />
      <circle cx="8.5" cy="6.5" r="1.5" />
      <path d="M21 11.5l-4.5-4.5-3 3-2.5-2.5L3 11.5" />
      <path d="M4 14h16M4 17h16M4 19.5h13M4 22h16" />
    </svg>
  )
}

/** Media posts: image / gallery only */
function MediaModeMediaPostsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M21 17l-4.5-4.5-3 3-2.5-2.5L3 17" />
    </svg>
  )
}

/** Text posts: lines only, no media frame */
function MediaModeTextPostsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 6h16M4 10h16M4 14h13M4 18h16" />
    </svg>
  )
}

function MediaModeGlyph({ mode }: { mode: MediaMode }) {
  return (
    <span className={styles.mediaModeIconWrap}>
      {mode === 'mediaText' ? <MediaModeAllPostsIcon /> : mode === 'media' ? <MediaModeMediaPostsIcon /> : <MediaModeTextPostsIcon />}
    </span>
  )
}

const DESKTOP_BREAKPOINT = 768
function getDesktopSnapshot() {
  return typeof window !== 'undefined' ? window.innerWidth >= DESKTOP_BREAKPOINT : false
}
function subscribeDesktop(cb: () => void) {
  if (typeof window === 'undefined') return () => {}
  const mq = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

export default function Layout({ title, children, showNav }: Props) {
  const loc = useLocation()
  const navigate = useNavigate()
  const {
    openProfileModal,
    openPostModal,
    isModalOpen,
    modalScrollHidden,
    openCollectionsModal,
    searchModalTopQuery,
  } = useProfileModal()
  const { openLoginModal } = useLoginModal()
  const editProfile = useEditProfile()
  const { session, sessionsList, logout, switchAccount, authResolved } = useSession()
  const [accountProfiles, setAccountProfiles] = useState<Record<string, { avatar?: string; handle?: string }>>({})
  const [accountProfilesVersion, setAccountProfilesVersion] = useState(0)
  const sessionsDidKey = useMemo(() => sessionsList.map((s) => s.did).sort().join(','), [sessionsList])

  useEffect(() => {
    editProfile?.registerOnSaved(() => setAccountProfilesVersion((v) => v + 1))
  }, [editProfile?.registerOnSaved])

  useEffect(() => {
    if (sessionsList.length === 0) {
      setAccountProfiles({})
      return
    }
    let cancelled = false
    const dids = sessionsList.map(s => s.did)
    getProfilesBatch(dids, true).then((profiles) => {
      if (cancelled) return
      const updated: Record<string, { avatar?: string; handle?: string }> = {}
      for (const [did, profile] of profiles.entries()) {
        updated[did] = { avatar: profile.avatar, handle: profile.handle }
      }
      setAccountProfiles(updated)
    }).catch(() => {
      // Log warning but don't break UI
      console.warn('Failed to fetch account profiles')
    })
    return () => { cancelled = true }
  }, [sessionsDidKey, sessionsList, accountProfilesVersion])
  const { theme, setTheme } = useTheme()
  const themeGearLabel =
    theme === 'light'
      ? 'Light Theme'
      : theme === 'dark'
        ? 'Dark Theme'
        : 'Auto Theme'
  const { viewMode, setViewMode, cycleViewMode } = useViewMode()
  const { cardViewMode, cycleCardView } = useArtOnly()
  const { nsfwPreference, cycleNsfwPreference } = useModeration()
  const { mediaMode, cycleMediaMode } = useMediaOnly()
  const path = loc.pathname
  const mainAllColumnsWidth = viewMode === 'a' && isMultiColumnGridRoute(path)
  /** Mobile gear FAB: same view/theme/column controls as the home feed */
  const showFeedStyleSettingsFloat =
    path === '/feed' || path === '/collections' || isHandleBoardPath(path)
  const isDesktop = useSyncExternalStore(subscribeDesktop, getDesktopSnapshot, () => false)
  const scrollLock = useScrollLock()
  const [, setAccountSheetOpen] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const feedPullRefreshWrapperRef = useRef<HTMLDivElement>(null)
  const [feedPullRefreshHandlers, setFeedPullRefreshHandlers] = useState<FeedPullRefreshHandlers | null>(null)
  const [feedPullOffsetPx, setFeedPullOffsetPx] = useState(0)
  const [notificationFilter, setNotificationFilter] = useState<'all' | 'reply' | 'follow'>('all')
  const [feedsDropdownOpen, setFeedsDropdownOpen] = useState(false)
  const [feedsClosingAngle, setFeedsClosingAngle] = useState<number | null>(null)
  const [feedsChevronNoTransition, setFeedsChevronNoTransition] = useState(false)
  const prevFeedsOpenRef = useRef(false)
  const [savedFeedSources, setSavedFeedSources] = useState<FeedSource[]>([])
  const did = useMemo(() => {
    if (session?.did) return session.did
    if (!authResolved) {
      const p = getPersistedActiveDid()
      if (p) return p
    }
    return 'guest'
  }, [session?.did, authResolved])
  /** True when we have a session or OAuth restore may still be in flight (avoid guest chrome / feed flash). */
  const showAccountFeedUi = Boolean(session) || !authResolved
  const currentAccountDid = session?.did ?? (did !== 'guest' ? did : undefined)
  const currentAccountAvatar = currentAccountDid ? accountProfiles[currentAccountDid]?.avatar : null
  const prevFeedDidRef = useRef(did)
  const [hiddenPresetUris, setHiddenPresetUris] = useState<Set<string>>(() => loadHiddenPresetUris(did))
  const [feedOrder, setFeedOrder] = useState<string[]>(() => loadFeedOrder(did))
  const [feedAddError, setFeedAddError] = useState<string | null>(null)
  const feedsDropdownRef = useRef<HTMLDivElement>(null)
  const feedsBtnRef = useRef<HTMLButtonElement>(null)
  const feedsChevronRef = useRef<HTMLSpanElement>(null)
  const [notifications, setNotifications] = useState<{ uri: string; author: { handle?: string; did: string; avatar?: string; displayName?: string }; reason: string; reasonSubject?: string; isRead: boolean; indexedAt: string; replyPreview?: string }[]>([])
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0)
  const unreadCountInitialFetchDoneRef = useRef(false)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const [composeOverlayBottom, setComposeOverlayBottom] = useState(0)
  const [composeSegments, setComposeSegments] = useState<ComposeSegment[]>([{ id: Math.random().toString(36).slice(2), text: '', images: [], imageAlts: [] }])
  const [composeSegmentIndex, setComposeSegmentIndex] = useState(0)
  const [composePosting, setComposePosting] = useState(false)
  const [composeError, setComposeError] = useState<string | null>(null)
  const composeFileInputRef = useRef<HTMLInputElement>(null)
  const composeFormRef = useRef<HTMLFormElement>(null)
  const currentSegment = composeSegments[composeSegmentIndex] ?? { text: '', images: [], imageAlts: [] }
  const navVisible = true
  const [mobileNavScrollHidden, setMobileNavScrollHidden] = useState(false)
  const [feedFloatButtonsExpanded, setFeedFloatButtonsExpanded] = useState(false)
  const gearFloatWrapRef = useRef<HTMLDivElement>(null)
  const headerGearWrapRef = useRef<HTMLDivElement>(null)
  const lastScrollYRef = useRef(0)
  const scrollEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOverlayBottom, setSearchOverlayBottom] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const accountBtnRef = useRef<HTMLButtonElement>(null)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const notificationsMenuRef = useRef<HTMLDivElement>(null)
  const notificationsBtnRef = useRef<HTMLButtonElement>(null)
  const lastSeenAtSyncedRef = useRef<string>('')
  const maxSeenInViewRef = useRef<string>('')
  const markSeenDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const markSeenObserverCleanupRef = useRef<(() => void) | null>(null)
  const homeLongPressTriggeredRef = useRef(false)
  const homeHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seenLongPressTriggeredRef = useRef(false)
  const seenHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seenPosts = useSeenPosts()
  const toast = useToast()
  const previousSessionDidRef = useRef<string | null>(session?.did ?? null)
  const userInitiatedLogoutRef = useRef(false)
  const HOME_HOLD_MS = 500
  const { entries: mixEntries, setEntryPercent, toggleSource, addEntry, setSingleFeed } = useFeedMix()
  const presetUris = new Set((PRESET_FEED_SOURCES.map((s) => s.uri).filter((uri): uri is string => !!uri)))
  const visiblePresets = PRESET_FEED_SOURCES.filter((s) => !s.uri || !hiddenPresetUris.has(s.uri))
  const savedDeduped = savedFeedSources.filter((s) => !s.uri || !presetUris.has(s.uri))
  const allFeedSources = useMemo(() => {
    const combined: FeedSource[] = [...visiblePresets, ...savedDeduped]
    if (feedOrder.length === 0) return combined
    const orderMap = new Map(feedOrder.map((id, i) => [id, i]))
    return [...combined].sort((a, b) => {
      const ia = orderMap.get(feedSourceId(a)) ?? 9999
      const ib = orderMap.get(feedSourceId(b)) ?? 9999
      return ia - ib
    })
  }, [visiblePresets, savedDeduped, feedOrder])
  const fallbackFeedSource = visiblePresets[0] ?? PRESET_FEED_SOURCES[0]
  const handleFeedsToggleSource = useCallback(
    (clicked: FeedSource) => {
      if (mixEntries.length === 0) {
        addEntry(fallbackFeedSource)
        addEntry(clicked)
      } else {
        toggleSource(clicked)
      }
    },
    [mixEntries.length, addEntry, toggleSource]
  )

  const handleReorderFeeds = useCallback((ordered: FeedSource[]) => {
    const ids = ordered.map(feedSourceId).filter((id): id is string => !!id)
    setFeedOrder(ids)
    try {
      localStorage.setItem(feedOrderKey(did), JSON.stringify(ids))
    } catch {
      // ignore
    }
  }, [did])

  const removableSourceUris = useMemo(
    () => new Set([...savedDeduped.map((s) => s.uri).filter((uri): uri is string => !!uri), ...presetUris]),
    [savedDeduped]
  )

  const startHomeHold = useCallback(() => {
    homeHoldTimerRef.current = setTimeout(() => {
      homeLongPressTriggeredRef.current = true
      seenPosts?.clearSeenAndShowAll()
      homeHoldTimerRef.current = null
    }, HOME_HOLD_MS)
  }, [seenPosts])

  const endHomeHold = useCallback(() => {
    if (homeHoldTimerRef.current) {
      clearTimeout(homeHoldTimerRef.current)
      homeHoldTimerRef.current = null
    }
  }, [])

  const seenHoldAnchorRef = useRef<HTMLElement | null>(null)
  const startSeenHold = useCallback((e: React.PointerEvent) => {
    seenHoldAnchorRef.current = e.currentTarget as HTMLElement
    seenHoldTimerRef.current = setTimeout(() => {
      seenLongPressTriggeredRef.current = true
      seenPosts?.announceShowSeen(seenHoldAnchorRef.current ?? undefined)
      seenPosts?.clearSeenAndShowAll()
      seenHoldTimerRef.current = null
    }, HOME_HOLD_MS)
  }, [seenPosts])

  const endSeenHold = useCallback(() => {
    if (seenHoldTimerRef.current) {
      clearTimeout(seenHoldTimerRef.current)
      seenHoldTimerRef.current = null
    }
  }, [])

  const seenBtnClick = useCallback((e?: React.MouseEvent<HTMLButtonElement>) => {
    if (seenLongPressTriggeredRef.current) {
      seenLongPressTriggeredRef.current = false
      return
    }
    seenPosts?.onHideSeenOnly(e?.currentTarget ?? undefined)
    if (path !== '/feed') navigate('/feed')
  }, [seenPosts, path, navigate])

  const homeBtnClick = useCallback((e: React.MouseEvent) => {
    if (homeLongPressTriggeredRef.current) {
      homeLongPressTriggeredRef.current = false
      e.preventDefault()
      return
    }
    e.preventDefault()
    const onFeed = path === '/feed' || path === '/'
    /* Always route logo clicks to home instead of stepping back in modal/history stacks. */
    if (!onFeed || isModalOpen) {
      navigate('/feed', { replace: true })
      return
    }
    seenPosts?.onHomeClick()
  }, [path, seenPosts, navigate, isModalOpen])

  useEffect(() => {
    document.title = title ? `${title} · PurpleSky` : 'PurpleSky'
  }, [title])

  /* Global keyboard: Q / Backspace = back. Do not handle when a popup is open so the popup gets shortcuts and scroll. */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isModalOpen) return
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
      if (key !== 'q' && e.key !== 'Backspace') return
      /* On feed, Q / Backspace are for chrome and menus; don't treat as browser back */
      if (loc.pathname === '/' || loc.pathname.startsWith('/feed')) return
      e.preventDefault()
      navigate(-1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate, isModalOpen, setViewMode, loc.pathname])

  useEffect(() => {
    if (!accountMenuOpen) return
    const isInsideAccountMenu = (target: EventTarget | null) => {
      const node = target as Node | null
      if (!node) return false
      if (accountMenuRef.current?.contains(node)) return true
      if (accountBtnRef.current?.contains(node)) return true
      return false
    }
    const onPointerDown = (e: PointerEvent) => {
      if (isInsideAccountMenu(e.target)) return
      setAccountMenuOpen(false)
    }
    const onTouchStart = (e: TouchEvent) => {
      if (isInsideAccountMenu(e.target)) return
      setAccountMenuOpen(false)
    }
    const onScroll = (e: Event) => {
      if (isInsideAccountMenu(e.target)) return
      setAccountMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('touchstart', onTouchStart)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [accountMenuOpen])

  useEffect(() => {
    if (!feedFloatButtonsExpanded) return
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (gearFloatWrapRef.current?.contains(t) || headerGearWrapRef.current?.contains(t)) return
      setFeedFloatButtonsExpanded(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [feedFloatButtonsExpanded])

  useEffect(() => {
    if (!aboutOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setAboutOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [aboutOpen])

  useEffect(() => {
    if (!settingsOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setSettingsOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [settingsOpen])

  useEffect(() => {
    if (!notificationsOpen) return
    const isInsideNotificationsMenu = (target: EventTarget | null) => {
      const node = target as Node | null
      if (!node) return false
      if (notificationsMenuRef.current?.contains(node)) return true
      if (notificationsBtnRef.current?.contains(node)) return true
      return false
    }
    const onPointerDown = (e: PointerEvent) => {
      if (isInsideNotificationsMenu(e.target)) return
      setNotificationsOpen(false)
    }
    const onTouchStart = (e: TouchEvent) => {
      if (isInsideNotificationsMenu(e.target)) return
      setNotificationsOpen(false)
    }
    const onScroll = (e: Event) => {
      if (isInsideNotificationsMenu(e.target)) return
      setNotificationsOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('touchstart', onTouchStart)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [notificationsOpen])


  /** When user selects a feed from the header search bar: add to saved list, enable it, then go to feed so the pill appears. */
  const handleSelectFeedFromSearch = useCallback(
    async (source: FeedSource) => {
      if (!source.uri) {
        navigate('/feed', { state: { feedSource: source } })
        return
      }
      if (!session) {
        navigate('/feed', { state: { feedSource: source } })
        return
      }
      setFeedAddError(null)
      try {
        const uri = await resolveFeedUri(source.uri)
        await addSavedFeed(uri)
        const label = source.label ?? (await requestDeduplicator.dedupe(`feed-name:${uri}`, () => getFeedDisplayName(uri)))
        const normalized: FeedSource = { kind: 'custom', label, uri }
        setSavedFeedSources((prev) => (prev.some((s) => s.uri === uri) ? prev : [...prev, normalized]))
        handleFeedsToggleSource(normalized)
        navigate('/feed', { state: { feedSource: normalized } })
      } catch (err) {
        setFeedAddError(err instanceof Error ? err.message : 'Could not add feed. Try again.')
        navigate('/feed', { state: { feedSource: source } })
      }
    },
    [session, navigate, handleFeedsToggleSource]
  )

  const handleRemoveFeed = useCallback(
    async (source: FeedSource) => {
      if (!source.uri) return
      try {
        await removeSavedFeedByUri(source.uri)
        setSavedFeedSources((prev) => prev.filter((s) => s.uri !== source.uri))
        if (mixEntries.some((e) => e.source.uri === source.uri)) toggleSource(source)
        if (presetUris.has(source.uri)) {
          setHiddenPresetUris((prev) => {
            const next = new Set(prev)
            next.add(source.uri!)
            try {
              localStorage.setItem(hiddenPresetKey(did), JSON.stringify([...next]))
            } catch {
              // ignore
            }
            return next
          })
        }
      } catch {
        // ignore
      }
    },
    [mixEntries, toggleSource, did]
  )

  const handleShareFeed = useCallback(async (source: FeedSource) => {
    if (!source.uri) return
    try {
      const url = await getFeedShareUrl(source.uri)
      await navigator.clipboard.writeText(url)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    if (prevFeedDidRef.current !== did) {
      try {
        localStorage.setItem(hiddenPresetKey(prevFeedDidRef.current), JSON.stringify([...hiddenPresetUris]))
        localStorage.setItem(feedOrderKey(prevFeedDidRef.current), JSON.stringify(feedOrder))
      } catch {
        // ignore
      }
      setHiddenPresetUris(loadHiddenPresetUris(did))
      setFeedOrder(loadFeedOrder(did))
      prevFeedDidRef.current = did
    }
  }, [did, hiddenPresetUris, feedOrder])

  const savedFeedsLoadedRef = useRef<boolean>(false)
  const activeSessionDidForSavedFeedsRef = useRef<string | undefined>(undefined)
  activeSessionDidForSavedFeedsRef.current = session?.did
  const savedFeedsTargetDidRef = useRef<string | null>(null)

  const loadSavedFeeds = useCallback(async () => {
    const loadDid = activeSessionDidForSavedFeedsRef.current
    if (!loadDid) {
      setSavedFeedSources([])
      return
    }
    let feeds: { type: string; value: string }[] = []
    try {
      const list = await getSavedFeedsFromPreferences()
      if (activeSessionDidForSavedFeedsRef.current !== loadDid) return
      feeds = list.filter((f) => f.type === 'feed' && f.pinned)

      if (feeds.length === 0) {
        setSavedFeedSources([])
        savedFeedsLoadedRef.current = true
        return
      }

      const feedUris = feeds.map((f) => f.value)
      const labels = await getFeedDisplayNamesBatch(feedUris)
      if (activeSessionDidForSavedFeedsRef.current !== loadDid) return

      const withLabels = feeds.map((f) => ({
        kind: 'custom' as const,
        label: labels.get(f.value) ?? f.value,
        uri: f.value,
      }))
      setSavedFeedSources(withLabels)
      savedFeedsLoadedRef.current = true
    } catch {
      if (activeSessionDidForSavedFeedsRef.current !== loadDid) return
      savedFeedsLoadedRef.current = false
      setSavedFeedSources(
        feeds.length > 0
          ? feeds.map((f) => ({ kind: 'custom' as const, label: f.value, uri: f.value }))
          : []
      )
    }
  }, [])

  useEffect(() => {
    if (!session) {
      savedFeedsTargetDidRef.current = null
      savedFeedsLoadedRef.current = false
      setSavedFeedSources([])
      return
    }
    if (savedFeedsTargetDidRef.current !== session.did) {
      savedFeedsTargetDidRef.current = session.did
      savedFeedsLoadedRef.current = false
    }
    if (savedFeedsLoadedRef.current) return
    void loadSavedFeeds()
  }, [session, loadSavedFeeds])

  useEffect(() => {
    if (feedsDropdownOpen) {
      setFeedAddError(null)
      if (session) loadSavedFeeds()
    }
  }, [feedsDropdownOpen, session, loadSavedFeeds])

  useEffect(() => {
    if (prevFeedsOpenRef.current && !feedsDropdownOpen) setFeedsClosingAngle(360)
    prevFeedsOpenRef.current = feedsDropdownOpen
  }, [feedsDropdownOpen])

  useEffect(() => {
    if (searchModalTopQuery != null) setFeedsDropdownOpen(false)
  }, [searchModalTopQuery])

  /* Clear no-transition class only after we've painted 0deg, so 360→0 doesn't animate */
  useEffect(() => {
    if (!feedsChevronNoTransition || feedsClosingAngle !== null) return
    const id = requestAnimationFrame(() => {
      setFeedsChevronNoTransition(false)
    })
    return () => cancelAnimationFrame(id)
  }, [feedsChevronNoTransition, feedsClosingAngle])

  useEffect(() => {
    if (!feedsDropdownOpen) return
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (feedsDropdownRef.current?.contains(t) || feedsBtnRef.current?.contains(t)) return
      setFeedsDropdownOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [feedsDropdownOpen])

  useEffect(() => {
    if (!notificationsOpen || !session) return
    setNotificationsLoading(true)
    getNotifications(30)
      .then(({ notifications: list }) => {
        setNotifications(list)
        setUnreadNotificationCount(0)
        updateSeenNotifications().catch(() => {})
      })
      .catch(() => setNotifications([]))
      .finally(() => setNotificationsLoading(false))
  }, [notificationsOpen, session])

  /* Mark notifications as seen when they scroll into view */
  useEffect(() => {
    if (!notificationsOpen || !session || notifications.length === 0) return
    maxSeenInViewRef.current = lastSeenAtSyncedRef.current
    markSeenObserverCleanupRef.current = null
    const timeoutId = setTimeout(() => {
      const lists = document.querySelectorAll<HTMLUListElement>('[data-notifications-list]')
      if (lists.length === 0) return
      const markSeenIfNeeded = () => {
        const maxSeenIndexedAt = maxSeenInViewRef.current
        if (maxSeenIndexedAt === '' || maxSeenIndexedAt === lastSeenAtSyncedRef.current) return
        lastSeenAtSyncedRef.current = maxSeenIndexedAt
        updateSeenNotifications(maxSeenIndexedAt)
          .then(() => {
            setNotifications((prev) =>
              prev.map((n) => (n.indexedAt <= maxSeenIndexedAt ? { ...n, isRead: true } : n))
            )
            const newlyRead = notifications.filter((n) => n.indexedAt <= maxSeenIndexedAt && !n.isRead).length
            setUnreadNotificationCount((prev) => Math.max(0, prev - newlyRead))
          })
          .catch(() => {})
      }
      const scheduleMarkSeen = () => {
        if (markSeenDebounceRef.current) clearTimeout(markSeenDebounceRef.current)
        markSeenDebounceRef.current = setTimeout(markSeenIfNeeded, 400)
      }
      const observer = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue
            const at = e.target.getAttribute('data-indexed-at')
            if (at && (maxSeenInViewRef.current === '' || at > maxSeenInViewRef.current)) {
              maxSeenInViewRef.current = at
            }
          }
          scheduleMarkSeen()
        },
        { root: null, rootMargin: '0px', threshold: 0.25 }
      )
      const observed: Element[] = []
      lists.forEach((ul) => {
        ul.querySelectorAll('[data-indexed-at]').forEach((el) => {
          observer.observe(el)
          observed.push(el)
        })
      })
      markSeenObserverCleanupRef.current = () => {
        if (markSeenDebounceRef.current) clearTimeout(markSeenDebounceRef.current)
        observer.disconnect()
      }
    }, 0)
    return () => {
      clearTimeout(timeoutId)
      markSeenObserverCleanupRef.current?.()
      markSeenObserverCleanupRef.current = null
    }
  }, [notificationsOpen, session, notifications])

  /* Fetch unread count when session exists. On initial load/refresh don't show the dot (server count can be stale). */
  useEffect(() => {
    if (!session) {
      unreadCountInitialFetchDoneRef.current = false
      return
    }
    getUnreadNotificationCount()
      .then((count) => {
        if (!unreadCountInitialFetchDoneRef.current) {
          unreadCountInitialFetchDoneRef.current = true
          setUnreadNotificationCount(0)
        } else {
          setUnreadNotificationCount(count)
        }
      })
      .catch(() => setUnreadNotificationCount(0))
  }, [session])

  /* Sync unread count when tab/window becomes visible (e.g. user read notifications in Bluesky app or another tab) */
  const lastUnreadFetchRef = useRef(0)
  useEffect(() => {
    if (!session || typeof document === 'undefined') return
    function onVisibilityChange() {
      if (document.visibilityState === 'visible' && Date.now() - lastUnreadFetchRef.current > 120_000) {
        lastUnreadFetchRef.current = Date.now()
        getUnreadNotificationCount()
          .then(setUnreadNotificationCount)
          .catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [session])

  /* Do not refetch unread count on panel close – server can be stale and would bring the dot back. Count is updated when panel opens (after updateSeen) and on visibility change. */
  const prevNotificationsOpenRef = useRef(false)
  prevNotificationsOpenRef.current = notificationsOpen

  /* When any full-screen popup is open, lock body scroll so only the popup scrolls */
  const anyPopupOpen = isModalOpen || (mobileSearchOpen && !isDesktop) || composeOpen || aboutOpen || settingsOpen
  useEffect(() => {
    if (!scrollLock || !anyPopupOpen) return
    scrollLock.lockScroll()
    return () => scrollLock.unlockScroll()
  }, [anyPopupOpen, scrollLock])

  function focusSearch() {
    if (isDesktop) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      setTimeout(() => searchInputRef.current?.focus(), 300)
    } else {
      setMobileSearchOpen(true)
      setSearchOverlayBottom(0)
      requestAnimationFrame(() => {
        setTimeout(() => {
          searchInputRef.current?.focus({ preventScroll: false })
        }, 200)
      })
    }
  }

  useEffect(() => {
    if (!mobileSearchOpen || typeof window === 'undefined') return
    const vv = window.visualViewport
    if (!vv) return
    const viewport = vv
    function update() {
      setSearchOverlayBottom(window.innerHeight - (viewport.offsetTop + viewport.height))
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update, { passive: true })
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [mobileSearchOpen])

  /* On mobile: focus search input when overlay opens so the keyboard pops up immediately */
  useEffect(() => {
    if (!mobileSearchOpen || isDesktop) return
    const id = setTimeout(() => {
      searchInputRef.current?.focus({ preventScroll: false })
    }, 100)
    return () => clearTimeout(id)
  }, [mobileSearchOpen, isDesktop])

  useEffect(() => {
    if (!composeOpen || isDesktop || typeof window === 'undefined') return
    const vv = window.visualViewport
    if (!vv) return
    const viewport = vv
    function update() {
      setComposeOverlayBottom(window.innerHeight - (viewport.offsetTop + viewport.height))
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update, { passive: true })
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [composeOpen, isDesktop])

  /* Mobile: hide bottom nav when scrolling down; show when scrolling up or when scroll stops. Also collapse gear expandable on scroll. */
  useEffect(() => {
    if (typeof window === 'undefined' || isDesktop) return
    lastScrollYRef.current = window.scrollY
    const SCROLL_THRESHOLD = 8
    const SCROLL_END_MS = 350
    function onScroll() {
      const y = window.scrollY
      const delta = y - lastScrollYRef.current
      if (delta > SCROLL_THRESHOLD) {
        setMobileNavScrollHidden(true)
        setFeedFloatButtonsExpanded(false)
      } else if (delta < -SCROLL_THRESHOLD) {
        setMobileNavScrollHidden(false)
      }
      lastScrollYRef.current = y
      if (scrollEndTimerRef.current) clearTimeout(scrollEndTimerRef.current)
      scrollEndTimerRef.current = setTimeout(() => {
        scrollEndTimerRef.current = null
        setMobileNavScrollHidden(false)
      }, SCROLL_END_MS)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (scrollEndTimerRef.current) clearTimeout(scrollEndTimerRef.current)
    }
  }, [isDesktop])

  function closeMobileSearch() {
    setMobileSearchOpen(false)
    searchInputRef.current?.blur()
  }

  useEffect(() => {
    const prevDid = previousSessionDidRef.current
    const currentDid = session?.did ?? null
    if (prevDid && !currentDid && authResolved) {
      if (!userInitiatedLogoutRef.current) {
        toast?.showToast('You were logged out.')
      }
      userInitiatedLogoutRef.current = false
    }
    previousSessionDidRef.current = currentDid
  }, [session?.did, authResolved, toast])

  async function handleSelectAccount(did: string) {
    const ok = await switchAccount(did)
    if (ok) {
      setAccountSheetOpen(false)
      setAccountMenuOpen(false)
    } else {
      toast?.showToast('Could not switch account. Try again or sign in again.')
    }
  }

  const accountBtnClick = useCallback(() => {
    setAccountMenuOpen((o) => !o)
  }, [])

  function handleAddAccount() {
    setAccountSheetOpen(false)
    setAccountMenuOpen(false)
    openLoginModal()
  }

  function handleLogout() {
    userInitiatedLogoutRef.current = true
    setAccountSheetOpen(false)
    setAccountMenuOpen(false)
    void logout()
  }

  const POST_MAX_LENGTH = 300

  function openCompose() {
    setComposeOpen(true)
    setComposeSegments([{ id: Math.random().toString(36).slice(2), text: '', images: [], imageAlts: [] }])
    setComposeSegmentIndex(0)
    setComposeError(null)
    setComposeOverlayBottom(0)
  }

  function closeCompose() {
    setComposeOpen(false)
    setComposeError(null)
  }

  const COMPOSE_IMAGE_MAX = 4
  const COMPOSE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

  function setCurrentSegmentText(value: string) {
    setComposeSegments((prev) => {
      const n = [...prev]
      const seg = n[composeSegmentIndex]
      if (seg) n[composeSegmentIndex] = { ...seg, text: value }
      return n
    })
  }

  function addComposeImages(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => COMPOSE_IMAGE_TYPES.includes(f.type))
    const seg = currentSegment
    const take = Math.min(list.length, COMPOSE_IMAGE_MAX - seg.images.length)
    if (take <= 0) return
    const added = list.slice(0, take)
    setComposeSegments((prev) => {
      const n = [...prev]
      const s = n[composeSegmentIndex]
      if (s) n[composeSegmentIndex] = { ...s, images: [...s.images, ...added], imageAlts: [...s.imageAlts, ...added.map(() => '')] }
      return n
    })
  }

  function removeComposeImage(index: number) {
    setComposeSegments((prev) => {
      const n = [...prev]
      const s = n[composeSegmentIndex]
      if (s) n[composeSegmentIndex] = { ...s, images: s.images.filter((_, i) => i !== index), imageAlts: s.imageAlts.filter((_, i) => i !== index) }
      return n
    })
  }

  function addComposeThreadSegment() {
    setComposeSegments((prev) => [...prev, { id: Math.random().toString(36).slice(2), text: '', images: [], imageAlts: [] }])
    setComposeSegmentIndex((prev) => prev + 1)
  }

  async function handleComposeSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!session || composePosting) return
    const toPost = composeSegments.filter((s) => s.text.trim() || s.images.length > 0)
    if (toPost.length === 0) return
    setComposeError(null)
    setComposePosting(true)
    try {
      let rootUri: string | null = null
      let rootCid: string | null = null
      let parentUri: string | null = null
      let parentCid: string | null = null
      for (let i = 0; i < toPost.length; i++) {
        const s = toPost[i]
        if (i === 0) {
          const r = await createPost(s.text, s.images.length > 0 ? s.images : undefined, s.imageAlts.length > 0 ? s.imageAlts : undefined)
          rootUri = r.uri
          rootCid = r.cid
          parentUri = r.uri
          parentCid = r.cid
        } else {
          if (!s.text.trim()) continue
          const r = await postReply(rootUri!, rootCid!, parentUri!, parentCid!, s.text)
          parentUri = r.uri
          parentCid = r.cid
        }
      }
      setComposeSegments([{ id: Math.random().toString(36).slice(2), text: '', images: [], imageAlts: [] }])
      setComposeSegmentIndex(0)
      closeCompose()
      navigate('/feed')
    } catch (err) {
      setComposeError(err instanceof Error ? err.message : 'Failed to post')
    } finally {
      setComposePosting(false)
    }
  }

  function handleComposeKeyDown(e: React.KeyboardEvent, form: HTMLFormElement | null) {
    if ((e.key === 'Enter' || e.key === 'E') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (form && (currentSegment.text.trim() || currentSegment.images.length > 0) && !composePosting) {
        form.requestSubmit()
      }
    }
  }

  function handleComposeDrop(e: React.DragEvent) {
    e.preventDefault()
    if (!e.dataTransfer?.files?.length) return
    addComposeImages(e.dataTransfer.files)
  }

  function handleComposeDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const composePreviewUrls = useMemo(
    () => currentSegment.images.map((f) => URL.createObjectURL(f)),
    [currentSegment.images],
  )
  useEffect(() => {
    return () => composePreviewUrls.forEach((u) => URL.revokeObjectURL(u))
  }, [composePreviewUrls])

  /* Mobile nav: Home, [Collections], New, Search, Profile. Desktop tray: Home, New, Search, [Collections]. */
  const searchActive = mobileSearchOpen && !isDesktop
  const homeActive = path === '/feed' && !isModalOpen && !searchActive
  const collectionsActive =
    !!showAccountFeedUi &&
    !searchActive &&
    (path === '/collections' || isHandleBoardPath(path))
  const handleCollectionsNavClick = () => {
    if (!showAccountFeedUi) {
      openLoginModal()
      return
    }
    openCollectionsModal()
  }
  const navTrayItems = (
    <>
      <button
        type="button"
        className={homeActive ? styles.navActive : ''}
        aria-current={homeActive ? 'page' : undefined}
        onPointerDown={startHomeHold}
        onPointerUp={endHomeHold}
        onPointerLeave={endHomeHold}
        onPointerCancel={endHomeHold}
        onClick={homeBtnClick}
        title="Home (hold to show all seen posts)"
      >
        <span className={styles.navIcon}><HomeIcon active={homeActive} /></span>
        <span className={styles.navLabel}>Home</span>
      </button>
      <button
        type="button"
        className={styles.navBtn}
        onClick={openCompose}
        aria-label="New post"
      >
        <span className={styles.navIcon}><PlusIcon /></span>
        <span className={styles.navLabel}>New</span>
      </button>
      <button type="button" className={searchActive ? styles.navActive : styles.navBtn} onClick={focusSearch} aria-label="Search" aria-pressed={searchActive}>
        <span className={styles.navIcon}><SearchIcon active={searchActive} /></span>
        <span className={styles.navLabel}>Search</span>
      </button>
      <button
        type="button"
        className={collectionsActive ? styles.navActive : styles.navBtn}
        onClick={handleCollectionsNavClick}
        aria-current={collectionsActive ? 'page' : undefined}
        aria-label="Collections"
        title="Collections"
      >
        <span className={styles.navIcon}><CollectionsBookmarkNavIcon active={collectionsActive} /></span>
        <span className={styles.navLabel}>Collections</span>
      </button>
    </>
  )

  const navItems = (
    <>
      {isDesktop ? (
        /* Desktop: Home, New, Search, [Collections] */
        navTrayItems
      ) : (
        /* Mobile: Home, Collections, New, Search, Profile (right). Seen-posts button floats above Home. */
        <>
          <div className={styles.navHomeWrap}>
            <button
              type="button"
              className={homeActive ? styles.navActive : ''}
              aria-current={homeActive ? 'page' : undefined}
              onPointerDown={startHomeHold}
              onPointerUp={endHomeHold}
              onPointerLeave={endHomeHold}
              onPointerCancel={endHomeHold}
              onClick={homeBtnClick}
              title="Home (hold to show all read posts)"
            >
              <span className={styles.navIcon}><HomeIcon active={homeActive} /></span>
            </button>
          </div>
          <button
            type="button"
            className={collectionsActive ? styles.navActive : styles.navBtn}
            onClick={handleCollectionsNavClick}
            aria-current={collectionsActive ? 'page' : undefined}
            aria-label="Collections"
            title="Collections"
          >
            <span className={styles.navIcon}><CollectionsBookmarkNavIcon active={collectionsActive} /></span>
          </button>
          <button type="button" className={styles.navBtn} onClick={openCompose} aria-label="New post">
            <span className={styles.navIcon}><PlusIcon /></span>
          </button>
          <button type="button" className={searchActive ? styles.navActive : styles.navBtn} onClick={focusSearch} aria-label="Search" aria-pressed={searchActive}>
            <span className={styles.navIcon}><SearchIcon active={searchActive} /></span>
          </button>
          <div className={styles.navProfileWrap}>
            <button
              ref={accountBtnRef}
              type="button"
              className={styles.navProfileBtn}
              onClick={accountBtnClick}
              aria-label="Account menu"
              aria-expanded={accountMenuOpen}
              title="Account menu"
            >
              <span className={styles.navIcon}>
                {currentAccountAvatar ? (
                  <img
                    src={currentAccountAvatar}
                    alt=""
                    className={styles.navProfileAvatar}
                    loading="lazy"
                    onContextMenu={(e) => e.preventDefault()}
                    draggable={false}
                  />
                ) : (
                  <AccountIcon />
                )}
              </span>
            </button>
          </div>
        </>
      )}
    </>
  )

  const notificationsPanelContent = (
    <>
      <h2 className={styles.menuTitle}>Notifications</h2>
      <div className={styles.notificationFilters}>
        <button type="button" className={notificationFilter === 'all' ? styles.notificationFilterActive : styles.notificationFilter} onClick={() => setNotificationFilter('all')}>All</button>
        <button type="button" className={notificationFilter === 'reply' ? styles.notificationFilterActive : styles.notificationFilter} onClick={() => setNotificationFilter('reply')}>Replies</button>
        <button type="button" className={notificationFilter === 'follow' ? styles.notificationFilterActive : styles.notificationFilter} onClick={() => setNotificationFilter('follow')}>Follows</button>
      </div>
      {notificationsLoading ? (
        <p className={styles.notificationsLoading}>Loading…</p>
      ) : (() => {
        const filtered = notificationFilter === 'all' ? notifications : notifications.filter((n) => n.reason === notificationFilter)
        return filtered.length === 0 ? (
          <p className={styles.notificationsEmpty}>
            {notificationFilter === 'all' ? 'No notifications yet.' : 'No matching notifications.'}
          </p>
        ) : (
          <ul className={styles.notificationsList} data-notifications-list>
            {filtered.map((n) => {
              const handle = n.author.handle ?? n.author.did
              const isFollow = n.reason === 'follow'
              const isReplyOrLike = n.reason === 'reply' || n.reason === 'like'
              const postUriForLink = n.reasonSubject ?? n.uri
              const parsedPost = parseBskyFeedPostUri(postUriForLink)
              let postAuthorHandle: string | undefined
              if (parsedPost && currentAccountDid && parsedPost.did === currentAccountDid) {
                postAuthorHandle = accountProfiles[currentAccountDid]?.handle
              } else if (parsedPost && n.author.did === parsedPost.did) {
                postAuthorHandle = n.author.handle
              }
              const href = isFollow
                ? `/profile/${encodeURIComponent(handle)}`
                : getPostAppPath(postUriForLink, postAuthorHandle)
              const reasonLabel =
                n.reason === 'like' ? 'liked your post' :
                n.reason === 'repost' ? 'reposted your post' :
                n.reason === 'follow' ? 'followed you' :
                n.reason === 'mention' ? 'mentioned you' :
                n.reason === 'reply' ? 'replied to you' :
                n.reason === 'quote' ? 'quoted your post' :
                n.reason
              const useModalOnClick = !isDesktop && (isFollow || isReplyOrLike || n.reason === 'repost' || n.reason === 'mention' || n.reason === 'quote')
              return (
                <li key={n.uri} data-indexed-at={n.indexedAt}>
                  <Link
                    to={href}
                    className={styles.notificationItem}
                    onClick={(e) => {
                      setNotificationsOpen(false)
                      if (useModalOnClick) {
                        e.preventDefault()
                        if (isFollow) {
                          openProfileModal(handle)
                        } else if (isReplyOrLike) {
                          openPostModal(n.uri, undefined, n.uri, n.author?.handle)
                        } else {
                          openPostModal(n.reasonSubject ?? n.uri, undefined, undefined, postAuthorHandle)
                        }
                      } else if (isFollow) {
                        e.preventDefault()
                        openProfileModal(handle)
                      }
                    }}
                  >
                    {n.author.avatar ? (
                      <img src={n.author.avatar} alt="" className={styles.notificationAvatar} loading="lazy" />
                    ) : (
                      <span className={styles.notificationAvatarPlaceholder} aria-hidden>{handle.slice(0, 1).toUpperCase()}</span>
                    )}
                    <span className={styles.notificationTextWrap}>
                      <span className={styles.notificationText}>
                        <strong>@{handle}</strong> {reasonLabel}
                      </span>
                      {n.replyPreview && (
                        <span className={styles.notificationReplyPreview}>{n.replyPreview}</span>
                      )}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )
      })()}
    </>
  )

  const accountPanelContent = (
    <>
      {showAccountFeedUi && (
        <>
          <section className={styles.menuSection}>
            <div className={styles.menuProfileAndAccounts}>
              <div className={styles.menuAccountsBlock}>
                {sessionsList.map((s) => {
            const profile = accountProfiles[s.did]
            const handle = profile?.handle ?? (s as { handle?: string }).handle ?? s.did
            const isCurrent = currentAccountDid != null && s.did === currentAccountDid
            return (
              <button
                key={s.did}
                type="button"
                className={isCurrent ? styles.menuItemActive : styles.menuItem}
                onClick={() => {
                  if (isCurrent) {
                    setAccountMenuOpen(false)
                    setAccountSheetOpen(false)
                    openProfileModal(handle)
                  } else {
                    handleSelectAccount(s.did)
                  }
                }}
                title={isCurrent ? 'View my profile' : `Switch to @${handle}`}
              >
                {profile?.avatar ? (
                  <img src={profile.avatar} alt="" className={styles.accountMenuAvatar} loading="lazy" />
                ) : (
                  <span className={styles.accountMenuAvatarPlaceholder} aria-hidden>{(handle || s.did).slice(0, 1).toUpperCase()}</span>
                )}
                {isCurrent ? (
                  <span className={styles.menuAccountLabel}>
                    <span className={styles.menuAccountLabelDefault}>@{handle}</span>
                    <span className={styles.menuAccountLabelHover}>Open profile</span>
                  </span>
                ) : (
                  <span>@{handle}</span>
                )}
                {isCurrent && <span className={styles.sheetCheck} aria-hidden> ✓</span>}
              </button>
            )
          })}
              </div>
            </div>
            <div className={styles.menuActions}>
              <button type="button" className={styles.menuActionBtn} onClick={handleAddAccount}>
                Add account
              </button>
              <button type="button" className={styles.menuActionSecondary} onClick={handleLogout}>
                Log out
              </button>
            </div>
          </section>
        </>
      )}
      {!showAccountFeedUi && (
        <section className={styles.menuSection}>
          <div className={styles.menuProfileAndAccounts}>
            <a
              href="https://bsky.app"
              target="_blank"
              rel="noopener noreferrer"
              className={`${styles.menuProfileBtn} ${styles.menuProfileBtnAccentHover}`}
              onClick={() => {
                setAccountMenuOpen(false)
                setAccountSheetOpen(false)
              }}
            >
              <span className={styles.menuProfileIconWrap} aria-hidden>
                <AccountIcon />
              </span>
              <span>Create account on Bluesky</span>
            </a>
            <div className={styles.menuAccountsBlock}>
              <button
                type="button"
                className={styles.menuAuthLink}
                onClick={() => {
                  setAccountMenuOpen(false)
                  setAccountSheetOpen(false)
                  openLoginModal()
                }}
              >
                <LogInIcon />
                <span>Log in with Bluesky</span>
              </button>
            </div>
          </div>
        </section>
      )}
    </>
  )

  const feedPullRefreshContextValue = useMemo(
    () => ({
      wrapperRef: showNav && path === '/feed' ? feedPullRefreshWrapperRef : null,
      setHandlers: showNav && path === '/feed' ? setFeedPullRefreshHandlers : null,
      setPullOffsetPx: showNav && path === '/feed' ? setFeedPullOffsetPx : null,
    }),
    [showNav, path]
  )

  useEffect(() => {
    if (path !== '/feed') setFeedPullOffsetPx(0)
  }, [path])

  return (
    <div className={`${styles.wrap} ${showNav && isDesktop ? styles.wrapWithHeader : ''} ${showNav && !isDesktop ? styles.wrapMobileTop : ''}`}>
      <FeedPullRefreshContext.Provider value={feedPullRefreshContextValue}>
      <FeedSwipeProvider feedSources={showAccountFeedUi ? allFeedSources : GUEST_FEED_SOURCES} setSingleFeed={setSingleFeed}>
      <a href="#main-content" className={styles.skipLink}>
        Skip to main content
      </a>
      {showNav && isDesktop && (
      <header className={`${styles.header} ${!showAccountFeedUi ? styles.headerLoggedOut : ''} ${isModalOpen ? styles.headerAboveModal : ''}`} role="banner">
        {(
          <>
            <div className={styles.headerLeft}>
              {isDesktop && (
                <div ref={headerGearWrapRef} className={styles.headerGearWrap}>
                  <button
                    type="button"
                    className={`${styles.headerGearBtn} float-btn ${feedFloatButtonsExpanded ? styles.feedFloatGearActive : ''}`}
                    onClick={() => setFeedFloatButtonsExpanded((e) => !e)}
                    title={feedFloatButtonsExpanded ? 'Hide view options' : 'Show view options'}
                    aria-label={feedFloatButtonsExpanded ? 'Hide view options' : 'Show view options'}
                    aria-expanded={feedFloatButtonsExpanded}
                  >
                    <GearIcon />
                  </button>
                  <div
                    className={`${styles.headerGearExpandable} ${styles.gearFloatExpandable} ${feedFloatButtonsExpanded ? styles.feedFloatButtonsExpandableOpen : ''}`}
                    aria-hidden={!feedFloatButtonsExpanded}
                  >
                    <button
                      type="button"
                      className={`${styles.nsfwFloatBtn} ${styles.gearExpandableBtn} float-btn`}
                      onClick={(e) => cycleNsfwPreference(e.currentTarget, { showToast: false })}
                      title={`${nsfwPreference}. Click to cycle: SFW → Blurred → NSFW`}
                      aria-label={`Content: ${nsfwPreference}. Click to cycle.`}
                    >
                      <NsfwEyeIcon mode={nsfwPreference === 'sfw' ? 'closed' : nsfwPreference === 'blurred' ? 'half' : 'open'} />
                      <span className={styles.gearExpandableLabel}>{NSFW_LABELS[nsfwPreference]}</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.feedFloatBtn} ${styles.gearExpandableBtn} float-btn`}
                      onClick={() => setTheme(cycleThemeMode(theme))}
                      title={`${themeGearLabel}. Click to cycle.`}
                      aria-label={`${themeGearLabel}. Click to cycle.`}
                    >
                      <span className={styles.feedFloatThemeIcon}>
                        <ThemeGearGlyph theme={theme} />
                      </span>
                      <span className={styles.gearExpandableLabel}>{themeGearLabel}</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.feedFloatBtn} ${styles.gearExpandableBtn} float-btn`}
                      onClick={(e) => cycleCardView(e.currentTarget, { showToast: false })}
                      title={CARD_VIEW_LABELS[cardViewMode]}
                      aria-label={CARD_VIEW_LABELS[cardViewMode]}
                    >
                      <CardModeIcon mode={cardViewMode === 'default' ? 'default' : cardViewMode === 'minimalist' ? 'minimalist' : 'artOnly'} />
                      <span className={styles.gearExpandableLabel}>{CARD_VIEW_LABELS[cardViewMode]}</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.feedFloatBtn} ${styles.gearExpandableBtn} float-btn`}
                      onClick={() => cycleMediaMode({ showToast: false })}
                      title={`${MEDIA_MODE_LABELS[mediaMode]}. Click to cycle: All Posts → Media Posts → Text Posts.`}
                      aria-label={MEDIA_MODE_LABELS[mediaMode]}
                    >
                      <MediaModeGlyph mode={mediaMode} />
                      <span className={styles.gearExpandableLabel}>{MEDIA_MODE_LABELS[mediaMode]}</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.feedFloatBtn} ${styles.gearExpandableBtn} float-btn`}
                      onClick={(e) => cycleViewMode(e.currentTarget, { showToast: false })}
                      title={`${VIEW_LABELS[viewMode]}. Click to cycle.`}
                      aria-label={`Columns: ${VIEW_LABELS[viewMode]}. Click to cycle.`}
                    >
                      {viewMode === '1' && <Column1Icon />}
                      {viewMode === '2' && <Column2Icon />}
                      {viewMode === '3' && <Column3Icon />}
                      {viewMode === 'a' && <ColumnAutoIcon />}
                      <span className={styles.gearExpandableLabel}>{VIEW_LABELS[viewMode]}</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.feedFloatBtn} ${styles.gearExpandableBtn} float-btn`}
                      onClick={() => { setFeedFloatButtonsExpanded(false); setSettingsOpen(true) }}
                      title="Manage cache and storage"
                      aria-label="Cache"
                    >
                      <span className={styles.gearExpandableIconSlot}>
                        <SettingsStorageIcon />
                      </span>
                      <span className={styles.gearExpandableLabel}>Cache</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.feedFloatBtn} ${styles.gearExpandableBtn} float-btn`}
                      onClick={() => setAboutOpen(true)}
                      title="About PurpleSky and keyboard shortcuts"
                      aria-label="About PurpleSky"
                    >
                      <AboutIcon />
                      <span className={styles.gearExpandableLabel}>About</span>
                    </button>
                  </div>
                </div>
              )}
              <Link
                to="/feed"
                className={styles.logoLink}
                aria-label="PurpleSky – back to feed"
                title={path === '/feed' ? 'Home (hold to show all read posts)' : 'Back to feed'}
                onPointerDown={startHomeHold}
                onPointerUp={endHomeHold}
                onPointerLeave={endHomeHold}
                onPointerCancel={endHomeHold}
                onClick={homeBtnClick}
              >
                <PurpleSkyLogo className={styles.logoIcon} />
                <span className={styles.logoText}>PurpleSky</span>
                {import.meta.env.VITE_APP_ENV === 'dev' && (
                  <span className={styles.logoDev}> dev</span>
                )}
              </Link>
            </div>
            <div className={styles.headerCenter}>
              {isDesktop ? (
                <div className={styles.headerSearchRow}>
                  <div className={styles.headerSearchSide}>
                    <div className={styles.headerFeedsWrap} ref={feedsDropdownRef}>
                      <button
                        ref={feedsBtnRef}
                        type="button"
                        className={feedsDropdownOpen ? styles.headerFeedsLinkActive : styles.headerFeedsLink}
                        aria-label="Feeds"
                        aria-expanded={feedsDropdownOpen}
                        onClick={() => setFeedsDropdownOpen((o) => !o)}
                      >
                        Feeds
                      </button>
                      {feedsDropdownOpen && (
                        <div className={styles.feedsDropdown} role="dialog" aria-label="Remix feeds">
                          {feedAddError && (
                            <p className={styles.feedAddError} role="alert">
                              {feedAddError}
                            </p>
                          )}
                          <FeedSelector
                            variant="dropdown"
                            sources={showAccountFeedUi ? allFeedSources : GUEST_FEED_SOURCES}
                            fallbackSource={showAccountFeedUi ? fallbackFeedSource : GUEST_FEED_SOURCES[0]}
                            mixEntries={showAccountFeedUi ? mixEntries : GUEST_MIX_ENTRIES}
                            onToggle={handleFeedsToggleSource}
                            setEntryPercent={setEntryPercent}
                            onAddCustom={async (input) => {
                              if (!session) return
                              setFeedAddError(null)
                              try {
                                const isFeedSource = typeof input === 'object' && input !== null && 'uri' in input
                                const uri = isFeedSource ? await resolveFeedUri((input as FeedSource).uri!) : await resolveFeedUri(input as string)
                                await addSavedFeed(uri)
                                const label = isFeedSource ? (input as FeedSource).label ?? await requestDeduplicator.dedupe(`feed-name:${uri}`, () => getFeedDisplayName(uri)) : await requestDeduplicator.dedupe(`feed-name:${uri}`, () => getFeedDisplayName(uri))
                                const source: FeedSource = { kind: 'custom', label, uri }
                                setSavedFeedSources((prev) => (prev.some((s) => s.uri === uri) ? prev : [...prev, source]))
                                handleFeedsToggleSource(source)
                              } catch (err) {
                                setFeedAddError(err instanceof Error ? err.message : 'Could not add feed. Try again.')
                              }
                            }}
                            onToggleWhenGuest={showAccountFeedUi ? undefined : openLoginModal}
                            removableSourceUris={session ? removableSourceUris : undefined}
                            onRemoveFeed={session ? handleRemoveFeed : undefined}
                            onShareFeed={session ? handleShareFeed : undefined}
                            onReorderSources={session ? handleReorderFeeds : undefined}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={styles.headerSearchBarWrap}>
                    <SearchBar inputRef={searchInputRef} compact={isDesktop} onSelectFeed={handleSelectFeedFromSearch} />
                  </div>
                  <div className={styles.headerSearchSide}>
                    {showAccountFeedUi && (
                      <button
                        type="button"
                        className={styles.headerForumLink}
                        aria-label="Collections"
                        onClick={() => openCollectionsModal()}
                      >
                        Collections
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className={styles.headerCenterMobile}>
                  <div className={styles.headerFeedsWrap} ref={feedsDropdownRef}>
                    <button
                      ref={feedsBtnRef}
                      type="button"
                      className={feedsDropdownOpen ? styles.headerFeedsBtnActive : styles.headerFeedsBtn}
                      aria-label="Feeds"
                      aria-expanded={feedsDropdownOpen}
                      onClick={() => setFeedsDropdownOpen((o) => !o)}
                    >
                      <FeedsIcon />
                      <span className={styles.headerFeedsBtnLabel}>Feeds</span>
                    </button>
                    {feedsDropdownOpen && (
                      <div className={styles.feedsDropdown} role="dialog" aria-label="Remix feeds">
                        {feedAddError && (
                          <p className={styles.feedAddError} role="alert">
                            {feedAddError}
                          </p>
                        )}
                        <FeedSelector
                          variant="dropdown"
                          sources={showAccountFeedUi ? allFeedSources : GUEST_FEED_SOURCES}
                          fallbackSource={showAccountFeedUi ? fallbackFeedSource : GUEST_FEED_SOURCES[0]}
                          mixEntries={showAccountFeedUi ? mixEntries : GUEST_MIX_ENTRIES}
                          onToggle={handleFeedsToggleSource}
                          setEntryPercent={setEntryPercent}
                          onAddCustom={async (input) => {
                            if (!session) return
                            setFeedAddError(null)
                            try {
                              const isFeedSource = typeof input === 'object' && input !== null && 'uri' in input
                              const uri = isFeedSource ? await resolveFeedUri((input as FeedSource).uri!) : await resolveFeedUri(input as string)
                              await addSavedFeed(uri)
                              const label = isFeedSource ? (input as FeedSource).label ?? await requestDeduplicator.dedupe(`feed-name:${uri}`, () => getFeedDisplayName(uri)) : await requestDeduplicator.dedupe(`feed-name:${uri}`, () => getFeedDisplayName(uri))
                              const source: FeedSource = { kind: 'custom', label, uri }
                              setSavedFeedSources((prev) => (prev.some((s) => s.uri === uri) ? prev : [...prev, source]))
                              handleFeedsToggleSource(source)
                            } catch (err) {
                              setFeedAddError(err instanceof Error ? err.message : 'Could not add feed. Try again.')
                            }
                          }}
                          onToggleWhenGuest={showAccountFeedUi ? undefined : openLoginModal}
                          removableSourceUris={session ? removableSourceUris : undefined}
                          onRemoveFeed={session ? handleRemoveFeed : undefined}
                          onShareFeed={session ? handleShareFeed : undefined}
                          onReorderSources={session ? handleReorderFeeds : undefined}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className={styles.headerRight}>
              {showAccountFeedUi && isDesktop && (
                <button
                  type="button"
                  className={styles.headerBtnWithLabel}
                  onClick={openCompose}
                  aria-label="New post"
                  title="New post"
                >
                  <PlusIcon />
                  <span className={styles.headerBtnLabel}>New</span>
                </button>
              )}
              {showAccountFeedUi && (
                <div className={styles.headerBtnWrap}>
                  <button
                    ref={notificationsBtnRef}
                    type="button"
                    className={styles.headerBtn}
                    onClick={() => setNotificationsOpen((o) => !o)}
                    aria-label="Notifications"
                    aria-expanded={notificationsOpen}
                    title="Notifications"
                  >
                    <BellIcon />
                  </button>
                  {unreadNotificationCount > 0 && (
                    <span className={styles.notificationUnreadDot} aria-hidden />
                  )}
                  {notificationsOpen && (
                    <div ref={notificationsMenuRef} className={styles.notificationsMenu} role="dialog" aria-label="Notifications">
                      {notificationsPanelContent}
                    </div>
                  )}
                </div>
              )}
              {isDesktop && (
                <>
                  {!showAccountFeedUi && (
                    <button
                      type="button"
                      className={styles.headerAuthLink}
                      onClick={() => openLoginModal()}
                    >
                      Log in
                    </button>
                  )}
                  <div className={styles.headerBtnWrap}>
                    <button
                      ref={accountBtnRef}
                      type="button"
                      className={styles.headerBtn}
                      onClick={accountBtnClick}
                      aria-label="Account menu"
                      aria-expanded={accountMenuOpen}
                      title="Account menu"
                    >
                      <span className={styles.navIcon}>
                        {currentAccountAvatar ? (
                          <img src={currentAccountAvatar} alt="" className={styles.headerAccountAvatar} loading="lazy" />
                        ) : (
                          <AccountIcon />
                        )}
                      </span>
                    </button>
                    {accountMenuOpen && (
                      <div ref={accountMenuRef} className={styles.accountMenu} role="menu" aria-label="Accounts and settings">
                        {accountPanelContent}
                      </div>
                    )}
                  </div>
                </>
              )}
              {/* Mobile: Log in (when logged out) + account button – same positions as desktop */}
              {!isDesktop && (
                <>
                  {!showAccountFeedUi && (
                    <button
                      type="button"
                      className={styles.headerAuthLink}
                      onClick={() => openLoginModal()}
                    >
                      Log in
                    </button>
                  )}
                  <div className={styles.headerAccountMenuWrap}>
                    <button
                      ref={accountBtnRef}
                      type="button"
                      className={styles.headerAccountNavBtn}
                      onClick={accountBtnClick}
                      aria-label="Account menu"
                      aria-expanded={accountMenuOpen}
                      title="Account menu"
                    >
                      <span className={styles.navIcon}>
                        {currentAccountAvatar ? (
                          <img src={currentAccountAvatar} alt="" className={styles.headerAccountAvatar} loading="lazy" />
                        ) : (
                          <AccountIcon />
                        )}
                      </span>
                    </button>
                    {accountMenuOpen && (
                      <div ref={accountMenuRef} className={styles.accountMenu} role="menu" aria-label="Accounts and settings">
                        {accountPanelContent}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </header>
      )}
      {showNav && !isDesktop && (
        <div
          className={`${styles.feedsFloatWrap} feeds-float-wrap ${isModalOpen ? styles.feedsFloatWrapAboveModal : ''} ${mobileNavScrollHidden || (isModalOpen && modalScrollHidden) ? styles.feedsFloatWrapScrollHidden : ''} ${searchModalTopQuery != null ? styles.feedsFloatWrapSearchSlot : ''} ${searchModalTopQuery != null && showFeedStyleSettingsFloat && isModalOpen ? styles.feedsFloatWrapSearchSlotBetweenChrome : ''} ${searchModalTopQuery != null && showFeedStyleSettingsFloat && isModalOpen && showAccountFeedUi ? styles.feedsFloatWrapSearchSlotBetweenChromeRightAccount : ''} ${searchModalTopQuery != null && showFeedStyleSettingsFloat && isModalOpen && !showAccountFeedUi ? styles.feedsFloatWrapSearchSlotBetweenChromeRightGuest : ''}`}
          ref={feedsDropdownRef}
        >
          {searchModalTopQuery != null ? (
            <SearchBar
              seedQuery={searchModalTopQuery}
              hideFilter
              placeholderOverride="Search posts, users, #tags…"
              onSelectFeed={handleSelectFeedFromSearch}
              matchMobileFloatChrome
            />
          ) : (
            <>
              <button
                ref={feedsBtnRef}
                type="button"
                className={`${styles.feedsFloatBtn} float-btn ${feedsDropdownOpen ? styles.feedsFloatBtnActive : ''}`}
                onClick={() => setFeedsDropdownOpen((o) => !o)}
                aria-label="Feeds"
                aria-expanded={feedsDropdownOpen}
              >
                <span className={styles.feedsFloatLabel}>Feeds</span>
                <span
                  ref={feedsChevronRef}
                  className={`${styles.feedsFloatChevronWrap} ${feedsChevronNoTransition ? styles.feedsFloatChevronWrapNoTransition : ''}`}
                  style={{
                    transform: `rotate(${feedsDropdownOpen ? 180 : (feedsClosingAngle ?? 0)}deg)`,
                  }}
                  onTransitionEnd={() => {
                    if (feedsClosingAngle === 360) {
                      flushSync(() => setFeedsChevronNoTransition(true))
                      setFeedsClosingAngle(null)
                    }
                  }}
                >
                  <ChevronDownIcon />
                </span>
              </button>
              {feedsDropdownOpen && (
                <div className={styles.feedsDropdown} role="dialog" aria-label="Remix feeds">
                  {feedAddError && (
                    <p className={styles.feedAddError} role="alert">
                      {feedAddError}
                    </p>
                  )}
                  <FeedSelector
                    variant="dropdown"
                    touchFriendly
                    sources={showAccountFeedUi ? allFeedSources : GUEST_FEED_SOURCES}
                    fallbackSource={showAccountFeedUi ? fallbackFeedSource : GUEST_FEED_SOURCES[0]}
                    mixEntries={showAccountFeedUi ? mixEntries : GUEST_MIX_ENTRIES}
                    onToggle={handleFeedsToggleSource}
                    setEntryPercent={setEntryPercent}
                    onAddCustom={async (input) => {
                      if (!session) return
                      setFeedAddError(null)
                      try {
                        const isFeedSource = typeof input === 'object' && input !== null && 'uri' in input
                        const uri = isFeedSource ? await resolveFeedUri((input as FeedSource).uri!) : await resolveFeedUri(input as string)
                        await addSavedFeed(uri)
                        const label = isFeedSource ? (input as FeedSource).label ?? await requestDeduplicator.dedupe(`feed-name:${uri}`, () => getFeedDisplayName(uri)) : await requestDeduplicator.dedupe(`feed-name:${uri}`, () => getFeedDisplayName(uri))
                        const source: FeedSource = { kind: 'custom', label, uri }
                        setSavedFeedSources((prev) => (prev.some((s) => s.uri === uri) ? prev : [...prev, source]))
                        handleFeedsToggleSource(source)
                      } catch (err) {
                        setFeedAddError(err instanceof Error ? err.message : 'Could not add feed. Try again.')
                      }
                    }}
                    onToggleWhenGuest={showAccountFeedUi ? undefined : openLoginModal}
                    removableSourceUris={session ? removableSourceUris : undefined}
                    onRemoveFeed={session ? handleRemoveFeed : undefined}
                    onShareFeed={session ? handleShareFeed : undefined}
                    onReorderSources={session ? handleReorderFeeds : undefined}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}
      {showNav && !isDesktop && showFeedStyleSettingsFloat && (
        <div ref={gearFloatWrapRef} className={`${styles.gearFloatWrap} ${isModalOpen ? styles.gearFloatWrapModalOpen : ''} ${mobileNavScrollHidden || (isModalOpen && modalScrollHidden) ? styles.gearFloatWrapScrollHidden : ''}`}>
          <button
            type="button"
            className={`${styles.feedFloatBtn} float-btn ${feedFloatButtonsExpanded ? styles.feedFloatGearActive : ''}`}
            onClick={() => setFeedFloatButtonsExpanded((e) => !e)}
            title={feedFloatButtonsExpanded ? 'Hide view options' : 'Show view options'}
            aria-label={feedFloatButtonsExpanded ? 'Hide view options' : 'Show view options'}
            aria-expanded={feedFloatButtonsExpanded}
          >
            <GearIcon />
          </button>
          <div
            className={`${styles.feedFloatButtonsExpandable} ${styles.gearFloatExpandable} ${feedFloatButtonsExpanded ? styles.feedFloatButtonsExpandableOpen : ''}`}
            aria-hidden={!feedFloatButtonsExpanded}
          >
            <button
              type="button"
              className={`${styles.nsfwFloatBtn} ${styles.gearExpandableBtn} float-btn`}
              onClick={(e) => cycleNsfwPreference(e.currentTarget, { showToast: false })}
              title={`${nsfwPreference}. Click to cycle: SFW → Blurred → NSFW`}
              aria-label={`Content: ${nsfwPreference}. Click to cycle.`}
            >
              <NsfwEyeIcon mode={nsfwPreference === 'sfw' ? 'closed' : nsfwPreference === 'blurred' ? 'half' : 'open'} />
              <span className={styles.gearExpandableLabel}>{NSFW_LABELS[nsfwPreference]}</span>
            </button>
            <button
              type="button"
              className={`${styles.feedFloatBtn} ${styles.gearExpandableBtn} float-btn`}
              onClick={() => setTheme(cycleThemeMode(theme))}
              title={`${themeGearLabel}. Click to cycle.`}
              aria-label={`${themeGearLabel}. Click to cycle.`}
            >
              <span className={styles.feedFloatThemeIcon}>
                <ThemeGearGlyph theme={theme} />
              </span>
              <span className={styles.gearExpandableLabel}>{themeGearLabel}</span>
            </button>
            <button
              type="button"
              className={`${styles.feedFloatBtn} ${styles.gearExpandableBtn} float-btn`}
              onClick={(e) => cycleCardView(e.currentTarget, { showToast: false })}
              title={CARD_VIEW_LABELS[cardViewMode]}
              aria-label={CARD_VIEW_LABELS[cardViewMode]}
            >
              <CardModeIcon mode={cardViewMode === 'default' ? 'default' : cardViewMode === 'minimalist' ? 'minimalist' : 'artOnly'} />
              <span className={styles.gearExpandableLabel}>{CARD_VIEW_LABELS[cardViewMode]}</span>
            </button>
            <button
              type="button"
              className={`${styles.feedFloatBtn} ${styles.gearExpandableBtn} float-btn`}
              onClick={() => cycleMediaMode({ showToast: false })}
              title={`${MEDIA_MODE_LABELS[mediaMode]}. Click to cycle: All Posts → Media Posts → Text Posts.`}
              aria-label={MEDIA_MODE_LABELS[mediaMode]}
            >
              <MediaModeGlyph mode={mediaMode} />
              <span className={styles.gearExpandableLabel}>{MEDIA_MODE_LABELS[mediaMode]}</span>
            </button>
            <button
              type="button"
              className={`${styles.feedFloatBtn} ${styles.gearExpandableBtn} float-btn`}
              onClick={(e) => cycleViewMode(e.currentTarget, { showToast: false })}
              title={`${VIEW_LABELS[viewMode]}. Click to cycle.`}
              aria-label={`Columns: ${VIEW_LABELS[viewMode]}. Click to cycle.`}
            >
              {viewMode === '1' && <Column1Icon />}
              {viewMode === '2' && <Column2Icon />}
              {viewMode === '3' && <Column3Icon />}
              {viewMode === 'a' && <ColumnAutoIcon />}
              <span className={styles.gearExpandableLabel}>{VIEW_LABELS[viewMode]}</span>
            </button>
            <button
              type="button"
              className={`${styles.feedFloatBtn} ${styles.gearExpandableBtn} float-btn`}
              onClick={() => { setFeedFloatButtonsExpanded(false); setSettingsOpen(true) }}
              title="Manage cache and storage"
              aria-label="Cache"
            >
              <span className={styles.gearExpandableIconSlot}>
                <SettingsStorageIcon />
              </span>
              <span className={styles.gearExpandableLabel}>Cache</span>
            </button>
            <button
              type="button"
              className={`${styles.feedFloatBtn} ${styles.gearExpandableBtn} float-btn`}
              onClick={() => setAboutOpen(true)}
              title="About PurpleSky and keyboard shortcuts"
              aria-label="About PurpleSky"
            >
              <AboutIcon />
              <span className={styles.gearExpandableLabel}>About</span>
            </button>
          </div>
        </div>
      )}
      {showNav && !isDesktop && !showAccountFeedUi && (
        <div className={`${styles.loginFloatWrap} login-float-wrap ${isModalOpen ? styles.loginFloatWrapAboveModal : ''} ${mobileNavScrollHidden || (isModalOpen && modalScrollHidden) ? styles.loginFloatWrapScrollHidden : ''}`}>
          <button
            type="button"
            className={`${styles.loginFloatBtn} float-btn`}
            onClick={() => openLoginModal()}
            aria-label="Log in"
            title="Log in"
          >
            Log in
          </button>
        </div>
      )}
      {showNav && !isDesktop && showAccountFeedUi && (
        <div className={`${styles.notificationFloatWrap} notification-float-wrap ${isModalOpen ? styles.notificationFloatWrapAboveModal : ''} ${mobileNavScrollHidden || (isModalOpen && modalScrollHidden) ? styles.notificationFloatWrapScrollHidden : ''}`}>
          <button
            ref={notificationsBtnRef}
            type="button"
            className={`${styles.notificationFloatBtn} float-btn`}
            onClick={() => setNotificationsOpen((o) => !o)}
            aria-label="Notifications"
            aria-expanded={notificationsOpen}
            title="Notifications"
          >
            <BellIcon />
            {unreadNotificationCount > 0 && (
              <span className={styles.notificationUnreadDot} aria-hidden />
            )}
          </button>
          {notificationsOpen && (
            <div ref={notificationsMenuRef} className={styles.notificationsMenu} role="dialog" aria-label="Notifications">
              {notificationsPanelContent}
            </div>
          )}
        </div>
      )}
      {showNav && !isDesktop && accountMenuOpen && (
        <div className={styles.accountMenuAboveWrap}>
          <div ref={accountMenuRef} className={styles.accountMenuAbove} role="menu" aria-label="Accounts and settings">
            {accountPanelContent}
          </div>
        </div>
      )}
      <main
        id="main-content"
        className={`${styles.main} ${mainAllColumnsWidth ? styles.mainAllColumns : ''}`}
        aria-label="Main content"
      >
        {showNav && path === '/feed' ? (
          <div
            ref={feedPullRefreshWrapperRef}
            style={
              !isDesktop
                ? { transform: `translateY(${feedPullOffsetPx}px)` }
                : undefined
            }
            onTouchStart={feedPullRefreshHandlers?.onTouchStart}
            onTouchMove={feedPullRefreshHandlers?.onTouchMove}
            onTouchEnd={feedPullRefreshHandlers?.onTouchEnd}
          >
            <div className={styles.feedSelectorStickyWrap}>
              <FeedSelector
                variant="page"
                sources={showAccountFeedUi ? allFeedSources : GUEST_FEED_SOURCES}
                fallbackSource={showAccountFeedUi ? fallbackFeedSource : GUEST_FEED_SOURCES[0]}
                mixEntries={showAccountFeedUi ? mixEntries : GUEST_MIX_ENTRIES}
                onToggle={handleFeedsToggleSource}
                setEntryPercent={setEntryPercent}
                onAddCustom={async (input) => {
                  if (!session) return
                  setFeedAddError(null)
                  try {
                    const isFeedSource = typeof input === 'object' && input !== null && 'uri' in input
                    const uri = isFeedSource ? await resolveFeedUri((input as FeedSource).uri!) : await resolveFeedUri(input as string)
                    await addSavedFeed(uri)
                    const label = isFeedSource ? (input as FeedSource).label ?? await requestDeduplicator.dedupe(`feed-name:${uri}`, () => getFeedDisplayName(uri)) : await requestDeduplicator.dedupe(`feed-name:${uri}`, () => getFeedDisplayName(uri))
                    const source: FeedSource = { kind: 'custom', label, uri }
                    setSavedFeedSources((prev) => (prev.some((s) => s.uri === uri) ? prev : [...prev, source]))
                    handleFeedsToggleSource(source)
                  } catch (err) {
                    setFeedAddError(err instanceof Error ? err.message : 'Could not add feed. Try again.')
                  }
                }}
                onToggleWhenGuest={showAccountFeedUi ? undefined : openLoginModal}
                removableSourceUris={session ? removableSourceUris : undefined}
                onRemoveFeed={session ? handleRemoveFeed : undefined}
                onShareFeed={session ? handleShareFeed : undefined}
                onReorderSources={session ? handleReorderFeeds : undefined}
              />
            </div>
            {children}
          </div>
        ) : (
          children
        )}
      </main>
      {showNav && (
        <>
          {typeof document !== 'undefined' &&
            createPortal(
              <div
                className={`${styles.navOuter} nav-outer ${navVisible ? '' : styles.navHidden} ${!isDesktop && (mobileNavScrollHidden || (isModalOpen && modalScrollHidden)) ? styles.navOuterScrollHidden : ''}`}
              >
                {!isModalOpen && (
                  <button
                    type="button"
                    className={`${styles.seenPostsFloatBtn} hide-seen-fab float-btn`}
                    onPointerDown={(e) => startSeenHold(e)}
                    onPointerUp={endSeenHold}
                    onPointerLeave={endSeenHold}
                    onPointerCancel={endSeenHold}
                    onClick={(e) => seenBtnClick(e)}
                    title="Tap to hide read posts, hold to show them again"
                    aria-label="Read posts: tap to hide, hold to show again"
                  >
                    <SeenPostsIcon />
                  </button>
                )}
                <nav
                  className={`${styles.nav} nav`}
                  aria-label="Main navigation"
                >
                  {navItems}
                </nav>
              </div>,
              document.body
            )}
          {mobileSearchOpen && !isDesktop && (
            <>
              <div
                className={styles.searchOverlayBackdrop}
                onClick={closeMobileSearch}
                aria-hidden
              />
              <div
                className={`${styles.searchOverlayCenter} ${!isDesktop ? styles.searchOverlayMobileBottom : styles.searchOverlayAboveKeyboard}`}
                role="dialog"
                aria-label="Search"
                style={{ bottom: searchOverlayBottom }}
              >
                <div className={styles.searchOverlayCard}>
                  <SearchBar inputRef={searchInputRef} onClose={closeMobileSearch} suggestionsAbove onSelectFeed={handleSelectFeedFromSearch} />
                </div>
              </div>
            </>
          )}
          {composeOpen && (
            <>
              <div
                className={styles.searchOverlayBackdrop}
                onClick={closeCompose}
                aria-hidden
              />
              <div
                className={`${styles.composeOverlay} ${!isDesktop ? styles.composeOverlayMobile : ''}`}
                role="dialog"
                aria-label="New post"
                onClick={(e) => { if (e.target === e.currentTarget) closeCompose() }}
                onKeyDown={(e) => { if (e.key === 'Escape') closeCompose() }}
                onDragOver={handleComposeDragOver}
                onDrop={handleComposeDrop}
                style={!isDesktop ? { bottom: composeOverlayBottom } : undefined}
              >
                <div className={styles.composeCard}>
                  <header className={styles.composeHeader}>
                    <button type="button" className={styles.composeCancel} onClick={closeCompose} disabled={composePosting}>
                      Cancel
                    </button>
                    <h2 className={styles.composeTitle}>New post</h2>
                    <div className={styles.composeHeaderPostWrap}>
                      {session && (
                        <button
                          type="submit"
                          form="compose-form"
                          className={styles.composeSubmit}
                          disabled={composePosting || composeSegments.every((s) => !s.text.trim() && s.images.length === 0)}
                        >
                          {composePosting ? 'Posting…' : 'Post'}
                        </button>
                      )}
                    </div>
                  </header>
                  {!session ? (
                    <p className={styles.composeSignIn}>
                      <button type="button" className={styles.composeSignInLink} onClick={() => { closeCompose(); openLoginModal(); }}>Log in</button> to post.
                    </p>
                  ) : (
                    <Suspense
                      fallback={
                        <div className={styles.composeLazyFallback} role="status" aria-live="polite">
                          Loading composer…
                        </div>
                      }
                    >
                      <LayoutComposerForm
                        composeSegments={composeSegments}
                        composeSegmentIndex={composeSegmentIndex}
                        setComposeSegmentIndex={setComposeSegmentIndex}
                        composePosting={composePosting}
                        composeError={composeError}
                        composeFormRef={composeFormRef}
                        composeFileInputRef={composeFileInputRef}
                        currentSegment={currentSegment}
                        setComposeSegments={setComposeSegments}
                        setCurrentSegmentText={setCurrentSegmentText}
                        handleComposeSubmit={handleComposeSubmit}
                        handleComposeKeyDown={handleComposeKeyDown}
                        addComposeImages={addComposeImages}
                        removeComposeImage={removeComposeImage}
                        addComposeThreadSegment={addComposeThreadSegment}
                        composePreviewUrls={composePreviewUrls}
                        isDesktop={isDesktop}
                        postMaxLength={POST_MAX_LENGTH}
                        composeImageMax={COMPOSE_IMAGE_MAX}
                      />
                    </Suspense>
                  )}
                </div>
              </div>
            </>
          )}
          {settingsOpen && toast && (
            <Suspense fallback={null}>
              <SettingsModalLazy
                onClose={() => setSettingsOpen(false)}
                showToast={toast.showToast}
              />
            </Suspense>
          )}
          {aboutOpen && (
            <>
              <div
                className={styles.searchOverlayBackdrop}
                onClick={() => setAboutOpen(false)}
                aria-hidden
              />
              <div
                className={styles.aboutOverlay}
                role="dialog"
                aria-label="About PurpleSky"
                onClick={(e) => { if (e.target === e.currentTarget) setAboutOpen(false) }}
                onKeyDown={(e) => { if (e.key === 'Escape') setAboutOpen(false) }}
              >
                <div className={styles.aboutCard}>
                  <h2 className={styles.aboutTitle}>PurpleSky</h2>
                  <p className={styles.aboutIntro}>
                    A Bluesky client focused on art.
                  </p>
                  <h3 className={styles.aboutSubtitle}>Keyboard shortcuts</h3>
                  <dl className={styles.aboutShortcuts}>
                    <dt>W / ↑</dt><dd>Move up</dd>
                    <dt>A / ←</dt><dd>Move left</dd>
                    <dt>S / ↓</dt><dd>Move down</dd>
                    <dt>D / →</dt><dd>Move right</dd>
                    <dt>E</dt><dd>Enter post</dd>
                    <dt>Q / Backspace</dt><dd>Back / quit post</dd>
                    <dt>R</dt><dd>Reply to post</dd>
                    <dt>C</dt><dd>Collect post</dd>
                    <dt>F</dt><dd>Follow author</dd>
                    <dt>Spacebar</dt><dd>Like post</dd>
                    <dt>Escape</dt><dd>Escape all windows</dd>
                  </dl>
                  <button
                    type="button"
                    className={styles.aboutClose}
                    onClick={() => setAboutOpen(false)}
                    aria-label="Close"
                  >
                    Close
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
      {toast?.toastMessage &&
        createPortal(
          <div
            className={`app-toast float-btn${toast.toastPosition ? ' app-toast--anchored' : ''}`}
            style={
              toast.toastPosition
                ? {
                    top: toast.toastPosition.y,
                    left: toast.toastPosition.cx,
                    bottom: 'auto',
                    transform: 'translateX(-50%)',
                  }
                : undefined
            }
            role="status"
            aria-live="polite"
          >
            {toast.toastMessage}
          </div>,
          document.body
        )}
      <SWUpdateToast />
      </FeedSwipeProvider>
      </FeedPullRefreshContext.Provider>
    </div>
  )
}
