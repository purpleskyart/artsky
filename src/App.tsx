// PurpleSky – Bluesky client focused on art (deploy bump)
import { Component, lazy, Suspense, useEffect } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, type Location } from 'react-router-dom'
import { REPO_URL } from './config/repo'
import { initPerformanceMetrics } from './lib/performanceMetrics'
import { appAbsoluteUrl } from './lib/appUrl'
import { hasOAuthCallbackSearch } from './lib/oauth'
import { CoreProvidersGroup } from './context/CoreProvidersGroup'
import { FeedProvidersGroup } from './context/FeedProvidersGroup'
import { ModalProvidersGroup } from './context/ModalProvidersGroup'
import { ModerationProvider } from './context/ModerationContext'
import { ChunkLoadError } from './components/ChunkLoadError'
import { ModalErrorBoundary } from './components/ModalErrorBoundary'
import OfflineIndicator from './components/OfflineIndicator'
import { useScrollRestoration } from './hooks/useScrollRestoration'

// Lazy load route components for code splitting
const FeedPage = lazy(() => import('./pages/FeedPage'))
const PostDetailPage = lazy(() => import('./pages/PostDetailPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const TagPage = lazy(() => import('./pages/TagPage'))
const CollectionPage = lazy(() => import('./pages/CollectionPage'))
const CollectionsIndexPage = lazy(() => import('./pages/CollectionsIndexPage'))
const PostModalOverlay = lazy(() => import('./components/PostModalOverlay'))
const ProfileModalOverlay = lazy(() => import('./components/ProfileModalOverlay'))
const CollectionsIndexModalOverlay = lazy(() => import('./components/CollectionsIndexModalOverlay'))
const CollectionBoardModalOverlay = lazy(() => import('./components/CollectionBoardModalOverlay'))

const routerBasename = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || undefined

/** Official Git SCM logo (https://git-scm.com/images/logos/downloads/Git-Icon-1788C.svg) */
function GitLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 92 92" fill="none" aria-hidden style={{ flexShrink: 0 }}>
      <path
        fill="#f03c2e"
        fillRule="nonzero"
        d="M90.156 41.965 50.036 1.848a5.918 5.918 0 0 0-8.372 0l-8.328 8.332 10.566 10.566a7.03 7.03 0 0 1 7.23 1.684 7.034 7.034 0 0 1 1.669 7.277l10.187 10.184a7.028 7.028 0 0 1 7.278 1.672 7.04 7.04 0 0 1 0 9.957 7.05 7.05 0 0 1-9.965 0 7.044 7.044 0 0 1-1.528-7.66l-9.5-9.497V59.36a7.04 7.04 0 0 1 1.86 11.29 7.04 7.04 0 0 1-9.957 0 7.04 7.04 0 0 1 0-9.958 7.06 7.06 0 0 1 2.304-1.539V33.926a7.049 7.049 0 0 1-3.82-9.234L29.242 14.272 1.73 41.777a5.925 5.925 0 0 0 0 8.371L41.852 90.27a5.925 5.925 0 0 0 8.37 0l39.934-39.934a5.925 5.925 0 0 0 0-8.371"
      />
    </svg>
  )
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    // Session/token errors: auto-recover by redirecting to feed without showing error UI
    const isSessionError = /session was deleted by another process|TokenRefreshError/i.test(error.message)
    if (isSessionError) {
      // Immediately redirect without rendering error page
      window.location.assign(appAbsoluteUrl('/feed'))
      return { error: null }
    }
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const isSessionError = /session was deleted by another process|TokenRefreshError/i.test(error.message)
    if (!isSessionError) {
      console.error('App error:', error, info.componentStack)
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            padding: '1.5rem',
            background: 'var(--bg)',
            color: 'var(--text)',
            fontFamily: 'system-ui, sans-serif',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
          }}
        >
          <div style={{ maxWidth: '28rem' }}>
            <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem' }}>Something went wrong</h1>
            <p style={{ margin: 0, fontSize: '0.95rem' }}>{this.state.error.message}</p>
            <p style={{ margin: '1rem 0 0', fontSize: '0.9rem', color: 'var(--muted)' }}>
              Try refreshing the page. Check the browser console for details.
            </p>
            <p style={{ margin: '0.75rem 0 0' }}>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  padding: '0.5rem 1rem',
                  fontSize: '0.95rem',
                  cursor: 'pointer',
                  background: 'var(--accent)',
                  color: 'var(--bg)',
                  border: 'none',
                  borderRadius: 'var(--glass-radius-sm, 6px)',
                  fontWeight: 500,
                }}
              >
                Refresh
              </button>
            </p>
            <p style={{ margin: '1.25rem 0 0', fontSize: '0.9rem' }}>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: 'var(--muted)', textDecoration: 'none' }}
                title="View source"
              >
                <GitLogo />
                <span>View source</span>
              </a>
            </p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

