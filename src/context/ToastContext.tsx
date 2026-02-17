import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

const TOAST_DURATION_MS = 2500

type ToastContextValue = {
  toastMessage: string | null
  showToast: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const showToast = useCallback((message: string) => {
    setToastMessage(message)
  }, [])

  useEffect(() => {
    if (!toastMessage) return
    const t = setTimeout(() => setToastMessage(null), TOAST_DURATION_MS)
    return () => clearTimeout(t)
  }, [toastMessage])

  const value: ToastContextValue = useMemo(
    () => ({
      toastMessage,
      showToast,
    }),
    [toastMessage, showToast]
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue | null {
  return useContext(ToastContext)
}
