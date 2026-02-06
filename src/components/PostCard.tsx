import { useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Hls from 'hls.js'
import { getPostMediaInfo, type TimelineItem } from '../lib/bsky'
import PostText from './PostText'
import styles from './PostCard.module.css'

interface Props {
  item: TimelineItem
}

function VideoIcon() {
  return (
    <svg className={styles.mediaIcon} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      {/* Film strip: frame with sprocket holes */}
      <path d="M4 4h16v16H4V4zm2 2v2H4V6h2zm0 6v2H4v-2h2zm0 6v2H4v-2h2zm12-12h-2v2h2V6zm0 6v2h-2v-2h2zm0 6v2h-2v-2h2zM8 8h8v8H8V8z" />
    </svg>
  )
}

function ImagesIcon() {
  return (
    <svg className={styles.mediaIcon} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M22 16V4c0-1.1-.9-2-2-2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2zm-11-4l2.03 2.71L16 11l4 5H8l3-4zM2 6v14c0 1.1.9 2 2 2h14v-2H4V6H2z" />
    </svg>
  )
}

function RepostIcon() {
  return (
    <svg className={styles.repostIcon} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
    </svg>
  )
}

function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?|$)/i.test(url) || url.includes('m3u8')
}

export default function PostCard({ item }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const { post, reason } = item as { post: typeof item.post; reason?: { $type?: string; by?: { handle?: string; did?: string } } }
  const media = getPostMediaInfo(post)
  const text = (post.record as { text?: string })?.text ?? ''
  const handle = post.author.handle ?? post.author.did
  const isRepost = reason?.$type === 'app.bsky.feed.defs#reasonRepost' && reason?.by
  const repostedByHandle = reason?.by ? (reason.by.handle ?? reason.by.did) : null

  if (!media) return null

  const isVideo = media.type === 'video' && media.videoPlaylist
  const isMultipleImages = media.type === 'image' && (media.imageCount ?? 0) > 1

  useEffect(() => {
    if (!isVideo || !media.videoPlaylist || !videoRef.current) return
    const video = videoRef.current
    const src = media.videoPlaylist
    if (Hls.isSupported() && isHlsUrl(src)) {
      const hls = new Hls()
      hlsRef.current = hls
      hls.loadSource(src)
      hls.attachMedia(video)
      hls.on(Hls.Events.ERROR, () => {})
      return () => {
        hls.destroy()
        hlsRef.current = null
      }
    }
    if (video.canPlayType('application/vnd.apple.mpegurl') || !isHlsUrl(src)) {
      video.src = src
      return () => {
        video.removeAttribute('src')
      }
    }
  }, [isVideo, media.videoPlaylist])

  function onMediaEnter() {
    if (videoRef.current) {
      videoRef.current.play().catch(() => {})
    }
  }

  function onMediaLeave() {
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.currentTime = 0
    }
  }

  return (
    <Link to={`/post/${encodeURIComponent(post.uri)}`} className={styles.card}>
      <div
        className={styles.mediaWrap}
        onMouseEnter={onMediaEnter}
        onMouseLeave={onMediaLeave}
      >
        {isVideo ? (
          <video
            ref={videoRef}
            className={styles.media}
            poster={media.url || undefined}
            muted
            playsInline
            loop
            preload="metadata"
          />
        ) : (
          <img src={media.url} alt="" className={styles.media} loading="lazy" />
        )}
      </div>
      <div className={styles.meta}>
        <div className={styles.handleBlock}>
          <span className={styles.handleRow}>
            {isRepost && (
              <span className={styles.repostBadge} title="Repost">
                <RepostIcon />
              </span>
            )}
            <Link
              to={`/profile/${encodeURIComponent(handle)}`}
              className={styles.handleLink}
              onClick={(e) => e.stopPropagation()}
            >
              @{handle}
            </Link>
            {isVideo && (
              <span className={styles.mediaBadge} title="Video – hover to play, click to open post">
                <VideoIcon />
              </span>
            )}
            {isMultipleImages && (
              <span className={styles.mediaBadge} title={`${media.imageCount} images`}>
                <ImagesIcon />
              </span>
            )}
          </span>
          {repostedByHandle && (
            <span className={styles.repostedBy}>
              Reposted by{' '}
              <Link
                to={`/profile/${encodeURIComponent(repostedByHandle)}`}
                className={styles.handleLink}
                onClick={(e) => e.stopPropagation()}
              >
                @{repostedByHandle}
              </Link>
            </span>
          )}
        </div>
        {text ? (
          <p className={styles.text}>
            <PostText text={text} maxLength={80} stopPropagation />
          </p>
        ) : null}
      </div>
    </Link>
  )
}
