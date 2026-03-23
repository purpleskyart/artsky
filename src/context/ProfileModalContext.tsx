import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChunkLoadError } from '../components/ChunkLoadError'

const PostDetailModal = lazy(() => import('../components/PostDetailModal'))
const ProfileModal = lazy(() => import('../components/ProfileModal'))
const TagModal = lazy(() => import('../components/TagModal'))
const ForumModal = lazy(() => import('../components/ForumModal'))
const ForumPostModal = lazy(() => import('../components/ForumPostModal'))
const ArtboardsModal = lazy(() => import('../components/ArtboardsModal'))
const ArtboardModal = lazy(() => import('../components/ArtboardModal'))
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
  | { type: 'artboard'; id: string }

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
  openArtboardModal: (id: string) => void
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
 */
function parseSearchToModalStack(search: string): ModalItem[] {
  const params = new URLSearchParams(search)
  const forumPostLegacy = params.get('forumPost')
  const bskyThreadFromLegacy =
    forumPostLegacy && forumPostLegacy.includes('app.bsky.feed.post') ? forumPostLegacy : null
  const postUriParam = params.get('post')
  const resolvedPostUri = postUriParam ?? bskyThreadFromLegacy

  const stack: ModalItem[] = []
  const profileHandle = params.get('profile')
  if (profileHandle) stack.push({ type: 'profile', handle: profileHandle })
  if (params.get('forum') === '1' || bskyThreadFromLegacy) stack.push({ type: 'forum' })
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
  if (params.get('artboards') === '1') return [{ type: 'artboards' }]
  const artboardId = params.get('artboard')
  if (artboardId) return [{ type: 'artboard', id: artboardId }]
  return []
}

function modalStackToSearch(stack: ModalItem[]): string {
  return stack.map(modalItemToSearch).join('&')
}

