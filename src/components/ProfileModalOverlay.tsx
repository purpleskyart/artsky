import { lazy, Suspense, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

const ProfileModal = lazy(() => import('./ProfileModal'))

/**
 * Profile opened from feed (or another page) via `/profile/:handle` with `state.backgroundLocation`.
 * Canonical URL; feed stays mounted underneath for scroll preservation.
 */
export default function ProfileModalOverlay() {
  const { handle } = useParams<{ handle: string }>()
  const navigate = useNavigate()
  const onClose = useCallback(() => {
    navigate(-1)
  }, [navigate])

  const h = handle?.trim()
  if (!h) return null

  return (
    <Suspense fallback={null}>
      <ProfileModal
        handle={h}
        onClose={onClose}
        onBack={onClose}
        canGoBack={false}
        isTopModal
        stackIndex={0}
      />
    </Suspense>
  )
}
