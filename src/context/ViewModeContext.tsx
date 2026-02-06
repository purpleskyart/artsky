import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const STORAGE_KEY = 'artsky-view-mode'
export type ViewMode = 'compact' | 'large'

type ViewModeContextValue = {
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  toggleViewMode: () => void
}

const ViewModeContext = createContext<ViewModeContextValue | null>(null)

function getStored(): ViewMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'large' || v === 'compact') return v
  } catch {
    // ignore
  }
  return 'compact'
}

export function ViewModeProvider({ children }: { children: React.ReactNode }) {
  const [viewMode, setViewModeState] = useState<ViewMode>(getStored)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, viewMode)
    } catch {
      // ignore
    }
  }, [viewMode])

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode)
  }, [])

  const toggleViewMode = useCallback(() => {
    setViewModeState((m) => (m === 'compact' ? 'large' : 'compact'))
  }, [])

  const value: ViewModeContextValue = {
    viewMode,
    setViewMode,
    toggleViewMode,
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
