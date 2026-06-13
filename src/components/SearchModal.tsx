import { useEffect } from 'react'
import AppModal from './AppModal'
import MediaModalTopBar from './MediaModalTopBar'
import { SearchModalGridContent } from './SearchModalGridContent'
import { useModalPullRefresh } from '../hooks/useModalPullRefresh'
import modalStyles from './SearchModal.module.css'

interface SearchModalProps {
  query: string
  onClose: () => void
  onBack: () => void
  canGoBack: boolean
  onDesktopBackdrop?: () => void
  isTopModal?: boolean
  stackIndex?: number
}

/** Same shell as TagModal: AppModal + shared grid content pattern as TagContent. */
export default function SearchModal({
  query,
  onClose,
  onBack,
  canGoBack,
  onDesktopBackdrop,
  isTopModal,
  stackIndex,
}: SearchModalProps) {
  const { handleRegisterRefresh, onPullToRefresh } = useModalPullRefresh()

  useEffect(() => {
    void import('./PostDetailModal')
    // Removed ProfileModal import to avoid circular dependency
  }, [])

  return (
    <AppModal
      ariaLabel={`Search: ${query}`}
      onClose={onClose}
      onBack={onBack}
      canGoBack={canGoBack}
      onDesktopBackdrop={onDesktopBackdrop}
      transparentTopBar
      onPullToRefresh={onPullToRefresh}
      scrollKey={query}
      isTopModal={isTopModal}
      stackIndex={stackIndex}
    >
      <MediaModalTopBar
        showRightControls={false}
        centerContent={
          <span className={modalStyles.searchQueryCenter} title={query.trim()}>
            {`"${query.trim()}"`}
          </span>
        }
      />
      <SearchModalGridContent
        searchQuery={query}
        inModal
        isTopModal={isTopModal ?? true}
        contentClassName={modalStyles.searchContentBelowModalChrome}
        onRegisterRefresh={handleRegisterRefresh}
      />
    </AppModal>
  )
}
