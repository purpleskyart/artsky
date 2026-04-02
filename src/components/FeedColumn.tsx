import type { FeedDisplayEntry } from '../pages/FeedPage'
import { stableCardKey } from '../pages/FeedPage'
import { getPostAllMediaForDisplay, isPostNsfw } from '../lib/bsky'
import OptimizedPostCard from './OptimizedPostCard'
import { setInitialPostForUri } from '../lib/postCache'
import styles from '../pages/FeedPage.module.css'
import { memo, useCallback } from 'react'

type ColumnItem = { entry: FeedDisplayEntry; originalIndex: number }

// Memoized card wrapper to prevent re-renders when other cards change
const FeedCard = memo(function FeedCard({
  entry,
  originalIndex,
  isSelected,
  focusedMediaIndex,
  actionsMenuOpenForIndex,
  nsfwPreference,
  unblurredUris,
  likeOverrides,
  seenUris,
  onMediaRef,
  onActionsMenuOpenChange,
  onMouseEnter,
  setUnblurred,
  setLikeOverrides,
  openPostModal,
  cardRef,
  constrainMediaHeight = false,
  openCollectionMenuSignal,
}: {
  entry: FeedDisplayEntry
  originalIndex: number
  isSelected: boolean
  focusedMediaIndex: number | undefined
  actionsMenuOpenForIndex: number | null
  nsfwPreference: 'nsfw' | 'sfw' | 'blurred'
  unblurredUris: Set<string>
  likeOverrides: Record<string, string | null | undefined>
  seenUris: Set<string>
  onMediaRef: (index: number, mediaIndex: number, el: HTMLElement | null) => void
  onActionsMenuOpenChange: (index: number, open: boolean) => void
  onMouseEnter: (index: number) => void
  setUnblurred: (uri: string, revealed: boolean) => void
  setLikeOverrides: (postUri: string, likeUri: string | null) => void
  openPostModal: (uri: string, openReply?: boolean, focusUri?: string, authorHandle?: string) => void
  cardRef: (index: number) => (el: HTMLDivElement | null) => void
  constrainMediaHeight?: boolean
  openCollectionMenuSignal?: number
}) {
  const key = entry.item.post.uri
  const handleMouseEnter = useCallback(() => onMouseEnter(originalIndex), [onMouseEnter, originalIndex])
  const handleMediaRef = useCallback((mediaIndex: number, el: HTMLElement | null) => {
    onMediaRef(originalIndex, mediaIndex, el)
  }, [onMediaRef, originalIndex])
  const handleActionsMenuOpenChange = useCallback((open: boolean) => {
    onActionsMenuOpenChange(originalIndex, open)
  }, [onActionsMenuOpenChange, originalIndex])
  const handlePostClick = useCallback((uri: string, opts?: { initialItem?: unknown; openReply?: boolean }) => {
    if (opts?.initialItem) setInitialPostForUri(uri, opts.initialItem as never)
    openPostModal(uri, opts?.openReply, undefined, entry.item.post.author?.handle)
  }, [openPostModal, entry])

  return (
    <div
      ref={cardRef(originalIndex)}
      className={styles.gridItem}
      data-selected={isSelected || undefined}
      data-post-uri={key}
      onMouseEnter={handleMouseEnter}
    >
      <OptimizedPostCard
        item={entry.item}
        isSelected={isSelected}
        focusedMediaIndex={focusedMediaIndex}
        onMediaRef={handleMediaRef}
        cardRef={() => {}} // No-op since we're using the wrapper div ref above
        onActionsMenuOpenChange={handleActionsMenuOpenChange}
        cardIndex={originalIndex}
        actionsMenuOpenForIndex={actionsMenuOpenForIndex}
        onPostClick={handlePostClick}
        fillCell={false}
        nsfwBlurred={
          nsfwPreference === 'blurred' &&
          isPostNsfw(entry.item.post) &&
          !unblurredUris.has(entry.item.post.uri)
        }
        onNsfwUnblur={() => setUnblurred(entry.item.post.uri, true)}
        setUnblurred={setUnblurred}
        isRevealed={unblurredUris.has(entry.item.post.uri)}
        likedUriOverride={likeOverrides[entry.item.post.uri]}
        onLikedChange={(uri, likeRecordUri) =>
          setLikeOverrides(uri, likeRecordUri ?? null)
        }
        seen={seenUris.has(entry.item.post.uri)}
        constrainMediaHeight={constrainMediaHeight}
        openCollectionMenuSignal={openCollectionMenuSignal}
      />
    </div>
  )
}, (prevProps, nextProps) => {
  // Custom comparison: only re-render if props that matter for THIS card changed
  const prevUri = prevProps.entry.item.post.uri
  const nextUri = nextProps.entry.item.post.uri
  
  // Different post = must re-render
  if (prevUri !== nextUri) return false
  
  // Check props that affect this specific card
  if (prevProps.isSelected !== nextProps.isSelected) return false
  if (prevProps.focusedMediaIndex !== nextProps.focusedMediaIndex) return false
  if (prevProps.actionsMenuOpenForIndex !== nextProps.actionsMenuOpenForIndex) return false
  if (prevProps.nsfwPreference !== nextProps.nsfwPreference) return false
  
  // Check if this card's like status changed
  if (prevProps.likeOverrides[prevUri] !== nextProps.likeOverrides[nextUri]) return false
  
  // Check if this card's seen status changed
  if (prevProps.seenUris.has(prevUri) !== nextProps.seenUris.has(nextUri)) return false
  
  // Check if this card's blur status changed
  if (prevProps.unblurredUris.has(prevUri) !== nextProps.unblurredUris.has(nextUri)) return false
  
  if ((prevProps.constrainMediaHeight ?? false) !== (nextProps.constrainMediaHeight ?? false)) return false
  if ((prevProps.openCollectionMenuSignal ?? 0) !== (nextProps.openCollectionMenuSignal ?? 0)) return false

  // All relevant props are the same, skip re-render
  return true
})

