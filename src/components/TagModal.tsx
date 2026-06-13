import { TagContent } from '../pages/TagPage'
import AppModal from './AppModal'
import { useModalPullRefresh } from '../hooks/useModalPullRefresh'

interface TagModalProps {
  tag: string
  onClose: () => void
  onBack: () => void
  canGoBack: boolean
  onDesktopBackdrop?: () => void
  isTopModal?: boolean
  stackIndex?: number
}

export default function TagModal({ tag, onClose, onBack, canGoBack, onDesktopBackdrop, isTopModal, stackIndex }: TagModalProps) {
  const { handleRegisterRefresh, onPullToRefresh } = useModalPullRefresh()

  return (
    <AppModal
      ariaLabel={`#${tag}`}
      onClose={onClose}
      onBack={onBack}
      canGoBack={canGoBack}
      onDesktopBackdrop={onDesktopBackdrop}
      onPullToRefresh={onPullToRefresh}
      scrollKey={tag}
      isTopModal={isTopModal}
      stackIndex={stackIndex}
    >
      <TagContent tag={tag} inModal isTopModal={isTopModal ?? true} onRegisterRefresh={handleRegisterRefresh} />
    </AppModal>
  )
}
