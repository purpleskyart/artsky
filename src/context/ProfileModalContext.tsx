import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChunkLoadError } from '../components/ChunkLoadError'

const PostDetailModal = lazy(() => import('../components/PostDetailModal'))
const ProfileModal = lazy(() => import('../components/ProfileModal'))
const TagModal = lazy(() => import('../components/TagModal'))
const ForumModal = lazy(() => import('../components/ForumModal'))
const ForumPostModal = lazy(() => import('../components/ForumPostModal'))
const SearchModal = lazy(() => import('../components/SearchModal'))
const QuotesModal = lazy(() => import('../components/QuotesModal'))
const CollectionsIndexModal = lazy(() => import('../components/CollectionsIndexModal'))
const CollectionDetailModal = lazy(() => import('../components/CollectionDetailModal'))

export type ModalItem =
  | { type: 'post'; uri: string; openReply?: boolean; focusUri?: string }
  | { type: 'profile'; handle: string }
  | { type: 'tag'; tag: string }
  | { type: 'search'; query: string }
  | { type: 'quotes'; uri: string }
  | { type: 'forum' }
  | { type: 'forumPost'; documentUri: string }
  | { type: 'collections' }
  | { type: 'collection'; uri: string }

type ProfileModalContextValue = {
  openProfileModal: (handle: string) => void
  closeProfileModal: () => void
  openPostModal: (uri: string, openReply?: boolean, focusUri?: string) => void
  closePostModal: () => void
  openTagModal: (tag: string) => void
  openSearchModal: (query: string) => void
  openForumModal: () => void
  openForumPostModal: (documentUri: string) => void
  openQuotesModal: (postUri: string) => void
  openCollectionsModal: () => void
  /** Go back to previous modal (Q or back button). */
  closeModal: () => void
  /** Close all modals (ESC, backdrop click, or X). */
  closeAllModals: () => void
  /** True if any modal (post or profile or tag or forum) is open. */
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
 * When forum=1 and post= are both set, stack is [forum, post] so back returns to the forums list.
 */
function parseSearchToModalStack(search: string): ModalItem[] {
  const params = new URLSearchParams(search)
  const forumPostLegacy = params.get('forumPost')
  const bskyThreadFromLegacy =
    forumPostLegacy && forumPostLegacy.includes('app.bsky.feed.post') ? forumPostLegacy : null
  const postUriParam = params.get('post')
  const resolvedPostUriRaw = postUriParam ?? bskyThreadFromLegacy
  const resolvedPostUri =
    resolvedPostUriRaw && resolvedPostUriRaw.length > 0 ? resolvedPostUriRaw : null

  const stack: ModalItem[] = []
  const profileHandle = params.get('profile')
  if (profileHandle) stack.push({ type: 'profile', handle: profileHandle })
  if (params.get('forum') === '1' || bskyThreadFromLegacy) stack.push({ type: 'forum' })
  if (params.get('collections') === '1') stack.push({ type: 'collections' })
  const collectionParam = params.get('collection')
  if (collectionParam) {
    stack.push({ type: 'collection', uri: collectionParam })
  }

  if (resolvedPostUri) {
    const focusUri = params.get('focus') ?? undefined
    stack.push({
      type: 'post',
      uri: resolvedPostUri,
      openReply: params.get('reply') === '1',
      focusUri: focusUri ?? undefined,
    })
  }
  const lexiconForumPostUri =
    forumPostLegacy && forumPostLegacy.includes('app.artsky.forum.post') ? forumPostLegacy : null
  if (lexiconForumPostUri) {
    stack.push({ type: 'forumPost', documentUri: lexiconForumPostUri })
  }
  if (stack.length > 0) return stack
  const tag = params.get('tag')
  if (tag) return [{ type: 'tag', tag }]
  const searchQuery = params.get('search')
  if (searchQuery) return [{ type: 'search', query: searchQuery }]
  const quotesUri = params.get('quotes')
  if (quotesUri) return [{ type: 'quotes', uri: quotesUri }]
  if (forumPostLegacy) return [{ type: 'forumPost', documentUri: forumPostLegacy }]
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
  if (item.type === 'forum') {
    p.set('forum', '1')
    return
  }
  if (item.type === 'forumPost') {
    p.set('forumPost', item.documentUri)
    return
  }
  if (item.type === 'collections') {
    p.set('collections', '1')
    return
  }
  if (item.type === 'collection') {
    p.set('collection', item.uri)
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
  if (pathname === '/collections' || pathname.startsWith('/collection/')) return '/feed'
  return pathname
}

export function ProfileModalProvider({ children }: { children: ReactNode }) {
  const [modalScrollHidden, setModalScrollHidden] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  /** Same render as router URL — avoids one-frame (or stuck) stale stack when useEffect lagged behind navigate(). */
  const modalStack = useMemo(() => parseSearchToModalStack(location.search), [location.search])

  /* Modal URL changed → show floating back again (defer avoids react-hooks/set-state-in-effect on sync setState). */
  useEffect(() => {
    const t = requestAnimationFrame(() => setModalScrollHidden(false))
    return () => cancelAnimationFrame(t)
  }, [location.search])

  /** Open modal: when on a profile (page or modal), push [profile, post] so back returns to profile. Only use profile from URL if it's already the top of the stack (avoids reopening profile after user closed it). */
  const openPostModal = useCallback((uri: string, openReply?: boolean, focusUri?: string) => {
    const postItem: ModalItem = { type: 'post', uri, openReply, focusUri }
    const params = new URLSearchParams(location.search)
    const profileFromSearch = params.get('profile')
    const profileFromPath = location.pathname.match(/^\/profile\/([^/]+)/)?.[1]
    const stackFromUrl = parseSearchToModalStack(location.search)
    const topItem = stackFromUrl[stackFromUrl.length - 1]
    const profileAlreadyOpen = topItem?.type === 'profile' && profileFromSearch && topItem.handle === profileFromSearch
    const forumAlreadyOpen = topItem?.type === 'forum'
    const inCollectionsFlow = stackFromUrl.some(
      (i) => i.type === 'collections' || i.type === 'collection',
    )
    const stack: ModalItem[] = profileAlreadyOpen
      ? [...stackFromUrl, postItem]
      : forumAlreadyOpen
        ? [...stackFromUrl, postItem]
        : inCollectionsFlow && stackFromUrl.length > 0
          ? [...stackFromUrl, postItem]
          : profileFromPath
            ? [{ type: 'profile', handle: decodeURIComponent(profileFromPath) }, postItem]
            : [postItem]
    const search = stack.length > 0 ? `?${modalStackToSearch(stack)}` : ''
    navigate({ pathname: pathForModalNavigation(location.pathname), search }, { replace: false })
  }, [location.pathname, location.search, navigate])

  const openProfileModal = useCallback((handle: string) => {
    const item: ModalItem = { type: 'profile', handle }
    const search = `?${modalItemToSearch(item)}`
    navigate({ pathname: pathForModalNavigation(location.pathname), search }, { replace: false })
  }, [location.pathname, navigate])

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

  const openForumModal = useCallback(() => {
    const item: ModalItem = { type: 'forum' }
    const search = `?${modalItemToSearch(item)}`
    navigate({ pathname: pathForModalNavigation(location.pathname), search }, { replace: false })
  }, [location.pathname, navigate])

  const openForumPostModal = useCallback((documentUri: string) => {
    const search = `?forum=1&forumPost=${encodeURIComponent(documentUri)}`
    navigate({ pathname: pathForModalNavigation(location.pathname), search }, { replace: false })
  }, [location.pathname, navigate])

  const openQuotesModal = useCallback((postUri: string) => {
    const item: ModalItem = { type: 'quotes', uri: postUri }
    const search = `?${modalItemToSearch(item)}`
    navigate({ pathname: pathForModalNavigation(location.pathname), search }, { replace: false })
  }, [location.pathname, navigate])

  const openCollectionsModal = useCallback(() => {
    const item: ModalItem = { type: 'collections' }
    const search = `?${modalItemToSearch(item)}`
    navigate({ pathname: pathForModalNavigation(location.pathname), search }, { replace: false })
  }, [location.pathname, navigate])

  const closeModal = useCallback(() => {
    const current = parseSearchToModalStack(location.search)
    const next = current.length > 1 ? current.slice(0, -1) : []
    const search = next.length > 0 ? `?${modalStackToSearch(next)}` : ''
    navigate({ pathname: pathForModalNavigation(location.pathname), search }, { replace: true })
  }, [location.pathname, location.search, navigate])

  const closeAllModals = useCallback(() => {
    navigate({ pathname: pathForModalNavigation(location.pathname), search: '' }, { replace: true })
  }, [location.pathname, navigate])

  const isModalOpen = modalStack.length > 0
  const canGoBack = modalStack.length > 1

  const value: ProfileModalContextValue = useMemo(() => ({
    openProfileModal,
    closeProfileModal: closeModal,
    closePostModal: closeModal,
    openPostModal,
    openTagModal,
    openSearchModal,
    openForumModal,
    openForumPostModal,
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
    openForumModal,
    openForumPostModal,
    openQuotesModal,
    openCollectionsModal,
    closeAllModals,
    isModalOpen,
    canGoBack,
    modalScrollHidden,
  ])

  /* Render the full modal stack so underlying modals (e.g. profile) stay mounted and preserve scroll when a post modal opens on top.
   * Each lazy modal has its own Suspense — one outer Suspense would replace the whole stack with fallback (null) while a chunk loads. */
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
                : item.type === 'forumPost'
                  ? item.documentUri
                  : item.type === 'collection'
                    ? item.uri
                    : item.type === 'collections'
                      ? 'list'
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
    if (item.type === 'forum') {
      return wrap(<ForumModal onClose={closeAllModals} onBack={closeModal} canGoBack={canGoBackFromThis} isTopModal={isTop} stackIndex={index} />)
    }
    if (item.type === 'forumPost') {
      return wrap(
        <ForumPostModal
          documentUri={item.documentUri}
          onClose={closeAllModals}
          onBack={closeModal}
          canGoBack={canGoBackFromThis}
          isTopModal={isTop}
          stackIndex={index}
        />,
      )
    }
    if (item.type === 'collections') {
      return wrap(
        <CollectionsIndexModal
          onClose={closeAllModals}
          onBack={closeModal}
          canGoBack={canGoBackFromThis}
          isTopModal={isTop}
          stackIndex={index}
        />,
      )
    }
    if (item.type === 'collection') {
      return wrap(
        <CollectionDetailModal
          uri={item.uri}
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
      openForumModal: () => {},
      openForumPostModal: () => {},
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
