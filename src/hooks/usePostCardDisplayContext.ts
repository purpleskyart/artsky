import { useMemo } from 'react'
import { useSession } from '../context/SessionContext'
import { useArtOnly } from '../context/ArtOnlyContext'
import { useMediaOnly, type MediaMode } from '../context/MediaOnlyContext'
import { useProfileModal } from '../context/ProfileModalContext'
import { useFollowOverrides } from '../context/FollowOverridesContext'

export type PostCardDisplayContext = {
  artOnly: boolean
  minimalist: boolean
  mediaMode: MediaMode
  inModalStack: boolean
  sessionDid: string | null
  openQuotesModal: (postUri: string) => void
  openPostModal: (uri: string, openReply?: boolean, focusUri?: string, authorHandle?: string) => void
  openProfileModal: (handle: string) => void
  getFollowOverride: (did: string) => string | null | undefined
  setFollowOverride: (did: string, followRecordUri: string | null) => void
}

/** Read feed/grid display settings once per page — pass into PostCard to avoid per-card context subscriptions. */
export function usePostCardDisplayContext(inModalStack?: boolean): PostCardDisplayContext {
  const { session } = useSession()
  const { artOnly, minimalist } = useArtOnly()
  const { mediaMode } = useMediaOnly()
  const { openQuotesModal, openPostModal, openProfileModal, isModalOpen } = useProfileModal()
  const { getFollowOverride, setFollowOverride } = useFollowOverrides()

  return useMemo(
    () => ({
      artOnly,
      minimalist,
      mediaMode,
      inModalStack: inModalStack ?? isModalOpen,
      sessionDid: session?.did ?? null,
      openQuotesModal,
      openPostModal,
      openProfileModal,
      getFollowOverride,
      setFollowOverride,
    }),
    [
      artOnly,
      minimalist,
      mediaMode,
      inModalStack,
      isModalOpen,
      session?.did,
      openQuotesModal,
      openPostModal,
      openProfileModal,
      getFollowOverride,
      setFollowOverride,
    ],
  )
}
