import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  registerVideoSession,
  unregisterVideoSession,
  updateVideoVisibility,
  setFeedSuspendReason,
  setVideoPlaying,
  setVideoHlsAttached,
  resetVideoPlaybackManager,
  isFeedSuspended,
} from './videoPlaybackManager'

describe('videoPlaybackManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetVideoPlaybackManager()
  })

  afterEach(() => {
    vi.useRealTimers()
    resetVideoPlaybackManager()
  })

  it('plays feed video when visible and not suspended', () => {
    const onPlay = vi.fn()
    const onPause = vi.fn()
    registerVideoSession('a', 'feed', true, {
      onPlay,
      onPause,
      onAttach: vi.fn(),
      onDetach: vi.fn(),
    })
    updateVideoVisibility('a', 0.6, true)
    vi.runAllTimers()
    expect(onPlay).toHaveBeenCalled()
  })

  it('pauses feed video when modal suspend is active', () => {
    const onPlay = vi.fn()
    const onPause = vi.fn()
    registerVideoSession('a', 'feed', true, {
      onPlay,
      onPause,
      onAttach: vi.fn(),
      onDetach: vi.fn(),
    })
    updateVideoVisibility('a', 0.8, true)
    vi.runAllTimers()
    onPlay.mockClear()

    setVideoPlaying('a', true)
    setFeedSuspendReason('content-modal', true)
    expect(isFeedSuspended()).toBe(true)
    expect(onPause).toHaveBeenCalled()
    expect(onPlay).not.toHaveBeenCalled()
  })

  it('does not pause detail video when feed is suspended', () => {
    const onPlay = vi.fn()
    const onPause = vi.fn()
    registerVideoSession('detail', 'detail', true, {
      onPlay,
      onPause,
      onAttach: vi.fn(),
      onDetach: vi.fn(),
    })
    setFeedSuspendReason('content-modal', true)
    updateVideoVisibility('detail', 0.8, true)
    vi.runAllTimers()
    expect(onPlay).toHaveBeenCalled()
    expect(onPause).not.toHaveBeenCalled()
  })

  it('prioritizes preview mode over feed when both eligible', () => {
    const order: string[] = []
    registerVideoSession('feed', 'feed', true, {
      onPlay: () => order.push('feed'),
      onPause: vi.fn(),
      onAttach: vi.fn(),
      onDetach: vi.fn(),
    })
    registerVideoSession('preview', 'preview', true, {
      onPlay: () => order.push('preview'),
      onPause: vi.fn(),
      onAttach: vi.fn(),
      onDetach: vi.fn(),
    })
    updateVideoVisibility('feed', 0.9, true)
    updateVideoVisibility('preview', 0.7, true)
    vi.runAllTimers()
    expect(order[0]).toBe('preview')
    expect(order[1]).toBe('feed')
  })

  it('reconciles play when HLS attach completes while visible', () => {
    const onPlay = vi.fn()
    registerVideoSession('a', 'feed', true, {
      onPlay,
      onPause: vi.fn(),
      onAttach: vi.fn(),
      onDetach: vi.fn(),
    })
    updateVideoVisibility('a', 0.6, true)
    vi.runAllTimers()
    onPlay.mockClear()

    setVideoHlsAttached('a', true)
    vi.runAllTimers()
    expect(onPlay).toHaveBeenCalled()
  })

  it('cleans up on unregister', () => {
    const onPlay = vi.fn()
    registerVideoSession('x', 'feed', true, {
      onPlay,
      onPause: vi.fn(),
      onAttach: vi.fn(),
      onDetach: vi.fn(),
    })
    unregisterVideoSession('x')
    updateVideoVisibility('x', 1, true)
    vi.runAllTimers()
    expect(onPlay).not.toHaveBeenCalled()
  })
})
