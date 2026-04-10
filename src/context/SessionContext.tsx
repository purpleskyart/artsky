import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Agent } from '@atproto/api'
import type { AtpSessionData } from '@atproto/api'
import { REPO_URL } from '../config/repo'
import * as bsky from '../lib/bsky'
import * as oauth from '../lib/oauth'

// Suppress background OAuth token-refresh errors from reaching React's error boundary.
// The @atproto/oauth-client-browser fires these as unhandled promise rejections after
// restore() has already returned, so they can't be caught with try/catch.
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason instanceof Error ? e.reason.message : String(e.reason ?? '')
    if (/TokenRefreshError|session was deleted|token.*refresh|refresh.*token/i.test(msg)) {
      e.preventDefault()
    }
  })
}

interface SessionContextValue {
  session: AtpSessionData | null
  sessionsList: AtpSessionData[]
  loading: boolean
  /** False only on first paint when persisted login may exist but OAuth restore has not finished yet. */
  authResolved: boolean
  logout: () => Promise<void>
  switchAccount: (did: string) => Promise<boolean>
  refreshSession: () => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

function getInitialSession(): AtpSessionData | null {
  try {
    return bsky.getSessionStateForReact()
  } catch {
    return null
  }
}

function getInitialAuthResolved(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return !bsky.hasPersistedLoginHint()
  } catch {
    return true
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  // Show the app immediately; never block on a loading screen so localhost always loads
  const [session, setSession] = useState<AtpSessionData | null>(getInitialSession)
  const [authResolved, setAuthResolved] = useState(getInitialAuthResolved)
  // Block render until auth is resolved when there's a persisted login hint (prevents logged-out flash)
  const [loading, setLoading] = useState(() => !getInitialAuthResolved())

  useEffect(() => {
    // Removed requestPersistentStorage - modern browsers handle storage persistence automatically
  }, [])

  useEffect(() => {
    let cancelled = false
    const oauthCallbackTimeoutMs = 30_000

    const finish = (resolvedSession?: ReturnType<typeof bsky.getSessionStateForReact>) => {
      if (cancelled) return
      try {
        const s = resolvedSession !== undefined ? resolvedSession : bsky.getSessionStateForReact()
        setSession(s)
      } catch {
        setSession(null)
      }
      // Clear loading in the same synchronous call so React batches session + loading together,
      // preventing a render with session=null while loading=false (which causes the guest flash).
      setAuthResolved(true)
      setLoading(false)
    }

    async function init() {
      const oauthAccounts = bsky.getOAuthAccountsSnapshot()
      const search = typeof window !== 'undefined' ? window.location.search : ''
      const hasCallback = oauth.hasOAuthCallbackSearch(search)

      const noOAuthAccounts =
        oauthAccounts.dids.length === 0 && !oauthAccounts.activeDid

      // Cold start: skip loading @atproto/oauth-client-browser when there is nothing to restore
      // from the OAuth client (guests). Saves IndexedDB + chunk parse before the feed can load.
      if (!hasCallback && noOAuthAccounts) {
        if (!cancelled) finish()
        return
      }

      try {
        const preferredRestoreDid =
          !hasCallback
            ? oauthAccounts.activeDid ?? oauthAccounts.dids[0] ?? undefined
            : undefined

        // OAuth callback: keep a bounded wait so a broken redirect cannot hang boot forever.
        // Normal load (incl. after PWA update reload): await restore fully — a short race timeout
        // could fire while IndexedDB still opens, skip OAuth, and look "logged out" despite valid tokens.
        const oauthResult = hasCallback
          ? await Promise.race([
              oauth.initOAuth({ hasCallback: true }),
              new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), oauthCallbackTimeoutMs)),
            ])
          : await oauth.initOAuth({ hasCallback: false, preferredRestoreDid })

        if (cancelled) return
        if (oauthResult?.session) {
          bsky.addOAuthDid(oauthResult.session.did)
          const agent = new Agent(oauthResult.session)
          bsky.setOAuthAgent(agent, oauthResult.session)
          finish()
          return
        }
        // Restore returned no session — if we tried a specific DID and it failed, remove it
        // so hasPersistedLoginHint() stops returning true for a dead session on next load.
        if (!hasCallback && preferredRestoreDid && !oauthResult?.session) {
          bsky.removeOAuthDid(preferredRestoreDid)
        }
      } catch {
        // Don't auto-logout on token refresh errors - keep session data so user can retry
      }
      if (!cancelled) finish()
    }
    init()
      .catch(() => {
        if (!cancelled) finish()
      })
      .finally(() => {
        // finish() already handles setAuthResolved + setLoading atomically.
        // This is a safety net in case any code path exits init() without calling finish().
        if (!cancelled) {
          setAuthResolved(true)
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const logout = useCallback(async () => {
    const stillLoggedIn = await bsky.logoutCurrentAccount()
    setSession(stillLoggedIn ? bsky.getSessionStateForReact() : null)
  }, [])

  const switchAccount = useCallback(async (did: string) => {
    const ok = await bsky.switchAccount(did)
    if (ok) setSession(bsky.getSessionStateForReact())
    return ok
  }, [])

  const refreshSession = useCallback(() => {
    setSession(bsky.getSessionStateForReact())
  }, [])

  const sessionsList = useMemo<AtpSessionData[]>(() => {
    try {
      return bsky.getSessionsList()
    } catch {
      // localStorage or bsky not ready yet
      return []
    }
  }, [session, authResolved])

  const value: SessionContextValue = useMemo(
    () => ({
      session,
      sessionsList,
      loading,
      authResolved,
      logout,
      switchAccount,
      refreshSession,
    }),
    [session, sessionsList, loading, authResolved, logout, switchAccount, refreshSession]
  )

  return (
    <SessionContext.Provider value={value}>
      {loading ? (
        <div
          style={{
            margin: 0,
            padding: '2rem 1.5rem',
            textAlign: 'center',
            minHeight: '100dvh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem',
            background: 'var(--bg, #0f0f1a)',
            color: 'var(--text, #e8e8f0)',
            fontFamily: 'system-ui, sans-serif',
            fontSize: '1rem',
          }}
          aria-live="polite"
          aria-busy="true"
        >
          <p style={{ margin: 0, fontSize: '1rem' }}>Loading…</p>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--muted, #888)' }}>
            Try refreshing the page. Check the browser console for details.
          </p>
          <p style={{ margin: 0 }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: '0.5rem 1rem',
                fontSize: '0.95rem',
                cursor: 'pointer',
                background: 'var(--accent, #7c3aed)',
                color: 'var(--bg, #0f0f1a)',
                border: 'none',
                borderRadius: 6,
                fontWeight: 500,
              }}
            >
              Refresh
            </button>
          </p>
          <p style={{ margin: 0, fontSize: '0.9rem' }}>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                color: 'var(--muted, #888)',
                textDecoration: 'none',
                fontSize: '0.9rem',
              }}
              title="View source"
            >
              <svg width="20" height="20" viewBox="0 0 92 92" fill="none" aria-hidden style={{ flexShrink: 0 }}>
                <path
                  fill="#f03c2e"
                  fillRule="nonzero"
                  d="M90.156 41.965 50.036 1.848a5.918 5.918 0 0 0-8.372 0l-8.328 8.332 10.566 10.566a7.03 7.03 0 0 1 7.23 1.684 7.034 7.034 0 0 1 1.669 7.277l10.187 10.184a7.028 7.028 0 0 1 7.278 1.672 7.04 7.04 0 0 1 0 9.957 7.05 7.05 0 0 1-9.965 0 7.044 7.044 0 0 1-1.528-7.66l-9.5-9.497V59.36a7.04 7.04 0 0 1 1.86 11.29 7.04 7.04 0 0 1-9.957 0 7.04 7.04 0 0 1 0-9.958 7.06 7.06 0 0 1 2.304-1.539V33.926a7.049 7.049 0 0 1-3.82-9.234L29.242 14.272 1.73 41.777a5.925 5.925 0 0 0 0 8.371L41.852 90.27a5.925 5.925 0 0 0 8.37 0l39.934-39.934a5.925 5.925 0 0 0 0-8.371"
                />
              </svg>
              View source
            </a>
          </p>
        </div>
      ) : (
        children
      )}
    </SessionContext.Provider>
  )
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}
