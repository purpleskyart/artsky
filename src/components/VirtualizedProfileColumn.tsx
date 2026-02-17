import { useRef, useLayoutEffect, useState, useEffect } from 'react'
import { useVirtualizer, useWindowVirtualizer } from '@tanstack/react-virtual'
import type { TimelineItem } from '../lib/bsky'
import { getPostAllMediaForDisplay, isPostNsfw } from '../lib/bsky'
import PostCard from './PostCard'
import { setInitialPostForUri } from '../lib/postCache'
import styles from '../pages/ProfilePage.module.css'

const ESTIMATE_COL_WIDTH = 280
const CARD_CHROME = 100
const OVERSCAN = 15
const CARD_GAP = 6

function estimateItemHeight(item: TimelineItem): number {
  const allMedia = getPostAllMediaForDisplay(item.post)
  if (allMedia.length === 0) return CARD_CHROME + 80
  if (allMedia.length > 1) {
    const totalInverseAspect = allMedia.reduce((s, m) => s + 1 / (m.aspectRatio || 1), 0)
    const combinedAspect = 1 / totalInverseAspect
    return CARD_CHROME + Math.ceil(ESTIMATE_COL_WIDTH / combinedAspect)
  }
  const media = allMedia[0]
  if (media.aspectRatio != null && media.aspectRatio > 0) {
    return CARD_CHROME + Math.ceil(ESTIMATE_COL_WIDTH / media.aspectRatio)
  }
  return CARD_CHROME + 220
}

type ColumnItem = { item: TimelineItem; originalIndex: number }

export interface VirtualizedProfileColumnProps {
  column: ColumnItem[]
  colIndex: number
  scrollMargin: number
  scrollRef: React.RefObject<HTMLDivElement | null> | null
  loadMoreSentinelRef?: (el: HTMLDivElement | null) => void
  hasCursor?: boolean
  keyboardFocusIndex: number
  keyboardAddOpen: boolean
  actionsMenuOpenForIndex: number | null
  nsfwPreference: 'nsfw' | 'sfw' | 'blurred'
  unblurredUris: Set<string>
  setUnblurred: (uri: string, revealed: boolean) => void
  likeOverrides: Record<string, string | null>
  setLikeOverrides: React.Dispatch<React.SetStateAction<Record<string, string | null>>>
  openPostModal: (uri: string, openReply?: boolean) => void
  cardRef: (index: number) => (el: HTMLDivElement | null) => void
  onActionsMenuOpenChange: (index: number, open: boolean) => void
  onMouseEnter: (index: number) => void
  onAddClose: () => void
  constrainMediaHeight?: boolean
  isSelected: (index: number) => boolean
}

