import { BrowserOAuthClient } from '@atproto/oauth-client-browser'

let client: BrowserOAuthClient | null = null

/** Base URL for the app (origin + pathname to app root). Used as client_id base for HTTPS. */
function getAppBaseUrl(): string {
  const u = new URL(window.location.href)
  const path = u.pathname.replace(/\/index\.html$/, '').replace(/\/?$/, '') || '/'
  return `${u.origin}${path}`
}

/** True when running on localhost / 127.0.0.1 / [::1]. */
function isLoopback(): boolean {
  const h = typeof window !== 'undefined' ? window.location.hostname : ''
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'
}

/**
 * Build loopback client_id (no path). Required by spec so "Log in with Bluesky" works in dev.
 * redirect_uri must use 127.0.0.1 (not localhost) and can include path so callback lands on the app.
 */
function getLoopbackClientId(): string {
  const u = new URL(window.location.href)
  const host = u.hostname === 'localhost' ? '127.0.0.1' : u.hostname
  const port = u.port || (u.protocol === 'https:' ? '443' : '80')
  const path = u.pathname || '/'
  const redirectUri = `http://${host}:${port}${path}`
  return `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}`
}

/**
 * Load the OAuth client (cached). Client metadata must be at {appBase}/client-metadata.json for HTTPS.
 * On localhost we use the loopback client_id format (no path) so OAuth works in development.
 */
export async function getOAuthClient(): Promise<BrowserOAuthClient> {
  if (typeof window === 'undefined') {
    throw new Error('OAuth is only available in the browser')
  }
  if (client) return client
  const clientId = isLoopback() ? getLoopbackClientId() : `${getAppBaseUrl()}/client-metadata.json`
  client = await BrowserOAuthClient.load({
    clientId,
    handleResolver: 'https://bsky.social/',
  })
  return client
}

/**
 * Initialize OAuth: restore existing session or process callback after redirect.
 * Call once on app load. Returns session if user just completed OAuth or had a stored session.
 */
export async function initOAuth(): Promise<
  | { session: import('@atproto/oauth-client').OAuthSession; state?: string | null }
  | undefined
> {
  const oauth = await getOAuthClient()
  return oauth.init()
}

/**
 * Start OAuth sign-in for the given handle. Redirects the window to Bluesky; never returns.
 */
export async function signInWithOAuthRedirect(handle: string): Promise<never> {
  const oauth = await getOAuthClient()
  return oauth.signInRedirect(handle)
}
