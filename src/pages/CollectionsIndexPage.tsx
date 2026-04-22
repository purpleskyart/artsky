import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import Layout from '../components/Layout'
import { ProgressiveImage } from '../components/ProgressiveImage'
import { useSession } from '../context/SessionContext'
import { useLoginModal } from '../context/LoginModalContext'
import {
  getPostMediaInfoForDisplay,
  getPostsBatch,
  getProfileCached,
  POST_MEDIA_FEED_PREVIEW,
  type PostView,
} from '../lib/bsky'
import {
  collectionShareRef,
  deleteCollection,
  listMyCollectionSummaries,
  renameCollection,
  setCollectionPrivacy,
  type CollectionSummary,
} from '../lib/collections'
import styles from './CollectionsIndexPage.module.css'
import type { BackgroundLocationState } from '../lib/overlayNavigation'
import { useToast } from '../context/ToastContext'

const PREVIEW_SLOTS = 4

/** Lazy-loaded preview strip that only fetches posts when visible */
function LazyPreviewStrip({
  collection,
  postByUri,
  onPostsLoaded,
}: {
  collection: CollectionSummary
  postByUri: Map<string, PostView>
  onPostsLoaded: (posts: Map<string, PostView>) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [shouldLoad, setShouldLoad] = useState(false)
  const loadingRef = useRef(false)

  // Use intersection observer to detect when this collection card is visible
  useEffect(() => {
    if (!containerRef.current) return
    if (collection.previewPostUris.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShouldLoad(true)
          observer.disconnect()
        }
      },
      { rootMargin: '100px' } // Start loading slightly before it's fully visible
    )

    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [collection.previewPostUris.length])

  // Load posts when collection becomes visible
  useEffect(() => {
    if (!shouldLoad) return
    if (loadingRef.current) return

    // Filter to only URIs we haven't loaded yet globally
    const urisToLoad = collection.previewPostUris.filter((uri) => !postByUri.has(uri))
    if (urisToLoad.length === 0) return

    loadingRef.current = true

    getPostsBatch(urisToLoad)
      .then((map) => {
        onPostsLoaded(map)
      })
      .catch(() => {
        // Silently fail - previews are non-critical
      })
      .finally(() => {
        loadingRef.current = false
      })
  }, [shouldLoad, collection.previewPostUris, onPostsLoaded, postByUri])

  return (
    <div ref={containerRef} className={styles.previewRow} aria-hidden>
      {Array.from({ length: PREVIEW_SLOTS }, (_, i) => {
        const uri = collection.previewPostUris[i]
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
  const location = useLocation()
  const bg = (location.state as BackgroundLocationState | null)?.backgroundLocation
  const collectionLinkState = bg != null ? { backgroundLocation: bg } : undefined
  const { session } = useSession()
  const { openLoginModal } = useLoginModal()
  const toast = useToast()
  const [items, setItems] = useState<CollectionSummary[]>([])
  const [postByUri, setPostByUri] = useState<Map<string, PostView>>(() => new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [editingUri, setEditingUri] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [deletingUri, setDeletingUri] = useState<string | null>(null)
  const [privacyUpdatingUri, setPrivacyUpdatingUri] = useState<string | null>(null)
  /** Handle (or DID) for `handle/slug` links in the list. */
  const [pathActor, setPathActor] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!session?.did) return
    setLoading(true)
    setError(null)
    setPostByUri(new Map())
    try {
      const list = await listMyCollectionSummaries()
      setItems(list)
      try {
        const prof = await getProfileCached(session.did)
        const h = prof.handle?.replace(/^@/, '').trim()
        setPathActor(h || session.did)
      } catch {
        setPathActor(session.did)
      }
      setLoading(false) // Collections list loads instantly now
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load collections')
      setItems([])
      setPostByUri(new Map())
      setPathActor(null)
      setLoading(false)
    }
  }, [session?.did])

  // Merge newly loaded posts into the global map
  const handlePostsLoaded = useCallback((newPosts: Map<string, PostView>) => {
    setPostByUri((prev) => {
      const merged = new Map(prev)
      for (const [uri, post] of newPosts) {
        merged.set(uri, post)
      }
      return merged
    })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!editMode) {
      setEditingUri(null)
      setEditingTitle('')
      setSavingEdit(false)
      setDeletingUri(null)
      setPrivacyUpdatingUri(null)
    }
  }, [editMode])

  const startEdit = useCallback((collection: CollectionSummary) => {
    setEditingUri(collection.uri)
    setEditingTitle(collection.title)
  }, [])

  const saveEdit = useCallback(async () => {
    if (!editingUri) return
    if (savingEdit) return
    const nextTitle = editingTitle.trim()
    if (!nextTitle) {
      toast?.showToast('Enter a collection name')
      return
    }
    setSavingEdit(true)
    try {
      await renameCollection(editingUri, nextTitle)
      setItems((prev) => prev.map((c) => (c.uri === editingUri ? { ...c, title: nextTitle } : c)))
      setEditingUri(null)
      setEditingTitle('')
      toast?.showToast('Collection renamed')
    } catch (e) {
      toast?.showToast(e instanceof Error ? e.message : 'Could not rename collection')
    } finally {
      setSavingEdit(false)
    }
  }, [editingUri, editingTitle, savingEdit, toast])

  const onDelete = useCallback(
    async (collection: CollectionSummary) => {
      if (deletingUri) return
      const confirmed = window.confirm(`Delete "${collection.title}"? This cannot be undone.`)
      if (!confirmed) return
      setDeletingUri(collection.uri)
      try {
        await deleteCollection(collection.uri)
        setItems((prev) => prev.filter((c) => c.uri !== collection.uri))
        if (editingUri === collection.uri) {
          setEditingUri(null)
          setEditingTitle('')
        }
        toast?.showToast('Collection deleted')
      } catch (e) {
        toast?.showToast(e instanceof Error ? e.message : 'Could not delete collection')
      } finally {
        setDeletingUri(null)
      }
    },
    [deletingUri, editingUri, toast]
  )

  const onTogglePrivacy = useCallback(
    async (collection: CollectionSummary) => {
      if (privacyUpdatingUri) return
      const nextPrivate = !collection.isPrivate
      setPrivacyUpdatingUri(collection.uri)
      try {
        await setCollectionPrivacy(collection.uri, nextPrivate)
        setItems((prev) => prev.map((c) => (c.uri === collection.uri ? { ...c, isPrivate: nextPrivate } : c)))
        toast?.showToast(nextPrivate ? 'Collection is now private' : 'Collection is now public')
      } catch (e) {
        toast?.showToast(e instanceof Error ? e.message : 'Could not update privacy')
      } finally {
        setPrivacyUpdatingUri(null)
      }
    },
    [privacyUpdatingUri, toast]
  )

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
      <div className={styles.topRow}>
        <p className={styles.sub}>
          Open a collection to browse or share it. Use the bookmark on any post to save to a collection or create a new one.
        </p>
        {items.length > 0 && !loading ? (
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.editBtn}
              onClick={() => setEditMode((v) => !v)}
              aria-pressed={editMode}
            >
              {editMode ? 'Done' : 'Edit'}
            </button>
          </div>
        ) : null}
      </div>
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
              <div className={styles.cardWrap}>
                <Link
                  className={styles.card}
                  to={`/${collectionShareRef(pathActor ?? session.did ?? '', c.slug, c.rkey)}`}
                  state={collectionLinkState}
                >
                  <LazyPreviewStrip collection={c} postByUri={postByUri} onPostsLoaded={handlePostsLoaded} />
                  <div className={styles.cardFooter}>
                    <span className={styles.cardTitle}>{c.title}</span>
                    <span className={styles.meta}>
                      {c.isPrivate ? 'Private · ' : ''}
                      {c.itemCount} {c.itemCount === 1 ? 'post' : 'posts'}
                    </span>
                  </div>
                </Link>
                {editMode ? (
                  <div className={styles.editRow}>
                    {editingUri === c.uri ? (
                      <>
                        <input
                          type="text"
                          className={styles.editInput}
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              e.stopPropagation()
                              void saveEdit()
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault()
                              e.stopPropagation()
                              setEditingUri(null)
                              setEditingTitle('')
                            }
                          }}
                          maxLength={200}
                          autoFocus
                        />
                        <button
                          type="button"
                          className={styles.smallBtn}
                          onClick={() => void saveEdit()}
                          disabled={savingEdit}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className={styles.smallBtnMuted}
                          onClick={() => {
                            setEditingUri(null)
                            setEditingTitle('')
                          }}
                          disabled={savingEdit}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={styles.smallBtn}
                          onClick={() => startEdit(c)}
                          disabled={!!deletingUri || !!privacyUpdatingUri}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          className={styles.smallBtn}
                          onClick={() => void onTogglePrivacy(c)}
                          disabled={privacyUpdatingUri === c.uri || !!deletingUri}
                        >
                          {privacyUpdatingUri === c.uri ? 'Updating…' : c.isPrivate ? 'Make public' : 'Make private'}
                        </button>
                        <button
                          type="button"
                          className={styles.smallBtnDanger}
                          onClick={() => void onDelete(c)}
                          disabled={deletingUri === c.uri || !!privacyUpdatingUri}
                        >
                          {deletingUri === c.uri ? 'Deleting…' : 'Delete'}
                        </button>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function CollectionsIndexPage() {
  return (
    <Layout title="Collections" showNav>
      <CollectionsIndexContent />
    </Layout>
  )
}
