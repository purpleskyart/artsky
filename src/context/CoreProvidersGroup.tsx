import { memo, useMemo, type ReactNode } from 'react'
import { ThemeProvider } from './ThemeContext'
import { SessionProvider } from './SessionContext'
import { ScrollLockProvider } from './ScrollLockContext'
import { ToastProvider } from './ToastContext'

interface CoreProvidersGroupProps {
  children: ReactNode
}

/**
 * CoreProvidersGroup combines core application providers (Theme, Session, ScrollLock, Toast)
 * into a single memoized component to reduce nesting depth and improve render performance.
 * 
 * Each individual provider already memoizes its context values internally, and this wrapper
 * is memoized to prevent unnecessary re-renders of the provider tree itself.
 */
function CoreProvidersGroupComponent({ children }: CoreProvidersGroupProps) {
  // Memoize the children to prevent unnecessary re-renders
  const memoizedChildren = useMemo(() => children, [children])

  return (
    <ThemeProvider>
      <SessionProvider>
        <ScrollLockProvider>
          <ToastProvider>
            {memoizedChildren}
          </ToastProvider>
        </ScrollLockProvider>
      </SessionProvider>
    </ThemeProvider>
  )
}

/**
 * Memoized CoreProvidersGroup component to prevent re-renders when props haven't changed.
 * This optimization ensures that the entire provider tree doesn't re-render unnecessarily.
 */
export const CoreProvidersGroup = memo(CoreProvidersGroupComponent)
