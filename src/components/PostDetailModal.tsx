import { useState, useEffect, useCallback } from 'react'
import { PostDetailContent } from '../pages/PostDetailPage'
import AppModal from './AppModal'

interface PostDetailModalProps {
  uri: string
  openReply?: boolean
  focusUri?: string
  onClose: () => void
  onBack: () => void
  canGoBack: boolean
  onDesktopBackdrop?: () => void
  isTopModal?: boolean
  stackIndex?: number
  openProfileModal: (handle: string) => void
}

export default function PostDetailModal({ uri, openReply, focusUri, onClose, onBack, canGoBack, onDesktopBackdrop, isTopModal, stackIndex, openProfileModal }: PostDetailModalProps) {
  const [authorHandle, setAuthorHandle] = useState<string | null>(null)
  const [refreshFn, setRefreshFn] = useState<(() => void | Promise<void>) | null>(null)

  useEffect(() => {
    setAuthorHandle(null)
  }, [uri])

  /* Push profile on top of post (same as clicking author) so swipe-right/back returns to post */
  const handleSwipeLeft = () => {
    if (authorHandle) openProfileModal(authorHandle)
  }

  const handleRegisterRefresh = useCallback((fn: () => void | Promise<void>) => {
    setRefreshFn(() => fn)
  }, [])

  return (
    <AppModal
      ariaLabel="Post"
      onClose={onClose}
      onBack={onBack}
      canGoBack={canGoBack}
      onDesktopBackdrop={onDesktopBackdrop}
      transparentTopBar
      onSwipeLeft={authorHandle ? handleSwipeLeft : undefined}
      onPullToRefresh={refreshFn ? () => refreshFn() : undefined}
      scrollKey={uri}
      postScrollPersistenceHandle={uri}
      isTopModal={isTopModal}
      stackIndex={stackIndex}
    >
      <PostDetailContent
        uri={uri}
        initialOpenReply={openReply}
        initialFocusedCommentUri={focusUri}
        onClose={onClose}
        onAuthorHandle={setAuthorHandle}
        onRegisterRefresh={handleRegisterRefresh}
      />
    </AppModal>
  )
}
