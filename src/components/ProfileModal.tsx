import { lazy, Suspense, useState } from 'react'
import AppModal from './AppModal'

// Lazy-load ProfileContent inline to avoid circular dependency with ProfilePage
const ProfileContent = lazy(() => import('../pages/ProfilePage').then(m => ({ default: m.ProfileContent })))

interface ProfileModalProps {
  handle: string
  onClose: () => void
  onBack: () => void
  canGoBack: boolean
  onDesktopBackdrop?: () => void
  isTopModal?: boolean
  stackIndex?: number
  openProfileModal: (handle: string) => void
  openPostModal: (uri: string, openReply?: boolean, focusUri?: string, authorHandle?: string) => void
  isModalOpen: boolean
}

export default function ProfileModal({ handle, onClose, onBack, canGoBack, onDesktopBackdrop, isTopModal, stackIndex, openProfileModal, openPostModal, isModalOpen }: ProfileModalProps) {
  const [refreshFn, setRefreshFn] = useState<(() => void | Promise<void>) | null>(null)

  return (
    <AppModal
      ariaLabel="Profile"
      onClose={onClose}
      onBack={onBack}
      canGoBack={canGoBack}
      onDesktopBackdrop={onDesktopBackdrop}
      transparentTopBar
      hideTopBar
      onPullToRefresh={refreshFn ? () => refreshFn() : undefined}
      scrollKey={handle}
      profileScrollPersistenceHandle={handle}
      isTopModal={isTopModal}
      stackIndex={stackIndex}
    >
      <Suspense fallback={null}>
        <ProfileContent
          handle={handle}
          openProfileModal={openProfileModal}
          openPostModal={openPostModal}
          isModalOpen={isModalOpen}
          inModal
          onRegisterRefresh={(fn) => setRefreshFn(() => fn)}
        />
      </Suspense>
    </AppModal>
  )
}
