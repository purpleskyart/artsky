import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, type Location } from 'react-router-dom'
import { ChunkLoadError } from '../components/ChunkLoadError'
import { isHandleBoardPath } from '../lib/routes'
import { getPostOverlayPath } from '../lib/appUrl'
import { getOverlayBackgroundLocation, hasPathOverlayStack } from '../lib/overlayNavigation'
import { preloadProfileOpen } from '../lib/modalPreload'

const PostDetailModal = lazy(() => import('../components/PostDetailModal'))
const ProfileModal = lazy(() => import('../components/ProfileModal'))
const TagModal = lazy(() => import('../components/TagModal'))
const SearchModal = lazy(() => import('../components/SearchModal'))
const QuotesModal = lazy(() => import('../components/QuotesModal'))

export type ModalItem =
  | { type: 'post'; uri: string; openReply?: boolean; focusUri?: string }
  | { type: 'profile'; handle: string }
  | { type: 'tag'; tag: string }
  | { type: 'search'; query: string }
  | { type: 'quotes'; uri: string }

type ProfileModalContextValue = {
  openProfileModal: (handle: string) => void
  closeProfileModal: () => void
  openPostModal: (uri: string, openReply?: boolean, focusUri?: string, authorHandle?: string) => void
  closePostModal: () => void
  openTagModal: (tag: string) => void
  openSearchModal: (query: string) => void
  openQuotesModal: (postUri: string) => void
  openCollectionsModal: () => void
  /** Go back to previous modal (Q or back button). */
  closeModal: () => void
  /** Close all modals (ESC, backdrop click, or X). */
  closeAllModals: () => void
  /** True if any modal is open. */
  isModalOpen: boolean
  /** True if more than one modal is open (show back button). */
  canGoBack: boolean
  /** True when user has scrolled down in a modal (hide nav/back/gear). */
  modalScrollHidden: boolean
  setModalScrollHidden: (v: boolean) => void
}

const ProfileModalContext = createContext<ProfileModalContextValue | null>(null)

/**
 * URL ↔ modal stack: single source of truth for all popups.
 * To add a new modal type: add the variant to ModalItem, then in parseSearchToModalStack (read param)
 * and modalItemToSearch (write param). openXxx() just navigates; stack is derived from location.search each render (no lag vs URL).
 * When both profile= and post= are in the URL, stack is [profile, post] so back from post returns to profile.
 * Opening a profile from the app uses `?profile=` on the frozen pathname (e.g. `/feed?profile=`) so history stacks
 * like the feed post overlay: push post → POP restores the previous entry with the same mounted modal and scroll.
 */
function parseSearchToModalStack(search: string): ModalItem[] {
  const params = new URLSearchParams(search)
  const forumPostParam = params.get('forumPost')
  const bskyThreadFromLegacy =
    forumPostParam && forumPostParam.includes('app.bsky.feed.post') ? forumPostParam : null
  const postUriParam = params.get('post')
  const resolvedPostUriRaw = postUriParam ?? bskyThreadFromLegacy
  const resolvedPostUri =
    resolvedPostUriRaw && resolvedPostUriRaw.length > 0 ? resolvedPostUriRaw : null

  const stack: ModalItem[] = []
  const profileHandle = params.get('profile')
  if (profileHandle) stack.push({ type: 'profile', handle: profileHandle })

  if (resolvedPostUri) {
    const focusUri = params.get('focus') ?? undefined
    stack.push({
      type: 'post',
      uri: resolvedPostUri,
      openReply: params.get('reply') === '1',
      focusUri: focusUri ?? undefined,
    })
  }
  if (stack.length > 0) return stack
  const tag = params.get('tag')
  if (tag) return [{ type: 'tag', tag }]
  const searchQuery = params.get('search')
  if (searchQuery) return [{ type: 'search', query: searchQuery }]
  const quotesUri = params.get('quotes')
  if (quotesUri) return [{ type: 'quotes', uri: quotesUri }]
  return []
}

