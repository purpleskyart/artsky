import type { FeedDisplayEntry } from '../pages/FeedPage'
import { getPostAllMediaForDisplay, isPostNsfw } from '../lib/bsky'
import VirtualizedPostCard from './VirtualizedPostCard'
import RepostCarouselCard from './RepostCarouselCard'
import { setInitialPostForUri } from '../lib/postCache'
import styles from '../pages/FeedPage.module.css'

type ColumnItem = { entry: FeedDisplayEntry; originalIndex: number }

export interface VirtualizedFeedColumnProps {
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

export default function VirtualizedFeedColumn({
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
}: VirtualizedFeedColumnProps) {
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
      {column.map(({ entry, originalIndex }) => {
        const key = entry.type === 'post' ? entry.item.post.uri : entry.items[0].post.uri
        return (
          <div
            key={key}
            ref={cardRef(originalIndex)}
            className={styles.gridItem}
            data-selected={focusTargets[keyboardFocusIndex]?.cardIndex === originalIndex || undefined}
            data-post-uri={entry.type === 'post' ? entry.item.post.uri : entry.items[0].post.uri}
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
      {hasCursor && loadMoreSentinelRef != null && (
        <div ref={loadMoreSentinelRef} className={styles.loadMoreSentinel} aria-hidden />
      )}
    </div>
  )
}
