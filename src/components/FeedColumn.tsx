import type { FeedDisplayEntry } from '../pages/FeedPage'
import { getPostAllMediaForDisplay, isPostNsfw } from '../lib/bsky'
import OptimizedPostCard from './OptimizedPostCard'
import RepostCarouselCard from './RepostCarouselCard'
import { setInitialPostForUri } from '../lib/postCache'
import styles from '../pages/FeedPage.module.css'
import { memo } from 'react'

type ColumnItem = { entry: FeedDisplayEntry; originalIndex: number }

// Memoized card wrapper to prevent re-renders when other cards change
const FeedCard = memo(function FeedCard({
  entry,
  originalIndex,
  isSelected,
  focusedMediaIndex,
  openAddDropdown,
  actionsMenuOpenForIndex,
  nsfwPreference,
  unblurredUris,
  likeOverrides,
  seenUris,
  onMediaRef,
  onActionsMenuOpenChange,
  onMouseEnter,
  onAddClose,
  setUnblurred,
  setLikeOverrides,
  openPostModal,
  cardRef,
}: {
  entry: FeedDisplayEntry
  originalIndex: number
  isSelected: boolean
  focusedMediaIndex: number | undefined
  openAddDropdown: boolean
  actionsMenuOpenForIndex: number | null
  nsfwPreference: 'nsfw' | 'sfw' | 'blurred'
  unblurredUris: Set<string>
  likeOverrides: Record<string, string | null | undefined>
  seenUris: Set<string>
  onMediaRef: (index: number, mediaIndex: number, el: HTMLElement | null) => void
  onActionsMenuOpenChange: (index: number, open: boolean) => void
  onMouseEnter: (index: number) => void
  onAddClose: () => void
  setUnblurred: (uri: string, revealed: boolean) => void
  setLikeOverrides: (postUri: string, likeUri: string | null) => void
  openPostModal: (uri: string, openReply?: boolean, focusUri?: string) => void
  cardRef: (index: number) => (el: HTMLDivElement | null) => void
}) {
  const key = entry.type === 'post' ? entry.item.post.uri : entry.items[0].post.uri
  
  return (
    <div
      key={key}
      ref={cardRef(originalIndex)}
      className={styles.gridItem}
      data-selected={isSelected || undefined}
      data-post-uri={key}
      onMouseEnter={() => onMouseEnter(originalIndex)}
    >
      {entry.type === 'post' ? (
        <OptimizedPostCard
          item={entry.item}
          isSelected={isSelected}
          focusedMediaIndex={focusedMediaIndex}
          onMediaRef={(mediaIndex, el) => onMediaRef(originalIndex, mediaIndex, el)}
          cardRef={() => {}} // No-op since we're using the wrapper div ref above
          openAddDropdown={openAddDropdown}
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
}, (prevProps, nextProps) => {
  // Custom comparison: only re-render if props that matter for THIS card changed
  const prevUri = prevProps.entry.type === 'post' ? prevProps.entry.item.post.uri : prevProps.entry.items[0].post.uri
  const nextUri = nextProps.entry.type === 'post' ? nextProps.entry.item.post.uri : nextProps.entry.items[0].post.uri
  
  // Different post = must re-render
  if (prevUri !== nextUri) return false
  
  // Check props that affect this specific card
  if (prevProps.isSelected !== nextProps.isSelected) return false
  if (prevProps.focusedMediaIndex !== nextProps.focusedMediaIndex) return false
  if (prevProps.openAddDropdown !== nextProps.openAddDropdown) return false
  if (prevProps.actionsMenuOpenForIndex !== nextProps.actionsMenuOpenForIndex) return false
  if (prevProps.nsfwPreference !== nextProps.nsfwPreference) return false
  
  // Check if this card's like status changed
  if (prevProps.likeOverrides[prevUri] !== nextProps.likeOverrides[nextUri]) return false
  
  // Check if this card's seen status changed
  if (prevProps.seenUris.has(prevUri) !== nextProps.seenUris.has(nextUri)) return false
  
  // Check if this card's blur status changed
  if (prevProps.unblurredUris.has(prevUri) !== nextProps.unblurredUris.has(nextUri)) return false
  
  // All relevant props are the same, skip re-render
  return true
})

export interface FeedColumnProps {
  column: ColumnItem[]
  colIndex: number
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

const FeedColumn = memo(function FeedColumn({
  column,
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
          !(focusSetByMouse && getPostAllMediaForDisplay(entry.type === 'post' ? entry.item.post : entry.items[0].post).length > 1)
            ? focusTargets[keyboardFocusIndex]?.mediaIndex
            : undefined
        
        return (
          <FeedCard
            key={entry.type === 'post' ? entry.item.post.uri : entry.items[0].post.uri}
            entry={entry}
            originalIndex={originalIndex}
            isSelected={isSelected}
            focusedMediaIndex={focusedMediaIndex}
            openAddDropdown={isSelected && keyboardAddOpen}
            actionsMenuOpenForIndex={actionsMenuOpenForIndex}
            nsfwPreference={nsfwPreference}
            unblurredUris={unblurredUris}
            likeOverrides={likeOverrides}
            seenUris={seenUris}
            onMediaRef={onMediaRef}
            onActionsMenuOpenChange={onActionsMenuOpenChange}
            onMouseEnter={onMouseEnter}
            onAddClose={onAddClose}
            setUnblurred={setUnblurred}
            setLikeOverrides={setLikeOverrides}
            openPostModal={openPostModal}
            cardRef={cardRef}
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
