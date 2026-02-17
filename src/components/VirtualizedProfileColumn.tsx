import type { TimelineItem } from '../lib/bsky'
import { isPostNsfw } from '../lib/bsky'
import PostCard from './PostCard'
import { setInitialPostForUri } from '../lib/postCache'
import styles from '../pages/ProfilePage.module.css'

type ColumnItem = { item: TimelineItem; originalIndex: number }

export interface VirtualizedProfileColumnProps {
  column: ColumnItem[]
  colIndex: number
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

export default function VirtualizedProfileColumn(props: VirtualizedProfileColumnProps) {
  const {
    column,
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
      {column.map(({ item, originalIndex }) => (
        <div
          key={`${item.post.uri}-${originalIndex}`}
          ref={cardRef(originalIndex)}
          className={styles.gridItem}
          data-post-uri={item.post.uri}
          data-selected={isSelected(originalIndex) || undefined}
          onMouseEnter={() => onMouseEnter(originalIndex)}
        >
          <PostCard
            item={item}
            isSelected={isSelected(originalIndex)}
            cardRef={() => {}} // No-op since we're using the wrapper div ref above
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
      ))}
      {hasCursor && loadMoreSentinelRef && (
        <div ref={loadMoreSentinelRef} className={styles.loadMoreSentinel} aria-hidden />
      )}
    </div>
  )
}
