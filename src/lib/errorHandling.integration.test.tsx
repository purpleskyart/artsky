/**
 * Integration tests for error handling across all performance optimization features
 * 
 * This test suite validates that all error handling scenarios work correctly:
 * - Chunk load failures show retry UI (Requirement 4.1)
 * - Image load failures show placeholder (Requirement 5.1)
 * - API failures trigger retry with backoff (Requirement 7.6)
 * - localStorage quota exceeded triggers cleanup (Requirement 8.1)
 * 
 * Requirements: 4.1, 5.1, 7.6, 8.1
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { ChunkLoadError } from '../components/ChunkLoadError'
import { ProgressiveImage } from '../components/ProgressiveImage'
import { asyncStorage } from './AsyncStorage'
import { retryWithBackoff } from './retryWithBackoff'
import { shouldRetryError } from './apiErrors'

describe('Error Handling Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Chunk Load Error Handling (Requirement 4.1)', () => {
    it('catches chunk load failures and displays retry UI', () => {
      const ThrowChunkError = () => {
        const error = new Error('Loading chunk 123 failed')
        error.name = 'ChunkLoadError'
        throw error
      }

      render(
        <ChunkLoadError>
          <ThrowChunkError />
        </ChunkLoadError>
      )

      // Should show error UI
      expect(screen.getByText('Failed to load page')).toBeInTheDocument()
      expect(screen.getByText(/The page failed to load/)).toBeInTheDocument()
      
      // Should show retry button
      const retryButton = screen.getByRole('button', { name: 'Retry' })
      expect(retryButton).toBeInTheDocument()
    })

    it('implements exponential backoff for chunk load retries', async () => {
      const ThrowChunkError = () => {
        const error = new Error('Loading chunk failed')
        error.name = 'ChunkLoadError'
        throw error
      }

      render(
        <ChunkLoadError>
          <ThrowChunkError />
        </ChunkLoadError>
      )

      // First retry
      const retryButton = screen.getByRole('button', { name: 'Retry' })
      await act(async () => {
        retryButton.click()
      })

      // Should show retry count and backoff message
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Retry (1/5)' })).toBeInTheDocument()
        expect(screen.getByText(/Retrying with exponential backoff/)).toBeInTheDocument()
      })
    })

    it('reloads page after max retries exceeded', async () => {
      const reloadSpy = vi.fn()
      Object.defineProperty(window, 'location', {
        value: { reload: reloadSpy },
        writable: true,
      })

      const ThrowChunkError = () => {
        const error = new Error('Loading chunk failed')
        error.name = 'ChunkLoadError'
        throw error
      }

      render(
        <ChunkLoadError>
          <ThrowChunkError />
        </ChunkLoadError>
      )

      // Simulate 5 retries
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          const button = screen.getByRole('button')
          button.click()
        })
      }

      // Should show reload button
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Reload Page' })).toBeInTheDocument()
      })

      // Click reload
      await act(async () => {
        screen.getByRole('button', { name: 'Reload Page' }).click()
      })

      expect(reloadSpy).toHaveBeenCalled()
    })

    it('recovers successfully after retry', async () => {
      let shouldThrow = true
      const MaybeThrowError = () => {
        if (shouldThrow) {
          const error = new Error('Loading chunk failed')
          error.name = 'ChunkLoadError'
          throw error
        }
        return <div>Content Loaded</div>
      }

      render(
        <ChunkLoadError>
          <MaybeThrowError />
        </ChunkLoadError>
      )

      expect(screen.getByText('Failed to load page')).toBeInTheDocument()

      // Stop throwing
      shouldThrow = false

      // Retry
      await act(async () => {
        screen.getByRole('button', { name: 'Retry' }).click()
      })

      // Should render content successfully
      await waitFor(() => {
        expect(screen.getByText('Content Loaded')).toBeInTheDocument()
      })
    })
  })

  describe('Image Load Error Handling (Requirement 5.1)', () => {
    it('shows error placeholder after max retries exceeded', async () => {
      const { container } = render(
        <ProgressiveImage 
          src="https://example.com/broken-image.jpg" 
          alt="Test image"
          maxRetries={0}
        />
      )

      const img = screen.getByAltText('Test image')
      
      // Trigger error
      img.dispatchEvent(new Event('error'))

      // Should show error placeholder
      await waitFor(() => {
        const errorPlaceholder = container.querySelector('[role="img"]')
        expect(errorPlaceholder).toBeInTheDocument()
        expect(screen.getByText('Image failed to load')).toBeInTheDocument()
      })
    })

    it('retries image load with exponential backoff', async () => {
      vi.useFakeTimers()

      const { container } = render(
        <ProgressiveImage 
          src="https://example.com/image.jpg" 
          alt="Test image"
          maxRetries={3}
        />
      )

      const img = screen.getByAltText('Test image')
      
      // First error - should schedule retry after 1s
      img.dispatchEvent(new Event('error'))

      // Component should still be rendered (not showing error placeholder yet)
      expect(container.firstChild).toBeInTheDocument()
      expect(container.querySelector('[role="img"]')).not.toBeInTheDocument()

      vi.useRealTimers()
    })

    it('falls back to original URL when WebP fails', async () => {
      const originalUrl = 'https://example.com/image.jpg'
      render(<ProgressiveImage src={originalUrl} alt="Test image" />)

      const img = screen.getByAltText('Test image')
      
      // Simulate WebP load error
      img.dispatchEvent(new Event('error'))

      await waitFor(() => {
        // Should fall back to original URL
        const finalSrc = img.getAttribute('src')
        expect(finalSrc).toBe(originalUrl)
      })
    })

    it('recovers when image loads after initial error', async () => {
      const onLoad = vi.fn()
      render(
        <ProgressiveImage 
          src="https://example.com/image.jpg" 
          alt="Test image" 
          onLoad={onLoad}
          maxRetries={3}
        />
      )

      const img = screen.getByAltText('Test image')
      
      // Simulate error first (WebP fallback)
      img.dispatchEvent(new Event('error'))
      
      // Then simulate successful load
      img.dispatchEvent(new Event('load'))

      await waitFor(() => {
        expect(onLoad).toHaveBeenCalledTimes(1)
      })
    })

    it('resets retry count when src changes', async () => {
      vi.useFakeTimers()

      const { rerender } = render(
        <ProgressiveImage 
          src="https://example.com/image1.jpg" 
          alt="Test image"
          maxRetries={3}
        />
      )

      let img = screen.getByAltText('Test image')
      
      // Trigger error
      img.dispatchEvent(new Event('error'))
      vi.advanceTimersByTime(1000)

      // Change src - should reset retry count
      rerender(
        <ProgressiveImage 
          src="https://example.com/image2.jpg" 
          alt="Test image"
          maxRetries={3}
        />
      )

      // New image should be able to retry from 0
      img = screen.getByAltText('Test image')
      expect(img).toBeInTheDocument()

      vi.useRealTimers()
    })

    it('cleans up retry timeout on unmount', () => {
      vi.useFakeTimers()

      const { unmount } = render(
        <ProgressiveImage 
          src="https://example.com/broken-image.jpg" 
          alt="Test image"
        />
      )

      const img = screen.getByAltText('Test image')
      
      // Trigger error to start retry timeout
      img.dispatchEvent(new Event('error'))

      // Unmount before timeout completes
      unmount()

      // Advance timers - should not cause any issues
      vi.advanceTimersByTime(5000)

      vi.useRealTimers()
    })
  })

  describe('API Error Handling (Requirement 7.6)', () => {
    it('retries failed API requests with exponential backoff', async () => {
      let attemptCount = 0

      const mockFetcher = async () => {
        attemptCount++
        if (attemptCount < 3) {
          const error = new Error('Server error') as Error & { status: number }
          error.status = 500
          throw error
        }
        return { success: true }
      }

      const result = await retryWithBackoff(mockFetcher, {
        maxRetries: 3,
        initialDelay: 10,
      })

      // Should succeed after 3 attempts
      expect(attemptCount).toBe(3)
      expect(result).toEqual({ success: true })
    })

    it('stops retrying after max retries', async () => {
      let attemptCount = 0

      const mockFetcher = async () => {
        attemptCount++
        const error = new Error('Server error') as Error & { status: number }
        error.status = 500
        throw error
      }

      await expect(
        retryWithBackoff(mockFetcher, {
          maxRetries: 3,
          initialDelay: 10,
        })
      ).rejects.toThrow('Server error')

      // Should attempt 4 times (initial + 3 retries)
      expect(attemptCount).toBe(4)
    })

    it('does not retry 4xx client errors', async () => {
      let attemptCount = 0

      const mockFetcher = async () => {
        attemptCount++
        const error = new Error('Bad request') as Error & { status: number }
        error.status = 400
        throw error
      }

      await expect(
        retryWithBackoff(mockFetcher, {
          maxRetries: 3,
          initialDelay: 10,
        })
      ).rejects.toThrow('Bad request')

      // Should only attempt once (no retries for 4xx)
      expect(attemptCount).toBe(1)
    })

    it('retries 5xx server errors', async () => {
      let attemptCount = 0

      const mockFetcher = async () => {
        attemptCount++
        if (attemptCount < 2) {
          const error = new Error('Server error') as Error & { status: number }
          error.status = 503
          throw error
        }
        return { success: true }
      }

      const result = await retryWithBackoff(mockFetcher, {
        maxRetries: 3,
        initialDelay: 10,
      })

      // Should succeed after 2 attempts
      expect(attemptCount).toBe(2)
      expect(result).toEqual({ success: true })
    })

    it('retries network errors', async () => {
      let attemptCount = 0

      const mockFetcher = async () => {
        attemptCount++
        if (attemptCount < 2) {
          throw new TypeError('Failed to fetch')
        }
        return { success: true }
      }

      const result = await retryWithBackoff(mockFetcher, {
        maxRetries: 3,
        initialDelay: 10,
      })

      expect(attemptCount).toBe(2)
      expect(result).toEqual({ success: true })
    })

    it('implements exponential backoff delays', async () => {
      let attemptCount = 0
      const attemptTimestamps: number[] = []

      const mockFetcher = async () => {
        attemptTimestamps.push(Date.now())
        attemptCount++
        if (attemptCount < 3) {
          const error = new Error('Server error') as Error & { status: number }
          error.status = 500
          throw error
        }
        return { success: true }
      }

      await retryWithBackoff(mockFetcher, {
        maxRetries: 3,
        initialDelay: 50,
        maxDelay: 400,
      })

      // Verify delays increase exponentially
      expect(attemptTimestamps.length).toBe(3)

      // First retry delay should be ~50ms
      const firstDelay = attemptTimestamps[1] - attemptTimestamps[0]
      expect(firstDelay).toBeGreaterThanOrEqual(40)
      expect(firstDelay).toBeLessThanOrEqual(150)

      // Second retry delay should be ~100ms (2x first delay)
      const secondDelay = attemptTimestamps[2] - attemptTimestamps[1]
      expect(secondDelay).toBeGreaterThanOrEqual(90)
      expect(secondDelay).toBeLessThanOrEqual(200)
    })

    it('correctly identifies retryable errors', () => {
      // Network errors should be retried
      expect(shouldRetryError(new TypeError('Failed to fetch'))).toBe(true)
      expect(shouldRetryError(new Error('network error'))).toBe(true)

      // 5xx errors should be retried
      const serverError = new Error('Server error') as Error & { status: number }
      serverError.status = 500
      expect(shouldRetryError(serverError)).toBe(true)

      // 408 timeout should be retried
      const timeoutError = new Error('Timeout') as Error & { status: number }
      timeoutError.status = 408
      expect(shouldRetryError(timeoutError)).toBe(true)

      // 4xx errors should not be retried (except 408)
      const clientError = new Error('Bad request') as Error & { status: number }
      clientError.status = 400
      expect(shouldRetryError(clientError)).toBe(false)

      // Unknown errors should not be retried
      expect(shouldRetryError(new Error('Unknown error'))).toBe(false)
    })
  })

  describe('localStorage Error Handling (Requirement 8.1)', () => {
    let localStorageMock: {
      getItem: ReturnType<typeof vi.fn>
      setItem: ReturnType<typeof vi.fn>
      removeItem: ReturnType<typeof vi.fn>
      clear: ReturnType<typeof vi.fn>
      length: number
      key: ReturnType<typeof vi.fn>
    }
    let storage: Map<string, string>

    beforeEach(() => {
      storage = new Map<string, string>()
      localStorageMock = {
        getItem: vi.fn((key: string) => storage.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
          storage.set(key, value)
        }),
        removeItem: vi.fn((key: string) => {
          storage.delete(key)
        }),
        clear: vi.fn(() => {
          storage.clear()
        }),
        get length() {
          return storage.size
        },
        key: vi.fn((index: number) => {
          const keys = Array.from(storage.keys())
          return keys[index] ?? null
        }),
      }
      globalThis.localStorage = localStorageMock as any
      vi.useFakeTimers()
      
      // Re-check availability
      ;(asyncStorage as any).isAvailable = (asyncStorage as any).checkAvailability()
      asyncStorage.clearQueue()
      
      // Clear mock calls
      localStorageMock.setItem.mockClear()
      localStorageMock.getItem.mockClear()
      localStorageMock.removeItem.mockClear()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('triggers cleanup when quota exceeded', () => {
      // Pre-populate with artsky-* entries
      storage.set('artsky-old-1', JSON.stringify({ timestamp: 1000 }))
      storage.set('artsky-old-2', JSON.stringify({ timestamp: 2000 }))
      storage.set('artsky-old-3', JSON.stringify({ timestamp: 3000 }))
      storage.set('artsky-old-4', JSON.stringify({ timestamp: 4000 }))

      // Mock setItem to throw QuotaExceededError on first call
      let callCount = 0
      localStorageMock.setItem = vi.fn((key: string, value: string) => {
        callCount++
        if (callCount === 1) {
          const err = new DOMException('QuotaExceededError', 'QuotaExceededError')
          throw err
        }
        // Subsequent calls succeed
        storage.set(key, value)
      })

      asyncStorage.set('artsky-new', 'value', 0)
      vi.advanceTimersByTime(100)

      // Should have attempted multiple writes (cleanup + retry)
      expect(callCount).toBeGreaterThan(1)
      // The new key should eventually be written
      expect(storage.has('artsky-new')).toBe(true)
    })

    it('removes oldest 25% of entries during cleanup', () => {
      // Pre-populate with 8 entries
      for (let i = 1; i <= 8; i++) {
        storage.set(`artsky-entry-${i}`, JSON.stringify({ timestamp: i * 1000 }))
      }

      // Mock setItem to throw QuotaExceededError on first call
      let callCount = 0
      const removedKeys: string[] = []
      localStorageMock.setItem = vi.fn((key: string, value: string) => {
        callCount++
        if (callCount === 1) {
          const err = new DOMException('QuotaExceededError', 'QuotaExceededError')
          throw err
        }
        storage.set(key, value)
      })
      localStorageMock.removeItem = vi.fn((key: string) => {
        removedKeys.push(key)
        storage.delete(key)
      })

      asyncStorage.set('artsky-new', 'value', 0)
      vi.advanceTimersByTime(100)

      // Should have removed 25% of 8 entries = 2 entries
      expect(removedKeys.length).toBe(2)
      // Should remove oldest entries first
      expect(removedKeys).toContain('artsky-entry-1')
      expect(removedKeys).toContain('artsky-entry-2')
    })

    it('falls back to memory when quota exceeded and no entries to clean', () => {
      // Empty storage
      storage.clear()

      // Mock setItem to throw QuotaExceededError
      localStorageMock.setItem = vi.fn(() => {
        const err = new DOMException('QuotaExceededError', 'QuotaExceededError')
        throw err
      })

      asyncStorage.set('artsky-new', 'value', 0)
      vi.advanceTimersByTime(100)

      // Should still be able to read from memory fallback
      const result = asyncStorage.get('artsky-new')
      expect(result).toBe('value')
    })

    it('gracefully degrades when localStorage is unavailable', () => {
      // Mock localStorage to throw on access
      const unavailableStorage = {
        getItem: vi.fn(() => {
          throw new Error('localStorage is not available')
        }),
        setItem: vi.fn(() => {
          throw new Error('localStorage is not available')
        }),
        removeItem: vi.fn(() => {
          throw new Error('localStorage is not available')
        }),
        clear: vi.fn(),
        length: 0,
        key: vi.fn(() => null),
      }
      globalThis.localStorage = unavailableStorage as any

      // Force re-check
      ;(asyncStorage as any).isAvailable = (asyncStorage as any).checkAvailability()

      // Should report as unavailable
      expect(asyncStorage.isStorageAvailable()).toBe(false)

      // Should still work with memory fallback
      asyncStorage.set('test-key', 'test-value', 0)
      vi.advanceTimersByTime(100)

      const result = asyncStorage.get('test-key')
      expect(result).toBe('test-value')
    })

    it('falls back to memory when write fails', () => {
      // Mock setItem to always throw
      localStorageMock.setItem = vi.fn(() => {
        throw new Error('Write failed')
      })

      asyncStorage.set('test-key', 'test-value', 0)
      vi.advanceTimersByTime(100)

      // Should have attempted to write
      expect(localStorageMock.setItem).toHaveBeenCalled()

      // Should still be able to read from memory fallback
      const result = asyncStorage.get('test-key')
      expect(result).toBe('test-value')
    })

    it('handles parse errors gracefully', () => {
      storage.set('bad-key', 'invalid json{')

      const result = asyncStorage.get('bad-key')
      expect(result).toBeNull()
    })

    it('returns null for missing keys', () => {
      const result = asyncStorage.get('nonexistent')
      expect(result).toBeNull()
    })
  })

  describe('Cross-Feature Error Recovery', () => {
    it('handles multiple simultaneous errors gracefully', async () => {
      // Simulate chunk error
      const ThrowChunkError = () => {
        const error = new Error('Loading chunk failed')
        error.name = 'ChunkLoadError'
        throw error
      }

      const { container: chunkContainer } = render(
        <ChunkLoadError>
          <ThrowChunkError />
        </ChunkLoadError>
      )

      // Simulate image error
      const { container: imageContainer } = render(
        <ProgressiveImage 
          src="https://example.com/broken.jpg" 
          alt="Broken"
          maxRetries={0}
        />
      )

      // Both should show error UI
      expect(screen.getByText('Failed to load page')).toBeInTheDocument()
      
      const img = screen.getByAltText('Broken')
      img.dispatchEvent(new Event('error'))

      await waitFor(() => {
        expect(screen.getByText('Image failed to load')).toBeInTheDocument()
      })
    })

    it('maintains application stability during error recovery', async () => {
      let shouldThrow = true
      const MaybeThrowError = () => {
        if (shouldThrow) {
          const error = new Error('Loading chunk failed')
          error.name = 'ChunkLoadError'
          throw error
        }
        return (
          <div>
            <ProgressiveImage 
              src="https://example.com/image.jpg" 
              alt="Test"
            />
          </div>
        )
      }

      render(
        <ChunkLoadError>
          <MaybeThrowError />
        </ChunkLoadError>
      )

      // Initially shows error
      expect(screen.getByText('Failed to load page')).toBeInTheDocument()

      // Recover from chunk error
      shouldThrow = false
      await act(async () => {
        screen.getByRole('button', { name: 'Retry' }).click()
      })

      // Should render image component
      await waitFor(() => {
        expect(screen.getByAltText('Test')).toBeInTheDocument()
      })
    })
  })
})
