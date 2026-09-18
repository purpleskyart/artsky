import type { Location, NavigateFunction } from 'react-router-dom'
import { getPostOverlayPath } from './appUrl'
import {
  getOverlayBackgroundLocation,
  hasPathOverlayStack,
  isPostOverlayPath,
  type BackgroundLocationState,
} from './overlayNavigation'

export type OverlayNavigateTarget = {
  pathname: string
  search: string
  hash: string
  state?: BackgroundLocationState
}

export type PostOverlayOptions = {
  uri: string
  openReply?: boolean
  focusUri?: string
  authorHandle?: string | null
}

function mergePostIntoSearchParams(p: URLSearchParams, opts: PostOverlayOptions): void {
  p.set('post', opts.uri)
  p.delete('forumPost')
  if (opts.openReply) p.set('reply', '1')
  else p.delete('reply')
  if (opts.focusUri) p.set('focus', opts.focusUri)
  else p.delete('focus')
}

function queryOverlayTarget(
  pathname: string,
  searchParams: URLSearchParams,
  hash: string,
  backgroundLocation: Location,
): OverlayNavigateTarget {
  const qs = searchParams.toString()
  return {
    pathname,
    search: qs ? `?${qs}` : '',
    hash,
    state: { backgroundLocation },
  }
}

/**
 * Decide path vs query overlay for opening a post from the current location.
 * Callers should navigate to the returned target (see {@link navigateToOverlay}).
 */
export function resolvePostOverlayNavigation(
  location: Location,
  opts: PostOverlayOptions,
): OverlayNavigateTarget {
  const bg = getOverlayBackgroundLocation(location)
  const currentParams = new URLSearchParams(location.search.replace(/^\?/, ''))

  /** Path-based profile popup (`/profile/h` + backgroundLocation): encode as `?profile=&post=` on frozen pathname. */
  const profilePathMatch = /^\/profile\/([^/]+)\/?$/.exec(location.pathname)
  if (hasPathOverlayStack(location) && profilePathMatch) {
    const handle = decodeURIComponent(profilePathMatch[1])
    const p = new URLSearchParams(bg.search?.replace(/^\?/, '') ?? '')
    p.set('profile', handle)
    mergePostIntoSearchParams(p, opts)
    return queryOverlayTarget(bg.pathname, p, bg.hash ?? '', bg)
  }

  /** Path-based post popup: encode as `?post=` on frozen pathname so back pops one history entry. */
  if (hasPathOverlayStack(location) && isPostOverlayPath(location.pathname)) {
    const p = new URLSearchParams(bg.search?.replace(/^\?/, '') ?? '')
    mergePostIntoSearchParams(p, opts)
    return queryOverlayTarget(bg.pathname, p, bg.hash ?? '', bg)
  }

  /** Query modal already showing a post: push the next post on query instead of a path overlay. */
  if (
    currentParams.get('post') &&
    hasPathOverlayStack(location) &&
    !isPostOverlayPath(location.pathname)
  ) {
    const p = new URLSearchParams(location.search.replace(/^\?/, ''))
    mergePostIntoSearchParams(p, opts)
    const frozenBg = getOverlayBackgroundLocation(location)
    return queryOverlayTarget(location.pathname, p, location.hash, frozenBg)
  }

  /** Query-based search or tag modal: stack post on query (path `/post/` would drop the parent layer). */
  if (
    (currentParams.get('search') || currentParams.get('tag')) &&
    !isPostOverlayPath(location.pathname)
  ) {
    const p = new URLSearchParams(location.search.replace(/^\?/, ''))
    mergePostIntoSearchParams(p, opts)
    const frozenBg = getOverlayBackgroundLocation(location)
    return queryOverlayTarget(location.pathname, p, location.hash, frozenBg)
  }

  /** Default: path-based post overlay with optional reply/focus query params. */
  const path = getPostOverlayPath(opts.uri, opts.authorHandle)
  const q = new URLSearchParams()
  if (opts.openReply) q.set('reply', '1')
  if (opts.focusUri) q.set('focus', opts.focusUri)
  const qs = q.toString()
  return {
    pathname: path,
    search: qs ? `?${qs}` : '',
    hash: '',
    state: { backgroundLocation: bg },
  }
}

/** Decide navigation target for opening a profile overlay from the current location. */
export function resolveProfileOverlayNavigation(
  location: Location,
  handle: string,
): OverlayNavigateTarget {
  const bg = getOverlayBackgroundLocation(location)
  const p = new URLSearchParams(location.search.replace(/^\?/, ''))
  p.delete('profile')
  p.delete('post')
  p.delete('forumPost')
  p.delete('reply')
  p.delete('focus')
  p.delete('quotes')
  const qs = p.toString()
  return {
    pathname: `/profile/${encodeURIComponent(handle)}`,
    search: qs ? `?${qs}` : '',
    hash: location.hash ?? bg.hash ?? '',
    state: { backgroundLocation: bg },
  }
}

export function navigateToOverlay(
  navigate: NavigateFunction,
  target: OverlayNavigateTarget,
  options?: { replace?: boolean },
): void {
  navigate(
    { pathname: target.pathname, search: target.search, hash: target.hash },
    { replace: options?.replace ?? false, state: target.state },
  )
}

export function clearPostModalScrollPersistence(uri: string): void {
  try {
    sessionStorage.removeItem(`artsky-post-modal-scroll-v1:${encodeURIComponent(uri)}`)
  } catch {
    /* ignore storage errors */
  }
}

export function clearProfileModalScrollPersistence(handle: string): void {
  try {
    sessionStorage.removeItem(`artsky-profile-modal-scroll-v1:${encodeURIComponent(handle)}`)
  } catch {
    /* ignore storage errors */
  }
}
