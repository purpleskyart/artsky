import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { AtpSessionData } from '@atproto/api'
import * as bsky from '../lib/bsky'

interface SessionContextValue {
  session: AtpSessionData | null
  loading: boolean
  login: (identifier: string, password: string) => Promise<void>
  logout: () => void
  refreshSession: () => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AtpSessionData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    bsky.resumeSession().then((ok) => {
      if (cancelled) return
      setSession(ok ? bsky.getSession() : null)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (identifier: string, password: string) => {
    await bsky.login(identifier, password)
    setSession(bsky.getSession())
  }, [])

  const logout = useCallback(() => {
    bsky.logout()
    setSession(null)
  }, [])

  const refreshSession = useCallback(() => {
    setSession(bsky.getSession())
  }, [])

  const value: SessionContextValue = {
    session,
    loading,
    login,
    logout,
    refreshSession,
  }

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
