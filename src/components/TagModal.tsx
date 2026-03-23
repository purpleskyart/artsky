import { useState } from 'react'
import { TagContent } from '../pages/TagPage'
import AppModal from './AppModal'

interface TagModalProps {
  tag: string
  onClose: () => void
  onBack: () => void
  canGoBack: boolean
  isTopModal?: boolean
  stackIndex?: number
}

export default function TagModal({ tag, onClose, onBack, canGoBack, isTopModal, stackIndex }: TagModalProps) {
  const [refreshFn, setRefreshFn] = useState<(() => void | Promise<void>) | null>(null)

  return (
    <AppModal
      ariaLabel={`#${tag}`}
      onClose={onClose}
      onBack={onBack}
      canGoBack={canGoBack}
      onPullToRefresh={refreshFn ? () => refreshFn() : undefined}
      scrollKey={tag}
      isTopModal={isTopModal}
      stackIndex={stackIndex}
    >
      <TagContent tag={tag} inModal onRegisterRefresh={(fn) => setRefreshFn(() => fn)} />
    </AppModal>
  )
}
