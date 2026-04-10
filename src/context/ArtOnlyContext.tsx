import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { getSession } from '../lib/bsky'
import { useToast } from './ToastContext'
import { useSession } from './SessionContext'

export type CardViewMode = 'default' | 'artOnly' | 'minimalist'

/** Legacy global key — migrated once per account into `artsky-card-view:${did}`. */
const LEGACY_STORAGE_KEY = 'artsky-card-view'
const GUEST_STORAGE_KEY = 'artsky-card-view-guest'

function cardViewKeyForDid(did: string): string {
  return `artsky-card-view:${did}`
}

function parseStoredMode(v: string | null): CardViewMode | null {
  if (v === 'artOnly' || v === 'minimalist' || v === 'default') return v
  if (v === '1' || v === 'true') return 'artOnly'
  return null
}

/**
 * Guest: default Full Cards; optional saved choice in GUEST_STORAGE_KEY.
 * Logged in: default Full Cards until the user changes it; persisted per DID (and legacy key migrated once).
 */
export function loadModeForDid(did: string | null): CardViewMode {
  try {
    if (!did) {
      const g = parseStoredMode(localStorage.getItem(GUEST_STORAGE_KEY))
      return g ?? 'default'
    }
    const per = parseStoredMode(localStorage.getItem(cardViewKeyForDid(did)))
    if (per !== null) return per
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    const legacyParsed = parseStoredMode(legacy)
    if (legacyParsed !== null) {
      localStorage.setItem(cardViewKeyForDid(did), legacyParsed)
      localStorage.removeItem(LEGACY_STORAGE_KEY)
      return legacyParsed
    }
    return 'default'
  } catch {
    return 'default'
  }
}

function persistMode(did: string | null, mode: CardViewMode) {
  try {
    if (!did) {
      localStorage.setItem(GUEST_STORAGE_KEY, mode)
    } else {
      localStorage.setItem(cardViewKeyForDid(did), mode)
    }
  } catch {
    // ignore
  }
}

export const CARD_VIEW_LABELS: Record<CardViewMode, string> = {
  default: 'Full Cards',
  minimalist: 'Mini Cards',
  artOnly: 'Art Cards',
}

type ArtOnlyContextValue = {
  /** Current card view: default (full), artOnly (focus on art), minimalist (only collect + like) */
  cardViewMode: CardViewMode
  setCardViewMode: (value: CardViewMode) => void
  /** Cycle: default → minimalist → artOnly → default. Shows toast unless options.showToast is false. */
  cycleCardView: (anchor?: HTMLElement, options?: { showToast?: boolean }) => void
  /** True when mode is artOnly or minimalist (hide full text/handle in card) */
  artOnly: boolean
  /** True when mode is minimalist (only collect + like buttons) */
  minimalist: boolean
}

const ArtOnlyContext = createContext<ArtOnlyContextValue | null>(null)

export function ArtOnlyProvider({ children }: { children: React.ReactNode }) {
  const toast = useToast()
  const { session } = useSession()
  const did = session?.did ?? null
  const [cardViewMode, setCardViewModeState] = useState<CardViewMode>(() => loadModeForDid(getSession()?.did ?? null))
  const prevDidRef = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    if (prevDidRef.current === undefined) {
      prevDidRef.current = did
      return
    }
    if (prevDidRef.current !== did) {
      prevDidRef.current = did
      setCardViewModeState(loadModeForDid(did))
      return
    }
    persistMode(did, cardViewMode)
  }, [did, cardViewMode])

  const setCardViewMode = useCallback((value: CardViewMode) => {
    setCardViewModeState(value)
  }, [])

  const cycleCardView = useCallback((_anchor?: HTMLElement, options?: { showToast?: boolean }) => {
    setCardViewModeState((m) => {
      const next = m === 'default' ? 'minimalist' : m === 'minimalist' ? 'artOnly' : 'default'
      if (options?.showToast !== false) toast?.showToast(CARD_VIEW_LABELS[next])
      return next
    })
  }, [toast])

  const artOnly = cardViewMode !== 'default'
  const minimalist = cardViewMode === 'minimalist'

  const value: ArtOnlyContextValue = {
    cardViewMode,
    setCardViewMode,
    cycleCardView,
    artOnly,
    minimalist,
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
      cardViewMode: 'artOnly' as CardViewMode,
      setCardViewMode: () => {},
      cycleCardView: () => {},
      artOnly: true,
      minimalist: false,
    }
  }
  return ctx
}
