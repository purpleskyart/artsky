import { useRef, memo, useMemo, useState, useCallback } from 'react'
import { useOffscreenOptimization } from '../hooks/useOffscreenOptimization'
import { getPostMediaInfo } from '../lib/bsky'
import PostCard from './PostCard'
import type { TimelineItem } from '../lib/bsky'
import styles from './OptimizedPostCard.module.css'

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
  setUnblurred?: (uri: string, revealed: boolean) => void
  isRevealed?: boolean
  likedUriOverride?: string | null
  onLikedChange: (uri: string, likeRecordUri: string | null) => void
  seen: boolean
  constrainMediaHeight?: boolean
  /** Actual flex column width (px) for media height estimate; avoids placeholder shorter than real card. */
  estimatedColumnWidth?: number
}

const CARD_CHROME = 100
const ESTIMATE_COL_WIDTH = 280

function placeholderMinHeight(item: TimelineItem, columnWidthPx: number): number {
  const w = columnWidthPx > 0 ? columnWidthPx : ESTIMATE_COL_WIDTH
  const media = getPostMediaInfo(item.post)
  if (!media) return CARD_CHROME + 80
  if (media.aspectRatio != null && media.aspectRatio > 0) {
    return CARD_CHROME + w / media.aspectRatio
  }
  return CARD_CHROME + 220
}

const OFFSCREEN_MARGIN = '500px 0px 500px 0px'

function OptimizedPostCard(props: OptimizedPostCardProps) {
  const columnW = props.estimatedColumnWidth ?? ESTIMATE_COL_WIDTH
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null)
  const cardRefPropRef = useRef(props.cardRef)
  cardRefPropRef.current = props.cardRef

  const setRootRef = useCallback((el: HTMLDivElement | null) => {
    setRootEl(el)
    cardRefPropRef.current(el)
  }, [])

  const observerOpts = useMemo(() => ({ rootMargin: OFFSCREEN_MARGIN, threshold: 0 }), [])
  const isVisible = useOffscreenOptimization(rootEl, observerOpts)

  const needsFullCard =
    isVisible || props.isSelected || props.actionsMenuOpenForIndex === props.cardIndex

  return (
    <div ref={setRootRef} className={styles.optimizeWrap}>
      {needsFullCard ? (
        <PostCard {...props} cardRef={() => {}} onAspectRatio={undefined} />
      ) : (
        <div
          className={styles.offscreenPlaceholder}
          style={{ minHeight: placeholderMinHeight(props.item, columnW) }}
          aria-hidden
        />
      )}
    </div>
  )
}

export default memo(OptimizedPostCard)
