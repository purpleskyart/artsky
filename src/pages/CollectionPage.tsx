import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import Layout from '../components/Layout'
import { RESERVED_APP_PATH_SEGMENTS } from '../lib/routes'
import type { AppBskyFeedDefs } from '@atproto/api'
import ProfileColumn from '../components/ProfileColumn'
import { getPostMediaInfo, getPostsBatch, getProfileCached, isPostNsfw, type TimelineItem } from '../lib/bsky'
import { getCollectionByAtUri, isLikelyCollectionRefParam, removePostFromCollection } from '../lib/collections'
import { getShareableCollectionUrl } from '../lib/appUrl'
import { useSession } from '../context/SessionContext'
import { useViewMode } from '../context/ViewModeContext'
import { useModeration } from '../context/ModerationContext'
import { useModalScroll } from '../context/ModalScrollContext'
import { useToast } from '../context/ToastContext'
import { useCollectionSaveActions } from '../context/CollectionSaveContext'
import { useProfileModal } from '../context/ProfileModalContext'
import feedGridStyles from './FeedPage.module.css'
import styles from './CollectionPage.module.css'

const ESTIMATE_COL_WIDTH = 280
const CARD_CHROME = 100

function toTimelineItem(post: AppBskyFeedDefs.PostView): TimelineItem {
  return { post }
}

function estimateItemHeight(item: TimelineItem): number {
  const media = getPostMediaInfo(item.post)
  if (!media) return CARD_CHROME + 80
  if (media.aspectRatio != null && media.aspectRatio > 0) {
    return CARD_CHROME + ESTIMATE_COL_WIDTH / media.aspectRatio
  }
  return CARD_CHROME + 220
}

function distributeByHeight(
  items: TimelineItem[],
  numCols: number
): Array<Array<{ item: TimelineItem; originalIndex: number }>> {
  if (numCols < 1) return []
  const columns: Array<Array<{ item: TimelineItem; originalIndex: number }>> = Array.from(
    { length: numCols },
    () => []
  )
  const columnHeights: number[] = Array(numCols).fill(0)
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const h = estimateItemHeight(item)
    const lengths = columns.map((col) => col.length)
    const minCount = lengths.length === 0 ? 0 : Math.min(...lengths)
    let best = -1
    for (let c = 0; c < numCols; c++) {
      if (columns[c].length > minCount + 1) continue
      if (best === -1 || columnHeights[c] < columnHeights[best]) best = c
      else if (columnHeights[c] === columnHeights[best] && columns[c].length < columns[best].length) best = c
    }
    if (best === -1) best = 0
    columns[best].push({ item, originalIndex: i })
    columnHeights[best] += h
  }
  return columns
}

export interface CollectionDetailContentProps {
  uri: string
}

