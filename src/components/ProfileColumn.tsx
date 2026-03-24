import type { ReactNode } from 'react'
import type { TimelineItem } from '../lib/bsky'
import { isPostNsfw } from '../lib/bsky'
import PostCard from './PostCard'
import { setInitialPostForUri } from '../lib/postCache'
import profileStyles from '../pages/ProfilePage.module.css'
import feedStyles from '../pages/FeedPage.module.css'

type ColumnItem = { item: TimelineItem; originalIndex: number }

export interface ProfileColumnProps {
  column: ColumnItem[]
  colIndex: number
  scrollRef: React.RefObject<HTMLDivElement | null> | null
  loadMoreSentinelRef?: (el: HTMLDivElement | null) => void
  hasCursor?: boolean
  keyboardFocusIndex: number
  actionsMenuOpenForIndex: number | null
  nsfwPreference: 'nsfw' | 'sfw' | 'blurred'
  unblurredUris: Set<string>
  setUnblurred: (uri: string, revealed: boolean) => void
  likeOverrides: Record<string, string | null>
  setLikeOverrides: React.Dispatch<React.SetStateAction<Record<string, string | null>>>
  openPostModal: (uri: string, openReply?: boolean, focusUri?: string, authorHandle?: string) => void
  cardRef: (index: number) => (el: HTMLDivElement | null) => void
  onActionsMenuOpenChange: (index: number, open: boolean) => void
  onMouseEnter: (index: number) => void
  constrainMediaHeight?: boolean
  isSelected: (index: number) => boolean
  /** When true, do not unblur NSFW on pointer/mouse enter (scroll can move content under a stationary cursor in modals). */
  suppressHoverNsfwUnblur?: boolean
  /** Sync follow affordance on cards with profile header when author feed omits viewer.following */
  profileAuthorDid?: string
  profileAuthorFollowingUri?: string | null
  /** Optional row under each card (e.g. collection owner controls) */
  belowCard?: (ctx: { item: TimelineItem; originalIndex: number }) => ReactNode
  /** When set (e.g. collection page owner), ⋮ menu can remove post from that collection */
  onRemovePostFromCollection?: (postUri: string) => void | Promise<void>
  /** Use feed column/card spacing (e.g. collection grid) instead of profile/tighter gaps */
  layout?: 'profile' | 'feed'
  /** Center collect / avatar / like with ⋮ on the right (homepage preview layout) */
  feedPreviewActionRow?: boolean
}

export default function ProfileColumn(props: ProfileColumnProps) {
  const {
    column,
    loadMoreSentinelRef,
    hasCursor,
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
    constrainMediaHeight = false,
    isSelected,
    suppressHoverNsfwUnblur = false,
    profileAuthorDid,
    profileAuthorFollowingUri,
    belowCard,
    onRemovePostFromCollection,
    layout = 'profile',
    feedPreviewActionRow = false,
  } = props

  const styles = layout === 'feed' ? feedStyles : profileStyles

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
      {column.map(({ item, originalIndex }) => {
        const isNsfwBlurred =
          nsfwPreference === 'blurred' &&
          isPostNsfw(item.post) &&
          !unblurredUris.has(item.post.uri)
        return (
          <div
            key={`${item.post.uri}-${originalIndex}`}
            ref={cardRef(originalIndex)}
            className={styles.gridItem}
            data-post-uri={item.post.uri}
            data-selected={isSelected(originalIndex) || undefined}
            onMouseEnter={() => {
              onMouseEnter(originalIndex)
              if (!suppressHoverNsfwUnblur && isNsfwBlurred) setUnblurred(item.post.uri, true)
            }}
            onPointerEnter={() => {
              if (!suppressHoverNsfwUnblur && isNsfwBlurred) setUnblurred(item.post.uri, true)
            }}
          >
            <PostCard
              item={item}
              isSelected={isSelected(originalIndex)}
              cardRef={() => {}} // No-op since we're using the wrapper div ref above
              onPostClick={(uri, opts) => {
                if (opts?.initialItem) setInitialPostForUri(uri, opts.initialItem)
                openPostModal(uri, opts?.openReply, undefined, item.post.author?.handle)
              }}
              constrainMediaHeight={constrainMediaHeight}
              nsfwBlurred={isNsfwBlurred}
              onNsfwUnblur={() => setUnblurred(item.post.uri, true)}
              setUnblurred={setUnblurred}
              isRevealed={unblurredUris.has(item.post.uri)}
              likedUriOverride={likeOverrides[item.post.uri]}
              onLikedChange={(uri, likeRecordUri) =>
                setLikeOverrides((prev) => ({ ...prev, [uri]: likeRecordUri ?? null }))
              }
              onActionsMenuOpenChange={(open) => onActionsMenuOpenChange(originalIndex, open)}
              cardIndex={originalIndex}
              actionsMenuOpenForIndex={actionsMenuOpenForIndex}
              profileAuthorDid={profileAuthorDid}
              profileAuthorFollowingUri={profileAuthorFollowingUri}
              onRemovePostFromCollection={onRemovePostFromCollection}
              feedPreviewActionRow={feedPreviewActionRow}
            />
          {belowCard ? belowCard({ item, originalIndex }) : null}
          </div>
        )
      })}
      {hasCursor && loadMoreSentinelRef && (
        <div ref={loadMoreSentinelRef} className={styles.loadMoreSentinel} aria-hidden />
      )}
    </div>
  )
}
