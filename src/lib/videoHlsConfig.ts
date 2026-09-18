import type { HlsConfig } from 'hls.js'

/** Enough of the video visible to start autoplay. */
export const PLAY_VISIBILITY_RATIO = 0.35
/** Pause when visibility drops below this (hysteresis). */
export const PAUSE_VISIBILITY_RATIO = 0.15
/** Detach HLS after paused off-screen for this long (ms). */
export const HLS_DETACH_DELAY_MS = 2000
/** Stagger autoplay starts to avoid segment-fetch stampedes (ms). */
export const PLAY_STAGGER_MS = 75

export type VideoPlaybackMode = 'feed' | 'detail' | 'preview' | 'thumbnail'

export const MODE_PRIORITY: Record<VideoPlaybackMode, number> = {
  preview: 4,
  detail: 3,
  thumbnail: 2,
  feed: 1,
}

/** Safari/iOS plays HLS natively — skip loading hls.js (faster cold start, incl. Low Power Mode). */
export function supportsNativeHls(video?: HTMLVideoElement | null): boolean {
  if (typeof document === 'undefined') return false
  const el = video ?? document.createElement('video')
  return Boolean(el.canPlayType('application/vnd.apple.mpegurl'))
}

export function getTotalMemoryBudgetBytes(): number {
  if (typeof navigator === 'undefined') return 96 * 1024 * 1024
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  if (conn?.saveData) return 32 * 1024 * 1024
  if (conn?.effectiveType === '2g' || conn?.effectiveType === 'slow-2g') return 32 * 1024 * 1024
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  if (memory != null && memory <= 4) return 48 * 1024 * 1024
  if (typeof window !== 'undefined' && window.innerWidth < 720) return 48 * 1024 * 1024
  return 96 * 1024 * 1024
}

export function getPerVideoBufferBytes(visibleAutoplayCount: number): number {
  const budget = getTotalMemoryBudgetBytes()
  const count = Math.max(1, visibleAutoplayCount)
  const perVideo = Math.floor(budget / count)
  const min = 4 * 1024 * 1024
  const max = 12 * 1024 * 1024
  return Math.min(max, Math.max(min, perVideo))
}

export function buildHlsConfig(visibleAutoplayCount: number): Partial<HlsConfig> {
  const bufferBytes = getPerVideoBufferBytes(visibleAutoplayCount)
  const manyVisible = visibleAutoplayCount >= 4
  const crowded = visibleAutoplayCount >= 7

  return {
    maxBufferLength: crowded ? 5 : manyVisible ? 8 : 15,
    maxMaxBufferLength: crowded ? 15 : manyVisible ? 20 : 30,
    maxBufferSize: bufferBytes,
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: crowded ? 3 : 5,
    maxBufferHole: 0.5,
    capLevelToPlayerSize: manyVisible,
    abrEwmaDefaultEstimate: 500000,
    abrEwmaFastLive: 3,
    abrEwmaSlowLive: 9,
    abrEwmaFastVoD: 3,
    abrEwmaSlowVoD: 9,
    fragLoadPolicy: {
      default: {
        maxTimeToFirstByteMs: 10000,
        maxLoadTimeMs: 20000,
        timeoutRetry: {
          maxNumRetry: 2,
          retryDelayMs: 1000,
          maxRetryDelayMs: 5000,
        },
        errorRetry: {
          maxNumRetry: 2,
          retryDelayMs: 1000,
          maxRetryDelayMs: 5000,
        },
      },
    },
  }
}
