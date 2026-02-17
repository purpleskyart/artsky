import { useRef } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import type { FeedDisplayEntry } from '../pages/FeedPage'
import { getPostAllMediaForDisplay, isPostNsfw } from '../lib/bsky'
import VirtualizedPostCard from './VirtualizedPostCard'
import RepostCarouselCard from './RepostCarouselCard'
import { setInitialPostForUri } from '../lib/postCache'
import styles from '../pages/FeedPage.module.css'

const ESTIMATE_COL_WIDTH = 280
const CARD_CHROME = 100
const REPOST_CAROUSEL_ESTIMATE_HEIGHT = 200
const OVERSCAN = 15 // Keep more items rendered above/below viewport for smooth scrolling
/** Vertical gap between cards (matches gridColumn gap: 0.35rem ≈ 6px) */
const CARD_GAP = 6

function estimateEntryHeight(entry: FeedDisplayEntry): number {
  if (entry.type === 'carousel') return REPOST_CAROUSEL_ESTIMATE_HEIGHT
  const allMedia = getPostAllMediaForDisplay(entry.item.post)
  
  // Text-only posts: estimate based on text length
  if (allMedia.length === 0) {
    const text = (entry.item.post.record as { text?: string })?.text || ''
    const textLines = Math.ceil(text.length / 50) // ~50 chars per line
    const textHeight = Math.min(textLines * 20, 200) // Cap at ~10 lines
    return CARD_CHROME + textHeight
  }
  
  // Multi-image posts stack vertically: combined aspect = 1 / sum(1/ar)
  if (allMedia.length > 1) {
    const totalInverseAspect = allMedia.reduce((s, m) => s + 1 / (m.aspectRatio || 1), 0)
    const combinedAspect = 1 / totalInverseAspect
    const mediaHeight = Math.ceil(ESTIMATE_COL_WIDTH / combinedAspect)
    // Add extra height for multi-image layout spacing
    return CARD_CHROME + mediaHeight + (allMedia.length - 1) * 4
  }
  
  // Single image: use aspect ratio if available
  const media = allMedia[0]
  if (media.aspectRatio != null && media.aspectRatio > 0) {
    const mediaHeight = Math.ceil(ESTIMATE_COL_WIDTH / media.aspectRatio)
    // Clamp to reasonable bounds
    return CARD_CHROME + Math.min(Math.max(mediaHeight, 150), 600)
  }
  
  // Fallback for unknown aspect ratio
  return CARD_CHROME + 220
}

type ColumnItem = { entry: FeedDisplayEntry; originalIndex: number }

export interface VirtualizedFeedColumnProps {
  column: ColumnItem[]
  colIndex: number
  scrollMargin: number
  /** Callback ref for load-more sentinel (when cursor exists) */
  loadMoreSentinelRef?: (el: HTMLDivElement | null) => void
  hasCursor?: boolean
  /** Props passed through to PostCard/RepostCarouselCard */
  keyboardFocusIndex: number
  focusTargets: { cardIndex: number; mediaIndex: number }[]
  firstFocusIndexForCard: number[]
  focusSetByMouse: boolean
  keyboardAddOpen: boolean
  actionsMenuOpenForIndex: number | null
  nsfwPreference: 'nsfw' | 'sfw' | 'blurred'
  unblurredUris: Set<string>
  setUnblurred: (uri: string, revealed: boolean) => void
  likeOverrides: Record<string, string | null | undefined>
  setLikeOverrides: (postUri: string, likeUri: string | null) => void
  seenUris: Set<string>
  openPostModal: (uri: string, openReply?: boolean, focusUri?: string) => void
  cardRef: (index: number) => (el: HTMLDivElement | null) => void
  onMediaRef: (index: number, mediaIndex: number, el: HTMLElement | null) => void
  onActionsMenuOpenChange: (index: number, open: boolean) => void
  onMouseEnter: (index: number) => void
  onAddClose: () => void
}

