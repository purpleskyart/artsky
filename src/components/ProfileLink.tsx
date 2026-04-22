import { memo, useCallback, useRef } from 'react'
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
    // Allow middle-click (button 1) or ctrl/cmd+click to open in new tab
    if (e.button === 1 || e.ctrlKey || e.metaKey) {
      return
    }
    e.preventDefault()
    e.stopPropagation()
    e.nativeEvent.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
    preloadProfileOpen(handle)
    preloadProfileFeed(handle)
    openProfileModal(handle)
    onClick?.(e)
  }, [openProfileModal, handle, onClick])

  /* Track touch start position to distinguish tap from scroll on mobile. */
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  /* PostCard's cardLink schedules openPost on touchEnd; without stopping touch propagation, the post modal opens on top of the profile. */
  const stopTouchBubble = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]
    if (touch) touchStartRef.current = { x: touch.clientX, y: touch.clientY }
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    e.stopPropagation()
    /* If the finger moved more than 10px, the user was scrolling — don't open the modal. */
    const start = touchStartRef.current
    const touch = e.changedTouches[0]
    if (start && touch) {
      const dx = Math.abs(touch.clientX - start.x)
      const dy = Math.abs(touch.clientY - start.y)
      if (dx > 10 || dy > 10) return
    }
    preloadProfileOpen(handle)
    preloadProfileFeed(handle)
    openProfileModal(handle)
    onClick?.(e as any)
  }, [openProfileModal, handle, onClick])

  return (
    <a
      href={`/profile/${handle}`}
      className={className}
      title={title}
      aria-label={ariaLabel}
      target="_blank"
      rel="noopener noreferrer"
      data-profile-link="true"
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
    </a>
  )
}

export default memo(ProfileLink)
