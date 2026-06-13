import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Agent } from '@atproto/api'
import type { AtpSessionData } from '@atproto/api'
import * as bsky from '../lib/bsky'
import * as oauth from '../lib/oauth'
import { setAuthErrorReporter } from '../lib/apiErrors'

// Suppress background OAuth token-refresh errors from reaching React's error boundary.
// The @atproto/oauth-client-browser fires these as unhandled promise rejections after
// restore() has already returned, so they can't be caught with try/catch.
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason instanceof Error ? e.reason.message : String(e.reason ?? '')
    if (/TokenRefreshError|session was deleted|token.*refresh|refresh.*token/i.test(msg)) {
      e.preventDefault()
      console.warn('OAuth token refresh failed:', msg)
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
  reportAuthError: () => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

function getInitialSession(): AtpSessionData | null {
  try {
    return bsky.getSessionStateForReact() ?? bsky.getStoredSessionForDisplay()
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
  const sessionRefreshInFlightRef = useRef(false)

  const refreshSession = useCallback(() => {
    setSession(bsky.getSessionStateForReact())
  }, [])

  const reportAuthError = useCallback(() => {
    const did = bsky.getPersistedActiveDid()
    if (!did || sessionRefreshInFlightRef.current) return
    sessionRefreshInFlightRef.current = true
    void bsky.attemptSessionRefresh()
      .then((ok) => {
        if (ok) refreshSession()
      })
      .catch((err) => {
        console.warn('Session refresh after auth error failed:', err)
      })
      .finally(() => {
        sessionRefreshInFlightRef.current = false
      })
  }, [refreshSession])

  const logout = useCallback(async () => {
    const stillLoggedIn = await bsky.logoutCurrentAccount()
    setSession(stillLoggedIn ? bsky.getSessionStateForReact() : null)
  }, [])

  const switchAccount = useCallback(async (did: string) => {
    const ok = await bsky.switchAccount(did)
    if (ok) setSession(bsky.getSessionStateForReact())
    return ok
  }, [])

  useEffect(() => {
    // Removed requestPersistentStorage - modern browsers handle storage persistence automatically
  }, [])

  // Listen for storage changes (e.g., when handle is fetched for external PDS accounts)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'artsky-bsky-session' || e.key === 'artsky-accounts') {
        // Session data changed in another tab or was updated asynchronously
        // Refresh the React state to pick up new handle
        refreshSession()
      }
    }
    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [refreshSession])

  // Set up auth error reporter
  useEffect(() => {
    setAuthErrorReporter(reportAuthError)
    return () => {
      setAuthErrorReporter(null)
    }
  }, [reportAuthError])

  // Register callback for session updates (e.g., when handle is fetched for external PDS accounts)
  useEffect(() => {
    bsky.onSessionUpdated(() => {
      refreshSession()
    })
    return () => {
      bsky.onSessionUpdated(null)
    }
  }, [refreshSession])

  useEffect(() => {
    let cancelled = false
    const oauthCallbackTimeoutMs = 30_000

    const finish = (resolvedSession?: ReturnType<typeof bsky.getSessionStateForReact>) => {
      if (cancelled) return
      try {
        const s =
          resolvedSession !== undefined
            ? resolvedSession
            : bsky.getSessionStateForReact() ?? bsky.getStoredSessionForDisplay()
        setSession(s)
      } catch {
        setSession(bsky.getStoredSessionForDisplay())
      }
      // Clear loading in the same synchronous call so React batches session + loading together,
      // preventing a render with session=null while loading=false (which causes the guest flash).
      setAuthResolved(true)
      setLoading(false)
    }

    async function init() {
      const search = typeof window !== 'undefined' ? window.location.search : ''
      const hasCallback = oauth.hasOAuthCallbackSearch(search)
      const persistedDid = bsky.getPersistedActiveDid()

      // Cold start: skip OAuth client when there is nothing persisted to restore (guests).
      if (!hasCallback && !persistedDid) {
        if (!cancelled) finish()
        return
      }

      const preferredRestoreDid = !hasCallback ? persistedDid ?? undefined : undefined

      // Try localStorage FIRST before hitting IndexedDB/OAuth - localStorage survives PWA updates better
      if (!hasCallback && preferredRestoreDid) {
        const restored = await bsky.restoreAgentFromPersistedSession(preferredRestoreDid)
        if (restored) {
          finish(restored)
          oauth.initOAuth({ hasCallback: false, preferredRestoreDid })
            .then((oauthResult) => {
              if (oauthResult?.session) {
                bsky.resetOAuthFailure(preferredRestoreDid)
                const agent = new Agent(oauthResult.session)
                bsky.setOAuthAgent(agent, oauthResult.session)
                refreshSession()
              }
            })
            .catch((err) => { console.warn('Background OAuth refresh failed:', err) })
          return
        }
      }

      try {
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

        // Retry once after a short delay if restore failed (IndexedDB may need time after PWA update)
        let finalOauthResult = oauthResult
        if (!hasCallback && preferredRestoreDid && !oauthResult?.session) {
          await new Promise((resolve) => setTimeout(resolve, 500))
          if (!cancelled) {
            try {
              finalOauthResult = await oauth.initOAuth({ hasCallback: false, preferredRestoreDid })
            } catch {
              // Ignore retry error, will fall through to fallback
            }
          }
        }

        if (cancelled) return
        if (finalOauthResult?.session) {
          bsky.addOAuthDid(finalOauthResult.session.did)
          const agent = new Agent(finalOauthResult.session)
          bsky.setOAuthAgent(agent, finalOauthResult.session)
          // Reset failure count on successful restore
          bsky.resetOAuthFailure(finalOauthResult.session.did)
          // Filter out invalid handles before passing to finish
          const sessionHandle = (finalOauthResult.session as any).handle
          const isValidHandle = sessionHandle && sessionHandle !== 'handle.invalid' && !sessionHandle.includes('.invalid') && !sessionHandle.startsWith('did:')
          const sessionToFinish = isValidHandle
            ? finalOauthResult.session as unknown as AtpSessionData
            : { did: finalOauthResult.session.did } as AtpSessionData
          finish(sessionToFinish)
          // If handle was invalid, trigger a fetch to get the real handle
          if (!isValidHandle) {
            void agent.getProfile({ actor: finalOauthResult.session.did }).then((profile) => {
              if (profile.data.handle && profile.data.handle !== 'handle.invalid' && !profile.data.handle.includes('.invalid') && !profile.data.handle.startsWith('did:')) {
                const updatedSession = { ...sessionToFinish, handle: profile.data.handle } as AtpSessionData
                const accounts = bsky.getAccounts()
                accounts.sessions[finalOauthResult.session.did] = updatedSession
                bsky.saveAccounts?.(accounts)
                localStorage.setItem('artsky-bsky-session', JSON.stringify(updatedSession))
                // Trigger session update to refresh UI
                refreshSession()
              }
            }).catch((err) => {
              console.warn('Failed to fetch profile handle:', err)
            })
          }
          return
        }
        // OAuth restore failed — try localStorage fallback; never discard persisted credentials
        if (!hasCallback && preferredRestoreDid && !finalOauthResult?.session) {
          const restored = await bsky.restoreAgentFromPersistedSession(preferredRestoreDid)
          if (restored) {
            finish(restored)
            return
          }
          const displaySession = bsky.getStoredSessionForDisplay()
          if (displaySession) {
            finish(displaySession)
            void bsky.attemptSessionRefresh().then((ok) => {
              if (ok && !cancelled) refreshSession()
            })
            return
          }
        }
      } catch {
        // Don't auto-logout on token refresh errors - keep session data so user can retry
      }
      if (!cancelled) finish()
    }
    init()
      .catch((err) => {
        console.warn('Session init failed:', err)
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
      reportAuthError,
    }),
    [session, sessionsList, loading, authResolved, logout, switchAccount, refreshSession, reportAuthError]
  )

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}
