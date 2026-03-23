import { useState } from 'react'
import AppModal from './AppModal'
import { ArtboardDetailContent } from '../pages/ArtboardDetailPage'

interface ArtboardModalProps {
  id: string
  /** When set (e.g. from a shared URL), load this collection from the owner's repo. */
  ownerDid?: string
  onClose: () => void
  onBack: () => void
  canGoBack: boolean
  isTopModal?: boolean
  stackIndex?: number
}

export default function ArtboardModal({ id, ownerDid, onClose, onBack, canGoBack, isTopModal, stackIndex }: ArtboardModalProps) {
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
      stackIndex={stackIndex}
    >
      <ArtboardDetailContent id={id} ownerDid={ownerDid} inModal onRegisterRefresh={(fn) => setRefreshFn(() => fn)} />
    </AppModal>
  )
}
