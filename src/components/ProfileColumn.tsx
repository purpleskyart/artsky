import { type ReactNode, useRef, useState, useEffect, memo } from 'react'
import type { TimelineItem } from '../lib/bsky'
import { isPostNsfw } from '../lib/bsky'
import PostCard from './PostCard'
import { setInitialPostForUri } from '../lib/postCache'
import { observeVirtualization } from '../lib/cardVirtualization'
import profileStyles from '../pages/ProfilePage.module.css'
import feedStyles from '../pages/FeedPage.module.css'

type ColumnItem = { item: TimelineItem; originalIndex: number }

export interface ProfileColumnProps {
  column: ColumnItem[]
  colIndex: number
  scrollRef: HTMLDivElement | null
  loadMoreSentinelRef?: (el: HTMLDivElement | null) => void
  hasCursor?: boolean
  keyboardFocusIndex: number
  actionsMenuOpenForIndex: number | null
  nsfwPreference: 'nsfw' | 'sfw' | 'blurred'
  unblurredUris: Set<string>
  setUnblurred: (uri: string, revealed: boolean) => void
  likeOverrides: Record<string, string | null | undefined>
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
  /** Use feed column/card spacing (e.g. collection grid) instead of profile/tighter gaps */
  layout?: 'profile' | 'feed'
  /** Center collect / avatar / like with ⋮ on the right (homepage preview layout) */
  feedPreviewActionRow?: boolean
}

/**
 * Lightweight virtualization wrapper: replaces children with a fixed-height
 * placeholder when far off-screen, freeing images/video/observers from memory.
 */
const VirtualizedCell = memo(function VirtualizedCell({ children, root }: { children: ReactNode; root?: Element | null }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const heightRef = useRef(0)
  const showingRef = useRef(true)
  const [isNear, setIsNear] = useState(true)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    return observeVirtualization(el, (near) => {
      if (!near && showingRef.current && el) {
        heightRef.current = el.offsetHeight
      }
      setIsNear(near)
    }, root)
  }, [root])

  const virtualized = !isNear && heightRef.current > 0
  showingRef.current = !virtualized

  return (
    <div ref={ref} style={{ width: '100%' }}>
      {virtualized ? <div style={{ height: heightRef.current }} aria-hidden /> : children}
    </div>
  )
})

function ProfileColumnComponent(props: ProfileColumnProps) {
  const {
    column,
    loadMoreSentinelRef,
    hasCursor,
    scrollRef,
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
    onProfileAuthorFollowChange,
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
      {column.map(({ item, originalIndex }, index) => {
        const isNsfwBlurred =
          nsfwPreference === 'blurred' &&
          isPostNsfw(item.post) &&
          !unblurredUris.has(item.post.uri)
        return (
          <div
            key={`${item.post.uri}-${index}`}
            ref={cardRef(originalIndex)}
            className={styles.gridItem}
            data-post-uri={item.post.uri}
            data-selected={isSelected(originalIndex) || undefined}
            onMouseEnter={() => {
              onMouseEnter(originalIndex)
              if (!suppressHoverNsfwUnblur && isNsfwBlurred) setUnblurred(item.post.uri, true)
            }}
            onMouseLeave={() => {
              if (!suppressHoverNsfwUnblur && unblurredUris.has(item.post.uri)) setUnblurred(item.post.uri, false)
            }}
            onPointerEnter={() => {
              if (!suppressHoverNsfwUnblur && isNsfwBlurred) setUnblurred(item.post.uri, true)
            }}
            onPointerLeave={() => {
              if (!suppressHoverNsfwUnblur && unblurredUris.has(item.post.uri)) setUnblurred(item.post.uri, false)
            }}
          >
            <VirtualizedCell root={scrollRef}>
              <PostCard
                item={item}
                isSelected={isSelected(originalIndex)}
                cardRef={() => {}}
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
