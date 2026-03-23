import { useState } from 'react'
import AppModal from './AppModal'
import { ArtboardsContent } from '../pages/ArtboardsPage'

interface ArtboardsModalProps {
  onClose: () => void
  onBack: () => void
  canGoBack: boolean
  isTopModal?: boolean
  stackIndex?: number
}

export default function ArtboardsModal({ onClose, onBack, canGoBack, isTopModal, stackIndex }: ArtboardsModalProps) {
  const [refreshFn, setRefreshFn] = useState<(() => void | Promise<void>) | null>(null)
  return (
    <AppModal
      ariaLabel="Collections"
      onClose={onClose}
      onBack={onBack}
      canGoBack={canGoBack}
      onPullToRefresh={refreshFn ? () => refreshFn() : undefined}
      scrollKey="collections"
      isTopModal={isTopModal}
      stackIndex={stackIndex}
    >
      <ArtboardsContent inModal onRegisterRefresh={(fn) => setRefreshFn(() => fn)} />
    </AppModal>
  )
}
