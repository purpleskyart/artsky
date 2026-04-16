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
  openSignal?: number
  /** Pilled button with "Collect" label — matches post detail Like / Repost row */
  variant?: 'icon' | 'detail'
}

export default function CollectionSaveMenu({ postUri, openSignal, variant = 'icon' }: Props) {
  const { session } = useSession()
  const { openLoginModal } = useLoginModal()
  const toast = useToast()
  const savedAnywhere = useIsPostSavedToAnyCollection(postUri)
  const {
    savingUri,
    quickSavePost,
    savePostToCollection,
    removePostFromCollectionUi,
    createCollectionAndAddPost,
  } = useCollectionSaveActions()

  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<CollectionPickerRow[]>([])
  const [loadingRows, setLoadingRows] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newCollectionIsPrivate, setNewCollectionIsPrivate] = useState(false)
  const [editingNewTitle, setEditingNewTitle] = useState(false)
  const [optimisticSaved, setOptimisticSaved] = useState(false)
  const [forceSavedRowCheck, setForceSavedRowCheck] = useState(false)
  const [dropdownPosition, setDropdownPosition] = useState<{
    bottom: number
    left: number
  } | null>(null)

  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const newTitleInputRef = useRef<HTMLInputElement>(null)

  const saving = savingUri === postUri
  const effectiveSavedAnywhere = savedAnywhere || optimisticSaved

  const updateDropdownPosition = useCallback(() => {
    if (!triggerRef.current) return null
    const rect = triggerRef.current.getBoundingClientRect()
    const dropdownWidth = dropdownRef.current?.offsetWidth || 320
    const maxLeft = window.innerWidth - 8 - dropdownWidth
    return {
      bottom: window.innerHeight - rect.top + 4,
      left: Math.max(8, Math.min(rect.left, maxLeft)),
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
    const isInsideMenu = (target: EventTarget | null) => {
      const node = target as Node | null
      if (!node) return false
      if (wrapRef.current?.contains(node)) return true
      if (dropdownRef.current?.contains(node)) return true
      return false
    }
    const onPointerDown = (e: PointerEvent) => {
      if (isInsideMenu(e.target)) return
      setOpen(false)
    }
    const onTouchStart = (e: TouchEvent) => {
      if (isInsideMenu(e.target)) return
      setOpen(false)
    }
    const onScroll = (e: Event) => {
      if (isInsideMenu(e.target)) return
      setOpen(false)
    }
    window.addEventListener('scroll', onScroll, true)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('touchstart', onTouchStart)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('touchstart', onTouchStart)
    }
  }, [open])

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

  const markSavedRowChecked = useCallback(() => {
    setRows((prev) =>
      prev.map((r) =>
        r.title.trim().toLowerCase() === 'saved' ? { ...r, hasPost: true } : r
      )
    )
  }, [])

  useEffect(() => {
    if (openSignal == null) return
    let cancelled = false
    ;(async () => {
      if (!session?.did) {
        openLoginModal()
        return
      }
      if (cancelled) return
      setOpen(true)
      if (!effectiveSavedAnywhere) {
        setOptimisticSaved(true)
        setForceSavedRowCheck(true)
        markSavedRowChecked()
        quickSavePost(postUri).catch(() => {
          /* context handles toasts */
          if (!cancelled) {
            setOptimisticSaved(false)
            setForceSavedRowCheck(false)
          }
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [openSignal, session?.did, openLoginModal, quickSavePost, postUri, markSavedRowChecked, effectiveSavedAnywhere])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (key === 'escape' || key === 'q' || key === 'u') {
        e.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
        return
      }
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      if (key === 'backspace') {
        e.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
        return
      }
      if (key === 'w' || key === 's' || key === 'e' || key === 'enter' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const dropdown = dropdownRef.current
        if (!dropdown) return
        const navItems = Array.from(
          dropdown.querySelectorAll<HTMLElement>('[data-collect-nav="item"]')
        ).filter((el) => !(el as HTMLButtonElement).disabled)
        if (navItems.length === 0) return
        const current = document.activeElement as HTMLElement | null
        const idx = current && navItems.includes(current) ? navItems.indexOf(current) : -1
        if (key === 'e' || key === 'enter') {
          e.preventDefault()
          e.stopPropagation()
          if (idx < 0) return
          const active = navItems[idx]
          if (active.dataset.collectInputProxy === 'true') {
            setEditingNewTitle(true)
            requestAnimationFrame(() => newTitleInputRef.current?.focus())
            return
          }
          ;(active as HTMLButtonElement).click()
          return
        }
        if (key === 'w' || e.key === 'ArrowUp') {
          e.preventDefault()
          const nextIdx = idx <= 0 ? navItems.length - 1 : idx - 1
          navItems[nextIdx].focus()
          return
        }
        if (key === 's' || e.key === 'ArrowDown') {
          e.preventDefault()
          const nextIdx = idx < 0 || idx >= navItems.length - 1 ? 0 : idx + 1
          navItems[nextIdx].focus()
          return
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (!open) return
    if (editingNewTitle) {
      requestAnimationFrame(() => newTitleInputRef.current?.focus())
      return
    }
    const dropdown = dropdownRef.current
    if (!dropdown) return
    const items = dropdown.querySelectorAll<HTMLElement>('[data-collect-nav="item"]')
    const first = items[0]
    if (first) first.focus()
  }, [open, loadingRows, editingNewTitle])

  useEffect(() => {
    if (!open || !editingNewTitle) return
    requestAnimationFrame(() => newTitleInputRef.current?.focus())
  }, [open, editingNewTitle, saving])

  useEffect(() => {
    if (!open) setEditingNewTitle(false)
  }, [open])

  useEffect(() => {
    setOptimisticSaved(false)
    setForceSavedRowCheck(false)
  }, [postUri])

  useEffect(() => {
    if (savedAnywhere) setForceSavedRowCheck(false)
  }, [savedAnywhere])

  const onTriggerClick = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (open) {
        setOpen(false)
        return
      }
      ;(async () => {
        if (!session?.did) {
          openLoginModal()
          return
        }
        setOpen(true)
        setEditingNewTitle(true)
        requestAnimationFrame(() => newTitleInputRef.current?.focus())
        if (!effectiveSavedAnywhere) {
          setOptimisticSaved(true)
          setForceSavedRowCheck(true)
          markSavedRowChecked()
          quickSavePost(postUri).catch(() => {
            /* context handles toasts */
            setOptimisticSaved(false)
            setForceSavedRowCheck(false)
          })
        }
      })()
    },
    [open, session?.did, openLoginModal, quickSavePost, postUri, markSavedRowChecked, effectiveSavedAnywhere]
  )

  const toggleRow = useCallback(
    async (row: CollectionPickerRow) => {
      if (saving) return
      const isSavedRow = row.title.trim().toLowerCase() === 'saved'
      const effectiveHasPost = row.hasPost || (isSavedRow && (optimisticSaved || forceSavedRowCheck))
      const nextHasPost = !effectiveHasPost

      // Optimistic UI: update local state immediately
      setRows((prev) =>
        prev.map((r) => (r.uri === row.uri ? { ...r, hasPost: nextHasPost } : r))
      )
      if (isSavedRow) {
        setOptimisticSaved(nextHasPost)
        setForceSavedRowCheck(nextHasPost)
      }

      // Sync with server in background
      try {
        if (effectiveHasPost) {
          await removePostFromCollectionUi(postUri, row.uri)
        } else {
          await savePostToCollection(postUri, row.uri, { isPrivate: row.isPrivate })
        }
      } catch {
        // Revert on error
        setRows((prev) =>
          prev.map((r) => (r.uri === row.uri ? { ...r, hasPost: effectiveHasPost } : r))
        )
        if (isSavedRow) {
          setOptimisticSaved(effectiveHasPost)
          setForceSavedRowCheck(effectiveHasPost)
        }
      }
    },
    [postUri, saving, removePostFromCollectionUi, savePostToCollection, optimisticSaved, forceSavedRowCheck]
  )

  const onCreate = useCallback(async () => {
    const title = newTitle.trim()
    if (!title) {
      toast?.showToast('Enter a name for the collection')
      return
    }
    if (saving) return
    try {
      await createCollectionAndAddPost(postUri, title, { isPrivate: newCollectionIsPrivate })
      setNewTitle('')
      setNewCollectionIsPrivate(false)
      setOpen(false)
      toast?.showToast('Saved to new collection')
    } catch {
      /* context */
    }
  }, [newTitle, postUri, saving, createCollectionAndAddPost, toast, newCollectionIsPrivate])

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
        className={
          variant === 'detail'
            ? `${styles.triggerDetail} ${effectiveSavedAnywhere ? styles.triggerDetailSaved : ''} ${open ? styles.triggerDetailOpen : ''}`
            : `${styles.trigger} ${effectiveSavedAnywhere ? styles.triggerSaved : ''}`
        }
        onClick={onTriggerClick}
        disabled={saving}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={effectiveSavedAnywhere ? 'Saved — choose collection' : 'Save to collection'}
        title={effectiveSavedAnywhere ? 'Saved — choose collection' : 'Save to collection'}
      >
        {variant === 'detail' ? (
          <>
            <span className={styles.triggerDetailIcon} aria-hidden>
              <BookmarkIcon filled={effectiveSavedAnywhere} />
            </span>
            <span>Collect</span>
          </>
        ) : (
          <BookmarkIcon filled={effectiveSavedAnywhere} />
        )}
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
            data-collection-menu="true"
            aria-label="Save to collection"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
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
                    data-collect-nav="item"
                    disabled={saving}
                    onClick={() => toggleRow(row)}
                  >
                    <span className={styles.rowTitle}>
                      {row.title}
                      {row.isPrivate ? ' (Private)' : ''}
                    </span>
                    <span className={styles.check} aria-hidden>
                      {row.hasPost || ((optimisticSaved || forceSavedRowCheck) && row.title.trim().toLowerCase() === 'saved') ? '✓' : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className={styles.newBlock}>
              <div className={styles.newCollectionRow}>
                {editingNewTitle ? (
                  <input
                    ref={newTitleInputRef}
                    className={styles.input}
                    type="text"
                    data-collect-input="true"
                    placeholder="New Collection"
                    value={newTitle}
                    onBlur={() => setEditingNewTitle(false)}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        e.stopPropagation()
                        void onCreate()
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        e.stopPropagation()
                        setEditingNewTitle(false)
                      }
                    }}
                    maxLength={200}
                    autoComplete="off"
                  />
                ) : (
                  <button
                    type="button"
                    className={styles.inputProxy}
                    data-collect-nav="item"
                    data-collect-input-proxy="true"
                    onClick={() => {
                      setEditingNewTitle(true)
                      requestAnimationFrame(() => newTitleInputRef.current?.focus())
                    }}
                  >
                    {newTitle.trim() ? newTitle : 'New Collection'}
                  </button>
                )}
                <button type="button" className={styles.createInlineBtn} data-collect-nav="item" disabled={saving} onClick={() => void onCreate()}>
                  Create
                </button>
              </div>
              <label className={styles.metaRow}>
                <input
                  type="checkbox"
                  checked={newCollectionIsPrivate}
                  onChange={(e) => setNewCollectionIsPrivate(e.target.checked)}
                  disabled={saving}
                />
                Private collection
              </label>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
