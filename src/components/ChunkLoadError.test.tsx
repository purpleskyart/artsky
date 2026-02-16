import { render, screen, waitFor, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { ChunkLoadError } from './ChunkLoadError'

describe('ChunkLoadError', () => {
  beforeEach(() => {
    // Don't use fake timers by default - only in specific tests
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should render children when no error occurs', () => {
    render(
      <ChunkLoadError>
        <div>Test Content</div>
      </ChunkLoadError>
    )

    expect(screen.getByText('Test Content')).toBeInTheDocument()
  })

  it('should catch chunk load errors and display retry UI', () => {
    const ThrowError = () => {
      const error = new Error('Loading chunk 123 failed')
      error.name = 'ChunkLoadError'
      throw error
    }

    render(
      <ChunkLoadError>
        <ThrowError />
      </ChunkLoadError>
    )

    expect(screen.getByText('Failed to load page')).toBeInTheDocument()
    expect(screen.getByText(/The page failed to load/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('should catch dynamic import errors', () => {
    const ThrowError = () => {
      throw new Error('Failed to fetch dynamically imported module')
    }

    render(
      <ChunkLoadError>
        <ThrowError />
      </ChunkLoadError>
    )

    expect(screen.getByText('Failed to load page')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('should not catch non-chunk errors (let them bubble up)', () => {
    const ThrowError = () => {
      throw new Error('Some other error')
    }

    // This should throw and not be caught by ChunkLoadError
    expect(() => {
      render(
        <ChunkLoadError>
          <ThrowError />
        </ChunkLoadError>
      )
    }).toThrow('Some other error')
  })

  it('should reset error state when retry button is clicked', async () => {
    let shouldThrow = true
    const MaybeThrowError = () => {
      if (shouldThrow) {
        const error = new Error('Loading chunk 456 failed')
        error.name = 'ChunkLoadError'
        throw error
      }
      return <div>Success!</div>
    }

    render(
      <ChunkLoadError>
        <MaybeThrowError />
      </ChunkLoadError>
    )

    expect(screen.getByText('Failed to load page')).toBeInTheDocument()

    // Stop throwing error
    shouldThrow = false

    // Click retry
    const retryButton = screen.getByRole('button', { name: 'Retry' })
    
    await act(async () => {
      retryButton.click()
    })

    // Should render children successfully after retry
    await waitFor(() => {
      expect(screen.getByText('Success!')).toBeInTheDocument()
    })
  })

  it('should show retry count after first retry', async () => {
    const ThrowError = () => {
      const error = new Error('Loading chunk 789 failed')
      error.name = 'ChunkLoadError'
      throw error
    }

    render(
      <ChunkLoadError>
        <ThrowError />
      </ChunkLoadError>
    )

    // First retry
    const retryButton = screen.getByRole('button', { name: 'Retry' })
    
    await act(async () => {
      retryButton.click()
    })

    // After first retry, should show count and backoff message
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry (1/5)' })).toBeInTheDocument()
      expect(screen.getByText(/Retrying with exponential backoff/)).toBeInTheDocument()
    })
  })

  it('should implement exponential backoff for retries', async () => {
    const ThrowError = () => {
      const error = new Error('Loading chunk failed')
      error.name = 'ChunkLoadError'
      throw error
    }

    render(
      <ChunkLoadError>
        <ThrowError />
      </ChunkLoadError>
    )

    const retryButton = screen.getByRole('button', { name: 'Retry' })

    // First retry: 0ms delay
    await act(async () => {
      retryButton.click()
    })

    // After first retry, should show backoff message
    await waitFor(() => {
      expect(screen.getByText(/Retrying with exponential backoff/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Retry (1/5)' })).toBeInTheDocument()
    })

    // Second retry
    await act(async () => {
      screen.getByRole('button', { name: 'Retry (1/5)' }).click()
    })

    // Should show increased retry count
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry (2/5)' })).toBeInTheDocument()
    })
  })

  it('should reload page after max retries', async () => {
    const reloadSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { reload: reloadSpy },
      writable: true,
    })

    const ThrowError = () => {
      const error = new Error('Loading chunk failed')
      error.name = 'ChunkLoadError'
      throw error
    }

    render(
      <ChunkLoadError>
        <ThrowError />
      </ChunkLoadError>
    )

    // Simulate 5 retries
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        const button = screen.getByRole('button')
        button.click()
      })
    }

    // After 5 retries, button should say "Reload Page"
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Reload Page' })).toBeInTheDocument()
    })

    // Click reload
    await act(async () => {
      screen.getByRole('button', { name: 'Reload Page' }).click()
    })

    expect(reloadSpy).toHaveBeenCalled()
  })

  it('should show different message after max retries', async () => {
    const ThrowError = () => {
      const error = new Error('Loading chunk failed')
      error.name = 'ChunkLoadError'
      throw error
    }

    render(
      <ChunkLoadError>
        <ThrowError />
      </ChunkLoadError>
    )

    // Simulate 5 retries
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        const button = screen.getByRole('button')
        button.click()
      })
    }

    await waitFor(() => {
      expect(screen.getByText(/Unable to load the page after multiple attempts/)).toBeInTheDocument()
    })
  })

  it('should log chunk load errors to console', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const ThrowError = () => {
      const error = new Error('Loading chunk 999 failed')
      error.name = 'ChunkLoadError'
      throw error
    }

    render(
      <ChunkLoadError>
        <ThrowError />
      </ChunkLoadError>
    )

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Chunk load error:',
      expect.any(Error),
      expect.any(String)
    )

    consoleErrorSpy.mockRestore()
  })

  it('should clean up timeout on unmount', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

    const ThrowError = () => {
      const error = new Error('Loading chunk failed')
      error.name = 'ChunkLoadError'
      throw error
    }

    const { unmount } = render(
      <ChunkLoadError>
        <ThrowError />
      </ChunkLoadError>
    )

    // Click retry to start timeout
    await act(async () => {
      const retryButton = screen.getByRole('button', { name: 'Retry' })
      retryButton.click()
    })

    // Unmount before timeout completes
    unmount()

    expect(clearTimeoutSpy).toHaveBeenCalled()

    clearTimeoutSpy.mockRestore()
  })
})
