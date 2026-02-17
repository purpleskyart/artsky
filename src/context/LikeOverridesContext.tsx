import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'

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
    setLikeOverrides((prev) => ({
      ...prev,
      [postUri]: likeUri,
    }))
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
