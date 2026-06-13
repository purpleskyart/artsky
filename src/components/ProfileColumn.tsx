import { type ReactNode, useRef, useState, useEffect, memo } from 'react'
import { useSyncExternalStore } from 'react'
import type { TimelineItem } from '../lib/bsky'
import { isPostNsfw, getPostMediaInfo } from '../lib/bsky'
import PostCard from './PostCard'
import type { PostCardDisplayContext } from '../hooks/usePostCardDisplayContext'
import { setInitialPostForUri } from '../lib/postCache'
import { observeVirtualization } from '../lib/cardVirtualization'
import { estimateMediaCardHeight } from '../lib/masonryLayout'
import { getDesktopSnapshot, subscribeDesktop } from '../config/breakpoints'
import styles from '../styles/postGrid.module.css'

type ColumnItem = { item: TimelineItem; originalIndex: number }

export interface ProfileColumnProps {
  column: ColumnItem[]
  colIndex: number
  scrollRef: HTMLDivElement | null
  loadMoreSentinelRef?: (el: HTMLDivElement | null) => void
  hasCursor?: boolean
  keyboardFocusIndex: number
  /** Flat list of focus targets for multi-image keyboard navigation. */
  focusTargets?: { cardIndex: number; mediaIndex: number }[]
  onMediaRef?: (index: number, mediaIndex: number, el: HTMLElement | null) => void
  actionsMenuOpenForIndex: number | null
  nsfwPreference: 'nsfw' | 'sfw' | 'blurred'
  unblurredUris: Set<string>
  setUnblurred: (uri: string, revealed: boolean) => void
  setLikeOverrides: (postUri: string, likeUri: string | null) => void
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
  onProfileAuthorFollowChange?: (followRecordUri: string | null) => void
  /** Optional row under each card (e.g. collection owner controls) */
  belowCard?: (ctx: { item: TimelineItem; originalIndex: number }) => ReactNode
  /** When set (e.g. collection page owner), ⋮ menu can remove post from that collection */
  onRemovePostFromCollection?: (postUri: string) => void | Promise<void>
  /** Center collect / avatar / like with ⋮ on the right (homepage preview layout) */
  feedPreviewActionRow?: boolean
  /** Pre-resolved display context from page (avoids per-card context hooks). */
  displayContext?: PostCardDisplayContext
  /** Collection board grid: preview-priority video autoplay. */
  collectionGridPlayback?: boolean
}

interface VirtualizedCellProps {
  children: ReactNode
  root?: Element | null
  /** Minimum placeholder height so column layout stays stable when images unload. */
  minHeight?: number
}

/**
 * Lightweight virtualization wrapper: replaces children with a fixed-height
 * placeholder when far off-screen, freeing images/video/observers from memory.
 */
export const VirtualizedCell = memo(function VirtualizedCell({ children, root, minHeight = 0 }: VirtualizedCellProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const heightRef = useRef(0)
  const showingRef = useRef(true)
  const [isNear, setIsNear] = useState(true)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    return observeVirtualization(el, (near) => {
      if (!near && showingRef.current && el) {
        heightRef.current = Math.max(el.offsetHeight, minHeight)
      }
      setIsNear(near)
    }, root)
  }, [root, minHeight])

  const placeholderHeight = Math.max(heightRef.current, minHeight)
  const virtualized = !isNear && placeholderHeight > 0
  showingRef.current = !virtualized

  return (
    <div ref={ref} style={{ width: '100%', overflowAnchor: 'none' }}>
      {virtualized ? <div style={{ height: placeholderHeight }} aria-hidden /> : children}
    </div>
  )
})

