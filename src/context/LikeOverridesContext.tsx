import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'

const MAX_LIKE_OVERRIDE_KEYS = 500

/**
 * Normalized cache for like overrides across the application.
 * This context provides a centralized store for tracking like state changes
 * (optimistic updates) without duplicating state in each component.
 * 
 * Key: post URI
 * Value: like record URI (string) or null (unliked) or undefined (use original post.viewer.like)
 */
type LikeOverridesCache = Record<string, string | null | undefined>

interface LikeOverridesContextValue {
  likeOverrides: LikeOverridesCache
  setLikeOverride: (postUri: string, likeUri: string | null) => void
  getLikeOverride: (postUri: string) => string | null | undefined
  clearLikeOverrides: () => void
}

const LikeOverridesContext = createContext<LikeOverridesContextValue | undefined>(undefined)

interface LikeOverridesProviderProps {
  children: ReactNode
}

/**
 * Provider for the normalized like overrides cache.
 * Memoizes context value to prevent unnecessary re-renders.
 */
export function LikeOverridesProvider({ children }: LikeOverridesProviderProps) {
  const [likeOverrides, setLikeOverrides] = useState<LikeOverridesCache>({})

  const setLikeOverride = useCallback((postUri: string, likeUri: string | null) => {
    setLikeOverrides((prev) => {
      const next = { ...prev, [postUri]: likeUri }
      const keys = Object.keys(next)
      if (keys.length <= MAX_LIKE_OVERRIDE_KEYS) return next
      const keep = keys.slice(-MAX_LIKE_OVERRIDE_KEYS)
      const pruned: LikeOverridesCache = {}
      for (const k of keep) pruned[k] = next[k]
      return pruned
    })
  }, [])

  const getLikeOverride = useCallback((postUri: string) => {
    return likeOverrides[postUri]
  }, [likeOverrides])

  const clearLikeOverrides = useCallback(() => {
    setLikeOverrides({})
  }, [])

  const value = useMemo(
    () => ({
      likeOverrides,
      setLikeOverride,
      getLikeOverride,
      clearLikeOverrides,
    }),
    [likeOverrides, setLikeOverride, getLikeOverride, clearLikeOverrides]
  )

  return (
    <LikeOverridesContext.Provider value={value}>
      {children}
    </LikeOverridesContext.Provider>
  )
}

/**
 * Hook to access the like overrides cache.
 * @throws Error if used outside of LikeOverridesProvider
 */
export function useLikeOverrides() {
  const context = useContext(LikeOverridesContext)
  if (context === undefined) {
    throw new Error('useLikeOverrides must be used within a LikeOverridesProvider')
  }
  return context
}
