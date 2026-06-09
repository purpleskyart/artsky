import { useEffect } from 'react'
import { useProfileModal } from '../context/ProfileModalContext'
import { setFeedSuspendReason } from '../lib/videoPlaybackManager'

/** Suspends home-feed autoplay videos while content modals (post, profile, collection, search) are open. */
export function VideoFeedSuspendSync() {
  const { isModalOpen } = useProfileModal()

  useEffect(() => {
    setFeedSuspendReason('content-modal', isModalOpen)
    return () => setFeedSuspendReason('content-modal', false)
  }, [isModalOpen])

  return null
}
