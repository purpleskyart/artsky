import { HOME_PATH, isHandleBoardPath } from './routes'
import { postUriToQuotesParam, quotesParamToPostUri } from './appUrl'

export type ModalItem =
  | { type: 'post'; uri: string; openReply?: boolean; focusUri?: string }
  | { type: 'profile'; handle: string }
  | { type: 'tag'; tag: string }
  | { type: 'search'; query: string }
  | { type: 'quotes'; uri: string }

/**
 * URL ↔ modal stack: single source of truth for query-based popup layers.
 * Stack bottom → top: search, tag, profile, post (whichever params exist).
 */
export function parseSearchToModalStack(search: string): ModalItem[] {
  const params = new URLSearchParams(search)
  const forumPostParam = params.get('forumPost')
  const bskyThreadFromLegacy =
    forumPostParam && forumPostParam.includes('app.bsky.feed.post') ? forumPostParam : null
  const postUriParam = params.get('post')
  const resolvedPostUriRaw = postUriParam ?? bskyThreadFromLegacy
  const resolvedPostUri =
    resolvedPostUriRaw && resolvedPostUriRaw.length > 0 ? resolvedPostUriRaw : null

  const searchQueryParam = params.get('search')
  const tag = params.get('tag')
  const quotesUri = params.get('quotes')
  const profileParam = params.get('profile')

  const stack: ModalItem[] = []
  if (searchQueryParam && searchQueryParam.length > 0) {
    stack.push({ type: 'search', query: searchQueryParam })
  }
  if (tag) stack.push({ type: 'tag', tag })
  if (profileParam) stack.push({ type: 'profile', handle: profileParam })

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
  if (quotesUri) {
    const uri = quotesParamToPostUri(quotesUri)
    if (uri) return [{ type: 'quotes', uri }]
  }
  return []
}

/** Serialize one modal layer into URLSearchParams (single source of truth for encoding). */
export function appendModalItemToSearchParams(p: URLSearchParams, item: ModalItem): void {
  if (item.type === 'post') {
    p.set('post', item.uri)
    if (item.openReply) p.set('reply', '1')
    if (item.focusUri) p.set('focus', item.focusUri)
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
    p.set('quotes', postUriToQuotesParam(item.uri))
    return
  }
  if (item.type === 'profile') {
    p.set('profile', item.handle)
    return
  }
}

export function modalStackToSearch(stack: ModalItem[]): string {
  const p = new URLSearchParams()
  for (const item of stack) {
    appendModalItemToSearchParams(p, item)
  }
  return p.toString()
}

export function modalItemToSearch(item: ModalItem): string {
  return modalStackToSearch([item])
}

/**
 * Full-page post URLs use `/profile/:handle/post/:rkey` or encoded `/post/:uri`. Modal stacks encode the
 * post in `?post=`; keeping both would show the path post while query pointed elsewhere — so modal
 * navigation must use home (`/`) when leaving those paths.
 */
export function pathForModalNavigation(pathname: string): string {
  if (pathname.startsWith('/post/')) return HOME_PATH
  if (/^\/profile\/[^/]+\/post\//.test(pathname)) return HOME_PATH
  if (/^\/profile\/[^/]+$/.test(pathname)) return HOME_PATH
  if (pathname === '/collections' || isHandleBoardPath(pathname)) return HOME_PATH
  return pathname
}
