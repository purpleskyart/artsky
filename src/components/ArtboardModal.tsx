import { useState } from 'react'
import AppModal from './AppModal'
import { ArtboardDetailContent } from '../pages/ArtboardDetailPage'

interface ArtboardModalProps {
  id: string
  onClose: () => void
  onBack: () => void
  canGoBack: boolean
  isTopModal?: boolean
}

export default function ArtboardModal({ id, onClose, onBack, canGoBack, isTopModal }: ArtboardModalProps) {
  const [refreshFn, setRefreshFn] = useState<(() => void | Promise<void>) | null>(null)
  return (
    <AppModal
      ariaLabel="Collection"
      onClose={onClose}
      onBack={onBack}
      canGoBack={canGoBack}
      onPullToRefresh={refreshFn ? () => refreshFn() : undefined}
      scrollKey={id}
      isTopModal={isTopModal}
    >
      <ArtboardDetailContent id={id} inModal onRegisterRefresh={(fn) => setRefreshFn(() => fn)} />
    </AppModal>
  )
}
