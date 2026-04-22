import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { getSession } from '../lib/bsky'
import { useToast } from './ToastContext'
import { useSession } from './SessionContext'
import { asyncStorage } from '../lib/AsyncStorage'

export type CardViewMode = 'default' | 'artOnly' | 'minimalist'

/** Legacy global key — migrated once per account into `artsky-card-view:${did}`. */
const LEGACY_STORAGE_KEY = 'artsky-card-view'
const GUEST_STORAGE_KEY = 'artsky-card-view-guest'

function cardViewKeyForDid(did: string): string {
  return `artsky-card-view:${did}`
}

function parseStoredMode(v: unknown): CardViewMode | null {
  if (v === 'artOnly' || v === 'minimalist' || v === 'default') return v as CardViewMode
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
      const g = parseStoredMode(asyncStorage.get(GUEST_STORAGE_KEY))
      return g ?? 'default'
    }
    const per = parseStoredMode(asyncStorage.get(cardViewKeyForDid(did)))
    if (per !== null) return per
    const legacy = asyncStorage.get(LEGACY_STORAGE_KEY)
    const legacyParsed = parseStoredMode(legacy)
    if (legacyParsed !== null) {
      asyncStorage.set(cardViewKeyForDid(did), legacyParsed, 0)
      asyncStorage.remove(LEGACY_STORAGE_KEY)
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
      asyncStorage.set(GUEST_STORAGE_KEY, mode, 0)
    } else {
      asyncStorage.set(cardViewKeyForDid(did), mode, 0)
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
  const prevDidRef = useRef<string | null>(did)

  // Update mode when switching accounts
  if (prevDidRef.current !== did) {
    prevDidRef.current = did
    setCardViewModeState(loadModeForDid(did))
  }

  const setCardViewMode = useCallback((value: CardViewMode) => {
    setCardViewModeState(value)
    persistMode(did, value)
  }, [did])

  const cycleCardView = useCallback((_anchor?: HTMLElement, options?: { showToast?: boolean }) => {
    setCardViewModeState((m) => {
      const next = m === 'default' ? 'minimalist' : m === 'minimalist' ? 'artOnly' : 'default'
      if (options?.showToast !== false) toast?.showToast(CARD_VIEW_LABELS[next])
      persistMode(did, next)
      return next
    })
  }, [did, toast])

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
