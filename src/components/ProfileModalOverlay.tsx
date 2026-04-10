import { lazy, Suspense, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useProfileModal } from '../context/ProfileModalContext'
import AppModal from './AppModal'

// Lazy-load ProfileContent inline to avoid circular dependency
const ProfileContent = lazy(() => import('../pages/ProfilePage').then(m => ({ default: m.ProfileContent })))

/**
 * Profile opened from feed (or another page) via `/profile/:handle` with `state.backgroundLocation`.
 * Canonical URL; feed stays mounted underneath for scroll preservation.
 */
export default function ProfileModalOverlay() {
  const { handle } = useParams<{ handle: string }>()
  const navigate = useNavigate()
  const { openProfileModal } = useProfileModal()
  const onClose = useCallback(() => {
    navigate(-1)
  }, [navigate])

  const h = handle?.trim()
  if (!h) return null

  return (
    <Suspense fallback={null}>
      <AppModal
        ariaLabel="Profile"
        onClose={onClose}
        onBack={onClose}
        canGoBack={false}
        transparentTopBar
        hideTopBar
        scrollKey={h}
        profileScrollPersistenceHandle={h}
        isTopModal
        stackIndex={0}
      >
        <ProfileContent
          handle={h}
          openProfileModal={openProfileModal}
          inModal
        />
      </AppModal>
    </Suspense>
  )
}
