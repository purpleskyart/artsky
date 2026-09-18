/**
 * Lock-screen media controls (Media Session API) and screen wake lock for video
 * playback. Only unmuted, user-initiated videos participate — muted autoplay feed
 * videos must not take over lock-screen controls or keep the screen awake.
 */

let ownerVideo: HTMLVideoElement | null = null

export function acquireMediaSession(
  video: HTMLVideoElement,
  options: { title: string; artwork?: string },
): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
  // Another video already owns the lock-screen controls (e.g. multiple posts mounted).
  if (ownerVideo && ownerVideo !== video) return
  ownerVideo = video
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: options.title,
      artist: 'PurpleSky',
      artwork: options.artwork ? [{ src: options.artwork, sizes: '640x640' }] : undefined,
    })
    navigator.mediaSession.setActionHandler('play', () => {
      void video.play().catch(() => {})
    })
    navigator.mediaSession.setActionHandler('pause', () => video.pause())
    navigator.mediaSession.playbackState = 'playing'
  } catch {
    // Unsupported action handler / metadata on this platform.
  }
}

export function releaseMediaSession(video: HTMLVideoElement | null): void {
  if (!video || ownerVideo !== video) return
  ownerVideo = null
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
  try {
    navigator.mediaSession.metadata = null
    navigator.mediaSession.playbackState = 'none'
    navigator.mediaSession.setActionHandler('play', null)
    navigator.mediaSession.setActionHandler('pause', null)
  } catch {
    // ignore
  }
}

let wakeLockSentinel: WakeLockSentinel | null = null

/** Keep the screen on while a video plays. Auto-releases when the page hides. */
export async function acquireWakeLock(): Promise<void> {
  try {
    if (!navigator.wakeLock || wakeLockSentinel) return
    wakeLockSentinel = await navigator.wakeLock.request('screen')
    wakeLockSentinel.addEventListener('release', () => {
      wakeLockSentinel = null
    })
  } catch {
    // Denied or unsupported (e.g. low battery / unsupported browser).
  }
}

export function releaseWakeLock(): void {
  const sentinel = wakeLockSentinel
  wakeLockSentinel = null
  void sentinel?.release().catch(() => {})
}
