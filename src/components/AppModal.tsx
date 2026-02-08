import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ModalTopBarSlotContext } from '../context/ModalTopBarSlotContext'
import styles from './PostDetailModal.module.css'

interface AppModalProps {
  /** Accessible name for the dialog */
  ariaLabel: string
  children: React.ReactNode
  onClose: () => void
  onBack: () => void
  canGoBack: boolean
  /** When true, focus the close button when the modal opens (e.g. profile/tag). Default false. */
  focusCloseOnOpen?: boolean
  /** When true, top bar has transparent background so content shows through; X button keeps its background. */
  transparentTopBar?: boolean
}

export default function AppModal({
  ariaLabel,
  children,
  onClose,
  onBack,
  canGoBack,
  focusCloseOnOpen = false,
  transparentTopBar = false,
}: AppModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const [topBarSlotEl, setTopBarSlotEl] = useState<HTMLDivElement | null>(null)
  const [topBarRightSlotEl, setTopBarRightSlotEl] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    if (focusCloseOnOpen) closeBtnRef.current?.focus()
  }, [focusCloseOnOpen])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) {
        if (e.key === 'Escape') {
          e.preventDefault()
          target.blur()
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        onClose()
        return
      }
      if (e.key.toLowerCase() === 'q') {
        e.preventDefault()
        e.stopImmediatePropagation()
        onBack()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose, onBack])

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose()
  }

  const modal = (
    <ModalTopBarSlotContext.Provider value={{ centerSlot: topBarSlotEl, rightSlot: topBarRightSlotEl }}>
      <div
        ref={overlayRef}
        className={styles.overlay}
        onClick={handleBackdropClick}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        <div className={styles.pane}>
          <div className={`${styles.modalTopBar} ${transparentTopBar ? styles.modalTopBarTransparent : ''}`}>
            <div className={styles.modalTopBarLeft}>
              <button
                ref={focusCloseOnOpen ? closeBtnRef : undefined}
                type="button"
                className={styles.closeBtn}
                onClick={onClose}
                aria-label="Close"
              >
                ×
              </button>
              {canGoBack ? (
                <button
                  type="button"
                  className={styles.backBtn}
                  onClick={onBack}
                  aria-label="Back to previous"
                >
                  ←
                </button>
              ) : null}
            </div>
            <div ref={setTopBarSlotEl} className={styles.modalTopBarSlot} />
            <div ref={setTopBarRightSlotEl} className={styles.modalTopBarRight} />
          </div>
          <div className={`${styles.scroll} ${transparentTopBar ? styles.scrollWithTransparentBar : ''}`}>{children}</div>
        </div>
      </div>
    </ModalTopBarSlotContext.Provider>
  )

  return createPortal(modal, document.body)
}
