import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, type Location } from 'react-router-dom'
import { ChunkLoadError } from '../components/ChunkLoadError'
import { HOME_PATH } from '../lib/routes'
import { getOverlayBackgroundLocation, hasPathOverlayStack } from '../lib/overlayNavigation'
import {
  clearPostModalScrollPersistence,
  clearProfileModalScrollPersistence,
  navigateToOverlay,
  resolvePostOverlayNavigation,
  resolveProfileOverlayNavigation,
} from '../lib/overlayEntry'
import {
  modalItemToSearch,
  modalStackToSearch,
  parseSearchToModalStack,
  pathForModalNavigation,
  type ModalItem,
} from '../lib/modalStack'
import { VideoAutoplayBootstrap } from '../components/VideoAutoplayBootstrap'
import { VideoFeedSuspendSync } from '../components/VideoFeedSuspendSync'
import { blurEditableOnEscape, getFocusedEditableElement } from '../lib/modalKeyboard'

const PostDetailModal = lazy(() => import('../components/PostDetailModal'))
const ProfileModal = lazy(() => import('../components/ProfileModal'))
const TagModal = lazy(() => import('../components/TagModal'))
const SearchModal = lazy(() => import('../components/SearchModal'))
const QuotesModal = lazy(() => import('../components/QuotesModal'))

export type { ModalItem } from '../lib/modalStack'

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
  /** When the topmost query modal is search, its query (e.g. mobile header search slot). */
  searchModalTopQuery: string | null
  /** True when user has scrolled down in a modal (hide nav/back/gear). */
  modalScrollHidden: boolean
  setModalScrollHidden: (v: boolean) => void
}

const ProfileModalContext = createContext<ProfileModalContextValue | null>(null)

/** Preserve frozen underlay (feed scroll) on replace navigations that only change modal query params. */
function overlayBackgroundNavigateState(loc: Location): { backgroundLocation: Location } | undefined {
  const bg = (loc.state as { backgroundLocation?: Location } | null)?.backgroundLocation
  return bg != null ? { backgroundLocation: bg } : undefined
}

