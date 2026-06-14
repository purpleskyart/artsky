import { useRef, useState, memo, useCallback, useEffect } from 'react'
import PostCard from './PostCard'
import type { TimelineItem } from '../lib/bsky'
import type { PostCardDisplayContext } from '../hooks/usePostCardDisplayContext'
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
  displayContext?: PostCardDisplayContext
}

/**
 * Wrapper around PostCard for the feed grid.
 *
 * Cards far off-screen are replaced with a fixed-height placeholder (see
 * cardVirtualization root margins), freeing images, video/HLS, and observers.
 * Top margin is tighter than bottom so scrolled-past cards virtualize sooner.
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

    const ro = new ResizeObserver(() => {
      if (showingContentRef.current && el.offsetHeight > 0) {
        measuredHeightRef.current = Math.max(measuredHeightRef.current, el.offsetHeight)
      }
    })
    ro.observe(el)

    const unobserveVirt = observeVirtualization(el, (isNear) => {
      if (!isNear && showingContentRef.current && el) {
        measuredHeightRef.current = Math.max(measuredHeightRef.current, el.offsetHeight)
      }
      setIsNearViewport(isNear)
    })

    return () => {
      ro.disconnect()
      unobserveVirt()
    }
  }, [])

  const showPlaceholder = !isNearViewport && measuredHeightRef.current > 0
  showingContentRef.current = !showPlaceholder

  // Reserve the last measured height when re-mounting real content (e.g. scrolling
  // back up). This keeps the card from collapsing while its media reloads, which
  // would otherwise shift everything below and make upward scrolling jump.
  const reservedHeight = measuredHeightRef.current > 0 ? measuredHeightRef.current : undefined

  return (
    <div
      ref={setWrapRef}
      className={styles.optimizeWrap}
      style={!showPlaceholder && reservedHeight ? { minHeight: reservedHeight } : undefined}
    >
      {showPlaceholder ? (
        <div style={{ height: measuredHeightRef.current }} aria-hidden />
      ) : (
        <PostCard {...props} cardRef={() => {}} onAspectRatio={undefined} />
      )}
    </div>
  )
}

export default memo(OptimizedPostCard)
