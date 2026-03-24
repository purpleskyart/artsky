import type { BrowserOAuthClient } from '@atproto/oauth-client-browser'

let clientPromise: Promise<BrowserOAuthClient> | null = null

/** Base URL for the app (origin + pathname to app root). Used as client_id base for HTTPS. */
function getAppBaseUrl(): string {
  const origin = window.location.origin
  // Vite's BASE_URL points to the app root (e.g. "/" or "/artsky/"), unlike location.pathname which may be a routed page.
  const basePath = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')
  const appRoot = new URL(basePath, origin)
  return `${appRoot.origin}${appRoot.pathname.replace(/\/$/, '') || '/'}`
}

/** True when running on localhost / 127.0.0.1 / [::1]. */
function isLoopback(): boolean {
  const h = typeof window !== 'undefined' ? window.location.hostname : ''
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'
}

/** Scope matching client-metadata.json so loopback OAuth gets AppView timeline/feed access. */
const OAUTH_SCOPE =
  'atproto transition:generic rpc:app.bsky.feed.getFeed?aud=did:web:api.bsky.app%23bsky_appview rpc:app.bsky.feed.getTimeline?aud=did:web:api.bsky.app%23bsky_appview'

/**
 * Build loopback client_id (no path). Required by spec so "Log in with Bluesky" works in dev.
 * redirect_uri must use 127.0.0.1 (not localhost) and can include path so callback lands on the app.
 * Include scope so the token has AppView timeline/feed access (same as production client-metadata).
 */
function getLoopbackClientId(): string {
  const u = new URL(window.location.href)
  const host = u.hostname === 'localhost' ? '127.0.0.1' : u.hostname
  const port = u.port || (u.protocol === 'https:' ? '443' : '80')
  const path = u.pathname || '/'
  const redirectUri = `http://${host}:${port}${path}`
  const params = new URLSearchParams()
  params.set('redirect_uri', redirectUri)
  params.set('scope', OAUTH_SCOPE)
  return `http://localhost?${params.toString()}`
}

/**
 * Load the OAuth client (cached). Client metadata must be at {appBase}/client-metadata.json for HTTPS.
 * On localhost we use the loopback client_id format (no path) so OAuth works in development.
 */
export async function getOAuthClient(): Promise<BrowserOAuthClient> {
  if (typeof window === 'undefined') {
    throw new Error('OAuth is only available in the browser')
  }
  if (clientPromise) return clientPromise
  const clientId = isLoopback() ? getLoopbackClientId() : `${getAppBaseUrl()}/client-metadata.json`
  // Use query so callback lands in ?code=...&state=... (standard OAuth redirect).
  const { BrowserOAuthClient } = await import('@atproto/oauth-client-browser')
  clientPromise = BrowserOAuthClient.load({
    clientId,
    handleResolver: 'https://bsky.social/',
    responseMode: 'query',
  })
  return clientPromise
}

export type OAuthSession = import('@atproto/oauth-client').OAuthSession

/**
 * Initialize OAuth: restore existing session or process callback after redirect.
 * When hasCallback is false and preferredRestoreDid is set, restores that DID's session (for multi-account).
 */
export async function initOAuth(options?: {
  hasCallback?: boolean
  preferredRestoreDid?: string
}): Promise<
  | { session: OAuthSession; state?: string | null }
  | undefined
> {
  const oauth = await getOAuthClient()
  const hasCallback =
    options?.hasCallback ??
    (typeof window !== 'undefined'
      ? (() => {
          const params = new URLSearchParams(window.location.search)
          return params.has('state') && (params.has('code') || params.has('error'))
        })()
      : false)
  if (hasCallback) {
    return oauth.init()
  }
  if (options?.preferredRestoreDid) {
    try {
      const session = await oauth.restore(options.preferredRestoreDid, true)
      return { session }
    } catch {
      return undefined
    }
  }
  return oauth.init()
}

/**
 * Restore a specific OAuth session by DID (for account switching). Returns the session or null.
 */
export async function restoreOAuthSession(did: string): Promise<OAuthSession | null> {
  try {
    const oauth = await getOAuthClient()
    const session = await oauth.restore(did, true)
    return session
  } catch {
    return null
  }
}

/**
 * Start OAuth sign-in for the given handle. Redirects the window to Bluesky; never returns.
 */
export async function signInWithOAuthRedirect(handle: string): Promise<void> {
  const oauth = await getOAuthClient()
  await oauth.signInRedirect(handle)
}
