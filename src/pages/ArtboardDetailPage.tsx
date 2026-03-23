import { useState, useEffect, useRef, useSyncExternalStore, useCallback } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { getArtboard, removePostFromArtboard, subscribeArtboards, type Artboard } from '../lib/artboards'
import { getArtboardFromRepo, putArtboardOnPds } from '../lib/artboardsPds'
import { agent } from '../lib/bsky'
import { getShareableCollectionUrl } from '../lib/appUrl'
import { useSession } from '../context/SessionContext'
import { useProfileModal } from '../context/ProfileModalContext'
import { useToast } from '../context/ToastContext'
import { useListKeyboardNav } from '../hooks/useListKeyboardNav'
import Layout from '../components/Layout'
import styles from './ArtboardDetailPage.module.css'

export function ArtboardDetailContent({
  id,
  inModal = false,
  ownerDid,
  onRegisterRefresh,
  onBoardName,
}: {
  id: string
  inModal?: boolean
  ownerDid?: string
  onRegisterRefresh?: (fn: () => void | Promise<void>) => void
  onBoardName?: (name: string) => void
}) {
  const { session } = useSession()
  const toast = useToast()
  const { openPostModal } = useProfileModal()
  const [, setTick] = useState(0)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const gridRef = useRef<HTMLDivElement>(null)
  const isRemoteView = !!(ownerDid && ownerDid !== session?.did)
  const [remoteBoard, setRemoteBoard] = useState<Artboard | null | undefined>(undefined)

  const localBoard = useSyncExternalStore(
    subscribeArtboards,
    () => (id ? getArtboard(id) : undefined),
    () => (id ? getArtboard(id) : undefined),
  )

  useEffect(() => {
    if (!id || !ownerDid || ownerDid === session?.did) {
      setRemoteBoard(undefined)
      return
    }
    let cancelled = false
    setRemoteBoard(undefined)
    getArtboardFromRepo(ownerDid, id).then((b) => {
      if (!cancelled) setRemoteBoard(b ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [id, ownerDid, session?.did])

  const board: Artboard | undefined | null = isRemoteView
    ? remoteBoard === undefined
      ? undefined
      : remoteBoard
    : localBoard

  useEffect(() => {
    if (board?.name) onBoardName?.(board.name)
  }, [board?.name, onBoardName])

  const posts = board?.posts ?? []

  useEffect(() => {
    setFocusedIndex((i) => (posts.length ? Math.min(i, posts.length - 1) : 0))
  }, [posts.length])

  useEffect(() => {
    onRegisterRefresh?.(() => setTick((t) => t + 1))
  }, [onRegisterRefresh])

  useEffect(() => {
    if (!inModal || !gridRef.current || focusedIndex < 0) return
    const el = gridRef.current.querySelector(`[data-collection-post-index="${focusedIndex}"]`)
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [inModal, focusedIndex])

  useListKeyboardNav({
    enabled: inModal && posts.length > 0,
    itemCount: posts.length,
    focusedIndex,
    setFocusedIndex,
    columns: 2,
    onActivate: (index) => {
      const p = posts[index]
      if (p) openPostModal(p.uri)
    },
    useCapture: true,
  })

  const canShare = !!session?.did && !isRemoteView

  const handleShareCollection = useCallback(() => {
    if (!session?.did || !id) return
    const url = getShareableCollectionUrl(id, session.did)
    const tryCopy = () =>
      navigator.clipboard.writeText(url).then(
        () => toast?.showToast('Link copied'),
        () => toast?.showToast('Could not copy link'),
      )
    if (typeof navigator !== 'undefined' && navigator.share) {
      navigator.share({ url }).catch(tryCopy)
    } else {
      void tryCopy()
    }
  }, [session?.did, id, toast])

  if (!id) {
    return (
      <div className={styles.wrap}>
        <p className={styles.empty}>Collection not found.</p>
      </div>
    )
  }

  if (isRemoteView && remoteBoard === undefined) {
    return (
      <div className={styles.wrap}>
        <p className={styles.muted}>Loading collection…</p>
      </div>
    )
  }

  if (!board) {
    return (
      <div className={styles.wrap}>
        <p className={styles.empty}>
          {isRemoteView ? 'Collection not found or not available.' : 'Collection not found.'}
        </p>
      </div>
    )
  }

  const boardId = board.id
  async function handleRemove(postUri: string) {
    if (!confirm('Remove this post from the collection?')) return
    removePostFromArtboard(boardId, postUri)
    setTick((t) => t + 1)
    if (session?.did) {
      const updated = getArtboard(boardId)
      if (updated) {
        try {
          await putArtboardOnPds(agent, session.did, updated)
        } catch {
          // leave local state as is
        }
      }
    }
  }

  const showRemove = !isRemoteView

  const wrap = (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <p className={styles.count}>
          {posts.length} post{posts.length !== 1 ? 's' : ''}
        </p>
        {canShare ? (
          <button type="button" className={styles.shareBtn} onClick={handleShareCollection}>
            Share
          </button>
        ) : null}
      </div>
      {posts.length === 0 ? (
        <p className={styles.empty}>
          {isRemoteView ? 'No posts in this collection.' : 'No posts saved yet. Add posts from the feed.'}
        </p>
      ) : (
        <div ref={gridRef} className={styles.grid}>
          {posts.map((p, index) => (
            <div key={p.uri} className={`${styles.card} ${inModal && index === focusedIndex ? styles.cardFocused : ''}`} data-collection-post-index={inModal ? index : undefined}>
              {inModal ? (
                <button type="button" className={styles.link} onClick={() => openPostModal(p.uri)}>
                  <div className={styles.mediaWrap}>
                    {(p.thumbs && p.thumbs.length > 0) ? (
                      <div className={styles.thumbsGrid}>
                        {p.thumbs.map((url, i) => (
                          <img key={i} src={url} alt="" className={p.thumbs!.length === 1 ? `${styles.thumb} ${styles.thumbSpan}` : styles.thumb} loading="lazy" />
                        ))}
                      </div>
                    ) : p.thumb ? (
                      <img src={p.thumb} alt="" className={styles.thumb} loading="lazy" />
                    ) : (
                      <div className={styles.placeholder}>📌</div>
                    )}
                  </div>
                  <div className={styles.meta}>
                    <span className={styles.handle}>@{p.authorHandle ?? 'unknown'}</span>
                    {p.text ? <p className={styles.text}>{p.text.slice(0, 80)}{p.text.length > 80 ? '…' : ''}</p> : null}
                  </div>
                </button>
              ) : (
                <Link to={`/post/${encodeURIComponent(p.uri)}`} className={styles.link}>
                  <div className={styles.mediaWrap}>
                    {(p.thumbs && p.thumbs.length > 0) ? (
                      <div className={styles.thumbsGrid}>
                        {p.thumbs.map((url, i) => (
                          <img key={i} src={url} alt="" className={p.thumbs!.length === 1 ? `${styles.thumb} ${styles.thumbSpan}` : styles.thumb} loading="lazy" />
                        ))}
                      </div>
                    ) : p.thumb ? (
                      <img src={p.thumb} alt="" className={styles.thumb} loading="lazy" />
                    ) : (
                      <div className={styles.placeholder}>📌</div>
                    )}
                  </div>
                  <div className={styles.meta}>
                    <span className={styles.handle}>@{p.authorHandle ?? 'unknown'}</span>
                    {p.text ? <p className={styles.text}>{p.text.slice(0, 80)}{p.text.length > 80 ? '…' : ''}</p> : null}
                  </div>
                </Link>
              )}
              {showRemove ? (
                <button
                  type="button"
                  className={styles.remove}
                  onClick={() => handleRemove(p.uri)}
                  title="Remove from collection"
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )

  return wrap
}

export default function ArtboardDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const ownerDid = searchParams.get('artboardOwner') ?? undefined
  const [title, setTitle] = useState('Collection')
  const localName = id ? getArtboard(id)?.name : undefined

  return (
    <Layout title={localName ?? title} showNav>
      <ArtboardDetailContent id={id ?? ''} ownerDid={ownerDid} onBoardName={setTitle} />
    </Layout>
  )
}
