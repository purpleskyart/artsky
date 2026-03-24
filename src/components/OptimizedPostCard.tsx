import { useRef, memo, useCallback } from 'react'
import PostCard from './PostCard'
import type { TimelineItem } from '../lib/bsky'
import styles from './OptimizedPostCard.module.css'

interface OptimizedPostCardProps {
  item: TimelineItem
  isSelected: boolean
  focusedMediaIndex?: number
  onMediaRef: (mediaIndex: number, el: HTMLElement | null) => void
  cardRef: (el: HTMLDivElement | null) => void
  onActionsMenuOpenChange: (open: boolean) => void
  cardIndex: number
  actionsMenuOpenForIndex: number | null
  onPostClick: (uri: string, opts?: { openReply?: boolean; initialItem?: unknown }) => void
  fillCell: boolean
  nsfwBlurred: boolean
  onNsfwUnblur: () => void
  setUnblurred?: (uri: string, revealed: boolean) => void
  isRevealed?: boolean
  likedUriOverride?: string | null
  onLikedChange: (uri: string, likeRecordUri: string | null) => void
  seen: boolean
  constrainMediaHeight?: boolean
}

/**
 * Thin wrapper around PostCard for the feed. (Older versions swapped in a placeholder off-screen;
 * that caused visible layout shift while scrolling when heights didn’t match.)
 */
function OptimizedPostCard(props: OptimizedPostCardProps) {
  const cardRefPropRef = useRef(props.cardRef)
  cardRefPropRef.current = props.cardRef

  const setWrapRef = useCallback((el: HTMLDivElement | null) => {
    cardRefPropRef.current(el)
  }, [])

  return (
    <div ref={setWrapRef} className={styles.optimizeWrap}>
      <PostCard {...props} cardRef={() => {}} onAspectRatio={undefined} />
    </div>
  )
}

export default memo(OptimizedPostCard)
