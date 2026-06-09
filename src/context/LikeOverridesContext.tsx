import { createContext, useContext, useCallback, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import {
  clearLikeOverridesInStore,
  getLikeOverrideFromStore,
  getLikeOverridesSnapshot,
  setLikeOverrideInStore,
  subscribeLikeOverrides,
  subscribeLikeOverrideUri,
  type LikeOverridesCache,
} from '../lib/likeOverridesStore'

interface LikeOverridesContextValue {
  setLikeOverride: (postUri: string, likeUri: string | null) => void
  getLikeOverride: (postUri: string) => string | null | undefined
  clearLikeOverrides: () => void
}

const LikeOverridesContext = createContext<LikeOverridesContextValue | undefined>(undefined)

export function LikeOverridesProvider({ children }: { children: ReactNode }) {
  const setLikeOverride = useCallback((postUri: string, likeUri: string | null) => {
    setLikeOverrideInStore(postUri, likeUri)
  }, [])

  const getLikeOverride = useCallback((postUri: string) => {
    return getLikeOverrideFromStore(postUri)
  }, [])

  const clearLikeOverrides = useCallback(() => {
    clearLikeOverridesInStore()
  }, [])

  const value = useMemo(
    () => ({
      setLikeOverride,
      getLikeOverride,
      clearLikeOverrides,
    }),
    [setLikeOverride, getLikeOverride, clearLikeOverrides],
  )

  return (
    <LikeOverridesContext.Provider value={value}>
      {children}
    </LikeOverridesContext.Provider>
  )
}

/** Actions only — does not subscribe to the overrides map (avoids grid re-renders on like). */
export function useLikeOverridesActions(): LikeOverridesContextValue {
  const context = useContext(LikeOverridesContext)
  if (context === undefined) {
    throw new Error('useLikeOverridesActions must be used within a LikeOverridesProvider')
  }
  return context
}

export function useLikeOverrides() {
  const context = useLikeOverridesActions()
  const likeOverrides = useSyncExternalStore(
    subscribeLikeOverrides,
    getLikeOverridesSnapshot,
    (): LikeOverridesCache => ({}),
  )
  return useMemo(
    () => ({
      ...context,
      likeOverrides,
    }),
    [context, likeOverrides],
  )
}

/** Subscribe to the full overrides map (for grids that need per-uri lookups). */
export function useLikeOverridesMap(): LikeOverridesCache {
  return useSyncExternalStore(
    subscribeLikeOverrides,
    getLikeOverridesSnapshot,
    (): LikeOverridesCache => ({}),
  )
}

/** Subscribe to a single post URI — avoids re-renders when unrelated posts are liked. */
export function useLikeOverrideForUri(postUri: string): string | null | undefined {
  return useSyncExternalStore(
    (cb) => subscribeLikeOverrideUri(postUri, cb),
    () => getLikeOverrideFromStore(postUri),
    () => undefined,
  )
}
