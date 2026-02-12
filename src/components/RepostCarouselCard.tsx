import { getPostMediaInfo, type TimelineItem } from '../lib/bsky'
import styles from './RepostCarouselCard.module.css'

function RepostIcon() {
  return (
    <svg className={styles.repostIcon} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
    </svg>
  )
}

type Props = {
  items: TimelineItem[]
  onPostClick: (uri: string, opts?: { initialItem?: unknown }) => void
  cardRef?: React.Ref<HTMLDivElement | null>
  /** When true, card is marked as seen (e.g. scrolled past); shown darkened */
  seen?: boolean
  /** For feed scroll-into-view and seen tracking */
  'data-post-uri'?: string
}

export default function RepostCarouselCard({ items, onPostClick, cardRef, seen, 'data-post-uri': dataPostUri }: Props) {
  if (items.length === 0) return null

  const reasonBy = (item: TimelineItem) => (item.reason as { by?: { handle?: string; did?: string; avatar?: string } })?.by
  const handleFor = (item: TimelineItem) => reasonBy(item)?.handle ?? reasonBy(item)?.did ?? item.post.author?.handle ?? item.post.author?.did ?? ''

  return (
    <div
      ref={cardRef}
      className={`${styles.wrap} ${seen ? styles.seen : ''}`}
      data-post-uri={dataPostUri ?? items[0]?.post?.uri}
      role="article"
      aria-label={`${items.length} reposts`}
    >
      <div className={styles.header}>
        <RepostIcon />
        <span className={styles.title}>{items.length} reposts</span>
      </div>
      <div className={styles.scrollWrap}>
        <div className={styles.track}>
          {items.map((item) => {
            const uri = item.post.uri
            const handle = handleFor(item)
            const media = getPostMediaInfo(item.post)
            const authorAvatar = item.post.author?.avatar
            const thumb = media?.url ?? authorAvatar

            return (
              <button
                key={uri}
                type="button"
                className={styles.tile}
                onClick={() => onPostClick(uri, { initialItem: item })}
                aria-label={handle ? `Repost by @${handle}, open post` : 'Open post'}
              >
                {thumb ? (
                  <img src={thumb} alt="" className={styles.tileImg} loading="lazy" />
                ) : (
                  <span className={styles.tilePlaceholder}>
                    {(item.post.author?.displayName ?? handle ?? item.post.author?.did ?? '?').slice(0, 1).toUpperCase()}
                  </span>
                )}
                {handle ? <span className={styles.tileHandle}>@{handle}</span> : null}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
