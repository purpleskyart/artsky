import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { AtpSessionData } from '@atproto/api'
import * as bsky from '../lib/bsky'

interface SessionContextValue {
  session: AtpSessionData | null
  sessionsList: AtpSessionData[]
  loading: boolean
  login: (identifier: string, password: string) => Promise<void>
  logout: () => void
  switchAccount: (did: string) => Promise<boolean>
  refreshSession: () => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AtpSessionData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const maxWaitMs = 5000

    const timeoutId = window.setTimeout(() => {
      if (cancelled) return
      setLoading(false)
    }, maxWaitMs)

    const finish = (ok: boolean) => {
      if (cancelled) return
      window.clearTimeout(timeoutId)
      setSession(ok ? bsky.getSession() : null)
      setLoading(false)
    }

    Promise.race([
      bsky.resumeSession(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), maxWaitMs - 500)),
    ])
      .then((ok) => finish(ok))
      .catch(() => finish(false))

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [])

  const login = useCallback(async (identifier: string, password: string) => {
    await bsky.login(identifier, password)
    setSession(bsky.getSession())
  }, [])

  const logout = useCallback(() => {
    const stillLoggedIn = bsky.logoutCurrentAccount()
    setSession(stillLoggedIn ? bsky.getSession() : null)
  }, [])

  const switchAccount = useCallback(async (did: string) => {
    const ok = await bsky.switchAccount(did)
    if (ok) setSession(bsky.getSession())
    return ok
  }, [])

  const refreshSession = useCallback(() => {
    setSession(bsky.getSession())
  }, [])

  const sessionsList = bsky.getSessionsList()

  const value: SessionContextValue = {
    session,
    sessionsList,
    loading,
    login,
    logout,
    switchAccount,
    refreshSession,
  }

  return (
    <SessionContext.Provider value={value}>
      {loading ? (
        <div
          style={{
            margin: 0,
            padding: '2rem',
            textAlign: 'center',
            minHeight: '100dvh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg, #0f0f1a)',
            color: 'var(--text, #e8e8f0)',
            fontFamily: 'system-ui, sans-serif',
            fontSize: '1rem',
          }}
          aria-live="polite"
          aria-busy="true"
        >
          Loading…
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
