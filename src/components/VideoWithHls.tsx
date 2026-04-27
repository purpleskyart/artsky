import { useRef, useEffect, useState } from 'react'
import { loadHls } from '../lib/loadHls'

// Global video manager to limit concurrent playing videos
const MAX_CONCURRENT_VIDEOS = 8
const playingVideos = new Map<string, HTMLVideoElement>()
let playQueue: string[] = []

function registerPlayingVideo(id: string, video: HTMLVideoElement) {
  playingVideos.set(id, video)
  playQueue = playQueue.filter((v) => v !== id)
  playQueue.push(id)
  
  // If we exceed the limit, pause the oldest playing video
  if (playingVideos.size > MAX_CONCURRENT_VIDEOS) {
    const oldestId = playQueue.shift()
    if (oldestId) {
      const oldestVideo = playingVideos.get(oldestId)
      if (oldestVideo && !oldestVideo.paused) {
        oldestVideo.pause()
        playingVideos.delete(oldestId)
      }
    }
  }
}

function unregisterPlayingVideo(id: string) {
  playingVideos.delete(id)
  playQueue = playQueue.filter((v) => v !== id)
}

function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?|$)/i.test(url) || url.includes('m3u8')
}

interface Props {
  playlistUrl: string
  poster?: string
  className?: string
  controls?: boolean
  playsInline?: boolean
  preload?: string
  autoPlay?: boolean
  loop?: boolean
  /** When true, start with controls hidden; first tap on video shows native controls (for mobile post detail). */
  controlsHiddenUntilTap?: boolean
  style?: React.CSSProperties
  /** Root element for IntersectionObserver (e.g., modal scroll container) */
  intersectionRoot?: Element | null
  /** Callback when video play state changes (for showing play icon overlay) */
  onPlayStateChange?: (isPlaying: boolean) => void
}

export default function VideoWithHls({
  playlistUrl,
  poster,
  className,
  controls = true,
  playsInline = true,
  preload = 'none',
  autoPlay = false,
  loop = false,
  controlsHiddenUntilTap = false,
  style,
  intersectionRoot,
  onPlayStateChange,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [showControls, setShowControls] = useState(!controlsHiddenUntilTap)
  const effectiveControls = controlsHiddenUntilTap ? showControls : controls
  const wasPlayingRef = useRef(false)
  const videoIdRef = useRef(`video-${crypto.randomUUID()}`)

  useEffect(() => {
    if (!playlistUrl || !videoRef.current) return
    const video = videoRef.current
    
    let cleanup: (() => void) | undefined
    
    if (isHlsUrl(playlistUrl)) {
      loadHls().then((Hls) => {
        if (!videoRef.current) return
        if (Hls.isSupported()) {
          const hls = new Hls({
            // Balanced buffer sizes for stability with multiple videos
            maxBufferLength: 30, // Restore to default for smoother playback
            maxMaxBufferLength: 60, // Restore to default
            maxBufferSize: 30 * 1024 * 1024, // 30MB for better buffering
            // Optimize quality switching
            enableWorker: true,
            lowLatencyMode: false, // Disable low latency for better performance
            backBufferLength: 10, // Keep small back buffer for seeking
            // Performance optimizations
            maxBufferHole: 1.0, // More tolerant buffer hole threshold
            // Error recovery
            fragLoadPolicy: {
              default: {
                maxTimeToFirstByteMs: 10000,
                maxLoadTimeMs: 20000,
                timeoutRetry: {
                  maxNumRetry: 3,
                  retryDelayMs: 1000,
                  maxRetryDelayMs: 8000,
                },
                errorRetry: {
                  maxNumRetry: 3,
                  retryDelayMs: 1000,
                  maxRetryDelayMs: 8000,
                },
              },
            },
          })
          hls.loadSource(playlistUrl)
          hls.attachMedia(video)
          hls.on(Hls.Events.ERROR, (_event, data) => {
            // eslint-disable-next-line no-console
            console.error('HLS error:', data)
            if (data.fatal) {
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  hls.startLoad()
                  break
                case Hls.ErrorTypes.MEDIA_ERROR:
                  hls.recoverMediaError()
                  break
                default:
                  hls.destroy()
                  break
              }
            }
          })
          cleanup = () => {
            hls.destroy()
          }
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = playlistUrl
          const handleError = () => {
            // eslint-disable-next-line no-console
            console.error('Native HLS playback error for:', playlistUrl)
          }
          video.addEventListener('error', handleError)
          cleanup = () => {
            video.removeEventListener('error', handleError)
            video.removeAttribute('src')
          }
        }
      }).catch(() => {
        // Fallback to native playback if hls.js fails to load
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = playlistUrl
        }
      })
    } else {
      video.src = playlistUrl
      cleanup = () => {
        video.removeAttribute('src')
      }
    }
    
    return () => {
      cleanup?.()
    }
  }, [playlistUrl])

  useEffect(() => {
    if (!autoPlay || !videoRef.current) return
    const video = videoRef.current
    const videoId = videoIdRef.current
    function playWhenReady() {
      registerPlayingVideo(videoId, video)
      video.play().catch(() => {
        unregisterPlayingVideo(videoId)
      })
    }
    if (video.readyState >= 2) playWhenReady()
    else video.addEventListener('loadeddata', playWhenReady, { once: true })
    return () => {
      video.removeEventListener('loadeddata', playWhenReady)
      unregisterPlayingVideo(videoId)
    }
  }, [autoPlay, playlistUrl])

  // Track play/pause state changes
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handlePlay = () => onPlayStateChange?.(true)
    const handlePause = () => onPlayStateChange?.(false)

    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)

    return () => {
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
    }
  }, [onPlayStateChange])

  // Pause video when not visible to prevent resource contention with multiple videos
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const videoId = videoIdRef.current

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const isIntersecting = entry.isIntersecting

          if (!isIntersecting) {
            // Video is leaving viewport - pause it and remember it was playing
            if (!video.paused) {
              wasPlayingRef.current = true
              video.pause()
              unregisterPlayingVideo(videoId)
            }
          } else {
            // Video is entering viewport - always play when visible
            if (video.readyState >= 2) {
              registerPlayingVideo(videoId, video)
              video.play().catch(() => {
                unregisterPlayingVideo(videoId)
              })
              wasPlayingRef.current = false
            }
          }
        }
      },
      { threshold: 0.10, rootMargin: '-10% 0px -10% 0px', root: intersectionRoot ?? undefined }
    )

    observer.observe(video)

    return () => {
      observer.disconnect()
      unregisterPlayingVideo(videoId)
    }
  }, [intersectionRoot, autoPlay, playlistUrl])

  return (
    <video
      ref={videoRef}
      className={className}
      style={style}
      data-controls-hidden={controlsHiddenUntilTap && !showControls ? true : undefined}
      poster={poster}
      controls={effectiveControls}
      playsInline={playsInline}
      preload={preload}
      autoPlay={autoPlay}
      muted={autoPlay}
      loop={loop}
      onClick={controlsHiddenUntilTap && !showControls ? () => setShowControls(true) : undefined}
    />
  )
}
