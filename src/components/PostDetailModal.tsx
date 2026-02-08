import { PostDetailContent } from '../pages/PostDetailPage'
import AppModal from './AppModal'

interface PostDetailModalProps {
  uri: string
  openReply?: boolean
  onClose: () => void
  onBack: () => void
  canGoBack: boolean
}

export default function PostDetailModal({ uri, openReply, onClose, onBack, canGoBack }: PostDetailModalProps) {
  return (
    <AppModal ariaLabel="Post" onClose={onClose} onBack={onBack} canGoBack={canGoBack} transparentTopBar>
      <PostDetailContent
        uri={uri}
        initialOpenReply={openReply}
        onClose={onClose}
      />
    </AppModal>
  )
}
