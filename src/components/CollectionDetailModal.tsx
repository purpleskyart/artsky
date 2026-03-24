import AppModal from './AppModal'
import { CollectionDetailContent } from '../pages/CollectionPage'

interface Props {
  uri: string
  onClose: () => void
  onBack: () => void
  canGoBack: boolean
  isTopModal?: boolean
  stackIndex?: number
}

export default function CollectionDetailModal({ uri, onClose, onBack, canGoBack, isTopModal, stackIndex }: Props) {
  return (
    <AppModal
      ariaLabel="Collection"
      onClose={onClose}
      onBack={onBack}
      canGoBack={canGoBack}
      transparentTopBar
      feedBackground
      scrollKey={uri}
      isTopModal={isTopModal}
      stackIndex={stackIndex}
    >
      <CollectionDetailContent uri={uri} />
    </AppModal>
  )
}
