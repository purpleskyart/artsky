import { memo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useProfileModal } from '../context/ProfileModalContext'

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
    openProfileModal(handle)
    onClick?.(e)
  }, [openProfileModal, handle, onClick])
  
  return (
    <Link
      to={`/profile/${encodeURIComponent(handle)}`}
      className={className}
      title={title}
      aria-label={ariaLabel}
      onClick={handleClick}
    >
      {children}
    </Link>
  )
}

export default memo(ProfileLink)
