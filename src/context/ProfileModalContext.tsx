import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChunkLoadError } from '../components/ChunkLoadError'
import ArtboardModal from '../components/ArtboardModal'

const PostDetailModal = lazy(() => import('../components/PostDetailModal'))
const ProfileModal = lazy(() => import('../components/ProfileModal'))
const TagModal = lazy(() => import('../components/TagModal'))
const ForumModal = lazy(() => import('../components/ForumModal'))
const ForumPostModal = lazy(() => import('../components/ForumPostModal'))
const ArtboardsModal = lazy(() => import('../components/ArtboardsModal'))
const SearchModal = lazy(() => import('../components/SearchModal'))
const QuotesModal = lazy(() => import('../components/QuotesModal'))

export type ModalItem =
  | { type: 'post'; uri: string; openReply?: boolean; focusUri?: string }
  | { type: 'profile'; handle: string }
  | { type: 'tag'; tag: string }
  | { type: 'search'; query: string }
  | { type: 'quotes'; uri: string }
  | { type: 'forum' }
  | { type: 'forumPost'; documentUri: string }
  | { type: 'artboards' }
  | { type: 'artboard'; id: string; ownerDid?: string }

type ProfileModalContextValue = {
  openProfileModal: (handle: string) => void
  closeProfileModal: () => void
  openPostModal: (uri: string, openReply?: boolean, focusUri?: string) => void
  closePostModal: () => void
  openTagModal: (tag: string) => void
  openSearchModal: (query: string) => void
  openForumModal: () => void
  openForumPostModal: (documentUri: string) => void
  openArtboardsModal: () => void
  openArtboardModal: (id: string, ownerDid?: string) => void
  openQuotesModal: (postUri: string) => void
  /** Go back to previous modal (Q or back button). */
  closeModal: () => void
  /** Close all modals (ESC, backdrop click, or X). */
  closeAllModals: () => void
  /** True if any modal (post or profile or tag or forum or artboards) is open. */
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
 * and modalItemToSearch (write param), and in modalItemsMatch. openXxx() just navigates; effect syncs URL → stack.
 * When both profile= and post= are in the URL, stack is [profile, post] so back from post returns to profile.
 * When forum=1 and post= are both set, stack is [forum, post] so back returns to the forums list.
 * When artboards=1, artboard=, and post= are set, stack is [artboards, artboard, post] so back returns through the collection.
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

  /* Collections must be parsed before post= — otherwise ?artboards=1&artboard=id&post=… only became [post] and broke the stack. */
  const artboardId = params.get('artboard')
  const artboardOwner = params.get('artboardOwner') ?? undefined
  if (params.get('artboards') === '1') {
    stack.push({ type: 'artboards' })
    if (artboardId) stack.push({ type: 'artboard', id: artboardId, ownerDid: artboardOwner })
  } else if (artboardId) {
    stack.push({ type: 'artboard', id: artboardId, ownerDid: artboardOwner })
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

/** For openPostModal: base stack under the post layer (drops post items only). */
function stripPostItemsFromStack(stack: ModalItem[]): ModalItem[] {
  return stack.filter((i) => i.type !== 'post')
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
  if (item.type === 'artboards') {
    p.set('artboards', '1')
    return
  }
  if (item.type === 'artboard') {
    p.set('artboard', item.id)
    if (item.ownerDid) p.set('artboardOwner', item.ownerDid)
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

function modalStackEqual(a: ModalItem[], b: ModalItem[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (!modalItemsMatch(a[i]!, b[i]!)) return false
  }
  return true
}

/**
 * Full-page post URLs use `/post/:uri` in the path. Modal stacks encode the post in `?post=`; keeping
 * both would show the path post while query pointed elsewhere — so modal navigation must use `/feed`.
 */
function pathForModalNavigation(pathname: string): string {
  return pathname.startsWith('/post/') ? '/feed' : pathname
}

function modalItemsMatch(a: ModalItem, b: ModalItem): boolean {
  if (a.type !== b.type) return false
  if (a.type === 'post' && b.type === 'post') return a.uri === b.uri && (a.openReply ?? false) === (b.openReply ?? false) && (a.focusUri ?? '') === (b.focusUri ?? '')
  if (a.type === 'profile' && b.type === 'profile') return a.handle === b.handle
  if (a.type === 'tag' && b.type === 'tag') return a.tag === b.tag
  if (a.type === 'search' && b.type === 'search') return a.query === b.query
  if (a.type === 'quotes' && b.type === 'quotes') return a.uri === b.uri
  if (a.type === 'forum' && b.type === 'forum') return true
  if (a.type === 'forumPost' && b.type === 'forumPost') return a.documentUri === b.documentUri
  if (a.type === 'artboards' && b.type === 'artboards') return true
  if (a.type === 'artboard' && b.type === 'artboard') return a.id === b.id && (a.ownerDid ?? '') === (b.ownerDid ?? '')
  return false
}

export function ProfileModalProvider({ children }: { children: ReactNode }) {
  const [modalStack, setModalStack] = useState<ModalItem[]>([])
  const [modalScrollHidden, setModalScrollHidden] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (modalStack.length === 0) setModalScrollHidden(false)
  }, [modalStack.length])

  /* Reset scroll hidden state when modal changes to ensure back button is visible */
  useEffect(() => {
    if (modalStack.length > 0) setModalScrollHidden(false)
  }, [modalStack.length, modalStack[modalStack.length - 1]])

  /** Open modal: when on a profile (page or modal), push [profile, post] so back returns to profile. Only use profile from URL if it's already the top of the stack (avoids reopening profile after user closed it). */
  const openPostModal = useCallback((uri: string, openReply?: boolean, focusUri?: string) => {
    const postItem: ModalItem = { type: 'post', uri, openReply, focusUri }
    const params = new URLSearchParams(location.search)
    const profileFromSearch = params.get('profile')
    const profileFromPath = location.pathname.match(/^\/profile\/([^/]+)/)?.[1]
    const topItem = modalStack[modalStack.length - 1]
    const profileAlreadyOpen = topItem?.type === 'profile' && profileFromSearch && topItem.handle === profileFromSearch
    const forumAlreadyOpen = topItem?.type === 'forum'
    const artboardFlowOpen =
      topItem?.type === 'artboards' ||
      topItem?.type === 'artboard' ||
      params.get('artboards') === '1' ||
      !!params.get('artboard')
    const stack: ModalItem[] = profileAlreadyOpen
      ? [...modalStack, postItem]
      : forumAlreadyOpen
        ? [...modalStack, postItem]
        : artboardFlowOpen
          ? /* URL is source of truth — modalStack can lag after openArtboardModal (stale [artboards] drops artboard=id from the query). */
            [...stripPostItemsFromStack(parseSearchToModalStack(location.search)), postItem]
          : profileFromPath
            ? [{ type: 'profile', handle: decodeURIComponent(profileFromPath) }, postItem]
            : [postItem]
    const search = stack.length > 0 ? `?${modalStackToSearch(stack)}` : ''
    navigate({ pathname: pathForModalNavigation(location.pathname), search }, { replace: false })
  }, [location.pathname, location.search, navigate, modalStack])

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

  const openArtboardsModal = useCallback(() => {
    const item: ModalItem = { type: 'artboards' }
    const search = `?${modalItemToSearch(item)}`
    navigate({ pathname: pathForModalNavigation(location.pathname), search }, { replace: false })
  }, [location.pathname, navigate])

  const openArtboardModal = useCallback((id: string, ownerDid?: string) => {
    const params = new URLSearchParams(location.search)
    const stack: ModalItem[] = []
    if (params.get('artboards') === '1') stack.push({ type: 'artboards' })
    stack.push({ type: 'artboard', id, ownerDid })
    const search = `?${modalStackToSearch(stack)}`
    navigate({ pathname: pathForModalNavigation(location.pathname), search }, { replace: false })
  }, [location.pathname, location.search, navigate])

  const openQuotesModal = useCallback((postUri: string) => {
    const item: ModalItem = { type: 'quotes', uri: postUri }
    const search = `?${modalItemToSearch(item)}`
    navigate({ pathname: pathForModalNavigation(location.pathname), search }, { replace: false })
  }, [location.pathname, navigate])

  const closeModal = useCallback(() => {
    const next = modalStack.length > 1 ? modalStack.slice(0, -1) : []
    const search = next.length > 0 ? `?${modalStackToSearch(next)}` : ''
    setModalStack(next)
    navigate({ pathname: pathForModalNavigation(location.pathname), search }, { replace: true })
  }, [location.pathname, navigate, modalStack])

  const closeAllModals = useCallback(() => {
    setModalStack([])
    navigate({ pathname: pathForModalNavigation(location.pathname), search: '' }, { replace: true })
  }, [location.pathname, navigate])

  /** Single source of truth: URL drives which modal(s) are open. One effect syncs URL → stack for all modal types. */
  useEffect(() => {
    const urlStack = parseSearchToModalStack(location.search)
    if (urlStack.length === 0) {
      setModalStack((prev) => (prev.length === 0 ? prev : []))
      return
    }
    setModalStack((prev) => {
      /* Compare full stack — top-only equality missed middle layers (e.g. artboard id) and could leave state out of sync with the URL. */
      if (modalStackEqual(prev, urlStack)) return prev
      return urlStack
    })
  }, [location.search])

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
    openArtboardsModal,
    openArtboardModal,
    openQuotesModal,
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
    openArtboardsModal,
    openArtboardModal,
    openQuotesModal,
    closeAllModals,
    isModalOpen,
    canGoBack,
    modalScrollHidden,
  ])

  /* Render the full modal stack so underlying modals (e.g. profile) stay mounted and preserve scroll when a post modal opens on top.
   * Each lazy modal has its own Suspense — one outer Suspense would replace the whole stack with fallback (null) while a chunk loads.
   * ArtboardModal is imported eagerly so opening a collection on top of the list is never blank while its chunk loads. */
  const modalStackElements = modalStack.map((item, index) => {
    const isTop = index === modalStack.length - 1
    const canGoBackFromThis = isTop && modalStack.length > 1
    const key = `${index}-${item.type}-${item.type === 'profile' ? item.handle : item.type === 'post' ? item.uri : item.type === 'tag' ? item.tag : item.type === 'search' ? item.query : item.type === 'quotes' ? item.uri : item.type === 'forumPost' ? item.documentUri : item.type === 'artboard' ? `${item.id}:${item.ownerDid ?? ''}` : index}`
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
    if (item.type === 'artboards') {
      return wrap(<ArtboardsModal onClose={closeAllModals} onBack={closeModal} canGoBack={canGoBackFromThis} isTopModal={isTop} stackIndex={index} />)
    }
    if (item.type === 'artboard') {
      return wrap(
        <ArtboardModal
          id={item.id}
          ownerDid={item.ownerDid}
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
      openArtboardsModal: () => {},
      openArtboardModal: () => {},
      openQuotesModal: () => {},
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
