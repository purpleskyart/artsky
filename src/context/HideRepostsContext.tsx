import { createContext, useCallback, useContext, useState } from 'react'
import { asyncStorage } from '../lib/AsyncStorage'

const STORAGE_KEY = 'artsky-hide-reposts-from'

type HideRepostsContextValue = {
  /** DIDs of accounts whose reposts are hidden from the homepage feed. */
  hideRepostsFromDids: string[]
  addHideRepostsFrom: (did: string) => void
  removeHideRepostsFrom: (did: string) => void
  toggleHideRepostsFrom: (did: string) => void
  isHidingRepostsFrom: (did: string) => boolean
}

const HideRepostsContext = createContext<HideRepostsContextValue | null>(null)

function getStored(): string[] {
  try {
    const parsed = asyncStorage.get<string[]>(STORAGE_KEY)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function HideRepostsProvider({ children }: { children: React.ReactNode }) {
  const [hideRepostsFromDids, setHideRepostsFromDids] = useState<string[]>(getStored)

  const addHideRepostsFrom = useCallback((did: string) => {
    setHideRepostsFromDids((prev) => {
      const next = prev.includes(did) ? prev : [...prev, did]
      asyncStorage.set(STORAGE_KEY, next, 0)
      return next
    })
  }, [])

  const removeHideRepostsFrom = useCallback((did: string) => {
    setHideRepostsFromDids((prev) => {
      const next = prev.filter((d) => d !== did)
      asyncStorage.set(STORAGE_KEY, next, 0)
      return next
    })
  }, [])

  const toggleHideRepostsFrom = useCallback((did: string) => {
    setHideRepostsFromDids((prev) => {
      const next = prev.includes(did) ? prev.filter((d) => d !== did) : [...prev, did]
      asyncStorage.set(STORAGE_KEY, next, 0)
      return next
    })
  }, [])

  const isHidingRepostsFrom = useCallback(
    (did: string) => hideRepostsFromDids.includes(did),
    [hideRepostsFromDids]
  )

  const value: HideRepostsContextValue = {
    hideRepostsFromDids,
    addHideRepostsFrom,
    removeHideRepostsFrom,
    toggleHideRepostsFrom,
    isHidingRepostsFrom,
  }

  return (
    <HideRepostsContext.Provider value={value}>
      {children}
    </HideRepostsContext.Provider>
  )
}

export function useHideReposts(): HideRepostsContextValue | null {
  return useContext(HideRepostsContext)
}
