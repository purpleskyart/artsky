import { memo, useCallback } from 'react'
import { useProfileModal } from '../context/ProfileModalContext'
import { preloadProfileOpen, preloadProfileFeed } from '../lib/modalPreload'

interface ProfileLinkProps {
  handle: string
  className?: string
  title?: string
  'aria-label'?: string
  onClick?: (e: React.MouseEvent) => void
  children: React.ReactNode
}

/** Link that opens profile in the modal lightbox instead of navigating. */
function ProfileLink({ handle, className, title, 'aria-label': ariaLabel, onClick, children }: ProfileLinkProps) {
  const { openProfileModal } = useProfileModal()

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    preloadProfileOpen(handle)
    preloadProfileFeed(handle)
    openProfileModal(handle)
    onClick?.(e)
  }, [openProfileModal, handle, onClick])

  /* PostCard's cardLink schedules openPost on touchEnd; without stopping touch propagation, the post modal opens on top of the profile. */
  const stopTouchBubble = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    e.stopPropagation()
    preloadProfileOpen(handle)
    preloadProfileFeed(handle)
    openProfileModal(handle)
    onClick?.(e as any)
  }, [openProfileModal, handle, onClick])

  return (
    <span
      className={className}
      title={title}
      aria-label={ariaLabel}
      role="button"
      tabIndex={0}
      data-profile-link="true"
      style={{ cursor: 'pointer' }}
      onMouseEnter={() => preloadProfileOpen(handle)}
      onPointerDown={() => {
        preloadProfileOpen(handle)
        preloadProfileFeed(handle)
      }}
      onClick={handleClick}
      onTouchStart={stopTouchBubble}
      onTouchEnd={handleTouchEnd}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleClick(e as any)
        }
      }}
    >
      {children}
    </span>
  )
}

export default memo(ProfileLink)
