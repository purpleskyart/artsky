import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, type Location } from 'react-router-dom'
import { ChunkLoadError } from '../components/ChunkLoadError'
import { isHandleBoardPath } from '../lib/routes'
import { getPostOverlayPath } from '../lib/appUrl'
import { getOverlayBackgroundLocation, hasPathOverlayStack } from '../lib/overlayNavigation'

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

export function ProfileModalProvider({ children }: { children: ReactNode }) {
  const [modalScrollHidden, setModalScrollHidden] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  /** Same render as router URL — avoids one-frame (or stuck) stale stack when useEffect lagged behind navigate(). */
  const modalStack = useMemo(() => parseSearchToModalStack(location.search), [location.search])

  /** Legacy `/feed?profile=handle` → canonical `/profile/handle` with overlay (keep `?profile=&post=` stacks). */
  useEffect(() => {
    if (location.pathname !== '/feed') return
    const stack = parseSearchToModalStack(location.search)
    if (stack.length !== 1 || stack[0].type !== 'profile') return
    const h = stack[0].handle
    const params = new URLSearchParams(location.search)
    params.delete('profile')
    const feedSearch = params.toString()
    const feedBg: Location = { ...location, pathname: '/feed', search: feedSearch ? `?${feedSearch}` : '', hash: '' }
    navigate(
      { pathname: `/profile/${encodeURIComponent(h)}`, search: '' },
      { replace: true, state: { backgroundLocation: feedBg } }
    )
  }, [location, navigate])

  useEffect(() => {
    const t = requestAnimationFrame(() => setModalScrollHidden(false))
    return () => cancelAnimationFrame(t)
  }, [location.search, location.pathname])

  /** Opens post via URI path with optional `reply` / `focus` query for instant modal resolution. */
  const openPostModal = useCallback((uri: string, openReply?: boolean, focusUri?: string, _authorHandle?: string) => {
    const path = getPostOverlayPath(uri)
    const q = new URLSearchParams()
    if (openReply) q.set('reply', '1')
    if (focusUri) q.set('focus', focusUri)
    const qs = q.toString()
    const bg = getOverlayBackgroundLocation(location)
    navigate(
      { pathname: path, search: qs ? `?${qs}` : '' },
      { replace: false, state: { backgroundLocation: bg } }
    )
  }, [navigate, location])

  const openProfileModal = useCallback((handle: string) => {
    const path = `/profile/${encodeURIComponent(handle)}`
    const bg = getOverlayBackgroundLocation(location)
    navigate({ pathname: path, search: '' }, { replace: false, state: { backgroundLocation: bg } })
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
    if (hasPathOverlayStack(location)) {
      navigate(-1)
      return
    }
    const current = parseSearchToModalStack(location.search)
    const next = current.length > 1 ? current.slice(0, -1) : []
    const search = next.length > 0 ? `?${modalStackToSearch(next)}` : ''
    navigate({ pathname: pathForModalNavigation(location.pathname), search }, { replace: true })
  }, [location, navigate])

  const closeAllModals = useCallback(() => {
    if (hasPathOverlayStack(location)) {
      navigate(-1)
      return
    }
    navigate({ pathname: pathForModalNavigation(location.pathname), search: '' }, { replace: true })
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
