import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { FeedMixEntry, FeedSource } from '../types'
import { useSession } from './SessionContext'

const STORAGE_KEY_PREFIX = 'artsky-feed-mix'

function storageKey(did: string): string {
  return `${STORAGE_KEY_PREFIX}-${did || 'guest'}`
}

function loadStored(did: string): { entries: FeedMixEntry[]; enabled: boolean } {
  try {
    const key = storageKey(did)
    let raw = localStorage.getItem(key)
    let fromLegacy = false
    if (!raw && did !== 'guest') {
      raw = localStorage.getItem(STORAGE_KEY_PREFIX)
      fromLegacy = !!raw
    }
    if (!raw) return { entries: [], enabled: false }
    const parsed = JSON.parse(raw) as { entries?: FeedMixEntry[]; enabled?: boolean }
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : []
    const result = { entries, enabled: !!parsed?.enabled }
    if (fromLegacy && did !== 'guest') {
      save(entries, result.enabled, did)
    }
    return result
  } catch {
    return { entries: [], enabled: false }
  }
}

function save(entries: FeedMixEntry[], enabled: boolean, did: string) {
  try {
    localStorage.setItem(storageKey(did), JSON.stringify({ entries, enabled }))
  } catch {
    // ignore
  }
}

function sameSource(a: FeedSource, b: FeedSource): boolean {
  return (a.uri ?? a.label) === (b.uri ?? b.label)
}

type FeedMixContextValue = {
  entries: FeedMixEntry[]
  enabled: boolean
  setEnabled: (v: boolean) => void
  setEntryPercent: (index: number, percent: number) => void
  addEntry: (source: FeedSource) => void
  removeEntry: (index: number) => void
  /** Toggle source in mix: add with equal split if absent, remove and rebalance if present */
  toggleSource: (source: FeedSource) => void
  /** Set mix to a single feed (e.g. when user picks a feed from search to experience it) */
  setSingleFeed: (source: FeedSource) => void
  totalPercent: number
}

const FeedMixContext = createContext<FeedMixContextValue | null>(null)

export function FeedMixProvider({ children }: { children: ReactNode }) {
  const { session } = useSession()
  const did = session?.did ?? 'guest'
  const prevDidRef = useRef(did)
  const [entries, setEntries] = useState<FeedMixEntry[]>(() => loadStored(did).entries)
  const [enabled, setEnabledState] = useState(() => loadStored(did).enabled)

  useEffect(() => {
    if (prevDidRef.current !== did) {
      save(entries, enabled, prevDidRef.current)
      const loaded = loadStored(did)
      setEntries(loaded.entries)
      setEnabledState(loaded.enabled)
      prevDidRef.current = did
      return
    }
    save(entries, enabled, did)
  }, [did, entries, enabled])

  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v)
  }, [])

  const setEntryPercent = useCallback((index: number, percent: number) => {
    const n = Math.max(0, Math.min(100, Math.round(percent)))
    setEntries((prev) => {
      const remainder = 100 - n
      const otherIndices = prev.map((_, i) => i).filter((i) => i !== index)
      const otherCount = otherIndices.length
      if (otherCount === 0) return prev.map((e, i) => (i === index ? { ...e, percent: n } : e))
      const otherSum = otherIndices.reduce((s, i) => s + prev[i].percent, 0)
      if (otherSum === 0) {
        const base = Math.floor(remainder / otherCount)
        let extra = remainder - base * otherCount
        return prev.map((e, i) => {
          if (i === index) return { ...e, percent: n }
          const p = base + (extra > 0 ? 1 : 0)
          if (extra > 0) extra -= 1
          return { ...e, percent: Math.max(0, p) }
        })
      }
      const next = prev.map((e, i) => {
        if (i === index) return { ...e, percent: n }
        const p = Math.round((remainder * e.percent) / otherSum)
        return { ...e, percent: Math.max(0, p) }
      })
      const total = next.reduce((s, e) => s + e.percent, 0)
      const diff = 100 - total
      if (diff !== 0 && otherIndices.length > 0) {
        const fixIndex = otherIndices[diff > 0 ? 0 : otherIndices.length - 1]
        next[fixIndex] = { ...next[fixIndex], percent: Math.max(0, next[fixIndex].percent + diff) }
      }
      return next
    })
  }, [])

  const addEntry = useCallback((source: FeedSource) => {
    setEntries((prev) => {
      if (prev.some((e) => sameSource(e.source, source))) return prev
      const next = [...prev, { source, percent: 0 }]
      const n = next.length
      const base = Math.floor(100 / n)
      let remainder = 100 - base * n
      next.forEach((e, i) => {
        next[i] = { ...e, percent: base + (remainder > 0 ? 1 : 0) }
        if (remainder > 0) remainder -= 1
      })
      return next
    })
    setEnabledState(true)
  }, [])

  function rebalance(entries: FeedMixEntry[]): FeedMixEntry[] {
    if (entries.length <= 1) return entries.map((e) => ({ ...e, percent: entries.length === 1 ? 100 : 0 }))
    const n = entries.length
    const base = Math.floor(100 / n)
    let remainder = 100 - base * n
    return entries.map((e) => {
      const p = base + (remainder > 0 ? 1 : 0)
      if (remainder > 0) remainder -= 1
      return { ...e, percent: p }
    })
  }

  const removeEntry = useCallback((index: number) => {
    setEntries((prev) => rebalance(prev.filter((_, i) => i !== index)))
  }, [])

  const toggleSource = useCallback((source: FeedSource) => {
    setEntries((prev) => {
      const idx = prev.findIndex((e) => sameSource(e.source, source))
      if (idx >= 0) return rebalance(prev.filter((_, i) => i !== idx))
      const next = [...prev, { source, percent: 0 }]
      const n = next.length
      const base = Math.floor(100 / n)
      let remainder = 100 - base * n
      next.forEach((e, i) => {
        next[i] = { ...e, percent: base + (remainder > 0 ? 1 : 0) }
        if (remainder > 0) remainder -= 1
      })
      return next
    })
    setEnabledState(true)
  }, [])

  const setSingleFeed = useCallback((source: FeedSource) => {
    setEntries([{ source, percent: 100 }])
    setEnabledState(true)
  }, [])

  const totalPercent = useMemo(() => entries.reduce((s, e) => s + e.percent, 0), [entries])

  const value = useMemo(
    () => ({
      entries,
      enabled,
      setEnabled,
      setEntryPercent,
      addEntry,
      removeEntry,
      toggleSource,
      setSingleFeed,
      totalPercent,
    }),
    [entries, enabled, setEnabled, setEntryPercent, addEntry, removeEntry, toggleSource, setSingleFeed, totalPercent]
  )

  return <FeedMixContext.Provider value={value}>{children}</FeedMixContext.Provider>
}

export function useFeedMix() {
  const ctx = useContext(FeedMixContext)
  if (!ctx) {
    return {
      entries: [] as FeedMixEntry[],
      enabled: false,
      setEnabled: () => {},
      setEntryPercent: () => {},
      addEntry: () => {},
      removeEntry: () => {},
      toggleSource: () => {},
      setSingleFeed: () => {},
      totalPercent: 0,
    }
  }
  return ctx
}
