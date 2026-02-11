import { useState } from 'react'
import AppModal from './AppModal'
import { ForumPostContent } from '../pages/ForumPostDetailPage'

interface ForumPostModalProps {
  documentUri: string
  onClose: () => void
  onBack: () => void
  canGoBack: boolean
}

export default function ForumPostModal({ documentUri, onClose, onBack, canGoBack }: ForumPostModalProps) {
  const [refreshFn, setRefreshFn] = useState<(() => void | Promise<void>) | null>(null)
  return (
    <AppModal
      ariaLabel="Forum post"
      onClose={onClose}
      onBack={onBack}
      canGoBack={canGoBack}
      focusCloseOnOpen
      onPullToRefresh={refreshFn ? () => refreshFn() : undefined}
    >
      <ForumPostContent documentUri={documentUri} onClose={onClose} onRegisterRefresh={(fn) => setRefreshFn(() => fn)} />
    </AppModal>
  )
}
