import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { ModalTopBarSlotContext } from '../context/ModalTopBarSlotContext'
import { ModalScrollProvider } from '../context/ModalScrollContext'
import { useModalExpand } from '../context/ModalExpandContext'
import { useProfileModal } from '../context/ProfileModalContext'
import { useScrollLock } from '../context/ScrollLockContext'
import { useSwipeToClose } from '../hooks/useSwipeToClose'
import {
  usePullToRefresh,
  PULL_THRESHOLD_PX,
} from '../hooks/usePullToRefresh'
import { useStandalonePwa } from '../hooks/useStandalonePwa'
import styles from './PostDetailModal.module.css'

/** Must match `.overlay` in PostDetailModal.module.css; incremented per stack layer so paint order stays correct when lazy chunks mount after eager siblings. */
const MODAL_OVERLAY_Z_BASE = 1000

function profileModalScrollStorageKey(handle: string): string {
  return `artsky-profile-modal-scroll-v1:${encodeURIComponent(handle)}`
}

const MOBILE_BREAKPOINT = 768
function subscribeMobile(cb: () => void) {
  if (typeof window === 'undefined') return () => {}
  const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
function getMobileSnapshot() {
  return typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false
}

interface AppModalProps {
  /** Accessible name for the dialog */
  ariaLabel: string
  children: React.ReactNode
  onClose: () => void
  onBack: () => void
  canGoBack: boolean
  /** Desktop (≥768px): dimmed backdrop uses this so stacked query modals dismiss the full stack. Defaults to onClose. */
  onDesktopBackdrop?: () => void
  /** When true, top bar has transparent background so content shows through. */
  transparentTopBar?: boolean
  /** When true, do not render the top bar (e.g. profile popup uses only the bottom bar). */
  hideTopBar?: boolean
  /** When true, pane uses same size as compose/notifications (420px, 85vh). Default false. */
  compact?: boolean
  /** Optional: called when user completes a swipe left on mobile (e.g. open post author profile). */
  onSwipeLeft?: () => void
  /** Optional: when provided, pull-to-refresh at top of modal scroll triggers this (e.g. refresh post, profile). */
  onPullToRefresh?: () => void | Promise<void>
  /** Optional: when provided, scroll resets when this value changes */
  scrollKey?: string
  /** Profile handle: persist modal scroll in sessionStorage across remounts (path overlay ↔ ?profile= stack). */
  profileScrollPersistenceHandle?: string
  /** When false, this modal is under another; only the top modal should capture wheel to avoid scrolling the wrong pane */
  isTopModal?: boolean
  /** Index in the modal stack (0 = bottom). Sets z-index so layers paint correctly when portals mount out of order (e.g. lazy list loads after eager detail). */
  stackIndex?: number
  /** When true, pane uses --bg like the feed behind preview cards (default: --surface) */
  feedBackground?: boolean
}

export default function AppModal({
  ariaLabel,
  children,
  onClose,
  onBack,
  canGoBack,
  onDesktopBackdrop,
  transparentTopBar = false,
  hideTopBar = false,
  compact = false,
  onSwipeLeft,
  onPullToRefresh,
  scrollKey,
  profileScrollPersistenceHandle,
  isTopModal = true,
  stackIndex,
  feedBackground = false,
}: AppModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { modalScrollHidden, setModalScrollHidden } = useProfileModal()
  const lastScrollYRef = useRef(0)
  const scrollEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMobile = useSyncExternalStore(subscribeMobile, getMobileSnapshot, () => false)
  const isStandalonePwa = useStandalonePwa()
  const pullRefresh = usePullToRefresh({
    scrollRef,
    touchTargetRef: scrollRef,
    onRefresh: onPullToRefresh ?? (() => {}),
    enabled: !!onPullToRefresh && isMobile && isStandalonePwa,
    atTopMaxScrollPx: 1,
  })
  const [topBarSlotEl, setTopBarSlotEl] = useState<HTMLDivElement | null>(null)
  const [topBarRightSlotEl, setTopBarRightSlotEl] = useState<HTMLDivElement | null>(null)
  const { expanded, setExpanded } = useModalExpand()
  const scrollLock = useScrollLock()
  const handleSwipeRight = useCallback(() => {
    if (canGoBack) onBack()
    else onClose()
  }, [canGoBack, onBack, onClose])
  const swipe = useSwipeToClose({
    enabled: isMobile && isTopModal,
    onSwipeLeft,
    onSwipeRight: handleSwipeRight,
  })

  useEffect(() => {
    scrollLock?.lockScroll()
    return () => scrollLock?.unlockScroll()
  }, [scrollLock])

  /* Mobile: track on-screen keyboard via visualViewport and set --keyboard-inset on the overlay so the pane stays above the keyboard (CSS uses the variable for max-height).
   * Only listens to resize (keyboard open/close). Listening to visualViewport
   * scroll caused a feedback loop: adjusting scroll inside the modal fires a
   * viewport scroll event which re-runs this handler which changes pane height
   * which shifts content which triggers more scroll adjustments. */
  useEffect(() => {
    if (!isMobile || typeof window === 'undefined') return
    const vv = window.visualViewport
    const el = overlayRef.current
    if (!vv || !el) return
    const update = () => {
      const inset = Math.max(0, Math.round(window.innerHeight - (vv.offsetTop + vv.height)))
      el.style.setProperty('--keyboard-inset', `${inset}px`)
    }
    vv.addEventListener('resize', update)
    return () => {
      vv.removeEventListener('resize', update)
      el.style.removeProperty('--keyboard-inset')
    }
  }, [isMobile])

  /* Mobile pull-to-refresh: propagate pull offset to Layout floating buttons (gear, feeds, notification)
     which live outside the modal portal but should move with the pull. */
  useEffect(() => {
    if (isMobile && pullRefresh.pullDistance > 0) {
      document.documentElement.style.setProperty('--modal-pull-offset', `${pullRefresh.pullDistance}px`)
    } else {
      document.documentElement.style.removeProperty('--modal-pull-offset')
    }
    return () => {
      document.documentElement.style.removeProperty('--modal-pull-offset')
    }
  }, [isMobile, pullRefresh.pullDistance])

  /* When modal is open, route wheel events to the modal scroll area so scrolling never moves the page behind. Only the topmost modal does this so stacking (e.g. post on profile) scrolls the visible modal. */
  useLayoutEffect(() => {
    if (!isTopModal) return
    const overlay = overlayRef.current
    const scrollEl = scrollRef.current
    const root = typeof document !== 'undefined' ? document.getElementById('root') : null
    if (!overlay || !scrollEl || !root) return
    const onWheel = (e: WheelEvent) => {
      const target = e.target as Node
      if (!overlay.contains(target)) {
        /* Wheel on #root (feed underlay): route into the modal; ignore body portals (dropdowns, etc.). */
        if (root.contains(target)) {
          e.preventDefault()
          scrollEl.scrollTop += e.deltaY
        }
        return
      }
      if (scrollEl.contains(target)) return
      /* Mouse over overlay but not the scroll area (e.g. backdrop or top bar): scroll the popup */
      e.preventDefault()
      scrollEl.scrollTop += e.deltaY
    }
    window.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => window.removeEventListener('wheel', onWheel, { capture: true })
  }, [isTopModal])

  /* Touch: block scrolling the main app (#root) under the overlay. Portals on document.body (e.g. menus) stay scrollable — they are not under #root. */
  useLayoutEffect(() => {
    if (!isTopModal) return
    const overlay = overlayRef.current
    const scrollEl = scrollRef.current
    const root = typeof document !== 'undefined' ? document.getElementById('root') : null
    if (!overlay || !scrollEl || !root) return
    const onTouchMove = (e: TouchEvent) => {
      const target = e.target as Node
      if (overlay.contains(target)) {
        if (scrollEl.contains(target)) return
        e.preventDefault()
        return
      }
      if (root.contains(target)) e.preventDefault()
    }
    document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true })
    return () => document.removeEventListener('touchmove', onTouchMove, { capture: true })
  }, [isTopModal])

  /* Mobile only: hide back/nav/gear when scrolling down in modal; desktop keeps header controls visible */
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !isMobile) return
    lastScrollYRef.current = el.scrollTop
    const SCROLL_THRESHOLD = 8
    const SCROLL_END_MS = 350
    function onScroll() {
      const scrollEl = scrollRef.current
      if (!scrollEl) return
      const y = scrollEl.scrollTop
      const delta = y - lastScrollYRef.current
      if (delta > SCROLL_THRESHOLD) setModalScrollHidden(true)
      else if (delta < -SCROLL_THRESHOLD) setModalScrollHidden(false)
      lastScrollYRef.current = y
      if (scrollEndTimerRef.current) clearTimeout(scrollEndTimerRef.current)
      scrollEndTimerRef.current = setTimeout(() => {
        scrollEndTimerRef.current = null
        setModalScrollHidden(false)
      }, SCROLL_END_MS)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (scrollEndTimerRef.current) clearTimeout(scrollEndTimerRef.current)
    }
  }, [isMobile, setModalScrollHidden])

  /* Mobile: open in expanded mode by default */
  useEffect(() => {
    if (isMobile) setExpanded(true)
  }, [isMobile, setExpanded])

  /* Reset scroll when scrollKey changes, or restore profile modal scroll after remount (overlay ↔ query stack). */
  useEffect(() => {
    const scrollEl = scrollRef.current
    if (!scrollEl) return
    if (profileScrollPersistenceHandle) {
      let target = 0
      try {
        const raw = sessionStorage.getItem(profileModalScrollStorageKey(profileScrollPersistenceHandle))
        if (raw != null) {
          const n = Number(raw)
          if (Number.isFinite(n) && n >= 0) target = n
        }
      } catch {
        /* private mode / quota */
      }
      const maxAttempts = 12
      let attempts = 0
      const apply = () => {
        attempts += 1
        scrollEl.scrollTop = target
        const closeEnough = Math.abs(scrollEl.scrollTop - target) <= 2
        if (closeEnough || attempts >= maxAttempts) return
        window.setTimeout(() => requestAnimationFrame(apply), 50)
      }
      requestAnimationFrame(() => requestAnimationFrame(apply))
      return
    }
    scrollEl.scrollTop = 0
  }, [scrollKey, profileScrollPersistenceHandle])

  useEffect(() => {
    if (!profileScrollPersistenceHandle) return
    const scrollEl = scrollRef.current
    if (!scrollEl) return
    const key = profileModalScrollStorageKey(profileScrollPersistenceHandle)
    const save = () => {
      try {
        sessionStorage.setItem(key, String(scrollEl.scrollTop))
      } catch {
        /* ignore */
      }
    }
    scrollEl.addEventListener('scroll', save, { passive: true })
    return () => {
      save()
      scrollEl.removeEventListener('scroll', save)
    }
  }, [profileScrollPersistenceHandle])

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
        if (!isMobile && onDesktopBackdrop) {
          onDesktopBackdrop()
        } else {
          onClose()
        }
        return
      }
      if (e.key.toLowerCase() === 'q' || e.key === 'Backspace') {
        e.preventDefault()
        e.stopImmediatePropagation()
        onBack()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose, onBack, onDesktopBackdrop, isMobile])

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return
    if (!isMobile && onDesktopBackdrop) {
      onDesktopBackdrop()
      return
    }
    onClose()
  }

  const modal = (
    <ModalTopBarSlotContext.Provider value={{ centerSlot: topBarSlotEl, rightSlot: topBarRightSlotEl, isMobile }}>
      <div
        ref={overlayRef}
        className={`${styles.overlay}${!isTopModal ? ` ${styles.overlayStackedUnder}` : ''}${transparentTopBar ? ` ${styles.overlayFlushTop}` : ''}${expanded ? ` ${styles.overlayExpanded}` : ''}`}
        style={stackIndex !== undefined ? { zIndex: MODAL_OVERLAY_Z_BASE + stackIndex } : undefined}
        onClick={handleBackdropClick}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        <div
          className={`${styles.pane}${swipe.isReturning ? ` ${styles.paneSwipeReturning}` : ''}${transparentTopBar ? ` ${styles.paneNoRightBorder}` : ''}${compact ? ` ${styles.paneCompact}` : ''}${expanded ? ` ${styles.paneExpanded}` : ''}${feedBackground ? ` ${styles.paneFeedBackground}` : ''}`}
          style={swipe.style}
          onTouchStart={swipe.onTouchStart}
          onTouchMove={swipe.onTouchMove}
          onTouchEnd={swipe.onTouchEnd}
          onClick={(e) => e.stopPropagation()}
        >
          {onPullToRefresh && isMobile && isStandalonePwa && (
            <div
              className={styles.modalPanePullRefreshHeader}
              aria-hidden={pullRefresh.pullDistance === 0 && !pullRefresh.isRefreshing}
              aria-live="polite"
              aria-label={pullRefresh.isRefreshing ? 'Refreshing' : undefined}
            >
              {(pullRefresh.pullDistance > 0 || pullRefresh.isRefreshing) && (
                <div
                  className={styles.pullRefreshSpinner}
                  style={
                    pullRefresh.isRefreshing
                      ? undefined
                      : {
                          animation: 'none',
                          transform: `rotate(${Math.min(1, pullRefresh.pullDistance / PULL_THRESHOLD_PX) * 360}deg)`,
                        }
                  }
                />
              )}
            </div>
          )}
          <div
            className={styles.modalPaneBody}
            style={
              pullRefresh.pullDistance > 0
                ? { transform: `translateY(${pullRefresh.pullDistance}px)` }
                : undefined
            }
          >
            <button
              type="button"
              className={`float-btn modal-back-btn ${styles.modalFloatingBack}${modalScrollHidden ? ` ${styles.modalFloatingBackScrollHidden}` : ''}`}
              onClick={canGoBack ? onBack : onClose}
              aria-label={canGoBack ? 'Back' : 'Close'}
              title={canGoBack ? 'Back' : 'Close'}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
            {!hideTopBar && (
              <div className={`${styles.modalTopBar} ${transparentTopBar ? styles.modalTopBarTransparent : ''} ${styles.modalTopBarActionsBelow}`}>
                <div className={styles.modalTopBarLeft} aria-hidden="true">
                  {/* Back/close is the floating circle button only (mobile and desktop) */}
                </div>
                <div ref={setTopBarSlotEl} className={styles.modalTopBarSlot} />
                <div ref={setTopBarRightSlotEl} className={styles.modalTopBarRight} />
              </div>
            )}
            <div
              ref={scrollRef}
              data-modal-scroll
              className={`${styles.scroll} ${transparentTopBar ? styles.scrollWithTransparentBar : ''} ${styles.scrollWithFloatingBack}`}
              onTouchStart={pullRefresh.onTouchStart}
              onTouchMove={pullRefresh.onTouchMove}
              onTouchEnd={pullRefresh.onTouchEnd}
            >
              <ModalScrollProvider scrollRef={scrollRef}>
                {children}
              </ModalScrollProvider>
            </div>
          </div>
        </div>
      </div>
    </ModalTopBarSlotContext.Provider>
  )

  return createPortal(modal, document.body)
}