function ProfileColumnComponent(props: ProfileColumnProps) {
  const {
    column,
    loadMoreSentinelRef,
    hasCursor,
    scrollRef,
    keyboardFocusIndex,
    focusTargets,
    onMediaRef,
    actionsMenuOpenForIndex,
    nsfwPreference,
    unblurredUris,
    setUnblurred,
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
    onProfileAuthorFollowChange,
    belowCard,
    onRemovePostFromCollection,
    feedPreviewActionRow = true,
    displayContext,
    collectionGridPlayback = false,
  } = props

  const isDesktop = useSyncExternalStore(subscribeDesktop, getDesktopSnapshot, () => false)

  const focusedCardIndex = focusTargets?.[keyboardFocusIndex]?.cardIndex ?? -1

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
      {column.map(({ item, originalIndex }, index) => {
        const isNsfwBlurred =
          nsfwPreference === 'blurred' &&
          isPostNsfw(item.post) &&
          !unblurredUris.has(item.post.uri)
        const cardSelected = isSelected(originalIndex)
        const focusedMediaIndex =
          cardSelected && focusedCardIndex === originalIndex
            ? focusTargets?.[keyboardFocusIndex]?.mediaIndex
            : undefined
        const handleMediaRef = onMediaRef
          ? (mediaIndex: number, el: HTMLElement | null) => onMediaRef(originalIndex, mediaIndex, el)
          : undefined
        const media = getPostMediaInfo(item.post)
        const cellMinHeight = estimateMediaCardHeight(media?.aspectRatio, 1, !!media)
        return (
          <div
            key={`${item.post.uri}-${index}`}
            ref={cardRef(originalIndex)}
            className={styles.gridItem}
            data-post-uri={item.post.uri}
            data-selected={isSelected(originalIndex) || undefined}
            onMouseEnter={() => {
              onMouseEnter(originalIndex)
              if (isDesktop && !suppressHoverNsfwUnblur && isNsfwBlurred) setUnblurred(item.post.uri, true)
            }}
            onMouseLeave={() => {
              if (isDesktop && !suppressHoverNsfwUnblur && unblurredUris.has(item.post.uri)) setUnblurred(item.post.uri, false)
            }}
            onPointerEnter={isDesktop ? () => {
              if (!suppressHoverNsfwUnblur && isNsfwBlurred) setUnblurred(item.post.uri, true)
            } : undefined}
            onPointerLeave={isDesktop ? () => {
              if (!suppressHoverNsfwUnblur && unblurredUris.has(item.post.uri)) setUnblurred(item.post.uri, false)
            } : undefined}
          >
            <VirtualizedCell root={scrollRef} minHeight={cellMinHeight}>
              <PostCard
                item={item}
                isSelected={cardSelected}
                focusedMediaIndex={focusedMediaIndex}
                onMediaRef={handleMediaRef}
                cardRef={() => {}}
                onPostClick={(uri, opts) => {
                  if (opts?.initialItem) setInitialPostForUri(uri, opts.initialItem)
                  openPostModal(uri, opts?.openReply, undefined, item.post.author?.handle)
                }}
                constrainMediaHeight={constrainMediaHeight}
                fillCell={false}
                nsfwBlurred={isNsfwBlurred}
                onNsfwUnblur={() => setUnblurred(item.post.uri, true)}
                setUnblurred={setUnblurred}
                isRevealed={unblurredUris.has(item.post.uri)}
                onLikedChange={(uri, likeRecordUri) => setLikeOverrides(uri, likeRecordUri ?? null)}
                onActionsMenuOpenChange={(open) => onActionsMenuOpenChange(originalIndex, open)}
                cardIndex={originalIndex}
                actionsMenuOpenForIndex={actionsMenuOpenForIndex}
                profileAuthorDid={profileAuthorDid}
                profileAuthorFollowingUri={profileAuthorFollowingUri}
                onProfileAuthorFollowChange={onProfileAuthorFollowChange}
                onRemovePostFromCollection={onRemovePostFromCollection}
                feedPreviewActionRow={feedPreviewActionRow}
                suppressHoverNsfwUnblur={suppressHoverNsfwUnblur}
                seen={false}
                displayContext={displayContext}
                collectionGridPlayback={collectionGridPlayback}
              />
            </VirtualizedCell>
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

export default memo(ProfileColumnComponent)
