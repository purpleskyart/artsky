import { useCallback, useState } from 'react'
import AppModal from './AppModal'
import { ForumContent } from '../pages/ForumPage'

interface ForumModalProps {
  onClose: () => void
  onBack: () => void
  canGoBack: boolean
  isTopModal?: boolean
  stackIndex?: number
}

export default function ForumModal({ onClose, onBack, canGoBack, isTopModal, stackIndex }: ForumModalProps) {
  const [refreshFn, setRefreshFn] = useState<(() => void | Promise<void>) | null>(null)
  const onRegisterRefresh = useCallback((fn: () => void | Promise<void>) => {
    setRefreshFn(() => fn)
  }, [])
  return (
    <AppModal
      ariaLabel="Forums"
      onClose={onClose}
      onBack={onBack}
      canGoBack={canGoBack}
      onPullToRefresh={refreshFn ? () => refreshFn() : undefined}
      scrollKey="forums"
      isTopModal={isTopModal}
      stackIndex={stackIndex}
    >
      <ForumContent inModal onRegisterRefresh={onRegisterRefresh} />
    </AppModal>
  )
}
