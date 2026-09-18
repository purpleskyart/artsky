import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

const STORAGE_KEY = 'artsky-modal-expanded'

function getStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function setStored(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
  } catch {
    // ignore
  }
}

type ModalExpandContextValue = {
  expanded: boolean
  setExpanded: (value: boolean) => void
}

const ModalExpandContext = createContext<ModalExpandContextValue | null>(null)

export function ModalExpandProvider({ children }: { children: ReactNode }) {
  const [expanded, setExpandedState] = useState(getStored)
  const setExpanded = useCallback((value: boolean) => {
    setExpandedState(value)
    setStored(value)
  }, [])
  
  const value = useMemo(() => ({ expanded, setExpanded }), [expanded, setExpanded])
  
  return (
    <ModalExpandContext.Provider value={value}>
      {children}
    </ModalExpandContext.Provider>
  )
}

export function useModalExpand(): ModalExpandContextValue {
  const ctx = useContext(ModalExpandContext)
  if (!ctx) {
    return {
      expanded: false,
      setExpanded: () => {},
    }
  }
  return ctx
}
