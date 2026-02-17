/**
 * Retry utility with exponential backoff for failed API requests.
 * 
 * @param fn - The async function to retry
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param initialDelay - Initial delay in milliseconds (default: 1000)
 * @param maxDelay - Maximum delay in milliseconds (default: 8000)
 * @param shouldRetry - Optional function to determine if error should be retried (default: retry on 5xx and network errors)
 * @returns Promise that resolves with the function result or rejects after all retries exhausted
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number
    initialDelay?: number
    maxDelay?: number
    shouldRetry?: (error: unknown) => boolean
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 8000,
    shouldRetry = defaultShouldRetry,
  } = options

  let lastError: unknown
  let delay = initialDelay

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      // Don't retry if this is the last attempt or if error shouldn't be retried
      if (attempt === maxRetries || !shouldRetry(error)) {
        throw error
      }

      // Wait with exponential backoff
      await sleep(delay)

      // Double the delay for next attempt, but cap at maxDelay
      delay = Math.min(delay * 2, maxDelay)
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError
}

/**
 * Default retry logic: retry on 5xx server errors and network errors,
 * but not on 4xx client errors.
 */
function defaultShouldRetry(error: unknown): boolean {
  // Network errors (fetch failures, timeouts, etc.)
  if (error instanceof TypeError || error instanceof Error) {
    if (error.message.includes('fetch') || error.message.includes('network')) {
      return true
    }
  }

  // Check for HTTP status codes
  if (typeof error === 'object' && error !== null) {
    const err = error as { status?: number; statusCode?: number }
    const status = err.status ?? err.statusCode

    if (status !== undefined) {
      // Retry on 5xx server errors
      if (status >= 500 && status < 600) {
        return true
      }
      // Don't retry on 4xx client errors
      if (status >= 400 && status < 500) {
        return false
      }
    }
  }

  // Default: don't retry
  return false
}

/** Retry on 429 rate limit (wait + retry), 5xx, and network errors. Use for read operations that may hit rate limits. */
export function shouldRetryIncluding429(error: unknown): boolean {
  if (defaultShouldRetry(error)) return true
  const err = error as { status?: number; statusCode?: number; message?: string }
  const status = err?.status ?? err?.statusCode
  if (status === 429) return true
  const msg = String(err?.message ?? '')
  if (msg.toLowerCase().includes('rate limit')) return true
  return false
}

/**
 * Sleep utility for delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
