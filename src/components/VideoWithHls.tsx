import { useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react'
import { loadHls } from '../lib/loadHls'
import { buildHlsConfig, PAUSE_VISIBILITY_RATIO, PLAY_VISIBILITY_RATIO, type VideoPlaybackMode } from '../lib/videoHlsConfig'
import {
  getVisibleAutoplayCount,
  registerVideoSession,
  registerVisibilityRefresh,
  retryAutoplayIfWanted,
  setVideoHlsAttached,
  setVideoPlaying,
  unregisterVideoSession,
  updateVideoVisibility,
} from '../lib/videoPlaybackManager'
import type Hls from 'hls.js'

function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?|$)/i.test(url) || url.includes('m3u8')
}

function getNearViewportMargin(): string {
  if (typeof window === 'undefined') return '50% 0px 50% 0px'
  const vh = window.innerHeight
  const margin = Math.floor(vh * 0.5)
  return `${margin}px 0px ${margin}px 0px`
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
  controlsHiddenUntilTap?: boolean
  style?: React.CSSProperties
  intersectionRoot?: Element | null
  onPlayStateChange?: (isPlaying: boolean) => void
  forceMuted?: boolean
  onVideoDimensions?: (width: number, height: number) => void
  /** Tunes buffer sizes and suspend behavior. Feed videos pause when overlays are open. */
  playbackMode?: VideoPlaybackMode
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
  forceMuted = false,
  onVideoDimensions,
  playbackMode = 'detail',
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const visibilityRef = useRef<HTMLDivElement>(null)
  const [showControls, setShowControls] = useState(!controlsHiddenUntilTap)
  const effectiveControls = controlsHiddenUntilTap ? showControls : controls
  const videoIdRef = useRef(`video-${crypto.randomUUID()}`)
  const hlsRef = useRef<Hls | null>(null)
  const nativeCleanupRef = useRef<(() => void) | null>(null)
  const attachGenerationRef = useRef(0)
  const attachingRef = useRef(false)
  const playRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shouldMute = forceMuted || autoPlay

  const destroyHls = useCallback(() => {
    attachGenerationRef.current++
    attachingRef.current = false
    if (playRetryTimerRef.current != null) {
      clearTimeout(playRetryTimerRef.current)
      playRetryTimerRef.current = null
    }
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
    nativeCleanupRef.current?.()
    nativeCleanupRef.current = null
    const video = videoRef.current
    if (video) {
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
    setVideoHlsAttached(videoIdRef.current, false)
  }, [])

  const attachHls = useCallback(() => {
    const video = videoRef.current
    if (!video || !playlistUrl || hlsRef.current || attachingRef.current) return

    attachingRef.current = true
    const generation = attachGenerationRef.current

    if (isHlsUrl(playlistUrl)) {
      loadHls().then((HlsModule) => {
        if (generation !== attachGenerationRef.current || !videoRef.current) {
          attachingRef.current = false
          setVideoHlsAttached(videoIdRef.current, false)
          return
        }
        const videoEl = videoRef.current
        if (HlsModule.isSupported()) {
          const visibleCount = Math.max(1, getVisibleAutoplayCount())
          const hls = new HlsModule(buildHlsConfig(visibleCount))
          hls.loadSource(playlistUrl)
          hls.attachMedia(videoEl)
          hls.on(HlsModule.Events.ERROR, (_event, data) => {
            if (!data.fatal) return
            switch (data.type) {
              case HlsModule.ErrorTypes.NETWORK_ERROR:
                hls.startLoad()
                break
              case HlsModule.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError()
                break
              default:
                hls.destroy()
                hlsRef.current = null
                setVideoHlsAttached(videoIdRef.current, false)
                break
            }
          })
          hlsRef.current = hls
          attachingRef.current = false
          setVideoHlsAttached(videoIdRef.current, true)
        } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
          videoEl.src = playlistUrl
          const handleError = () => {
            console.error('Native HLS playback error for:', playlistUrl)
          }
          videoEl.addEventListener('error', handleError)
          nativeCleanupRef.current = () => {
            videoEl.removeEventListener('error', handleError)
            videoEl.removeAttribute('src')
          }
          attachingRef.current = false
          setVideoHlsAttached(videoIdRef.current, true)
        } else {
          attachingRef.current = false
        }
      }).catch((err) => {
        attachingRef.current = false
        console.warn('HLS.js failed to load, falling back to native playback:', err)
        if (videoRef.current?.canPlayType('application/vnd.apple.mpegurl')) {
          videoRef.current.src = playlistUrl
          setVideoHlsAttached(videoIdRef.current, true)
        }
      })
    } else {
      video.src = playlistUrl
      nativeCleanupRef.current = () => {
        video.removeAttribute('src')
      }
      attachingRef.current = false
      setVideoHlsAttached(videoIdRef.current, true)
    }
  }, [playlistUrl])

  const requestPlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (shouldMute) {
      video.muted = true
      video.defaultMuted = true
      video.setAttribute('muted', '')
      video.volume = 0
    }

    const attempt = () => {
      video.play().catch(() => {
        setVideoPlaying(videoIdRef.current, false)
        if (playRetryTimerRef.current != null) return
        playRetryTimerRef.current = setTimeout(() => {
          playRetryTimerRef.current = null
          if (!video.paused) return
          retryAutoplayIfWanted(videoIdRef.current)
        }, 300)
      })
    }

    if (video.readyState < 2) {
      const onReady = () => {
        video.removeEventListener('loadeddata', onReady)
        video.removeEventListener('canplay', onReady)
        attempt()
      }
      video.addEventListener('loadeddata', onReady, { once: true })
      video.addEventListener('canplay', onReady, { once: true })
      return
    }
    attempt()
  }, [shouldMute])

  const requestPause = useCallback(() => {
    videoRef.current?.pause()
  }, [])

  // Manager-driven autoplay sessions (layout effect so registration precedes visibility observer)
  useLayoutEffect(() => {
    if (!autoPlay) return
    const id = videoIdRef.current
    registerVideoSession(id, playbackMode, true, {
      onPlay: requestPlay,
      onPause: requestPause,
      onAttach: attachHls,
      onDetach: destroyHls,
    })
    return () => {
      unregisterVideoSession(id)
      destroyHls()
    }
  }, [autoPlay, playbackMode, requestPlay, requestPause, attachHls, destroyHls])

  // Visibility observer for manager (autoplay) or local pause (manual)
  useLayoutEffect(() => {
    const video = videoRef.current
    const visibilityTarget = visibilityRef.current ?? video
    if (!video || !visibilityTarget) return
    const id = videoIdRef.current

    const handleEntries = (entries: IntersectionObserverEntry[]) => {
      for (const entry of entries) {
        const ratio = entry.intersectionRatio
        const nearViewport = entry.isIntersecting

        if (autoPlay) {
          updateVideoVisibility(id, ratio, nearViewport)
        } else if (ratio < PAUSE_VISIBILITY_RATIO && !video.paused) {
          video.pause()
        }
      }
    }

    const observer = new IntersectionObserver(handleEntries, {
      threshold: [0, PAUSE_VISIBILITY_RATIO, PLAY_VISIBILITY_RATIO, 0.75, 1],
      rootMargin: getNearViewportMargin(),
      root: intersectionRoot ?? undefined,
    })

    const forceIntersectionUpdate = () => {
      observer.unobserve(visibilityTarget)
      observer.observe(visibilityTarget)
      const pending = observer.takeRecords()
      if (pending.length > 0) handleEntries(pending)
    }

    observer.observe(visibilityTarget)
    const pending = observer.takeRecords()
    if (pending.length > 0) handleEntries(pending)

    const raf1 = requestAnimationFrame(() => {
      forceIntersectionUpdate()
      requestAnimationFrame(forceIntersectionUpdate)
    })

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => forceIntersectionUpdate())
        : null
    resizeObserver?.observe(visibilityTarget)

    const unregisterRefresh = autoPlay
      ? registerVisibilityRefresh(forceIntersectionUpdate)
      : () => {}

    return () => {
      cancelAnimationFrame(raf1)
      resizeObserver?.disconnect()
      unregisterRefresh()
      observer.disconnect()
    }
  }, [intersectionRoot, autoPlay, playlistUrl, style])

  // Track play/pause state for overlays and manager
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const id = videoIdRef.current

    const handlePlay = () => {
      setVideoPlaying(id, true)
      onPlayStateChange?.(true)
    }
    const handlePause = () => {
      setVideoPlaying(id, false)
      onPlayStateChange?.(false)
    }

    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)
    return () => {
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
    }
  }, [onPlayStateChange])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !onVideoDimensions) return

    const reportDimensions = () => {
      const w = video.videoWidth
      const h = video.videoHeight
      if (w > 0 && h > 0) onVideoDimensions(w, h)
    }

    if (video.videoWidth > 0 && video.videoHeight > 0) reportDimensions()
    video.addEventListener('loadedmetadata', reportDimensions)
    return () => video.removeEventListener('loadedmetadata', reportDimensions)
  }, [onVideoDimensions, playlistUrl])

  // Non-autoplay: attach source on mount
  useEffect(() => {
    if (autoPlay) return
    attachHls()
    return () => destroyHls()
  }, [autoPlay, attachHls, destroyHls, playlistUrl])

  return (
    <div
      ref={visibilityRef}
      style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}
    >
      <video
        ref={videoRef}
        className={className}
        style={style}
        data-controls-hidden={controlsHiddenUntilTap && !showControls ? true : undefined}
        poster={poster}
        controls={effectiveControls}
        playsInline={playsInline}
        preload={preload}
        autoPlay={false}
        muted={shouldMute}
        loop={loop}
        onClick={(e) => {
          if (controlsHiddenUntilTap && !showControls) {
            setShowControls(true)
            return
          }
          const video = videoRef.current
          if (!video || effectiveControls) return
          if (video.paused) {
            e.stopPropagation()
            requestPlay()
          }
        }}
        disablePictureInPicture
        disableRemotePlayback
      />
    </div>
  )
}