/** Serialize one modal layer into URLSearchParams (single source of truth for encoding). */
function appendModalItemToSearchParams(p: URLSearchParams, item: ModalItem): void {
  if (item.type === 'post') {
    p.set('post', item.uri)
    if (item.openReply) p.set('reply', '1')
    if (item.focusUri) p.set('focus', item.focusUri)
    return
  }
  if (item.type === 'profile') {
    p.set('profile', item.handle)
    return
  }
  if (item.type === 'tag') {
    p.set('tag', item.tag)
    return
  }
  if (item.type === 'search') {
    p.set('search', item.query)
    return
  }
  if (item.type === 'quotes') {
    p.set('quotes', item.uri)
    return
  }
}

function modalStackToSearch(stack: ModalItem[]): string {
  const p = new URLSearchParams()
  for (const item of stack) {
    appendModalItemToSearchParams(p, item)
  }
  return p.toString()
}

function modalItemToSearch(item: ModalItem): string {
  return modalStackToSearch([item])
}

/**
 * Full-page post URLs use `/post/:uri` in the path. Modal stacks encode the post in `?post=`; keeping
 * both would show the path post while query pointed elsewhere — so modal navigation must use `/feed`.
 */
function pathForModalNavigation(pathname: string): string {
  if (pathname.startsWith('/post/')) return '/feed'
  if (/^\/profile\/[^/]+\/post\//.test(pathname)) return '/feed'
  if (/^\/profile\/[^/]+$/.test(pathname)) return '/feed'
  if (pathname === '/collections' || isHandleBoardPath(pathname)) return '/feed'
  return pathname
}

/** Preserve frozen underlay (feed scroll) on replace navigations that only change modal query params. */
function overlayBackgroundNavigateState(loc: Location): { backgroundLocation: Location } | undefined {
  const bg = (loc.state as { backgroundLocation?: Location } | null)?.backgroundLocation
  return bg != null ? { backgroundLocation: bg } : undefined
}

export function ProfileModalProvider({ children }: { children: ReactNode }) {
  const [modalScrollHidden, setModalScrollHidden] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  /** Same render as router URL — avoids one-frame (or stuck) stale stack when useEffect lagged behind navigate(). */
  const modalStack = useMemo(() => parseSearchToModalStack(location.search), [location.search])

  useEffect(() => {
    const t = requestAnimationFrame(() => setModalScrollHidden(false))
    return () => cancelAnimationFrame(t)
  }, [location.search, location.pathname])

  /** Opens post via URI path with optional `reply` / `focus` query for instant modal resolution. */
  const openPostModal = useCallback((uri: string, openReply?: boolean, focusUri?: string, _authorHandle?: string) => {
    const bg = getOverlayBackgroundLocation(location)
    /**
     * Path-based profile popup (`/profile/h` + backgroundLocation): encode as `?profile=&post=` on the
     * frozen pathname so the profile modal stays mounted (same idea as feed + post overlay).
     */
    const profilePathMatch = /^\/profile\/([^/]+)\/?$/.exec(location.pathname)
    if (hasPathOverlayStack(location) && profilePathMatch) {
      const handle = decodeURIComponent(profilePathMatch[1])
      const rawSearch = bg.search?.replace(/^\?/, '') ?? ''
      const p = new URLSearchParams(rawSearch)
      p.set('profile', handle)
      p.set('post', uri)
      p.delete('forumPost')
      if (openReply) p.set('reply', '1')
      else p.delete('reply')
      if (focusUri) p.set('focus', focusUri)
      else p.delete('focus')
      const qs = p.toString()
      navigate(
        { pathname: bg.pathname, search: qs ? `?${qs}` : '', hash: bg.hash ?? '' },
        { replace: false, state: { backgroundLocation: bg } },
      )
      return
    }

    /**
     * Query-based profile (`/feed?profile=…`, `/tag/x?profile=…`, …): push post onto the same pathname +
     * search so browser back pops the post entry and leaves the profile modal mounted (feed-style history).
     */
    const profileInSearch = new URLSearchParams(location.search).get('profile')
    if (
      profileInSearch &&
      hasPathOverlayStack(location) &&
      !location.pathname.startsWith('/post/') &&
      !/^\/profile\/[^/]+\/post\//.test(location.pathname)
    ) {
      const p = new URLSearchParams(location.search.replace(/^\?/, ''))
      p.set('post', uri)
      p.delete('forumPost')
      if (openReply) p.set('reply', '1')
      else p.delete('reply')
      if (focusUri) p.set('focus', focusUri)
      else p.delete('focus')
      const qs = p.toString()
      navigate(
        { pathname: location.pathname, search: qs ? `?${qs}` : '', hash: location.hash },
        { replace: false, state: location.state ?? undefined },
      )
      return
    }

    const path = getPostOverlayPath(uri)
    const q = new URLSearchParams()
    if (openReply) q.set('reply', '1')
    if (focusUri) q.set('focus', focusUri)
    const qs = q.toString()
    navigate(
      { pathname: path, search: qs ? `?${qs}` : '' },
      { replace: false, state: { backgroundLocation: bg } }
    )
  }, [navigate, location])

  const openProfileModal = useCallback((handle: string) => {
    preloadProfileOpen(handle)
    const bg = getOverlayBackgroundLocation(location)
    const rawSearch = bg.search?.replace(/^\?/, '') ?? ''
    const p = new URLSearchParams(rawSearch)
    p.set('profile', handle)
    p.delete('post')
    p.delete('forumPost')
    p.delete('reply')
    p.delete('focus')
    p.delete('tag')
    p.delete('search')
    p.delete('quotes')
    const qs = p.toString()
    navigate(
      { pathname: bg.pathname, search: qs ? `?${qs}` : '', hash: bg.hash ?? '' },
      { replace: false, state: { backgroundLocation: bg } },
    )
  }, [navigate, location])

  const openTagModal = useCallback((tag: string) => {
    const item: ModalItem = { type: 'tag', tag }
    const search = `?${modalItemToSearch(item)}`
    navigate({ pathname: pathForModalNavigation(location.pathname), search }, { replace: false })
  }, [location.pathname, navigate])

  const openSearchModal = useCallback((query: string) => {
    const item: ModalItem = { type: 'search', query }
    const search = `?${modalItemToSearch(item)}`
    navigate({ pathname: pathForModalNavigation(location.pathname), search }, { replace: false })
  }, [location.pathname, navigate])

  const openQuotesModal = useCallback((postUri: string) => {
    const item: ModalItem = { type: 'quotes', uri: postUri }
    const search = `?${modalItemToSearch(item)}`
    navigate({ pathname: pathForModalNavigation(location.pathname), search }, { replace: false })
  }, [location.pathname, navigate])

  const openCollectionsModal = useCallback(() => {
    const bg = getOverlayBackgroundLocation(location)
    navigate({ pathname: '/collections', search: '' }, { replace: false, state: { backgroundLocation: bg } })
  }, [navigate, location])

  const closeModal = useCallback(() => {
    const stack = parseSearchToModalStack(location.search)
    const preserve = overlayBackgroundNavigateState(location)
    if (stack.length > 1) {
      const bg = getOverlayBackgroundLocation(location)
      /* Same history entry the feed uses for post overlays: POP so in-modal back matches browser back. */
      if (location.pathname === bg.pathname) {
        navigate(-1)
        return
      }
      const next = stack.slice(0, -1)
      const search = next.length > 0 ? `?${modalStackToSearch(next)}` : ''
      navigate(
        { pathname: pathForModalNavigation(location.pathname), search },
        { replace: true, state: preserve },
      )
      return
    }
    if (hasPathOverlayStack(location)) {
      navigate(-1)
      return
    }
    /* stack length 0 or 1 */
    navigate(
      { pathname: pathForModalNavigation(location.pathname), search: '' },
      { replace: true, state: preserve },
    )
  }, [location, navigate])

  const closeAllModals = useCallback(() => {
    if (hasPathOverlayStack(location)) {
      navigate(-1)
      return
    }
    const preserve = overlayBackgroundNavigateState(location)
    navigate(
      { pathname: pathForModalNavigation(location.pathname), search: '' },
      { replace: true, state: preserve },
    )
  }, [location, navigate])

  const isModalOpen = modalStack.length > 0 || hasPathOverlayStack(location)
  const canGoBack = modalStack.length > 1

  const value: ProfileModalContextValue = useMemo(() => ({
    openProfileModal,
    closeProfileModal: closeModal,
    closePostModal: closeModal,
    openPostModal,
    openTagModal,
    openSearchModal,
    openQuotesModal,
    openCollectionsModal,
    closeModal,
    closeAllModals,
    isModalOpen,
    canGoBack,
    modalScrollHidden,
    setModalScrollHidden,
  }), [
    openProfileModal,
    closeModal,
    openPostModal,
    openTagModal,
    openSearchModal,
    openQuotesModal,
    openCollectionsModal,
    closeAllModals,
    isModalOpen,
    canGoBack,
    modalScrollHidden,
  ])

  const modalStackElements = modalStack.map((item, index) => {
    const isTop = index === modalStack.length - 1
    const canGoBackFromThis = isTop && modalStack.length > 1
    const key = `${index}-${item.type}-${
      item.type === 'profile'
        ? item.handle
        : item.type === 'post'
          ? item.uri
          : item.type === 'tag'
            ? item.tag
            : item.type === 'search'
              ? item.query
              : item.type === 'quotes'
                ? item.uri
                : index
    }`
    const wrap = (node: ReactNode) => (
      <Suspense key={key} fallback={null}>
        {node}
      </Suspense>
    )
    if (item.type === 'post') {
      return wrap(
        <PostDetailModal
          uri={item.uri}
          openReply={item.openReply}
          focusUri={item.focusUri}
          onClose={closeAllModals}
          onBack={closeModal}
          canGoBack={canGoBackFromThis}
          isTopModal={isTop}
          stackIndex={index}
        />,
      )
    }
    if (item.type === 'profile') {
      return wrap(
        <ProfileModal
          handle={item.handle}
          onClose={closeAllModals}
          onBack={closeModal}
          canGoBack={canGoBackFromThis}
          isTopModal={isTop}
          stackIndex={index}
        />,
      )
    }
    if (item.type === 'tag') {
      return wrap(
        <TagModal
          tag={item.tag}
          onClose={closeAllModals}
          onBack={closeModal}
          canGoBack={canGoBackFromThis}
          isTopModal={isTop}
          stackIndex={index}
        />,
      )
    }
    if (item.type === 'search') {
      return wrap(
        <SearchModal
          query={item.query}
          onClose={closeAllModals}
          onBack={closeModal}
          canGoBack={canGoBackFromThis}
          isTopModal={isTop}
          stackIndex={index}
        />,
      )
    }
    if (item.type === 'quotes') {
      return wrap(
        <QuotesModal
          postUri={item.uri}
          onClose={closeAllModals}
          onBack={closeModal}
          canGoBack={canGoBackFromThis}
          isTopModal={isTop}
          stackIndex={index}
        />,
      )
    }
    return null
  })

  return (
    <ProfileModalContext.Provider value={value}>
      {children}
      <ChunkLoadError>{modalStackElements}</ChunkLoadError>
    </ProfileModalContext.Provider>
  )
}

export function useProfileModal() {
  const ctx = useContext(ProfileModalContext)
  if (!ctx) {
    return {
      openProfileModal: () => {},
      closeProfileModal: () => {},
      openPostModal: () => {},
      closePostModal: () => {},
      openTagModal: () => {},
      openSearchModal: () => {},
      openQuotesModal: () => {},
      openCollectionsModal: () => {},
      closeModal: () => {},
      closeAllModals: () => {},
      isModalOpen: false,
      canGoBack: false,
      modalScrollHidden: false,
      setModalScrollHidden: () => {},
    }
  }
  return ctx
}