export default function VirtualizedFeedColumn({
  column,
  scrollMargin,
  loadMoreSentinelRef,
  hasCursor,
  keyboardFocusIndex,
  focusTargets,
  focusSetByMouse,
  keyboardAddOpen,
  actionsMenuOpenForIndex,
  nsfwPreference,
  unblurredUris,
  setUnblurred,
  likeOverrides,
  setLikeOverrides,
  seenUris,
  openPostModal,
  cardRef,
  onMediaRef,
  onActionsMenuOpenChange,
  onMouseEnter,
  onAddClose,
}: VirtualizedFeedColumnProps) {
  const virtualizer = useWindowVirtualizer({
    count: column.length,
    estimateSize: (i) => estimateEntryHeight(column[i].entry),
    overscan: OVERSCAN,
    scrollMargin,
    gap: CARD_GAP,
    lanes: 1,
    // Disable scroll restoration - let browser handle scroll naturally
    scrollToFn: () => {
      // No-op: prevent virtualizer from adjusting scroll position
    },
  })

  const virtualItems = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()
  
  // Track the last measured item to prevent remeasuring items far below viewport
  const lastMeasuredIndexRef = useRef(-1)
  const measureThrottleRef = useRef<Set<number>>(new Set())
  const prevColumnLengthRef = useRef(column.length)
  const newlyAddedIndices = useRef<number[]>([])
  
  // Clear measure throttle when column length changes (new items added)
  // Measure newly added items immediately to prevent scroll jumps from inaccurate estimates
  if (prevColumnLengthRef.current !== column.length) {
    const newThrottle = new Set<number>()
    for (let i = 0; i < Math.min(prevColumnLengthRef.current, column.length); i++) {
      if (measureThrottleRef.current.has(i)) {
        newThrottle.add(i)
      }
    }
    measureThrottleRef.current = newThrottle
    
    // Track newly added items at the end of the column to measure them immediately
    newlyAddedIndices.current = Array.from(
      { length: column.length - prevColumnLengthRef.current },
      (_, i) => prevColumnLengthRef.current + i
    )
    
    prevColumnLengthRef.current = column.length
  }

  if (column.length === 0) {
    return (
      <div className={styles.gridColumn}>
        {hasCursor && loadMoreSentinelRef != null && (
          <div ref={loadMoreSentinelRef} className={styles.loadMoreSentinel} aria-hidden />
        )}
      </div>
    )
  }

  return (
    <div className={styles.gridColumn}>
      <div
        style={{
          height: `${totalSize}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualItem) => {
          const { entry, originalIndex } = column[virtualItem.index]
          const key = entry.type === 'post' ? `${entry.item.post.uri}-${originalIndex}` : `carousel-${entry.items[0].post.uri}-${originalIndex}`
          return (
            <div
              key={key}
              data-index={virtualItem.index}
              ref={(el) => {
                if (!el) return
                
                const rect = el.getBoundingClientRect()
                const viewportHeight = window.innerHeight
                const isNewlyAdded = newlyAddedIndices.current.includes(virtualItem.index)
                
                // Always measure newly added items immediately to prevent scroll jumps
                // For existing items, only measure if in or near viewport
                const shouldMeasure = isNewlyAdded ||
                  rect.top < viewportHeight + 2000 || 
                  !measureThrottleRef.current.has(virtualItem.index) ||
                  rect.bottom < 0
                
                if (shouldMeasure) {
                  virtualizer.measureElement(el)
                  measureThrottleRef.current.add(virtualItem.index)
                  lastMeasuredIndexRef.current = Math.max(lastMeasuredIndexRef.current, virtualItem.index)
                  
                  // Remove from newly added list once measured
                  if (isNewlyAdded) {
                    newlyAddedIndices.current = newlyAddedIndices.current.filter(i => i !== virtualItem.index)
                  }
                }
                
                // Also set this as the cardRef so IntersectionObserver can track it
                cardRef(originalIndex)(el)
              }}
              className={styles.gridItem}
              data-selected={focusTargets[keyboardFocusIndex]?.cardIndex === originalIndex || undefined}
              data-post-uri={entry.type === 'post' ? entry.item.post.uri : entry.items[0].post.uri}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start - virtualizer.options.scrollMargin}px)`,
              }}
              onMouseEnter={() => onMouseEnter(originalIndex)}
            >
              {entry.type === 'post' ? (
                <VirtualizedPostCard
                  item={entry.item}
                  isSelected={focusTargets[keyboardFocusIndex]?.cardIndex === originalIndex}
                  focusedMediaIndex={
                    focusTargets[keyboardFocusIndex]?.cardIndex === originalIndex &&
                    !(focusSetByMouse && getPostAllMediaForDisplay(entry.item.post).length > 1)
                      ? focusTargets[keyboardFocusIndex]?.mediaIndex
                      : undefined
                  }
                  onMediaRef={(mediaIndex, el) => onMediaRef(originalIndex, mediaIndex, el)}
                  cardRef={() => {}} // No-op since we're using the wrapper div ref above
                  openAddDropdown={focusTargets[keyboardFocusIndex]?.cardIndex === originalIndex && keyboardAddOpen}
                  onAddClose={onAddClose}
                  onActionsMenuOpenChange={(open) => onActionsMenuOpenChange(originalIndex, open)}
                  cardIndex={originalIndex}
                  actionsMenuOpenForIndex={actionsMenuOpenForIndex}
                  onPostClick={(uri, opts) => {
                    if (opts?.initialItem) setInitialPostForUri(uri, opts.initialItem)
                    openPostModal(uri, opts?.openReply)
                  }}
                  fillCell={false}
                  nsfwBlurred={
                    nsfwPreference === 'blurred' &&
                    isPostNsfw(entry.item.post) &&
                    !unblurredUris.has(entry.item.post.uri)
                  }
                  onNsfwUnblur={() => setUnblurred(entry.item.post.uri, true)}
                  likedUriOverride={likeOverrides[entry.item.post.uri]}
                  onLikedChange={(uri, likeRecordUri) =>
                    setLikeOverrides(uri, likeRecordUri ?? null)
                  }
                  seen={seenUris.has(entry.item.post.uri)}
                />
              ) : (
                <RepostCarouselCard
                  items={entry.items}
                  onPostClick={(uri, opts) => {
                    if (opts?.initialItem) setInitialPostForUri(uri, opts.initialItem)
                    openPostModal(uri)
                  }}
                  cardRef={() => {}} // No-op since we're using the wrapper div ref above
                  seen={seenUris.has(entry.items[0].post.uri)}
                  data-post-uri={entry.items[0].post.uri}
                />
              )}
            </div>
          )
        })}
      </div>
      {hasCursor && loadMoreSentinelRef != null && (
        <div ref={loadMoreSentinelRef} className={styles.loadMoreSentinel} aria-hidden />
      )}
    </div>
  )
}
