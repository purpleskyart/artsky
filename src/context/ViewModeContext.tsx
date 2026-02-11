import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useSyncExternalStore } from 'react'
import { useSession } from './SessionContext'

const STORAGE_KEY = 'artsky-view-mode'
const DESKTOP_BREAKPOINT = 768

export type ViewMode = '1' | '2' | '3'

const VIEW_OPTIONS: ViewMode[] = ['1', '2', '3']

/** Human-readable labels: view N = N Columns */
export const VIEW_LABELS: Record<ViewMode, string> = {
  '1': '1 Column',
  '2': '2 Columns',
  '3': '3 Columns',
}

export type ViewModeAnnouncement = {
  text: string
  anchorRect: { top: number; left: number; width: number; height: number; bottom: number }
}

type ViewModeContextValue = {
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  /** Cycle 1 → 2 → 3 → 1 (uses current state, safe for header toggle). Pass anchor to show toast. */
  cycleViewMode: (anchor?: HTMLElement) => void
  viewOptions: ViewMode[]
  /** Brief toast when column view changes. */
  viewModeAnnouncement: ViewModeAnnouncement | null
}

const ViewModeContext = createContext<ViewModeContextValue | null>(null)

function getStored(): ViewMode | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === '1' || v === '2' || v === '3') return v
    if (v === '4' || v === '5') return '3' /* migrate old 4/5 column preference to 3 */
  } catch {
    // ignore
  }
  return null
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

const TOAST_MS = 1200

export function ViewModeProvider({ children }: { children: React.ReactNode }) {
  const { session } = useSession()
  const isDesktop = useSyncExternalStore(subscribeDesktop, getDesktopSnapshot, () => false)
  const stored = getStored()
  const defaultMode: ViewMode = !session && isDesktop ? '3' : '2'
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    const v = stored ?? defaultMode
    return v === '1' || v === '2' || v === '3' ? v : defaultMode
  })
  const [viewModeAnnouncement, setViewModeAnnouncement] = useState<ViewModeAnnouncement | null>(null)

  useEffect(() => {
    if (!viewModeAnnouncement) return
    const t = setTimeout(() => setViewModeAnnouncement(null), TOAST_MS)
    return () => clearTimeout(t)
  }, [viewModeAnnouncement])

  useEffect(() => {
    if (getStored() !== null) return
    const nextDefault: ViewMode = !session && isDesktop ? '3' : '2'
    setViewModeState((prev) => (prev === nextDefault ? prev : nextDefault))
  }, [session, isDesktop])

  const setViewMode = useCallback((mode: ViewMode) => {
    const safe: ViewMode = mode === '1' || mode === '2' || mode === '3' ? mode : '2'
    setViewModeState(safe)
    try {
      localStorage.setItem(STORAGE_KEY, safe)
    } catch {
      // ignore
    }
  }, [])

  const cycleViewMode = useCallback((anchor?: HTMLElement) => {
    setViewModeState((prev) => {
      const i = VIEW_OPTIONS.indexOf(prev)
      const next: ViewMode = VIEW_OPTIONS[i >= 0 ? (i + 1) % VIEW_OPTIONS.length : 0]
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // ignore
      }
      const rect = anchor?.getBoundingClientRect()
      setViewModeAnnouncement({
        text: VIEW_LABELS[next],
        anchorRect: rect
          ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom }
          : { top: 48, left: typeof window !== 'undefined' ? window.innerWidth / 2 : 0, width: 0, height: 0, bottom: 48 },
      })
      return next
    })
  }, [])

  const value: ViewModeContextValue = {
    viewMode,
    setViewMode,
    cycleViewMode,
    viewOptions: VIEW_OPTIONS,
    viewModeAnnouncement,
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
