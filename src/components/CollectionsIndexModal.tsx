import AppModal from './AppModal'
import { CollectionsIndexContent } from '../pages/CollectionsIndexPage'

interface Props {
  onClose: () => void
  onBack: () => void
  canGoBack: boolean
  isTopModal?: boolean
  stackIndex?: number
}

export default function CollectionsIndexModal({ onClose, onBack, canGoBack, isTopModal, stackIndex }: Props) {
  return (
    <AppModal
      ariaLabel="Collections"
      onClose={onClose}
      onBack={onBack}
      canGoBack={canGoBack}
      transparentTopBar
      feedBackground
      isTopModal={isTopModal}
      stackIndex={stackIndex}
    >
      <CollectionsIndexContent />
    </AppModal>
  )
}
