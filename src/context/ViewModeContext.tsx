import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { useSyncExternalStore } from 'react'
import { useSession } from './SessionContext'
import { useToast } from './ToastContext'
import { asyncStorage } from '../lib/AsyncStorage'

const DESKTOP_BREAKPOINT = 768

/** Legacy global key — migrated once per account into `artsky-view-mode:${did}`. */
const LEGACY_STORAGE_KEY = 'artsky-view-mode'
const GUEST_STORAGE_KEY = 'artsky-view-mode-guest'

function viewModeKeyForDid(did: string): string {
  return `artsky-view-mode:${did}`
}

export type ViewMode = '1' | '2' | '3' | 'a'

const VIEW_OPTIONS: ViewMode[] = ['1', '2', '3', 'a']

/** Human-readable labels: view N = N Columns */
export const VIEW_LABELS: Record<ViewMode, string> = {
  '1': '1 Column',
  '2': '2 Columns',
  '3': '3 Columns',
  a: 'All Columns',
}

type ViewModeContextValue = {
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  /** Cycle 1 → 2 → 3 → All → 1 (uses current state, safe for header toggle). Shows toast unless options.showToast is false. */
  cycleViewMode: (anchor?: HTMLElement, options?: { showToast?: boolean }) => void
  viewOptions: ViewMode[]
}

const ViewModeContext = createContext<ViewModeContextValue | null>(null)

function parseStoredMode(v: unknown): ViewMode | null {
  if (v === '1' || v === '2' || v === '3' || v === 'a') return v
  if (v === '4' || v === '5') return '3' /* migrate old 4/5 column preference to 3 */
  return null
}

/**
 * Guest: default 2 columns; optional saved choice in GUEST_STORAGE_KEY.
 * Logged in: default 2 columns (desktop: 3) until the user changes it; persisted per DID (and legacy key migrated once).
 */
function loadModeForDid(did: string | null, isDesktop: boolean): ViewMode {
  try {
    if (!did) {
      const g = parseStoredMode(asyncStorage.get(GUEST_STORAGE_KEY))
      return g ?? (isDesktop ? '3' : '2')
    }
    const per = parseStoredMode(asyncStorage.get(viewModeKeyForDid(did)))
    if (per !== null) return per
    const legacy = asyncStorage.get(LEGACY_STORAGE_KEY)
    const legacyParsed = parseStoredMode(legacy)
    if (legacyParsed !== null) {
      asyncStorage.set(viewModeKeyForDid(did), legacyParsed, 0)
      asyncStorage.remove(LEGACY_STORAGE_KEY)
      return legacyParsed
    }
    return isDesktop ? '3' : '2'
  } catch {
    return isDesktop ? '3' : '2'
  }
}

function persistMode(did: string | null, mode: ViewMode) {
  try {
    if (!did) {
      asyncStorage.set(GUEST_STORAGE_KEY, mode, 0)
    } else {
      asyncStorage.set(viewModeKeyForDid(did), mode, 0)
    }
  } catch {
    // ignore
  }
}

function getDesktopSnapshot() {
  return typeof window !== 'undefined' ? window.innerWidth >= DESKTOP_BREAKPOINT : false
}
function subscribeDesktop(cb: () => void) {
  if (typeof window === 'undefined') return () => {}
  const mq = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

export function ViewModeProvider({ children }: { children: React.ReactNode }) {
  const isDesktop = useSyncExternalStore(subscribeDesktop, getDesktopSnapshot, () => false)
  return (
    <ViewModeProviderInner isDesktop={isDesktop}>
      {children}
    </ViewModeProviderInner>
  )
}

function ViewModeProviderInner({
  children,
  isDesktop,
}: {
  children: React.ReactNode
  isDesktop: boolean
}) {
  const toast = useToast()
  const { session } = useSession()
  const did = session?.did ?? null
  const [viewMode, setViewModeState] = useState<ViewMode>(() => loadModeForDid(did, isDesktop))
  const prevDidRef = useRef<string | null>(did)
  const prevIsDesktopRef = useRef<boolean>(isDesktop)

  // Update mode when switching accounts or breakpoint changes
  if (prevDidRef.current !== did || prevIsDesktopRef.current !== isDesktop) {
    prevDidRef.current = did
    prevIsDesktopRef.current = isDesktop
    setViewModeState(loadModeForDid(did, isDesktop))
  }

  const setViewMode = useCallback((mode: ViewMode) => {
    const safe: ViewMode = mode === '1' || mode === '2' || mode === '3' || mode === 'a' ? mode : '2'
    setViewModeState(safe)
    persistMode(did, safe)
  }, [did])

  const cycleViewMode = useCallback((_anchor?: HTMLElement, options?: { showToast?: boolean }) => {
    setViewModeState((prev) => {
      const i = VIEW_OPTIONS.indexOf(prev)
      const next: ViewMode = VIEW_OPTIONS[i >= 0 ? (i + 1) % VIEW_OPTIONS.length : 0]
      persistMode(did, next)
      if (options?.showToast !== false) toast?.showToast(VIEW_LABELS[next])
      return next
    })
  }, [did, toast])

  const value: ViewModeContextValue = {
    viewMode,
    setViewMode,
    cycleViewMode,
    viewOptions: VIEW_OPTIONS,
  }

  return (
    <ViewModeContext.Provider value={value}>
      {children}
    </ViewModeContext.Provider>
  )
}

export function useViewMode() {
  const ctx = useContext(ViewModeContext)
  if (!ctx) throw new Error('useViewMode must be used within ViewModeProvider')
  return ctx
}

/** Matches feed/profile keyboard shortcuts (768px) — use for pointer vs touch behavior. */
export function useIsDesktop() {
  return useSyncExternalStore(subscribeDesktop, getDesktopSnapshot, () => false)
}
