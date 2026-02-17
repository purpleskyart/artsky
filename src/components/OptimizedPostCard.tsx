import { useRef, memo } from 'react'
import { useOffscreenOptimization } from '../hooks/useOffscreenOptimization'
import PostCard from './PostCard'
import type { TimelineItem } from '../lib/bsky'

interface OptimizedPostCardProps {
  item: TimelineItem
  isSelected: boolean
  focusedMediaIndex?: number
  onMediaRef: (mediaIndex: number, el: HTMLElement | null) => void
  cardRef: (el: HTMLDivElement | null) => void
  openAddDropdown: boolean
  onAddClose: () => void
  onActionsMenuOpenChange: (open: boolean) => void
  cardIndex: number
  actionsMenuOpenForIndex: number | null
  onPostClick: (uri: string, opts?: { openReply?: boolean; initialItem?: unknown }) => void
  fillCell: boolean
  nsfwBlurred: boolean
  onNsfwUnblur: () => void
  likedUriOverride?: string | null
  onLikedChange: (uri: string, likeRecordUri: string | null) => void
  seen: boolean
}

/**
 * Wrapper around PostCard with memoization to prevent unnecessary re-renders.
 * Uses IntersectionObserver to detect when posts are far off-screen
 * for potential future optimizations.
 */
function OptimizedPostCard(props: OptimizedPostCardProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  
  // Use intersection observer to detect if post is visible or near viewport
  // Generous rootMargin (1200px) ensures content is ready before it enters viewport
  useOffscreenOptimization(containerRef, {
    rootMargin: '1200px 0px 1200px 0px',
    threshold: 0,
  })

  // Combine refs - we need both the container ref for intersection observer
  // and the cardRef callback from parent
  const handleRef = (el: HTMLDivElement | null) => {
    (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el
    props.cardRef(el)
  }

  // Always render full content
  // The intersection observer is just for future optimizations
  return (
    <PostCard
      {...props}
      cardRef={handleRef}
      onAspectRatio={undefined}
    />
  )
}

// Memoize to prevent unnecessary re-renders
export default memo(OptimizedPostCard)
