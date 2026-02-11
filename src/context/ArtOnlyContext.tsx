import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const STORAGE_KEY = 'artsky-card-view'

export type CardViewMode = 'default' | 'artOnly' | 'minimalist'

export const CARD_VIEW_LABELS: Record<CardViewMode, string> = {
  default: 'Full Cards',
  minimalist: 'Mini Cards',
  artOnly: 'Art Cards',
}

export type CardViewAnnouncement = {
  text: string
  anchorRect: { top: number; left: number; width: number; height: number; bottom: number }
}

type ArtOnlyContextValue = {
  /** Current card view: default (full), artOnly (focus on art), minimalist (only collect + like) */
  cardViewMode: CardViewMode
  setCardViewMode: (value: CardViewMode) => void
  /** Cycle: default → minimalist → artOnly → default (eye: open → half → closed). Pass anchor to show toast. */
  cycleCardView: (anchor?: HTMLElement) => void
  /** True when mode is artOnly or minimalist (hide full text/handle in card) */
  artOnly: boolean
  /** True when mode is minimalist (only collect + like buttons) */
  minimalist: boolean
  /** @deprecated use setCardViewMode */
  setArtOnly: (value: boolean) => void
  /** @deprecated use cycleCardView */
  toggleArtOnly: () => void
  /** Brief toast when card view changes. */
  cardViewAnnouncement: CardViewAnnouncement | null
}

const ArtOnlyContext = createContext<ArtOnlyContextValue | null>(null)

function getStored(): CardViewMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'artOnly' || v === 'minimalist') return v
    if (v === '1' || v === 'true') return 'artOnly' // legacy
    return 'default'
  } catch {
    return 'default'
  }
}

const TOAST_MS = 1200

export function ArtOnlyProvider({ children }: { children: React.ReactNode }) {
  const [cardViewMode, setCardViewModeState] = useState<CardViewMode>(getStored)
  const [cardViewAnnouncement, setCardViewAnnouncement] = useState<CardViewAnnouncement | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, cardViewMode)
    } catch {
      // ignore
    }
  }, [cardViewMode])

  useEffect(() => {
    if (!cardViewAnnouncement) return
    const t = setTimeout(() => setCardViewAnnouncement(null), TOAST_MS)
    return () => clearTimeout(t)
  }, [cardViewAnnouncement])

  const setCardViewMode = useCallback((value: CardViewMode) => {
    setCardViewModeState(value)
  }, [])

  const cycleCardView = useCallback((anchor?: HTMLElement) => {
    setCardViewModeState((m) => {
      const next = m === 'default' ? 'minimalist' : m === 'minimalist' ? 'artOnly' : 'default'
      const rect = anchor?.getBoundingClientRect()
      setCardViewAnnouncement({
        text: CARD_VIEW_LABELS[next],
        anchorRect: rect
          ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom }
          : { top: 48, left: typeof window !== 'undefined' ? window.innerWidth / 2 : 0, width: 0, height: 0, bottom: 48 },
      })
      return next
    })
  }, [])

  const setArtOnly = useCallback((value: boolean) => {
    setCardViewModeState(value ? 'artOnly' : 'default')
  }, [])

  const toggleArtOnly = useCallback(() => {
    cycleCardView()
  }, [cycleCardView])

  const artOnly = cardViewMode !== 'default'
  const minimalist = cardViewMode === 'minimalist'

  const value: ArtOnlyContextValue = {
    cardViewMode,
    setCardViewMode,
    cycleCardView,
    artOnly,
    minimalist,
    setArtOnly,
    toggleArtOnly,
    cardViewAnnouncement,
  }

  return (
    <ArtOnlyContext.Provider value={value}>
      {children}
    </ArtOnlyContext.Provider>
  )
}

export function useArtOnly() {
  const ctx = useContext(ArtOnlyContext)
  if (!ctx) {
    return {
      cardViewMode: 'default' as CardViewMode,
      setCardViewMode: () => {},
      cycleCardView: () => {},
      artOnly: false,
      minimalist: false,
      setArtOnly: () => {},
      toggleArtOnly: () => {},
      cardViewAnnouncement: null,
    }
  }
  return ctx
}
