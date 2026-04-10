import { useCallback } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import AppModal from './AppModal'
import { CollectionDetailContent } from '../pages/CollectionPage'
import { RESERVED_APP_PATH_SEGMENTS } from '../lib/routes'

/** Single collection board opened as overlay from feed (backgroundLocation state). */
export default function CollectionBoardModalOverlay() {
  const { handle, boardSlug } = useParams<{ handle: string; boardSlug: string }>()
  const navigate = useNavigate()
  const onClose = useCallback(() => {
    navigate(-1)
  }, [navigate])

  const onDesktopBackdrop = useCallback(() => {
    navigate('/feed', { replace: true })
  }, [navigate])

  const h = handle?.trim()
  const s = boardSlug?.trim()
  if (!h || !s) return <Navigate to="/feed" replace />
  if (RESERVED_APP_PATH_SEGMENTS.has(h.toLowerCase())) return <Navigate to="/feed" replace />

  const uri = `${h}/${s}`

  return (
    <AppModal
      ariaLabel="Collection"
      onClose={onClose}
      onBack={onClose}
      canGoBack={false}
      onDesktopBackdrop={onDesktopBackdrop}
      transparentTopBar
      isTopModal
      stackIndex={0}
    >
      <CollectionDetailContent uri={uri} />
    </AppModal>
  )
}