export interface FeedColumnProps {
  column: ColumnItem[]
  colIndex: number
  /** Callback ref for load-more sentinel (when cursor exists) */
  loadMoreSentinelRef?: (el: HTMLDivElement | null) => void
  hasCursor?: boolean
  /** Props passed through to PostCard */
  keyboardFocusIndex: number
  focusTargets: { cardIndex: number; mediaIndex: number }[]
  firstFocusIndexForCard: number[]
  focusSetByMouse: boolean
  actionsMenuOpenForIndex: number | null
  nsfwPreference: 'nsfw' | 'sfw' | 'blurred'
  unblurredUris: Set<string>
  setUnblurred: (uri: string, revealed: boolean) => void
  likeOverrides: Record<string, string | null | undefined>
  setLikeOverrides: (postUri: string, likeUri: string | null) => void
  seenUris: Set<string>
  openPostModal: (uri: string, openReply?: boolean, focusUri?: string, authorHandle?: string) => void
  cardRef: (index: number) => (el: HTMLDivElement | null) => void
  onMediaRef: (index: number, mediaIndex: number, el: HTMLElement | null) => void
  onActionsMenuOpenChange: (index: number, open: boolean) => void
  onMouseEnter: (index: number) => void
  constrainMediaHeight?: boolean
  collectionMenuOpenForIndex?: number | null
  collectionMenuOpenSignal?: number
}

const FeedColumn = memo(function FeedColumn({
  column,
  loadMoreSentinelRef,
  hasCursor,
  keyboardFocusIndex,
  focusTargets,
  focusSetByMouse,
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
  constrainMediaHeight = false,
  collectionMenuOpenForIndex,
  collectionMenuOpenSignal,
}: FeedColumnProps) {
  if (column.length === 0) {
    return (
      <div className={styles.gridColumn}>
        {hasCursor && loadMoreSentinelRef != null && (
          <div ref={loadMoreSentinelRef} className={styles.loadMoreSentinel} aria-hidden />
        )}
      </div>
    )
  }

  // Pre-calculate the focused card to avoid recalculating in the map
  const focusedCardIndex = focusTargets[keyboardFocusIndex]?.cardIndex ?? -1

  return (
    <div className={styles.gridColumn}>
      {column.map(({ entry, originalIndex }) => {
        const isSelected = focusedCardIndex === originalIndex
        const focusedMediaIndex =
          isSelected &&
          !(focusSetByMouse && getPostAllMediaForDisplay(entry.item.post).length > 1)
            ? focusTargets[keyboardFocusIndex]?.mediaIndex
            : undefined
        
        return (
          <FeedCard
            key={stableCardKey(entry)}
            entry={entry}
            originalIndex={originalIndex}
            isSelected={isSelected}
            focusedMediaIndex={focusedMediaIndex}
            actionsMenuOpenForIndex={actionsMenuOpenForIndex}
            nsfwPreference={nsfwPreference}
            unblurredUris={unblurredUris}
            likeOverrides={likeOverrides}
            seenUris={seenUris}
            onMediaRef={onMediaRef}
            onActionsMenuOpenChange={onActionsMenuOpenChange}
            onMouseEnter={onMouseEnter}
            setUnblurred={setUnblurred}
            setLikeOverrides={setLikeOverrides}
            openPostModal={openPostModal}
            cardRef={cardRef}
            constrainMediaHeight={constrainMediaHeight}
            openCollectionMenuSignal={
              collectionMenuOpenForIndex === originalIndex ? collectionMenuOpenSignal : undefined
            }
          />
        )
      })}
      {hasCursor && loadMoreSentinelRef != null && (
        <div ref={loadMoreSentinelRef} className={styles.loadMoreSentinel} aria-hidden />
      )}
    </div>
  )
})

export default FeedColumn
