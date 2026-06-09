import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChunkLoadError } from '../components/ChunkLoadError'
import { setFeedSuspendReason } from '../lib/videoPlaybackManager'

const LoginModal = lazy(() => import('../components/LoginModal'))

type LoginModalContextValue = {
  openLoginModal: () => void
  closeLoginModal: () => void
}

const LoginModalContext = createContext<LoginModalContextValue | null>(null)

export function LoginModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)

  const openLoginModal = useCallback(() => {
    setIsOpen(true)
  }, [])

  const closeLoginModal = useCallback(() => {
    setIsOpen(false)
  }, [])

  useEffect(() => {
    setFeedSuspendReason('login', isOpen)
    return () => setFeedSuspendReason('login', false)
  }, [isOpen])

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
