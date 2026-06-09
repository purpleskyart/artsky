import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { FeedSource } from '../types'

type FeedSwipeContextValue = {
  feedSources: FeedSource[]
  setSingleFeed: (source: FeedSource) => void
}

const FeedSwipeContext = createContext<FeedSwipeContextValue | null>(null)

export function useFeedSwipe() {
  return useContext(FeedSwipeContext)
}

export function FeedSwipeProvider({
  feedSources,
  setSingleFeed,
  children,
}: {
  feedSources: FeedSource[]
  setSingleFeed: (source: FeedSource) => void
  children: ReactNode
}) {
  const value = useMemo<FeedSwipeContextValue>(() => ({
    feedSources,
    setSingleFeed,
  }), [feedSources, setSingleFeed])

  return (
    <FeedSwipeContext.Provider value={value}>
      {children}
    </FeedSwipeContext.Provider>
  )
}
