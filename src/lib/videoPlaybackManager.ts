import {
  MODE_PRIORITY,
  PAUSE_VISIBILITY_RATIO,
  PLAY_STAGGER_MS,
  PLAY_VISIBILITY_RATIO,
  HLS_DETACH_DELAY_MS,
  type VideoPlaybackMode,
} from './videoHlsConfig'

export type { VideoPlaybackMode } from './videoHlsConfig'
export {
  PLAY_VISIBILITY_RATIO,
  PAUSE_VISIBILITY_RATIO,
  HLS_DETACH_DELAY_MS,
} from './videoHlsConfig'

type SessionCallbacks = {
  onPlay: () => void
  onPause: () => void
  onAttach: () => void
  onDetach: () => void
}

type VideoSession = {
  id: string
  mode: VideoPlaybackMode
  autoPlay: boolean
  intersectionRatio: number
  nearViewport: boolean
  isPlaying: boolean
  wantsPlay: boolean
  hlsAttached: boolean
  callbacks: SessionCallbacks
  detachTimer: ReturnType<typeof setTimeout> | null
  playStaggerTimer: ReturnType<typeof setTimeout> | null
}

const sessions = new Map<string, VideoSession>()
const feedSuspendReasons = new Set<string>()
let staggerGeneration = 0

export function setFeedSuspendReason(reason: string, active: boolean): void {
  if (active) feedSuspendReasons.add(reason)
  else feedSuspendReasons.delete(reason)
  reconcile()
}

export function isFeedSuspended(): boolean {
  return feedSuspendReasons.size > 0
}

export function registerVideoSession(
  id: string,
  mode: VideoPlaybackMode,
  autoPlay: boolean,
  callbacks: SessionCallbacks,
): void {
  sessions.set(id, {
    id,
    mode,
    autoPlay,
    intersectionRatio: 0,
    nearViewport: false,
    isPlaying: false,
    wantsPlay: false,
    hlsAttached: false,
    callbacks,
    detachTimer: null,
    playStaggerTimer: null,
  })
  reconcile()
}

export function unregisterVideoSession(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  clearSessionTimers(session)
  sessions.delete(id)
}

export function updateVideoVisibility(
  id: string,
  intersectionRatio: number,
  nearViewport: boolean,
): void {
  const session = sessions.get(id)
  if (!session) return
  session.intersectionRatio = intersectionRatio
  session.nearViewport = nearViewport
  reconcile()
}

export function setVideoHlsAttached(id: string, attached: boolean): void {
  const session = sessions.get(id)
  if (!session) return
  if (session.hlsAttached === attached) return
  session.hlsAttached = attached
  reconcile()
}

/** Retry autoplay after media becomes ready or a programmatic play() was blocked. */
export function retryAutoplayIfWanted(id: string): void {
  const session = sessions.get(id)
  if (!session || !session.wantsPlay || session.isPlaying) return
  reconcile()
}

export function setVideoPlaying(id: string, playing: boolean): void {
  const session = sessions.get(id)
  if (!session) return
  session.isPlaying = playing
}

export function getVisibleAutoplayCount(): number {
  let count = 0
  for (const session of sessions.values()) {
    if (
      session.autoPlay &&
      session.intersectionRatio >= PLAY_VISIBILITY_RATIO &&
      shouldSessionBeEligible(session)
    ) {
      count++
    }
  }
  return count
}

function clearSessionTimers(session: VideoSession): void {
  if (session.detachTimer != null) {
    clearTimeout(session.detachTimer)
    session.detachTimer = null
  }
  if (session.playStaggerTimer != null) {
    clearTimeout(session.playStaggerTimer)
    session.playStaggerTimer = null
  }
}

function shouldSessionBeEligible(session: VideoSession): boolean {
  if (session.mode === 'feed' && isFeedSuspended()) return false
  return true
}

function shouldAttachHls(session: VideoSession): boolean {
  return session.nearViewport || session.intersectionRatio >= PAUSE_VISIBILITY_RATIO
}

function shouldPlay(session: VideoSession): boolean {
  if (!session.autoPlay) return false
  if (!shouldSessionBeEligible(session)) return false
  return session.intersectionRatio >= PLAY_VISIBILITY_RATIO
}

function shouldPause(session: VideoSession): boolean {
  if (!session.autoPlay) return false
  if (session.mode === 'feed' && isFeedSuspended()) return true
  return session.intersectionRatio < PAUSE_VISIBILITY_RATIO
}

function scheduleDetach(session: VideoSession): void {
  if (session.detachTimer != null) return
  session.detachTimer = setTimeout(() => {
    session.detachTimer = null
    if (session.hlsAttached && session.intersectionRatio < PAUSE_VISIBILITY_RATIO && !session.nearViewport) {
      session.callbacks.onDetach()
    }
  }, HLS_DETACH_DELAY_MS)
}

function cancelDetach(session: VideoSession): void {
  if (session.detachTimer != null) {
    clearTimeout(session.detachTimer)
    session.detachTimer = null
  }
}

function reconcile(): void {
  staggerGeneration++
  const generation = staggerGeneration

  const playCandidates: VideoSession[] = []
  for (const session of sessions.values()) {
    clearSessionTimers(session)

    const attach = shouldAttachHls(session)
    if (attach && !session.hlsAttached) {
      session.callbacks.onAttach()
    } else if (!attach && session.hlsAttached && session.intersectionRatio < PAUSE_VISIBILITY_RATIO) {
      scheduleDetach(session)
    } else if (attach) {
      cancelDetach(session)
    }

    if (shouldPause(session)) {
      session.wantsPlay = false
      session.callbacks.onPause()
    } else if (shouldPlay(session)) {
      session.wantsPlay = true
      playCandidates.push(session)
    } else {
      session.wantsPlay = false
    }
  }

  playCandidates.sort((a, b) => {
    const priorityDiff = MODE_PRIORITY[b.mode] - MODE_PRIORITY[a.mode]
    if (priorityDiff !== 0) return priorityDiff
    return b.intersectionRatio - a.intersectionRatio
  })

  playCandidates.forEach((session, index) => {
    if (session.isPlaying) return
    const delay = index * PLAY_STAGGER_MS
    session.playStaggerTimer = setTimeout(() => {
      session.playStaggerTimer = null
      if (generation !== staggerGeneration) return
      const current = sessions.get(session.id)
      if (!current || !current.wantsPlay || current.isPlaying) return
      current.callbacks.onPlay()
    }, delay)
  })
}

/** Reset all state (for tests and page unload). */
export function resetVideoPlaybackManager(): void {
  for (const session of sessions.values()) {
    clearSessionTimers(session)
  }
  sessions.clear()
  feedSuspendReasons.clear()
  staggerGeneration = 0
}
