import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useSession } from '../context/SessionContext'
import { useLoginModal } from '../context/LoginModalContext'
import { useToast } from '../context/ToastContext'
import {
  useCollectionSaveActions,
  useIsPostSavedToAnyCollection,
} from '../context/CollectionSaveContext'
import { listCollectionsWithMembership, type CollectionPickerRow } from '../lib/collections'
import styles from './CollectionSaveMenu.module.css'

function BookmarkIcon({ filled }: { filled?: boolean }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden>
      {filled ? (
        <path fill="currentColor" d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2v16z" />
      ) : (
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2v16z"
        />
      )}
    </svg>
  )
}

interface Props {
  postUri: string
}

export default function CollectionSaveMenu({ postUri }: Props) {
  const { session } = useSession()
  const { openLoginModal } = useLoginModal()
  const toast = useToast()
  const savedAnywhere = useIsPostSavedToAnyCollection(postUri)
  const {
    savingUri,
    savePostToCollection,
    removePostFromCollectionUi,
    createCollectionAndAddPost,
  } = useCollectionSaveActions()

  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<CollectionPickerRow[]>([])
  const [loadingRows, setLoadingRows] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [dropdownPosition, setDropdownPosition] = useState<{
    bottom: number
    left: number
  } | null>(null)

  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const saving = savingUri === postUri

  const updateDropdownPosition = useCallback(() => {
    if (!triggerRef.current) return null
    const rect = triggerRef.current.getBoundingClientRect()
    return {
      bottom: window.innerHeight - rect.top + 4,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 8 - 220)),
    }
  }, [])

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setDropdownPosition(null)
      return
    }
    setDropdownPosition(updateDropdownPosition())
  }, [open, updateDropdownPosition])

  useEffect(() => {
    if (!open) return
    const onScroll = () => setDropdownPosition((prev) => (prev ? updateDropdownPosition() ?? prev : prev))
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [open, updateDropdownPosition])

  useEffect(() => {
    if (!open || !session?.did) return
    let cancelled = false
    setLoadingRows(true)
    listCollectionsWithMembership(postUri)
      .then((r) => {
        if (!cancelled) setRows(r)
      })
      .catch(() => {
        if (!cancelled) setRows([])
      })
      .finally(() => {
        if (!cancelled) setLoadingRows(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, postUri, session?.did])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t)) return
      if (dropdownRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const onTriggerClick = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!session?.did) {
        openLoginModal()
        return
      }
      setOpen((o) => !o)
    },
    [session?.did, openLoginModal]
  )

  const toggleRow = useCallback(
    async (row: CollectionPickerRow) => {
      if (saving) return
      try {
        if (row.hasPost) {
          await removePostFromCollectionUi(postUri, row.uri)
        } else {
          await savePostToCollection(postUri, row.uri)
        }
        setRows((prev) =>
          prev.map((r) => (r.uri === row.uri ? { ...r, hasPost: !r.hasPost } : r))
        )
      } catch {
        /* toast from context */
      }
    },
    [postUri, saving, removePostFromCollectionUi, savePostToCollection]
  )

  const onCreate = useCallback(async () => {
    const title = newTitle.trim()
    if (!title) {
      toast?.showToast('Enter a name for the collection')
      return
    }
    if (saving) return
    try {
      await createCollectionAndAddPost(postUri, title)
      setNewTitle('')
      setOpen(false)
      toast?.showToast('Saved to new collection')
    } catch {
      /* context */
    }
  }, [newTitle, postUri, saving, createCollectionAndAddPost, toast])

  return (
    <div
      ref={wrapRef}
      className={styles.wrap}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${savedAnywhere ? styles.triggerSaved : ''}`}
        onClick={onTriggerClick}
        disabled={saving}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={savedAnywhere ? 'Saved — choose collection' : 'Save to collection'}
        title={savedAnywhere ? 'Saved — choose collection' : 'Save to collection'}
      >
        <BookmarkIcon filled={savedAnywhere} />
      </button>
      {open && dropdownPosition &&
        createPortal(
          <div
            ref={dropdownRef}
            className={`${styles.dropdown} ${styles.dropdownFixed}`}
            style={{
              position: 'fixed',
              bottom: dropdownPosition.bottom,
              left: dropdownPosition.left,
            }}
            role="dialog"
            aria-label="Save to collection"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <p className={styles.title}>Your collections</p>
            {loadingRows ? (
              <div className={styles.loading}>Loading…</div>
            ) : rows.length === 0 ? (
              <div className={styles.empty}>No collections yet — create one below.</div>
            ) : (
              <div className={styles.list}>
                {rows.map((row) => (
                  <button
                    key={row.uri}
                    type="button"
                    className={styles.row}
                    role="menuitem"
                    disabled={saving}
                    onClick={() => toggleRow(row)}
                  >
                    <span className={styles.rowTitle}>{row.title}</span>
                    {row.hasPost ? (
                      <span className={styles.check} aria-hidden>
                        ✓
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
            <div className={styles.newBlock}>
              <input
                className={styles.input}
                type="text"
                placeholder="New collection name"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void onCreate()
                  }
                }}
                maxLength={200}
                disabled={saving}
                autoComplete="off"
              />
              <button type="button" className={styles.createBtn} disabled={saving} onClick={() => void onCreate()}>
                Create and save here
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
