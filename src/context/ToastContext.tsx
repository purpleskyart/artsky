import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

const TOAST_DURATION_MS = 2500

/** Viewport center-x and top offset for fixed positioning below an anchor element */
export type ToastAnchorPosition = { cx: number; y: number }

type ToastPayload = {
  message: string
  /** null = default bottom bar placement */
  position: ToastAnchorPosition | null
}

type ToastContextValue = {
  toastMessage: string | null
  toastPosition: ToastAnchorPosition | null
  showToast: (message: string, anchorEl?: HTMLElement | null) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastPayload | null>(null)

  const showToast = useCallback((message: string, anchorEl?: HTMLElement | null) => {
    if (anchorEl) {
      const r = anchorEl.getBoundingClientRect()
      setToast({
        message,
        position: { cx: r.left + r.width / 2, y: r.bottom + 8 },
      })
    } else {
      setToast({ message, position: null })
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), TOAST_DURATION_MS)
    return () => clearTimeout(t)
  }, [toast])

  const value: ToastContextValue = useMemo(
    () => ({
      toastMessage: toast?.message ?? null,
      toastPosition: toast?.position ?? null,
      showToast,
    }),
    [toast, showToast]
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
