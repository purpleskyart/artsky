import { Component, type ReactNode } from 'react'

interface ModalErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ModalErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

/**
 * Error boundary specifically for modal components.
 * Prevents errors in modals from crashing the entire app.
 */
export class ModalErrorBoundary extends Component<ModalErrorBoundaryProps, ModalErrorBoundaryState> {
  constructor(props: ModalErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<ModalErrorBoundaryState> {
    return {
      hasError: true,
      error,
    }
  }

  componentDidCatch(error: Error, errorInfo: { componentStack: string }) {
    console.error('Modal error:', error, errorInfo.componentStack)
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
    })
  }

  render() {
    if (this.state.hasError) {
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
              Something went wrong
            </h1>
            <p style={{ margin: '0 0 1rem', fontSize: '0.95rem', color: 'var(--muted)' }}>
              {this.state.error?.message || 'An unexpected error occurred in this modal.'}
            </p>
            <button
              type="button"
              onClick={this.handleReset}
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
              Try Again
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
