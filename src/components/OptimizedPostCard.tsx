import { useRef, useState, memo, useCallback, useEffect } from 'react'
import PostCard from './PostCard'
import type { TimelineItem } from '../lib/bsky'
import { observeVirtualization } from '../lib/cardVirtualization'
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
  openCollectionMenuSignal?: number
}

/**
 * Wrapper around PostCard for the feed grid.
 *
 * Cards that scroll far enough off-screen (>2 000 px from viewport) are
 * replaced with a fixed-height placeholder, freeing all images, video/HLS
 * instances, and per-card IntersectionObservers from memory. When the user
 * scrolls back, the full PostCard is re-mounted well before it becomes
 * visible — the 2 000 px buffer gives React + image-preload plenty of time.
 */
function OptimizedPostCard(props: OptimizedPostCardProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const cardRefPropRef = useRef(props.cardRef)
  cardRefPropRef.current = props.cardRef

  const measuredHeightRef = useRef(0)
  const showingContentRef = useRef(true)
  const [isNearViewport, setIsNearViewport] = useState(true)

  const setWrapRef = useCallback((el: HTMLDivElement | null) => {
    wrapRef.current = el
    cardRefPropRef.current(el)
  }, [])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    return observeVirtualization(el, (isNear) => {
      if (!isNear && showingContentRef.current && el) {
        measuredHeightRef.current = el.offsetHeight
      }
      setIsNearViewport(isNear)
    })
  }, [])

  const showPlaceholder = !isNearViewport && measuredHeightRef.current > 0
  showingContentRef.current = !showPlaceholder

  return (
    <div ref={setWrapRef} className={styles.optimizeWrap}>
      {showPlaceholder ? (
        <div style={{ height: measuredHeightRef.current }} aria-hidden />
      ) : (
        <PostCard {...props} cardRef={() => {}} onAspectRatio={undefined} />
      )}
    </div>
  )
}

export default memo(OptimizedPostCard)
