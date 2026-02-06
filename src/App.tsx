import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { SessionProvider, useSession } from './context/SessionContext'
import LoginPage from './pages/LoginPage'
import FeedPage from './pages/FeedPage'
import ArtboardsPage from './pages/ArtboardsPage'
import ArtboardDetailPage from './pages/ArtboardDetailPage'
import PostDetailPage from './pages/PostDetailPage'
import ProfilePage from './pages/ProfilePage'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useSession()
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <span style={{ color: 'var(--muted)' }}>Loading…</span>
      </div>
    )
  }
  if (!session) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/feed"
        element={
          <ProtectedRoute>
            <FeedPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/artboards"
        element={
          <ProtectedRoute>
            <ArtboardsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/artboard/:id"
        element={
          <ProtectedRoute>
            <ArtboardDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/post/:uri"
        element={
          <ProtectedRoute>
            <PostDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile/:handle"
        element={
          <ProtectedRoute>
            <ProfilePage />
          </ProtectedRoute>
        }
      />
      <Route path="/" element={<Navigate to="/feed" replace />} />
      <Route path="*" element={<Navigate to="/feed" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <HashRouter>
      <SessionProvider>
        <AppRoutes />
      </SessionProvider>
    </HashRouter>
  )
}
