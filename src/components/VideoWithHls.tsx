import { useRef, useEffect, useState } from 'react'
import { loadHls } from '../lib/loadHls'

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
  /** When true, start with controls hidden; first tap on video shows native controls (for mobile post detail). */
  controlsHiddenUntilTap?: boolean
}

export default function VideoWithHls({
  playlistUrl,
  poster,
  className,
  controls = true,
  playsInline = true,
  preload = 'metadata',
  autoPlay = false,
  controlsHiddenUntilTap = false,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [showControls, setShowControls] = useState(!controlsHiddenUntilTap)
  const effectiveControls = controlsHiddenUntilTap ? showControls : controls

  useEffect(() => {
    if (!playlistUrl || !videoRef.current) return
    const video = videoRef.current
    
    let cleanup: (() => void) | undefined
    
    if (isHlsUrl(playlistUrl)) {
      loadHls().then((Hls) => {
        if (!videoRef.current) return
        if (Hls.isSupported()) {
          const hls = new Hls()
          hls.loadSource(playlistUrl)
          hls.attachMedia(video)
          hls.on(Hls.Events.ERROR, () => {})
          cleanup = () => {
            hls.destroy()
          }
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = playlistUrl
          cleanup = () => {
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
    function playWhenReady() {
      video.play().catch(() => {})
    }
    if (video.readyState >= 2) playWhenReady()
    else video.addEventListener('loadeddata', playWhenReady, { once: true })
    return () => video.removeEventListener('loadeddata', playWhenReady)
  }, [autoPlay, playlistUrl])

  return (
    <video
      ref={videoRef}
      className={className}
      poster={poster}
      controls={effectiveControls}
      playsInline={playsInline}
      preload={preload}
      autoPlay={autoPlay}
      muted={autoPlay}
      onClick={controlsHiddenUntilTap && !showControls ? () => setShowControls(true) : undefined}
    />
  )
}