function modalItemToSearch(item: ModalItem): string {
  if (item.type === 'post') {
    const s = `post=${encodeURIComponent(item.uri)}`
    const reply = item.openReply ? '&reply=1' : ''
    const focus = item.focusUri ? `&focus=${encodeURIComponent(item.focusUri)}` : ''
    return s + reply + focus
  }
  if (item.type === 'profile') return `profile=${encodeURIComponent(item.handle)}`
  if (item.type === 'tag') return `tag=${encodeURIComponent(item.tag)}`
  if (item.type === 'search') return `search=${encodeURIComponent(item.query)}`
  if (item.type === 'quotes') return `quotes=${encodeURIComponent(item.uri)}`
  if (item.type === 'forum') return 'forum=1'
  if (item.type === 'forumPost') return `forumPost=${encodeURIComponent(item.documentUri)}`
  if (item.type === 'artboards') return 'artboards=1'
  if (item.type === 'artboard') return `artboard=${encodeURIComponent(item.id)}`
  return ''
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
  if (a.type === 'artboard' && b.type === 'artboard') return a.id === b.id
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
    const stack: ModalItem[] = profileAlreadyOpen
      ? [...modalStack, postItem]
      : forumAlreadyOpen
        ? [...modalStack, postItem]
        : profileFromPath
          ? [{ type: 'profile', handle: decodeURIComponent(profileFromPath) }, postItem]
          : [postItem]
    const search = stack.length > 0 ? `?${modalStackToSearch(stack)}` : ''
    navigate({ pathname: location.pathname, search }, { replace: false })
  }, [location.pathname, location.search, navigate, modalStack])

  const openProfileModal = useCallback((handle: string) => {
    const item: ModalItem = { type: 'profile', handle }
    const search = `?${modalItemToSearch(item)}`
    navigate({ pathname: location.pathname, search }, { replace: false })
  }, [location.pathname, navigate])

  const openTagModal = useCallback((tag: string) => {
    const item: ModalItem = { type: 'tag', tag }
    const search = `?${modalItemToSearch(item)}`
    navigate({ pathname: location.pathname, search }, { replace: false })
  }, [location.pathname, navigate])

  const openSearchModal = useCallback((query: string) => {
    const item: ModalItem = { type: 'search', query }
    const search = `?${modalItemToSearch(item)}`
    navigate({ pathname: location.pathname, search }, { replace: false })
  }, [location.pathname, navigate])

  const openForumModal = useCallback(() => {
    const item: ModalItem = { type: 'forum' }
    const search = `?${modalItemToSearch(item)}`
    navigate({ pathname: location.pathname, search }, { replace: false })
  }, [location.pathname, navigate])

  const openForumPostModal = useCallback((documentUri: string) => {
    const search = `?forum=1&forumPost=${encodeURIComponent(documentUri)}`
    navigate({ pathname: location.pathname, search }, { replace: false })
  }, [location.pathname, navigate])

  const openArtboardsModal = useCallback(() => {
    const item: ModalItem = { type: 'artboards' }
    const search = `?${modalItemToSearch(item)}`
    navigate({ pathname: location.pathname, search }, { replace: false })
  }, [location.pathname, navigate])

  const openArtboardModal = useCallback((id: string) => {
    const item: ModalItem = { type: 'artboard', id }
    const search = `?${modalItemToSearch(item)}`
    navigate({ pathname: location.pathname, search }, { replace: false })
  }, [location.pathname, navigate])

  const openQuotesModal = useCallback((postUri: string) => {
    const item: ModalItem = { type: 'quotes', uri: postUri }
    const search = `?${modalItemToSearch(item)}`
    navigate({ pathname: location.pathname, search }, { replace: false })
  }, [location.pathname, navigate])

  const closeModal = useCallback(() => {
    const next = modalStack.length > 1 ? modalStack.slice(0, -1) : []
    const search = next.length > 0 ? `?${modalStackToSearch(next)}` : ''
    setModalStack(next)
    navigate({ pathname: location.pathname, search }, { replace: true })
  }, [location.pathname, navigate, modalStack])

  const closeAllModals = useCallback(() => {
    setModalStack([])
    navigate({ pathname: location.pathname, search: '' }, { replace: true })
  }, [location.pathname, navigate])

  /** Single source of truth: URL drives which modal(s) are open. One effect syncs URL → stack for all modal types. */
  useEffect(() => {
    const urlStack = parseSearchToModalStack(location.search)
    if (urlStack.length === 0) {
      setModalStack((prev) => (prev.length === 0 ? prev : []))
      return
    }
    setModalStack((prev) => {
      const top = prev[prev.length - 1]
      const urlTop = urlStack[urlStack.length - 1]
      if (prev.length === urlStack.length && top && urlTop && modalItemsMatch(top, urlTop)) return prev
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

  /* Render the full modal stack so underlying modals (e.g. profile) stay mounted and preserve scroll when a post modal opens on top. */
  const modalStackElements = modalStack.map((item, index) => {
    const isTop = index === modalStack.length - 1
    const canGoBackFromThis = isTop && modalStack.length > 1
    const key = `${index}-${item.type}-${item.type === 'profile' ? item.handle : item.type === 'post' ? item.uri : item.type === 'tag' ? item.tag : item.type === 'search' ? item.query : item.type === 'quotes' ? item.uri : item.type === 'forumPost' ? item.documentUri : item.type === 'artboard' ? item.id : index}`
    if (item.type === 'post') {
      return (
        <PostDetailModal
          key={key}
          uri={item.uri}
          openReply={item.openReply}
          focusUri={item.focusUri}
          onClose={closeAllModals}
          onBack={closeModal}
          canGoBack={canGoBackFromThis}
          isTopModal={isTop}
        />
      )
    }
    if (item.type === 'profile') {
      return (
        <ProfileModal
          key={key}
          handle={item.handle}
          onClose={closeAllModals}
          onBack={closeModal}
          canGoBack={canGoBackFromThis}
          isTopModal={isTop}
        />
      )
    }
    if (item.type === 'tag') {
      return (
        <TagModal
          key={key}
          tag={item.tag}
          onClose={closeAllModals}
          onBack={closeModal}
          canGoBack={canGoBackFromThis}
          isTopModal={isTop}
        />
      )
    }
    if (item.type === 'search') {
      return (
        <SearchModal
          key={key}
          query={item.query}
          onClose={closeAllModals}
          onBack={closeModal}
          canGoBack={canGoBackFromThis}
          isTopModal={isTop}
        />
      )
    }
    if (item.type === 'quotes') {
      return (
        <QuotesModal
          key={key}
          postUri={item.uri}
          onClose={closeAllModals}
          onBack={closeModal}
          canGoBack={canGoBackFromThis}
          isTopModal={isTop}
        />
      )
    }
    if (item.type === 'forum') {
      return (
        <ForumModal key={key} onClose={closeAllModals} onBack={closeModal} canGoBack={canGoBackFromThis} isTopModal={isTop} />
      )
    }
    if (item.type === 'forumPost') {
      return (
        <ForumPostModal
          key={key}
          documentUri={item.documentUri}
          onClose={closeAllModals}
          onBack={closeModal}
          canGoBack={canGoBackFromThis}
          isTopModal={isTop}
        />
      )
    }
    if (item.type === 'artboards') {
      return (
        <ArtboardsModal key={key} onClose={closeAllModals} onBack={closeModal} canGoBack={canGoBackFromThis} isTopModal={isTop} />
      )
    }
    if (item.type === 'artboard') {
      return (
        <ArtboardModal
          key={key}
          id={item.id}
          onClose={closeAllModals}
          onBack={closeModal}
          canGoBack={canGoBackFromThis}
          isTopModal={isTop}
        />
      )
    }
    return null
  })

  return (
    <ProfileModalContext.Provider value={value}>
      {children}
      <ChunkLoadError>
        <Suspense fallback={null}>
          {modalStackElements}
        </Suspense>
      </ChunkLoadError>
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