/** Body only — used inside AppModal */
export function CollectionDetailContent({ uri: decodedUri }: CollectionDetailContentProps) {
  const { openPostModal } = useProfileModal()
  const { session } = useSession()
  const { viewMode } = useViewMode()
  const toast = useToast()
  const { nsfwPreference, unblurredUris, setUnblurred } = useModeration()
  const modalScrollRef = useModalScroll()
  const { refreshUnionFromPds } = useCollectionSaveActions()

  const [title, setTitle] = useState('')
  const [ownerDid, setOwnerDid] = useState<string | null>(null)
  const [items, setItems] = useState<TimelineItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [likeOverrides, setLikeOverrides] = useState<Record<string, string | null>>({})
  const [keyboardFocusIndex, setKeyboardFocusIndex] = useState(0)
  const keyboardFocusIndexRef = useRef(0)
  const displayItemsRef = useRef<TimelineItem[]>([])
  const copyLinkBtnRef = useRef<HTMLButtonElement>(null)
  const [resolvedAtUri, setResolvedAtUri] = useState<string | null>(null)
  const [shareHandle, setShareHandle] = useState<string | null>(null)
  const [boardSlug, setBoardSlug] = useState<string | null>(null)

  useEffect(() => {
    setResolvedAtUri(null)
    setShareHandle(null)
    setBoardSlug(null)
  }, [decodedUri])

  /** Refetch when `session?.did` appears so OAuth restore after refresh can use the owner agent if needed. */
  const load = useCallback(async () => {
    if (!decodedUri) return
    setLoading(true)
    setError(null)
    try {
      const col = await getCollectionByAtUri(decodedUri)
      if (!col) {
        setError('Collection not found or not a public board.')
        setItems([])
        setTitle('')
        setOwnerDid(null)
        setResolvedAtUri(null)
        setBoardSlug(null)
        return
      }
      setTitle(col.title)
      setOwnerDid(col.did)
      setResolvedAtUri(col.uri)
      setBoardSlug(col.slug)
      const map = await getPostsBatch(col.items)
      const next: TimelineItem[] = []
      for (const u of col.items) {
        const p = map.get(u)
        if (p) next.push(toTimelineItem(p))
      }
      setItems(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load collection')
      setItems([])
      setTitle('')
      setOwnerDid(null)
      setResolvedAtUri(null)
      setBoardSlug(null)
    } finally {
      setLoading(false)
    }
  }, [decodedUri, session?.did])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!ownerDid) {
      setShareHandle(null)
      return
    }
    let cancelled = false
    void getProfileCached(ownerDid)
      .then((p) => {
        if (!cancelled) setShareHandle(p.handle ?? null)
      })
      .catch(() => {
        if (!cancelled) setShareHandle(null)
      })
    return () => {
      cancelled = true
    }
  }, [ownerDid])

  useEffect(() => {
    if (loading || !session?.did) return
    void refreshUnionFromPds()
  }, [loading, session?.did, refreshUnionFromPds])

  const isOwner = !!(session?.did && ownerDid && session.did === ownerDid)
  const cols = viewMode === '1' ? 1 : viewMode === '2' ? 2 : 3

  const displayItems = useMemo(
    () =>
      items.filter((item) => {
        if (nsfwPreference === 'sfw' && isPostNsfw(item.post)) return false
        return true
      }),
    [items, nsfwPreference]
  )

  displayItemsRef.current = displayItems
  keyboardFocusIndexRef.current = keyboardFocusIndex

  useEffect(() => {
    setKeyboardFocusIndex((i) => (displayItems.length ? Math.min(i, displayItems.length - 1) : 0))
  }, [displayItems.length])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) {
        return
      }
      if (e.ctrlKey || e.metaKey) return
      if (displayItems.length === 0) return
      const list = displayItemsRef.current
      const i = keyboardFocusIndexRef.current
      const key = e.key.toLowerCase()
      if (key === 'w' || key === 's' || key === 'a' || key === 'd' || key === 'e' || key === 'enter' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
      }
      if (key === 'w' || e.key === 'ArrowUp') {
        setKeyboardFocusIndex((idx) => Math.max(0, idx - cols))
        return
      }
      if (key === 's' || e.key === 'ArrowDown') {
        setKeyboardFocusIndex((idx) => Math.min(list.length - 1, idx + cols))
        return
      }
      if (key === 'a' || e.key === 'ArrowLeft') {
        setKeyboardFocusIndex((idx) => Math.max(0, idx - 1))
        return
      }
      if (key === 'd' || e.key === 'ArrowRight') {
        setKeyboardFocusIndex((idx) => Math.min(list.length - 1, idx + 1))
        return
      }
      if (key === 'e' || key === 'enter') {
        const item = list[i]
        if (item) openPostModal(item.post.uri, undefined, undefined, item.post.author?.handle)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [displayItems.length, cols, openPostModal])

  const shareUrl = useMemo(() => {
    if (!decodedUri || !isLikelyCollectionRefParam(decodedUri)) return ''
    const ref = resolvedAtUri ?? decodedUri
    return getShareableCollectionUrl(ref, shareHandle, boardSlug)
  }, [decodedUri, resolvedAtUri, shareHandle, boardSlug])

  const copyShare = useCallback(() => {
    if (!shareUrl) return
    const anchor = copyLinkBtnRef.current
    void navigator.clipboard.writeText(shareUrl).then(
      () => toast?.showToast('Copied!', anchor),
      () => toast?.showToast('Could not copy', anchor)
    )
  }, [shareUrl, toast])

  const onRemovePostFromCollection = useCallback(
    async (postUri: string) => {
      if (!isOwner || !decodedUri) return
      try {
        await removePostFromCollection(decodedUri, postUri)
        setItems((prev) => prev.filter((t) => t.post.uri !== postUri))
        void refreshUnionFromPds()
        void load()
      } catch (e) {
        toast?.showToast(e instanceof Error ? e.message : 'Could not remove')
      }
    },
    [isOwner, decodedUri, refreshUnionFromPds, toast, load]
  )

  if (!decodedUri) {
    return (
      <div className={styles.wrap}>
        <p className={styles.empty}>No collection specified.</p>
      </div>
    )
  }

  if (!isLikelyCollectionRefParam(decodedUri)) {
    return (
      <div className={styles.wrap}>
        <p className={styles.error}>Invalid collection link.</p>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{loading ? '…' : title || 'Collection'}</h1>
          <p className={styles.meta}>
            {items.length} {items.length === 1 ? 'post' : 'posts'}
            {!session ? ' · Anyone with the link can view this board' : ''}
          </p>
        </div>
        <div className={styles.actions}>
          <button
            ref={copyLinkBtnRef}
            type="button"
            className={styles.actionBtn}
            onClick={copyShare}
            disabled={!shareUrl}
          >
            Copy link
          </button>
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}
      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : displayItems.length === 0 ? (
        <div className={styles.empty}>No posts to show (removed or unavailable).</div>
      ) : (
        <div className={`${feedGridStyles.gridColumns} ${feedGridStyles[`gridView${viewMode}`]}`} data-view-mode={viewMode}>
          {distributeByHeight(displayItems, cols).map((column, colIndex) => (
            <ProfileColumn
              key={colIndex}
              layout="feed"
              column={column}
              colIndex={colIndex}
              scrollRef={modalScrollRef}
              keyboardFocusIndex={keyboardFocusIndex}
              actionsMenuOpenForIndex={null}
              nsfwPreference={nsfwPreference}
              unblurredUris={unblurredUris}
              setUnblurred={setUnblurred}
              likeOverrides={likeOverrides}
              setLikeOverrides={setLikeOverrides}
              openPostModal={(uri, openReply, focusUri, authorHandle) =>
                openPostModal(uri, openReply, focusUri, authorHandle)
              }
              cardRef={() => () => {}}
              onActionsMenuOpenChange={() => {}}
              onMouseEnter={(originalIndex) => setKeyboardFocusIndex(originalIndex)}
              isSelected={(index) => index === keyboardFocusIndex}
                onRemovePostFromCollection={isOwner ? onRemovePostFromCollection : undefined}
                feedPreviewActionRow
              />
            ))}
          </div>
      )}
    </div>
  )
}

/** Full-page board: `/handle/collection-slug` (share URL). */
export default function CollectionPage() {
  const { handle, boardSlug } = useParams<{ handle: string; boardSlug: string }>()
  const h = handle?.trim()
  const s = boardSlug?.trim()
  if (!h || !s) return <Navigate to="/feed" replace />
  if (RESERVED_APP_PATH_SEGMENTS.has(h.toLowerCase())) return <Navigate to="/feed" replace />
  const uri = `${h}/${s}`
  return (
    <Layout title="Collection" showNav>
      <CollectionDetailContent uri={uri} />
    </Layout>
  )
}
