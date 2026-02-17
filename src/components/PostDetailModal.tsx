import { useState, useEffect, useCallback } from 'react'
import { useProfileModal } from '../context/ProfileModalContext'
import { PostDetailContent } from '../pages/PostDetailPage'
import AppModal from './AppModal'

interface PostDetailModalProps {
  uri: string
  openReply?: boolean
  focusUri?: string
  onClose: () => void
  onBack: () => void
  canGoBack: boolean
}

export default function PostDetailModal({ uri, openReply, focusUri, onClose, onBack, canGoBack }: PostDetailModalProps) {
  const { openProfileModal } = useProfileModal()
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
      transparentTopBar
      onSwipeLeft={authorHandle ? handleSwipeLeft : undefined}
      onPullToRefresh={refreshFn ? () => refreshFn() : undefined}
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
