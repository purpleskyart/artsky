import { memo, useMemo, type ReactNode } from 'react'
import { LoginModalProvider } from './LoginModalContext'
import { ModalExpandProvider } from './ModalExpandContext'
import { ProfileModalProvider } from './ProfileModalContext'
import { EditProfileProvider } from './EditProfileContext'

interface ModalProvidersGroupProps {
  children: ReactNode
}

/**
 * ModalProvidersGroup combines modal-related providers (LoginModal, ModalExpand, 
 * ProfileModal, EditProfile) into a single memoized component to reduce nesting 
 * depth and improve render performance.
 * 
 * Each individual provider already memoizes its context values internally, and this wrapper
 * is memoized to prevent unnecessary re-renders of the provider tree itself.
 */
function ModalProvidersGroupComponent({ children }: ModalProvidersGroupProps) {
  // Memoize the children to prevent unnecessary re-renders
  const memoizedChildren = useMemo(() => children, [children])

  return (
    <LoginModalProvider>
      <ModalExpandProvider>
        <ProfileModalProvider>
          <EditProfileProvider>
            {memoizedChildren}
          </EditProfileProvider>
        </ProfileModalProvider>
      </ModalExpandProvider>
    </LoginModalProvider>
  )
}

/**
 * Memoized ModalProvidersGroup component to prevent re-renders when props haven't changed.
 * This optimization ensures that the entire provider tree doesn't re-render unnecessarily.
 */
export const ModalProvidersGroup = memo(ModalProvidersGroupComponent)
