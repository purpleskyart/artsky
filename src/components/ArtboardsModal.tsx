import { useState } from 'react'
import AppModal from './AppModal'
import CollectionsModalTopBar from './CollectionsModalTopBar'
import { ArtboardsContent } from '../pages/ArtboardsPage'
import styles from './PostDetailModal.module.css'

interface ArtboardsModalProps {
  onClose: () => void
  onBack: () => void
  canGoBack: boolean
  isTopModal?: boolean
}

export default function ArtboardsModal({ onClose, onBack, canGoBack, isTopModal }: ArtboardsModalProps) {
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
    >
      <div className={styles.modalBetaAlert} role="status">BETA</div>
      <CollectionsModalTopBar />
      <ArtboardsContent inModal onRegisterRefresh={(fn) => setRefreshFn(() => fn)} />
    </AppModal>
  )
}
