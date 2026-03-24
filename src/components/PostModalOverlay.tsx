import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { getProfileCached } from '../lib/bsky'

const PostDetailModal = lazy(() => import('./PostDetailModal'))

/**
 * Renders when the current location has `state.backgroundLocation` (feed stays mounted underneath).
 * Same AppModal chrome as legacy ?post= modals: floating back, scroll preservation on dismiss.
 */
export default function PostModalOverlay() {
  const { uri, handle, rkey } = useParams<{ uri?: string; handle?: string; rkey?: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [resolvedUri, setResolvedUri] = useState<string | null>(() => (uri ? decodeURIComponent(uri) : null))
  const [resolving, setResolving] = useState(() => !uri && !!(handle && rkey))

  useEffect(() => {
    if (uri) {
      setResolvedUri(decodeURIComponent(uri))
      setResolving(false)
      return
    }
    if (!handle || !rkey) {
      setResolvedUri(null)
      setResolving(false)
      return
    }
    let cancelled = false
    setResolving(true)
    getProfileCached(handle)
      .then((p) => {
        if (cancelled) return
        if (!p?.did) {
          navigate('/feed', { replace: true })
          return
        }
        setResolvedUri(`at://${p.did}/app.bsky.feed.post/${rkey}`)
        setResolving(false)
      })
      .catch(() => {
        if (!cancelled) navigate('/feed', { replace: true })
      })
    return () => {
      cancelled = true
    }
  }, [uri, handle, rkey, navigate])

  const searchParams = new URLSearchParams(location.search)
  const openReply = searchParams.get('reply') === '1'
  const focusUri = searchParams.get('focus') ?? undefined

  const onClose = useCallback(() => {
    navigate(-1)
  }, [navigate])

  if (resolving || (resolvedUri == null && (handle || rkey))) {
    return null
  }
  if (!resolvedUri) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <PostDetailModal
        uri={resolvedUri}
        openReply={openReply}
        focusUri={focusUri}
        onClose={onClose}
        onBack={onClose}
        canGoBack={false}
        isTopModal
        stackIndex={0}
      />
    </Suspense>
  )
}
