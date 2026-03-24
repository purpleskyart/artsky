import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ProgressiveImage } from '../components/ProgressiveImage'
import { useSession } from '../context/SessionContext'
import { useLoginModal } from '../context/LoginModalContext'
import {
  getPostMediaInfoForDisplay,
  getPostsBatch,
  POST_MEDIA_FEED_PREVIEW,
  type PostView,
} from '../lib/bsky'
import { listMyCollectionSummaries, type CollectionSummary } from '../lib/collections'
import styles from './CollectionsIndexPage.module.css'

const PREVIEW_SLOTS = 4

function PreviewStrip({
  previewPostUris,
  postByUri,
}: {
  previewPostUris: string[]
  postByUri: Map<string, PostView>
}) {
  return (
    <div className={styles.previewRow} aria-hidden>
      {Array.from({ length: PREVIEW_SLOTS }, (_, i) => {
        const uri = previewPostUris[i]
        const post = uri ? postByUri.get(uri) : undefined
        const media = post ? getPostMediaInfoForDisplay(post, POST_MEDIA_FEED_PREVIEW) : null
        const src = media?.url?.trim() ? media.url : null
        return (
          <div key={i} className={styles.previewCell}>
            {src ? (
              <ProgressiveImage src={src} alt="" className={styles.previewImg} loading="lazy" />
            ) : (
              <div className={styles.previewPlaceholder} title={post ? 'Text or link post' : undefined}>
                <span className={styles.previewPlaceholderIcon} aria-hidden>
                  {post ? '¶' : ''}
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Body only — used inside AppModal (floating back + gear align with post modals) */
export function CollectionsIndexContent() {
  const { session } = useSession()
  const { openLoginModal } = useLoginModal()
  const [items, setItems] = useState<CollectionSummary[]>([])
  const [postByUri, setPostByUri] = useState<Map<string, PostView>>(() => new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!session?.did) return
    setLoading(true)
    setError(null)
    try {
      const list = await listMyCollectionSummaries()
      setItems(list)
      const allUris = [...new Set(list.flatMap((c) => c.previewPostUris))]
      if (allUris.length === 0) {
        setPostByUri(new Map())
      } else {
        const map = await getPostsBatch(allUris)
        setPostByUri(map)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load collections')
      setItems([])
      setPostByUri(new Map())
    } finally {
      setLoading(false)
    }
  }, [session?.did])

  useEffect(() => {
    load()
  }, [load])

  if (!session?.did) {
    return (
      <div className={styles.wrap}>
        <h1 className={styles.title}>Collections</h1>
        <p className={styles.sub}>Log in to see and manage your collections.</p>
        <button type="button" className={styles.loginBtn} onClick={() => openLoginModal()}>
          Log in
        </button>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>Collections</h1>
      <p className={styles.sub}>
        Open a collection to browse or share it. Use the bookmark on any post to save to a collection or create a new one.
      </p>
      {error && <p className={styles.error}>{error}</p>}
      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : items.length === 0 ? (
        <div className={styles.empty}>
          No collections yet. Save a post from the feed with the bookmark — you can create a new collection or pick an existing one there.
        </div>
      ) : (
        <ul className={styles.list}>
          {items.map((c) => (
            <li key={c.uri}>
              <Link
                className={styles.card}
                to={`/feed?collections=1&collection=${encodeURIComponent(c.uri)}`}
              >
                <PreviewStrip previewPostUris={c.previewPostUris} postByUri={postByUri} />
                <div className={styles.cardFooter}>
                  <span className={styles.cardTitle}>{c.title}</span>
                  <span className={styles.meta}>
                    {c.itemCount} {c.itemCount === 1 ? 'post' : 'posts'}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Legacy path → modal URL */
export default function CollectionsIndexPage() {
  return <Navigate to="/feed?collections=1" replace />
}
