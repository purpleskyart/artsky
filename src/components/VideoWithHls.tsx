import { useRef, useEffect } from 'react'
import Hls from 'hls.js'

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
}

export default function VideoWithHls({
  playlistUrl,
  poster,
  className,
  controls = true,
  playsInline = true,
  preload = 'metadata',
  autoPlay = false,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!playlistUrl || !videoRef.current) return
    const video = videoRef.current
    if (Hls.isSupported() && isHlsUrl(playlistUrl)) {
      const hls = new Hls()
      hls.loadSource(playlistUrl)
      hls.attachMedia(video)
      hls.on(Hls.Events.ERROR, () => {})
      return () => {
        hls.destroy()
      }
    }
    if (video.canPlayType('application/vnd.apple.mpegurl') || !isHlsUrl(playlistUrl)) {
      video.src = playlistUrl
      return () => {
        video.removeAttribute('src')
      }
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
      controls={controls}
      playsInline={playsInline}
      preload={preload}
      autoPlay={autoPlay}
      muted={autoPlay}
    />
  )
}
