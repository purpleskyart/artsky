import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { LoginMode } from '../components/LoginCard'
import { ChunkLoadError } from '../components/ChunkLoadError'

const LoginModal = lazy(() => import('../components/LoginModal'))

type LoginModalContextValue = {
  openLoginModal: (mode?: LoginMode) => void
  closeLoginModal: () => void
}

const LoginModalContext = createContext<LoginModalContextValue | null>(null)

export function LoginModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [mode, setMode] = useState<LoginMode>('signin')

  const openLoginModal = useCallback((m?: LoginMode) => {
    setMode(m ?? 'signin')
    setIsOpen(true)
  }, [])

  const closeLoginModal = useCallback(() => {
    setIsOpen(false)
  }, [])

  const value: LoginModalContextValue = useMemo(() => ({
    openLoginModal,
    closeLoginModal,
  }), [openLoginModal, closeLoginModal])

  return (
    <LoginModalContext.Provider value={value}>
      {children}
      {isOpen && (
        <ChunkLoadError>
          <Suspense fallback={null}>
            <LoginModal
              isOpen={isOpen}
              mode={mode}
              onClose={closeLoginModal}
              onSuccess={closeLoginModal}
            />
          </Suspense>
        </ChunkLoadError>
      )}
    </LoginModalContext.Provider>
  )
}

export function useLoginModal(): LoginModalContextValue {
  const ctx = useContext(LoginModalContext)
  if (!ctx) throw new Error('useLoginModal must be used within LoginModalProvider')
  return ctx
}
