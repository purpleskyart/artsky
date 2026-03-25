import { useCallback, useRef, useState } from 'react'
import { TagContent } from '../pages/TagPage'
import AppModal from './AppModal'

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
  const refreshRef = useRef<(() => void | Promise<void>) | null>(null)
  const [pullReady, setPullReady] = useState(false)
  const handleRegisterRefresh = useCallback((fn: () => void | Promise<void>) => {
    refreshRef.current = fn
    setPullReady(true)
  }, [])

  return (
    <AppModal
      ariaLabel={`#${tag}`}
      onClose={onClose}
      onBack={onBack}
      canGoBack={canGoBack}
      onDesktopBackdrop={onDesktopBackdrop}
      onPullToRefresh={pullReady ? () => refreshRef.current?.() : undefined}
      scrollKey={tag}
      isTopModal={isTopModal}
      stackIndex={stackIndex}
    >
      <TagContent tag={tag} inModal onRegisterRefresh={handleRegisterRefresh} />
    </AppModal>
  )
}
