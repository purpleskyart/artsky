import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import AppModal from './AppModal'
import { CollectionsIndexContent } from '../pages/CollectionsIndexPage'

/** Collections index opened as overlay from feed (backgroundLocation state). */
export default function CollectionsIndexModalOverlay() {
  const navigate = useNavigate()
  const onClose = useCallback(() => {
    navigate(-1)
  }, [navigate])

  const onDesktopBackdrop = useCallback(() => {
    navigate('/feed', { replace: true })
  }, [navigate])

  return (
    <AppModal
      ariaLabel="Collections"
      onClose={onClose}
      onBack={onClose}
      canGoBack={false}
      onDesktopBackdrop={onDesktopBackdrop}
      transparentTopBar
      isTopModal
      stackIndex={0}
    >
      <CollectionsIndexContent />
    </AppModal>
  )
}