function VirtualizedProfileColumnWindow(props: Omit<VirtualizedProfileColumnProps, 'scrollRef'>) {
  const {
    column,
    scrollMargin,
    loadMoreSentinelRef,
    hasCursor,
    keyboardAddOpen,
    actionsMenuOpenForIndex,
    nsfwPreference,
    unblurredUris,
    setUnblurred,
    likeOverrides,
    setLikeOverrides,
    openPostModal,
    cardRef,
    onActionsMenuOpenChange,
    onMouseEnter,
    onAddClose,
    constrainMediaHeight = false,
    isSelected,
  } = props

  const virtualizer = useWindowVirtualizer({
    count: column.length,
    estimateSize: (i) => estimateItemHeight(column[i].item),
    overscan: OVERSCAN,
    scrollMargin,
    gap: CARD_GAP,
    // Increase measurement cache to reduce re-measurements
    lanes: 1,
  })

  const virtualItems = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()
  const scrollMarginVal = virtualizer.options.scrollMargin

  if (column.length === 0) {
    return (
      <div className={styles.gridColumn}>
        {hasCursor && loadMoreSentinelRef && (
          <div ref={loadMoreSentinelRef} className={styles.loadMoreSentinel} aria-hidden />
        )}
      </div>
    )
  }

  return (
    <div className={styles.gridColumn}>
      <div style={{ height: `${totalSize}px`, width: '100%', position: 'relative' }}>
        {virtualItems.map((virtualItem) => {
          const { item, originalIndex } = column[virtualItem.index]
          return (
            <div
              key={`${item.post.uri}-${originalIndex}`}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              className={styles.gridItem}
              data-post-uri={item.post.uri}
              data-selected={isSelected(originalIndex) || undefined}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start - scrollMarginVal}px)`,
              }}
              onMouseEnter={() => onMouseEnter(originalIndex)}
            >
              <PostCard
                item={item}
                isSelected={isSelected(originalIndex)}
                cardRef={cardRef(originalIndex)}
                openAddDropdown={isSelected(originalIndex) && keyboardAddOpen}
                onAddClose={onAddClose}
                onPostClick={(uri, opts) => {
                  if (opts?.initialItem) setInitialPostForUri(uri, opts.initialItem)
                  openPostModal(uri, opts?.openReply)
                }}
                constrainMediaHeight={constrainMediaHeight}
                nsfwBlurred={
                  nsfwPreference === 'blurred' &&
                  isPostNsfw(item.post) &&
                  !unblurredUris.has(item.post.uri)
                }
                onNsfwUnblur={() => setUnblurred(item.post.uri, true)}
                likedUriOverride={likeOverrides[item.post.uri]}
                onLikedChange={(uri, likeRecordUri) =>
                  setLikeOverrides((prev) => ({ ...prev, [uri]: likeRecordUri ?? null }))
                }
                onActionsMenuOpenChange={(open) => onActionsMenuOpenChange(originalIndex, open)}
                cardIndex={originalIndex}
                actionsMenuOpenForIndex={actionsMenuOpenForIndex}
              />
            </div>
          )
        })}
      </div>
      {hasCursor && loadMoreSentinelRef && (
        <div ref={loadMoreSentinelRef} className={styles.loadMoreSentinel} aria-hidden />
      )}
    </div>
  )
}

function VirtualizedProfileColumnElement(
  props: Omit<VirtualizedProfileColumnProps, 'scrollRef'> & {
    scrollRef: React.RefObject<HTMLDivElement | null>
  }
) {
  const {
    column,
    scrollRef,
    loadMoreSentinelRef,
    hasCursor,
    keyboardAddOpen,
    actionsMenuOpenForIndex,
    nsfwPreference,
    unblurredUris,
    setUnblurred,
    likeOverrides,
    setLikeOverrides,
    openPostModal,
    cardRef,
    onActionsMenuOpenChange,
    onMouseEnter,
    onAddClose,
    constrainMediaHeight = false,
    isSelected,
  } = props

  const gridRef = useRef<HTMLDivElement | null>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  
  // Track scroll position to maintain stability during virtualization updates
  const scrollPositionRef = useRef<number>(0)
  const isRestoringScrollRef = useRef<boolean>(false)

  useLayoutEffect(() => {
    const scrollEl = scrollRef.current
    const gridEl = gridRef.current
    if (!scrollEl || !gridEl) return
    const update = () => {
      const s = scrollRef.current
      const g = gridRef.current
      if (!s || !g) return
      const scrollRect = s.getBoundingClientRect()
      const gridRect = g.getBoundingClientRect()
      setScrollMargin(gridRect.top - scrollRect.top + s.scrollTop)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(gridEl)
    return () => ro.disconnect()
  }, [scrollRef, column.length])

  // Save scroll position before updates
  useEffect(() => {
    const scrollEl = scrollRef.current
    if (!scrollEl) return
    
    const saveScrollPosition = () => {
      scrollPositionRef.current = scrollEl.scrollTop
    }
    
    scrollEl.addEventListener('scroll', saveScrollPosition, { passive: true })
    return () => scrollEl.removeEventListener('scroll', saveScrollPosition)
  }, [scrollRef])

  const virtualizer = useVirtualizer({
    count: column.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => estimateItemHeight(column[i].item),
    overscan: OVERSCAN,
    scrollMargin,
    gap: CARD_GAP,
    // Custom scroll function to maintain position stability
    scrollToFn: (offset, canSmooth) => {
      const scrollEl = scrollRef.current
      if (!scrollEl) return
      
      // Only restore scroll if we're not in the middle of a user scroll
      if (isRestoringScrollRef.current) {
        return
      }
      
      // Allow programmatic scrolls (e.g., keyboard navigation)
      if (canSmooth) {
        scrollEl.scrollTo({ top: offset, behavior: 'smooth' })
      } else {
        scrollEl.scrollTop = offset
      }
    },
  })

  // Restore scroll position after virtualization updates that might cause jumps
  useEffect(() => {
    const scrollEl = scrollRef.current
    if (!scrollEl) return
    
    const savedPosition = scrollPositionRef.current
    const currentPosition = scrollEl.scrollTop
    
    // If scroll position changed unexpectedly (more than 5px), restore it
    if (Math.abs(currentPosition - savedPosition) > 5) {
      isRestoringScrollRef.current = true
      scrollEl.scrollTop = savedPosition
      
      // Reset flag after a short delay
      requestAnimationFrame(() => {
        isRestoringScrollRef.current = false
      })
    }
  }, [column.length, virtualizer.getTotalSize(), scrollRef])

  const virtualItems = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  if (column.length === 0) {
    return (
      <div ref={gridRef} className={styles.gridColumn}>
        {hasCursor && loadMoreSentinelRef && (
          <div ref={loadMoreSentinelRef} className={styles.loadMoreSentinel} aria-hidden />
        )}
      </div>
    )
  }

  return (
    <div ref={gridRef} className={styles.gridColumn}>
      <div style={{ height: `${totalSize}px`, width: '100%', position: 'relative' }}>
        {virtualItems.map((virtualItem) => {
          const { item, originalIndex } = column[virtualItem.index]
          return (
            <div
              key={`${item.post.uri}-${originalIndex}`}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              className={styles.gridItem}
              data-post-uri={item.post.uri}
              data-selected={isSelected(originalIndex) || undefined}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start - scrollMargin}px)`,
              }}
              onMouseEnter={() => onMouseEnter(originalIndex)}
            >
              <PostCard
                item={item}
                isSelected={isSelected(originalIndex)}
                cardRef={cardRef(originalIndex)}
                openAddDropdown={isSelected(originalIndex) && keyboardAddOpen}
                onAddClose={onAddClose}
                onPostClick={(uri, opts) => {
                  if (opts?.initialItem) setInitialPostForUri(uri, opts.initialItem)
                  openPostModal(uri, opts?.openReply)
                }}
                constrainMediaHeight={constrainMediaHeight}
                nsfwBlurred={
                  nsfwPreference === 'blurred' &&
                  isPostNsfw(item.post) &&
                  !unblurredUris.has(item.post.uri)
                }
                onNsfwUnblur={() => setUnblurred(item.post.uri, true)}
                likedUriOverride={likeOverrides[item.post.uri]}
                onLikedChange={(uri, likeRecordUri) =>
                  setLikeOverrides((prev) => ({ ...prev, [uri]: likeRecordUri ?? null }))
                }
                onActionsMenuOpenChange={(open) => onActionsMenuOpenChange(originalIndex, open)}
                cardIndex={originalIndex}
                actionsMenuOpenForIndex={actionsMenuOpenForIndex}
              />
            </div>
          )
        })}
      </div>
      {hasCursor && loadMoreSentinelRef && (
        <div ref={loadMoreSentinelRef} className={styles.loadMoreSentinel} aria-hidden />
      )}
    </div>
  )
}

export default function VirtualizedProfileColumn(props: VirtualizedProfileColumnProps) {
  const { scrollRef } = props
  if (scrollRef) {
    return <VirtualizedProfileColumnElement {...props} scrollRef={scrollRef} />
  }
  return <VirtualizedProfileColumnWindow {...props} />
}
