import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'

const MAX_FOLLOW_OVERRIDE_KEYS = 500

/**
 * Normalized cache for follow overrides across the application.
 * This context provides a centralized store for tracking follow state changes
 * (optimistic updates) without duplicating state in each component.
 * 
 * Key: author DID
 * Value: follow record URI (string) or null (not following) or undefined (use original author.viewer.following)
 */
type FollowOverridesCache = Record<string, string | null | undefined>

interface FollowOverridesContextValue {
  followOverrides: FollowOverridesCache
  setFollowOverride: (authorDid: string, followUri: string | null) => void
  getFollowOverride: (authorDid: string) => string | null | undefined
  clearFollowOverrides: () => void
}

const FollowOverridesContext = createContext<FollowOverridesContextValue | undefined>(undefined)

interface FollowOverridesProviderProps {
  children: ReactNode
}

/**
 * Provider for the normalized follow overrides cache.
 * Memoizes context value to prevent unnecessary re-renders.
 */
export function FollowOverridesProvider({ children }: FollowOverridesProviderProps) {
  const [followOverrides, setFollowOverrides] = useState<FollowOverridesCache>({})

  const setFollowOverride = useCallback((authorDid: string, followUri: string | null) => {
    setFollowOverrides((prev) => {
      const next = { ...prev, [authorDid]: followUri }
      const keys = Object.keys(next)
      if (keys.length <= MAX_FOLLOW_OVERRIDE_KEYS) return next
      const keep = keys.slice(-MAX_FOLLOW_OVERRIDE_KEYS)
      const pruned: FollowOverridesCache = {}
      for (const k of keep) pruned[k] = next[k]
      return pruned
    })
  }, [])

  const getFollowOverride = useCallback((authorDid: string) => {
    return followOverrides[authorDid]
  }, [followOverrides])

  const clearFollowOverrides = useCallback(() => {
    setFollowOverrides({})
  }, [])

  const value = useMemo(
    () => ({
      followOverrides,
      setFollowOverride,
      getFollowOverride,
      clearFollowOverrides,
    }),
    [followOverrides, setFollowOverride, getFollowOverride, clearFollowOverrides]
  )

  return (
    <FollowOverridesContext.Provider value={value}>
      {children}
    </FollowOverridesContext.Provider>
  )
}

/**
 * Hook to access the follow overrides cache.
 * @throws Error if used outside of FollowOverridesProvider
 */
export function useFollowOverrides() {
  const context = useContext(FollowOverridesContext)
  if (context === undefined) {
    throw new Error('useFollowOverrides must be used within a FollowOverridesProvider')
  }
  return context
}
