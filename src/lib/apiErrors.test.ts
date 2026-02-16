import { describe, it, expect } from 'vitest'
import { getApiErrorMessage, shouldRetryError, withApiErrorHandling } from './apiErrors'

describe('API Error Handling', () => {
  describe('getApiErrorMessage', () => {
    it('returns user-friendly message for network errors', () => {
      const error = new Error('Failed to fetch')
      const message = getApiErrorMessage(error)
      expect(message).toBe('Network connection lost. Please check your internet connection and try again.')
    })

    it('returns user-friendly message for timeout errors', () => {
      const error = new Error('Request timed out')
      const message = getApiErrorMessage(error)
      expect(message).toBe('Request timed out. The server is taking too long to respond. Please try again.')
    })

    it('returns user-friendly message for cancelled requests', () => {
      const error = new Error('Request was cancelled')
      const message = getApiErrorMessage(error)
      expect(message).toBe('Request was cancelled')
    })

    it('returns user-friendly message for 401 errors', () => {
      const error = Object.assign(new Error('Unauthorized'), { status: 401 })
      const message = getApiErrorMessage(error)
      expect(message).toBe('Your session has expired. Please log in again.')
    })

    it('returns user-friendly message for 403 errors with context', () => {
      const error = Object.assign(new Error('Forbidden'), { status: 403 })
      const message = getApiErrorMessage(error, 'delete post')
      expect(message).toBe("You don't have permission to delete post.")
    })

    it('returns user-friendly message for 404 errors', () => {
      const error = Object.assign(new Error('Not found'), { status: 404 })
      const message = getApiErrorMessage(error)
      expect(message).toBe('The requested content was not found.')
    })

    it('returns user-friendly message for 429 errors', () => {
      const error = Object.assign(new Error('Too many requests'), { status: 429 })
      const message = getApiErrorMessage(error)
      expect(message).toBe('Too many requests. Please wait a moment and try again.')
    })

    it('returns user-friendly message for 500 errors', () => {
      const error = Object.assign(new Error('Internal server error'), { status: 500 })
      const message = getApiErrorMessage(error)
      expect(message).toBe('Server error. Please try again in a moment.')
    })

    it('returns user-friendly message for 503 errors', () => {
      const error = Object.assign(new Error('Service unavailable'), { status: 503 })
      const message = getApiErrorMessage(error)
      expect(message).toBe('Service is currently down for maintenance. Please try again later.')
    })

    it('includes context in error message when provided', () => {
      const error = Object.assign(new Error('Bad request'), { status: 400 })
      const message = getApiErrorMessage(error, 'load feed')
      expect(message).toContain('load feed')
    })

    it('handles string errors', () => {
      const message = getApiErrorMessage('Something went wrong')
      expect(message).toBe('Something went wrong')
    })

    it('handles objects with message property', () => {
      const error = { message: 'Custom error message' }
      const message = getApiErrorMessage(error)
      expect(message).toBe('Custom error message')
    })

    it('returns fallback message for unknown errors', () => {
      const message = getApiErrorMessage(null)
      expect(message).toBe('An error occurred')
    })

    it('returns fallback message with context for unknown errors', () => {
      const message = getApiErrorMessage(null, 'load timeline')
      expect(message).toBe('Failed to load timeline')
    })
  })

  describe('shouldRetryError', () => {
    it('returns true for network errors', () => {
      const error = new Error('Failed to fetch')
      expect(shouldRetryError(error)).toBe(true)
    })

    it('returns true for 5xx server errors', () => {
      const error = Object.assign(new Error('Server error'), { status: 500 })
      expect(shouldRetryError(error)).toBe(true)
    })

    it('returns true for 503 errors', () => {
      const error = Object.assign(new Error('Service unavailable'), { status: 503 })
      expect(shouldRetryError(error)).toBe(true)
    })

    it('returns true for 408 timeout errors', () => {
      const error = Object.assign(new Error('Timeout'), { status: 408 })
      expect(shouldRetryError(error)).toBe(true)
    })

    it('returns false for 4xx client errors (except 408)', () => {
      const error400 = Object.assign(new Error('Bad request'), { status: 400 })
      expect(shouldRetryError(error400)).toBe(false)

      const error401 = Object.assign(new Error('Unauthorized'), { status: 401 })
      expect(shouldRetryError(error401)).toBe(false)

      const error404 = Object.assign(new Error('Not found'), { status: 404 })
      expect(shouldRetryError(error404)).toBe(false)
    })

    it('returns false for unknown errors', () => {
      const error = new Error('Unknown error')
      expect(shouldRetryError(error)).toBe(false)
    })

    it('handles statusCode property', () => {
      const error = Object.assign(new Error('Server error'), { statusCode: 500 })
      expect(shouldRetryError(error)).toBe(true)
    })
  })

  describe('withApiErrorHandling', () => {
    it('returns result on success', async () => {
      const fn = async () => 'success'
      const result = await withApiErrorHandling(fn)
      expect(result).toBe('success')
    })

    it('throws user-friendly error on failure', async () => {
      const fn = async () => {
        throw Object.assign(new Error('Server error'), { status: 500 })
      }
      
      await expect(withApiErrorHandling(fn)).rejects.toThrow('Server error. Please try again in a moment.')
    })

    it('includes context in error message', async () => {
      const fn = async () => {
        throw Object.assign(new Error('Not found'), { status: 404 })
      }
      
      await expect(withApiErrorHandling(fn, 'load post')).rejects.toThrow('The requested content was not found.')
    })

    it('preserves status code in thrown error', async () => {
      const fn = async () => {
        throw Object.assign(new Error('Server error'), { status: 500 })
      }
      
      try {
        await withApiErrorHandling(fn)
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as { status?: number }).status).toBe(500)
      }
    })
  })
})