/**
 * OAuth redirects to the registered redirect_uri (app root), e.g. /artsky/?code=…&state=… .
 * That maps to router path "/" under basename. We must not redirect to /feed here — Navigate
 * would drop the query string before SessionContext runs the OAuth callback.
 */
function RootIndexRoute() {
  const { search } = useLocation()
  if (hasOAuthCallbackSearch(search)) {
    return <FeedPage />
  }
  return <Navigate to="/feed" replace />
}

function AppRoutes() {
  useScrollRestoration()
  const location = useLocation()
  const backgroundLocation = (location.state as { backgroundLocation?: Location } | null)?.backgroundLocation

  return (
    <ChunkLoadError>
      <Suspense fallback={null}>
        <Routes location={backgroundLocation ?? location}>
          <Route path="/feed" element={<FeedPage />} />
          <Route path="/collections" element={<ModalErrorBoundary><CollectionsIndexPage /></ModalErrorBoundary>} />
          <Route path="/profile/:handle/post/:rkey" element={<ModalErrorBoundary><PostDetailPage /></ModalErrorBoundary>} />
          <Route path="/post/:uri" element={<ModalErrorBoundary><PostDetailPage /></ModalErrorBoundary>} />
          <Route path="/profile/:handle" element={<ModalErrorBoundary><ProfilePage /></ModalErrorBoundary>} />
          <Route path="/tag/:tag" element={<ModalErrorBoundary><TagPage /></ModalErrorBoundary>} />
          <Route path="/:handle/:boardSlug" element={<ModalErrorBoundary><CollectionPage /></ModalErrorBoundary>} />
          <Route path="/" element={<RootIndexRoute />} />
          <Route path="*" element={<Navigate to="/feed" replace />} />
        </Routes>
        {backgroundLocation && (
          <Routes>
            <Route path="/profile/:handle/post/:rkey" element={<ModalErrorBoundary><PostModalOverlay /></ModalErrorBoundary>} />
            <Route path="/profile/:handle" element={<ModalErrorBoundary><ProfileModalOverlay /></ModalErrorBoundary>} />
            <Route path="/post/:uri" element={<ModalErrorBoundary><PostModalOverlay /></ModalErrorBoundary>} />
            <Route path="/collections" element={<ModalErrorBoundary><CollectionsIndexModalOverlay /></ModalErrorBoundary>} />
            <Route path="/:handle/:boardSlug" element={<ModalErrorBoundary><CollectionBoardModalOverlay /></ModalErrorBoundary>} />
          </Routes>
        )}
      </Suspense>
    </ChunkLoadError>
  )
}

export default function App() {
  useEffect(() => {
    initPerformanceMetrics()
  }, [])

  return (
    <ErrorBoundary>
      <BrowserRouter basename={routerBasename}>
        <OfflineIndicator />
        <CoreProvidersGroup>
          <FeedProvidersGroup>
            <ModerationProvider>
              <ModalProvidersGroup>
                <AppRoutes />
              </ModalProvidersGroup>
            </ModerationProvider>
          </FeedProvidersGroup>
        </CoreProvidersGroup>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
