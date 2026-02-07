import { useRef, useState, useEffect } from 'react'
import { blockAccount, reportPost, muteThread } from '../lib/bsky'
import { getSession } from '../lib/bsky'
import { useHiddenPosts } from '../context/HiddenPostsContext'
import styles from './PostActionsMenu.module.css'

interface PostActionsMenuProps {
  /** Post/reply URI */
  postUri: string
  postCid: string
  /** Author DID (for block) */
  authorDid: string
  /** Root post URI of the thread (for "Mute thread"). If same as postUri, this is the root post. */
  rootUri: string
  /** When true, hide "Block account" (own content) */
  isOwnPost?: boolean
  /** Called after hide (e.g. close modal or remove from view) */
  onHidden?: () => void
  /** Optional class for the trigger button wrapper */
  className?: string
  /** When true, use compact styling (e.g. for comments) */
  compact?: boolean
}

export default function PostActionsMenu({
  postUri,
  postCid,
  authorDid,
  rootUri,
  isOwnPost,
  onHidden,
  className,
  compact,
}: PostActionsMenuProps) {
  const session = getSession()
  const { addHidden } = useHiddenPosts()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) triggerRef.current?.blur()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [open])

  async function handleBlock() {
    if (!session?.did || isOwnPost) return
    setLoading('block')
    try {
      await blockAccount(authorDid)
      setOpen(false)
    } catch {
      // leave menu open; user can retry
    } finally {
      setLoading(null)
    }
  }

  async function handleReport() {
    if (!session?.did) return
    setLoading('report')
    try {
      await reportPost(postUri, postCid)
      setOpen(false)
    } catch {
      // leave menu open
    } finally {
      setLoading(null)
    }
  }

  async function handleMuteThread() {
    if (!session?.did) return
    setLoading('mute')
    try {
      await muteThread(rootUri)
      setOpen(false)
    } catch {
      // leave menu open
    } finally {
      setLoading(null)
    }
  }

  function handleHide() {
    addHidden(postUri)
    setOpen(false)
    onHidden?.()
  }

  if (!session?.did) return null

  return (
    <div ref={menuRef} className={`${styles.wrap} ${compact ? styles.wrapCompact : ''} ${className ?? ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="More options"
        title="More options"
      >
        ⋯
      </button>
      {open && (
        <div className={styles.dropdown} role="menu">
          {!isOwnPost && (
            <button
              type="button"
              className={styles.item}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleBlock() }}
              disabled={loading === 'block'}
              role="menuitem"
            >
              {loading === 'block' ? '…' : 'Block account'}
            </button>
          )}
          <button
            type="button"
            className={styles.item}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleReport() }}
            disabled={loading === 'report'}
            role="menuitem"
          >
            {loading === 'report' ? '…' : 'Report post'}
          </button>
          <button
            type="button"
            className={styles.item}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleMuteThread() }}
            disabled={loading === 'mute'}
            role="menuitem"
          >
            {loading === 'mute' ? '…' : 'Mute thread'}
          </button>
          <button
            type="button"
            className={styles.item}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleHide() }}
            role="menuitem"
          >
            Hide post
          </button>
        </div>
      )}
    </div>
  )
}
