import { memo, useCallback } from 'react'
import { Link } from 'react-router-dom'
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

  /* PostCard’s cardLink schedules openPost on touchEnd; without stopping touch propagation, the post modal opens on top of the profile. */
  const stopTouchBubble = useCallback((e: React.TouchEvent) => {
    e.stopPropagation()
  }, [])

  return (
    <Link
      to={`/profile/${encodeURIComponent(handle)}`}
      className={className}
      title={title}
      aria-label={ariaLabel}
      onMouseEnter={() => preloadProfileOpen(handle)}
      onPointerDown={() => {
        preloadProfileOpen(handle)
        preloadProfileFeed(handle)
      }}
      onClick={handleClick}
      onTouchStart={stopTouchBubble}
      onTouchEnd={stopTouchBubble}
    >
      {children}
    </Link>
  )
}

export default memo(ProfileLink)
