/**
 * API Error handling utilities
 * Provides user-friendly error messages for different API failure scenarios
 */

export interface ApiError extends Error {
  status?: number
  statusCode?: number
  code?: string
}

/**
 * Convert API errors to user-friendly messages
 * @param error - The error object from the API call
 * @param context - Optional context about what operation failed (e.g., 'load feed', 'like post')
 * @returns User-friendly error message
 */
export function getApiErrorMessage(error: unknown, context?: string): string {
  if (!error) {
    return context ? `Failed to ${context}` : 'An error occurred'
  }

  // Handle Error objects
  if (error instanceof Error) {
    const apiError = error as ApiError
    const status = apiError.status ?? apiError.statusCode

    // Network errors
    if (
      error.message.includes('fetch') ||
      error.message.includes('network') ||
      error.message.includes('NetworkError') ||
      error.message.includes('Failed to fetch')
    ) {
      return 'Network connection lost. Please check your internet connection and try again.'
    }

    // Timeout errors
    if (error.message.includes('timeout') || error.message.includes('timed out')) {
      return 'Request timed out. The server is taking too long to respond. Please try again.'
    }

    // Cancelled requests
    if (error.message.includes('cancel') || error.message.includes('abort')) {
      return 'Request was cancelled'
    }

    // HTTP status code errors
    if (status !== undefined) {
      return getStatusCodeMessage(status, context)
    }

    // Rate limit messages (API may not always set status 429)
    if (error.message.toLowerCase().includes('rate limit')) {
      return 'Too many requests. Please wait a moment and try again.'
    }

    // Return the original error message if it's user-friendly
    if (error.message && !error.message.includes('undefined') && !error.message.includes('null')) {
      return error.message
    }
  }

  // Handle string errors
  if (typeof error === 'string') {
    if (error.toLowerCase().includes('rate limit')) {
      return 'Too many requests. Please wait a moment and try again.'
    }
    return error
  }

  // Handle objects with message property
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const msg = (error as { message: unknown }).message
    if (typeof msg === 'string') {
      return msg
    }
  }

  // Fallback message
  return context ? `Failed to ${context}. Please try again.` : 'An unexpected error occurred. Please try again.'
}

/**
 * Get user-friendly message for HTTP status codes
 */
function getStatusCodeMessage(status: number, context?: string): string {
  const operation = context ? ` ${context}` : ''

  // 4xx Client Errors
  if (status >= 400 && status < 500) {
    switch (status) {
      case 400:
        return `Invalid request${operation}. Please check your input and try again.`
      case 401:
        return 'Your session has expired. Please log in again.'
      case 403:
        return `You don't have permission to${operation}.`
      case 404:
        return `The requested content was not found.`
      case 408:
        return 'Request timed out. Please try again.'
      case 429:
        return 'Too many requests. Please wait a moment and try again.'
      default:
        return `Unable to${operation}. Please try again.`
    }
  }

  // 5xx Server Errors
  if (status >= 500 && status < 600) {
    switch (status) {
      case 500:
        return 'Server error. Please try again in a moment.'
      case 502:
        return 'Service temporarily unavailable. Please try again in a moment.'
      case 503:
        return 'Service is currently down for maintenance. Please try again later.'
      case 504:
        return 'Server timeout. Please try again.'
      default:
        return 'Server error. Please try again later.'
    }
  }

  // Other status codes
  return `Request failed with status ${status}. Please try again.`
}

/**
 * Check if an error should be retried
 * Used by retry logic to determine if exponential backoff should be applied
 */
export function shouldRetryError(error: unknown): boolean {
  // Network errors should be retried
  if (error instanceof TypeError || error instanceof Error) {
    if (
      error.message.includes('fetch') ||
      error.message.includes('network') ||
      error.message.includes('NetworkError') ||
      error.message.includes('Failed to fetch')
    ) {
      return true
    }
  }

  // Check for HTTP status codes
  if (typeof error === 'object' && error !== null) {
    const err = error as { status?: number; statusCode?: number }
    const status = err.status ?? err.statusCode

    if (status !== undefined) {
      // Retry on 5xx server errors and 408 (timeout)
      if ((status >= 500 && status < 600) || status === 408) {
        return true
      }
      // Don't retry on 4xx client errors (except 408)
      if (status >= 400 && status < 500) {
        return false
      }
    }
  }

  // Default: don't retry
  return false
}

/**
 * Wrap an API call with error handling and user-friendly messages
 * @param fn - The API function to call
 * @param context - Context about what operation is being performed
 * @returns Promise that resolves with the result or rejects with a user-friendly error
 */
export async function withApiErrorHandling<T>(
  fn: () => Promise<T>,
  context?: string
): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    const message = getApiErrorMessage(error, context)
    const enhancedError = new Error(message) as ApiError
    
    // Preserve status code if available
    if (typeof error === 'object' && error !== null) {
      const err = error as { status?: number; statusCode?: number }
      if (err.status !== undefined) {
        enhancedError.status = err.status
      }
      if (err.statusCode !== undefined) {
        enhancedError.statusCode = err.statusCode
      }
    }
    
    throw enhancedError
  }
}
