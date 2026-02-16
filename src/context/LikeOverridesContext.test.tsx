import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { LikeOverridesProvider, useLikeOverrides } from './LikeOverridesContext'

describe('LikeOverridesContext', () => {
  it('should provide initial empty cache', () => {
    const { result } = renderHook(() => useLikeOverrides(), {
      wrapper: LikeOverridesProvider,
    })

    expect(result.current.likeOverrides).toEqual({})
  })

  it('should set like override for a post', () => {
    const { result } = renderHook(() => useLikeOverrides(), {
      wrapper: LikeOverridesProvider,
    })

    act(() => {
      result.current.setLikeOverride('post-uri-1', 'like-uri-1')
    })

    expect(result.current.likeOverrides['post-uri-1']).toBe('like-uri-1')
  })

  it('should set unlike override (null) for a post', () => {
    const { result } = renderHook(() => useLikeOverrides(), {
      wrapper: LikeOverridesProvider,
    })

    // First like the post
    act(() => {
      result.current.setLikeOverride('post-uri-1', 'like-uri-1')
    })

    // Then unlike it
    act(() => {
      result.current.setLikeOverride('post-uri-1', null)
    })

    expect(result.current.likeOverrides['post-uri-1']).toBe(null)
  })

  it('should get like override for a post', () => {
    const { result } = renderHook(() => useLikeOverrides(), {
      wrapper: LikeOverridesProvider,
    })

    act(() => {
      result.current.setLikeOverride('post-uri-1', 'like-uri-1')
    })

    expect(result.current.getLikeOverride('post-uri-1')).toBe('like-uri-1')
  })

  it('should return undefined for non-existent post', () => {
    const { result } = renderHook(() => useLikeOverrides(), {
      wrapper: LikeOverridesProvider,
    })

    expect(result.current.getLikeOverride('non-existent')).toBeUndefined()
  })

  it('should handle multiple posts independently', () => {
    const { result } = renderHook(() => useLikeOverrides(), {
      wrapper: LikeOverridesProvider,
    })

    act(() => {
      result.current.setLikeOverride('post-uri-1', 'like-uri-1')
      result.current.setLikeOverride('post-uri-2', 'like-uri-2')
      result.current.setLikeOverride('post-uri-3', null)
    })

    expect(result.current.likeOverrides['post-uri-1']).toBe('like-uri-1')
    expect(result.current.likeOverrides['post-uri-2']).toBe('like-uri-2')
    expect(result.current.likeOverrides['post-uri-3']).toBe(null)
  })

  it('should update existing like override', () => {
    const { result } = renderHook(() => useLikeOverrides(), {
      wrapper: LikeOverridesProvider,
    })

    act(() => {
      result.current.setLikeOverride('post-uri-1', 'like-uri-1')
    })

    expect(result.current.likeOverrides['post-uri-1']).toBe('like-uri-1')

    act(() => {
      result.current.setLikeOverride('post-uri-1', 'like-uri-2')
    })

    expect(result.current.likeOverrides['post-uri-1']).toBe('like-uri-2')
  })

  it('should clear all like overrides', () => {
    const { result } = renderHook(() => useLikeOverrides(), {
      wrapper: LikeOverridesProvider,
    })

    act(() => {
      result.current.setLikeOverride('post-uri-1', 'like-uri-1')
      result.current.setLikeOverride('post-uri-2', 'like-uri-2')
    })

    expect(Object.keys(result.current.likeOverrides).length).toBe(2)

    act(() => {
      result.current.clearLikeOverrides()
    })

    expect(result.current.likeOverrides).toEqual({})
  })

  it('should throw error when used outside provider', () => {
    expect(() => {
      renderHook(() => useLikeOverrides())
    }).toThrow('useLikeOverrides must be used within a LikeOverridesProvider')
  })

  it('should maintain referential stability for callback functions', () => {
    const { result, rerender } = renderHook(() => useLikeOverrides(), {
      wrapper: LikeOverridesProvider,
    })

    const setLikeOverride1 = result.current.setLikeOverride
    const getLikeOverride1 = result.current.getLikeOverride
    const clearLikeOverrides1 = result.current.clearLikeOverrides

    // Trigger a re-render by setting a value
    act(() => {
      result.current.setLikeOverride('post-uri-1', 'like-uri-1')
    })

    rerender()

    // Functions should maintain referential equality
    expect(result.current.setLikeOverride).toBe(setLikeOverride1)
    expect(result.current.clearLikeOverrides).toBe(clearLikeOverrides1)
    // Note: getLikeOverride depends on likeOverrides, so it will change
  })
})
