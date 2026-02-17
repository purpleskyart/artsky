import { Component, type ReactNode } from 'react'

interface ChunkLoadErrorProps {
  children: ReactNode
}

interface ChunkLoadErrorState {
  hasError: boolean
  error: Error | null
  retryCount: number
}

/**
 * Error boundary specifically for handling code splitting chunk load failures.
 * Provides a retry button with exponential backoff for failed lazy-loaded chunks.
 * 
 * Requirements: 4.1, 4.2
 */
export class ChunkLoadError extends Component<ChunkLoadErrorProps, ChunkLoadErrorState> {
  private retryTimeoutId: ReturnType<typeof setTimeout> | null = null

  constructor(props: ChunkLoadErrorProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      retryCount: 0,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<ChunkLoadErrorState> {
    // Check if this is a chunk loading error
    const isChunkError = 
      error.name === 'ChunkLoadError' ||
      /Loading chunk \d+ failed|Failed to fetch dynamically imported module/i.test(error.message)
    
    if (isChunkError) {
      return {
        hasError: true,
        error,
      }
    }
    
    // Not a chunk error, let it bubble up to parent error boundary
    throw error
  }

  componentDidCatch(error: Error, errorInfo: { componentStack: string }) {
    console.error('Chunk load error:', error, errorInfo.componentStack)
  }

  componentWillUnmount() {
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId)
    }
  }

  handleRetry = () => {
    const { retryCount } = this.state
    
    // Exponential backoff: 0ms, 1s, 2s, 4s, 8s
    const delay = retryCount === 0 ? 0 : Math.pow(2, retryCount - 1) * 1000
    const maxRetries = 5
    
    if (retryCount >= maxRetries) {
      // Max retries reached, suggest page reload
      window.location.reload()
      return
    }

    this.setState({ retryCount: retryCount + 1 })

    this.retryTimeoutId = setTimeout(() => {
      // Reset error state to trigger re-render and retry chunk load
      this.setState({
        hasError: false,
        error: null,
      })
    }, delay)
  }

  render() {
    if (this.state.hasError) {
      const { retryCount } = this.state
      const isMaxRetries = retryCount >= 5

      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg)',
            color: 'var(--text)',
            fontFamily: 'system-ui, sans-serif',
            padding: '1.5rem',
          }}
        >
          <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
            <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem' }}>
              Failed to load page
            </h1>
            <p style={{ margin: '0 0 1rem', fontSize: '0.95rem', color: 'var(--muted)' }}>
              {isMaxRetries
                ? 'Unable to load the page after multiple attempts. This may be due to a network issue or outdated cached files.'
                : 'The page failed to load. This might be a temporary network issue.'}
            </p>
            <button
              type="button"
              onClick={this.handleRetry}
              style={{
                padding: '0.5rem 1.5rem',
                fontSize: '0.95rem',
                cursor: 'pointer',
                background: 'var(--accent)',
                color: 'var(--bg)',
                border: 'none',
                borderRadius: 'var(--glass-radius-sm, 6px)',
                fontWeight: 500,
              }}
            >
              {isMaxRetries ? 'Reload Page' : retryCount > 0 ? `Retry (${retryCount}/5)` : 'Retry'}
            </button>
            {retryCount > 0 && !isMaxRetries && (
              <p style={{ margin: '1rem 0 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
                Retrying with exponential backoff...
              </p>
            )}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