export function ProfileModalProvider({ children }: { children: ReactNode }) {
  const [modalScrollHidden, setModalScrollHidden] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const directLinkSeededForKeyRef = useRef<string | null>(null)
  /** Same render as router URL — avoids one-frame (or stuck) stale stack when useEffect lagged behind navigate(). */
  const modalStack = useMemo(() => parseSearchToModalStack(location.search), [location.search])
  const searchModalTopQuery = useMemo(() => {
    const top = modalStack[modalStack.length - 1]
    return top?.type === 'search' ? top.query : null
  }, [modalStack])

  useEffect(() => {
    const t = requestAnimationFrame(() => setModalScrollHidden(false))
    return () => cancelAnimationFrame(t)
  }, [location.search, location.pathname])

  /** Dismiss keyboard when pushing another modal so the new top layer is full-height. */
  const prevModalStackLenRef = useRef(0)
  useEffect(() => {
    const len = modalStack.length
    if (len > prevModalStackLenRef.current) {
      const editable = getFocusedEditableElement()
      if (editable?.closest('[role="dialog"]')) {
        editable.blur()
      }
    }
    prevModalStackLenRef.current = len
  }, [modalStack.length])

  /**
   * Direct modal URLs (e.g. `/?profile=&post=`) have no prior in-app history entry, so POP would leave
   * the site. Seed feed underneath once so in-modal back and browser back both return to the homepage.
   */
  useLayoutEffect(() => {
    const stack = parseSearchToModalStack(location.search)
    if (stack.length === 0) return
    if (hasPathOverlayStack(location)) return
    const hasPost = stack.some((item) => item.type === 'post')
    const hasProfile = stack.some((item) => item.type === 'profile')
    /* Only seed for direct post share links that include profile as URL context. */
    if (!hasPost || !hasProfile) return
    if (directLinkSeededForKeyRef.current === location.key) return

    directLinkSeededForKeyRef.current = location.key
    const feedBg: Location = {
      pathname: pathForModalNavigation(location.pathname),
      search: '',
      hash: '',
      key: `${location.key}-feed-seed`,
      state: null,
    }
    navigate({ pathname: feedBg.pathname, search: feedBg.search, hash: feedBg.hash }, { replace: true })
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash ?? '' },
      { replace: false, state: { backgroundLocation: feedBg } },
    )
  }, [location, navigate])

  /** Opens post via URI path with optional `reply` / `focus` query for instant modal resolution. */
  const openPostModal = useCallback((uri: string, openReply?: boolean, focusUri?: string, authorHandle?: string) => {
    clearPostModalScrollPersistence(uri)
    navigateToOverlay(
      navigate,
      resolvePostOverlayNavigation(location, { uri, openReply, focusUri, authorHandle }),
    )
  }, [navigate, location])

  const openProfileModal = useCallback((handle: string) => {
    clearProfileModalScrollPersistence(handle)
    navigateToOverlay(navigate, resolveProfileOverlayNavigation(location, handle))
  }, [navigate, location])

  const openTagModal = useCallback((tag: string) => {
    const item: ModalItem = { type: 'tag', tag }
    const search = `?${modalItemToSearch(item)}`
    const bg = getOverlayBackgroundLocation(location)
    navigate(
      { pathname: pathForModalNavigation(location.pathname), search },
      { replace: false, state: { backgroundLocation: bg } },
    )
  }, [location, navigate])

  const openSearchModal = useCallback((query: string) => {
    const item: ModalItem = { type: 'search', query }
    const search = `?${modalItemToSearch(item)}`
    const bg = getOverlayBackgroundLocation(location)
    navigate(
      { pathname: pathForModalNavigation(location.pathname), search },
      { replace: false, state: { backgroundLocation: bg } },
    )
  }, [location, navigate])

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
      if (hasPathOverlayStack(location)) {
        const bg = getOverlayBackgroundLocation(location)
        /* Same history entry the feed uses for post overlays: POP so in-modal back matches browser back. */
        if (location.pathname === bg.pathname) {
          navigate(-1)
          return
        }
      }
      const next = stack.slice(0, -1)
      /* Direct share links include profile as URL context only — back from post goes to feed, not profile. */
      if (!hasPathOverlayStack(location) && next.length === 1 && next[0].type === 'profile') {
        navigate(HOME_PATH, { replace: true })
        return
      }
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
    navigate(HOME_PATH, { replace: true })
  }, [navigate])

  const isModalOpen = modalStack.length > 0 || hasPathOverlayStack(location)
  const canGoBack = modalStack.length > 1

  /* ESC closes all modals and returns to homescreen */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (!isModalOpen) return
      const editable = getFocusedEditableElement()
      if (editable) {
        blurEditableOnEscape(e, editable)
        return
      }
      e.preventDefault()
      // Close all modals and go to homescreen
      navigate(HOME_PATH, { replace: true })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isModalOpen, navigate])

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
    searchModalTopQuery,
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
    searchModalTopQuery,
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
          onClose={closeModal}
          onBack={closeModal}
          onDesktopBackdrop={closeAllModals}
          canGoBack={canGoBackFromThis}
          isTopModal={isTop}
          stackIndex={index}
          openProfileModal={openProfileModal}
        />,
      )
    }
    if (item.type === 'profile') {
      return wrap(
        <ProfileModal
          handle={item.handle}
          onClose={closeAllModals}
          onBack={closeModal}
          onDesktopBackdrop={closeAllModals}
          canGoBack={canGoBackFromThis}
          isTopModal={isTop}
          stackIndex={index}
          openProfileModal={openProfileModal}
          openPostModal={openPostModal}
          isModalOpen={modalStack.length > 0}
        />,
      )
    }
    if (item.type === 'tag') {
      return wrap(
        <TagModal
          tag={item.tag}
          onClose={closeAllModals}
          onBack={closeModal}
          onDesktopBackdrop={closeAllModals}
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
          onDesktopBackdrop={closeAllModals}
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
          onDesktopBackdrop={closeAllModals}
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
      <VideoFeedSuspendSync />
      <VideoAutoplayBootstrap />
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
      searchModalTopQuery: null,
      modalScrollHidden: false,
      setModalScrollHidden: () => {},
    }
  }
  return ctx
}
