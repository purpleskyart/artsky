import { useEffect, type MutableRefObject, type RefObject } from 'react'
import type { TimelineItem } from '../lib/bsky'
import type { MasonryNavColumn } from '../lib/masonryHorizontalNav'
import {
  computeFocusMoveDown,
  computeFocusMoveHorizontal,
  computeFocusMoveUp,
  isGridNavBlockedByOpenMenus,
  isHorizontalKeyRepeat,
  isMenuBlockedNavigationKey,
  shouldPreventDefaultFeedGridKey,
} from '../lib/gridKeyboardNav'
import { shouldUnderlayHandleGridKeys } from '../lib/modalKeyboard'

export interface MediaGridKeyboardShell {
  registerKeys: boolean
  useCapture: boolean
  claimKey: (e: KeyboardEvent) => void
  shouldBlockEditable: (target: HTMLElement) => boolean
  blurEditableOnEscape: (e: KeyboardEvent, target: HTMLElement) => void
}

export interface UseMediaGridKeyboardNavOptions {
  enabled: boolean
  /** Omit for full-page grids (e.g. feed); provide for modal grids. */
  keyboardShell?: MediaGridKeyboardShell | null
  inModal?: boolean
  isModalOpen?: boolean
  itemsRef: RefObject<TimelineItem[]>
  keyboardFocusIndexRef: RefObject<number>
  setKeyboardFocusIndex: (index: number | ((prev: number) => number)) => void
  focusTargetsRef: RefObject<{ cardIndex: number; mediaIndex: number }[]>
  firstFocusIndexForCardRef: RefObject<number[]>
  lastFocusIndexForCardRef: RefObject<number[]>
  colsRef: RefObject<number>
  getColumns: () => MasonryNavColumn[] | null
  cardRefsRef: RefObject<(HTMLElement | null)[]>
  mediaRefsRef: RefObject<Record<number, Record<number, HTMLElement | null>>>
  scrollIntoViewFromKeyboardRef: MutableRefObject<boolean>
  beginKeyboardNavigation: () => void
  actionsMenuOpenForIndexRef: RefObject<number | null>
  setActionsMenuOpenForIndex?: (index: number | null) => void
  blockConfirmRef?: RefObject<unknown>
  setBlockConfirm?: (value: null) => void
  includeCollectionMenu?: boolean
  includeNotificationsMenu?: boolean
  /** Full-page guard (feed modal URL, editable fields, etc.). Return false to ignore the key. */
  shouldHandleKeyDown?: (e: KeyboardEvent) => boolean
  /** Called at the start of each handled shortcut (feed: clear mouse-focus flag). */
  onBeforeKey?: () => void
  onOpenPost: (item: TimelineItem) => void
  onOpenReply?: (item: TimelineItem) => void
  onToggleActionsMenu?: (cardIndex: number, menuOpenForFocusedCard: boolean) => void
  onOpenCollectionMenu?: (cardIndex: number) => void
  onToggleLike?: (item: TimelineItem) => void
  onToggleFollow?: (item: TimelineItem) => void
  skipWhenPageModalOpen?: boolean
}

export function useMediaGridKeyboardNav(options: UseMediaGridKeyboardNavOptions) {
  const {
    enabled,
    keyboardShell = null,
    inModal = false,
    isModalOpen = false,
    itemsRef,
    keyboardFocusIndexRef,
    setKeyboardFocusIndex,
    focusTargetsRef,
    firstFocusIndexForCardRef,
    lastFocusIndexForCardRef,
    colsRef,
    getColumns,
    cardRefsRef,
    mediaRefsRef,
    scrollIntoViewFromKeyboardRef,
    beginKeyboardNavigation,
    actionsMenuOpenForIndexRef,
    setActionsMenuOpenForIndex,
    blockConfirmRef,
    setBlockConfirm,
    includeCollectionMenu = true,
    includeNotificationsMenu = true,
    shouldHandleKeyDown,
    onBeforeKey,
    onOpenPost,
    onOpenReply,
    onToggleActionsMenu,
    onOpenCollectionMenu,
    onToggleLike,
    onToggleFollow,
    skipWhenPageModalOpen = true,
  } = options

  useEffect(() => {
    if (!enabled) return
    if (keyboardShell && !keyboardShell.registerKeys) return

    const useCapture = keyboardShell?.useCapture ?? false
    const claimKey = keyboardShell?.claimKey
    const shouldBlockEditable = keyboardShell?.shouldBlockEditable
    const blurEditableOnEscape = keyboardShell?.blurEditableOnEscape

    const claim = (e: KeyboardEvent) => {
      claimKey?.(e)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (shouldHandleKeyDown && !shouldHandleKeyDown(e)) return

      if (keyboardShell) {
        if (skipWhenPageModalOpen && !inModal && isModalOpen) return
        const target = e.target as HTMLElement
        if (!shouldUnderlayHandleGridKeys(target, inModal)) return
        if (shouldBlockEditable?.(target)) {
          blurEditableOnEscape?.(e, target)
          return
        }
      }

      if (e.ctrlKey || e.metaKey) return

      const items = itemsRef.current ?? []
      if (items.length === 0) return

      onBeforeKey?.()

      const i = keyboardFocusIndexRef.current ?? -1
      const fromNone = i < 0
      const key = e.key.toLowerCase()
      const currentFocusTargets = focusTargetsRef.current ?? []
      const currentFirstByCard = firstFocusIndexForCardRef.current ?? []
      const currentLastByCard = lastFocusIndexForCardRef.current ?? []
      const currentCols = colsRef.current ?? 1
      const focusTarget = currentFocusTargets[i]
      const currentCardIndex = focusTarget?.cardIndex ?? 0
      const currentMediaIndex = focusTarget?.mediaIndex ?? 0
      const columns = currentCols >= 2 ? getColumns() : null
      const focusedItem = items[currentCardIndex] ?? null

      if (
        isGridNavBlockedByOpenMenus({
          actionsMenuOpenForIndex: actionsMenuOpenForIndexRef.current,
          focusedCardIndex: currentCardIndex,
          includeCollectionMenu,
          includeNotificationsMenu,
        }) &&
        isMenuBlockedNavigationKey(key, e.key)
      ) {
        return
      }

      if (isHorizontalKeyRepeat(e)) return

      if (blockConfirmRef?.current) {
        if (key === 'escape') {
          e.preventDefault()
          setBlockConfirm?.(null)
          return
        }
        return
      }

      if (shouldPreventDefaultFeedGridKey(key, e.code, e.key)) {
        e.preventDefault()
      }

      const navCtx = {
        focusIndex: i,
        cardCount: items.length,
        cols: currentCols,
        columns,
        focusTargetsLength: currentFocusTargets.length,
        firstByCard: currentFirstByCard,
        lastByCard: currentLastByCard,
        currentCardIndex,
        currentMediaIndex,
      }

      const initFocus = () => {
        if (currentFocusTargets.length > 0) {
          beginKeyboardNavigation()
          scrollIntoViewFromKeyboardRef.current = true
          setKeyboardFocusIndex(0)
        }
      }

      if (key === 'w' || key === 'i' || e.key === 'ArrowUp') {
        if (fromNone) {
          initFocus()
          claim(e)
          return
        }
        beginKeyboardNavigation()
        scrollIntoViewFromKeyboardRef.current = true
        const next = computeFocusMoveUp(navCtx)
        if (next === null) return
        setKeyboardFocusIndex(next)
        claim(e)
        return
      }

      if (key === 's' || key === 'k' || e.key === 'ArrowDown') {
        if (fromNone) {
          initFocus()
          claim(e)
          return
        }
        beginKeyboardNavigation()
        scrollIntoViewFromKeyboardRef.current = true
        const next = computeFocusMoveDown(navCtx)
        if (next === null) return
        setKeyboardFocusIndex(next)
        claim(e)
        return
      }

      if (key === 'a' || key === 'j' || e.key === 'ArrowLeft' || key === 'd' || key === 'l' || e.key === 'ArrowRight') {
        if (fromNone) {
          initFocus()
          claim(e)
          return
        }
        beginKeyboardNavigation()
        scrollIntoViewFromKeyboardRef.current = true
        const goLeft = key === 'a' || key === 'j' || e.key === 'ArrowLeft'
        const measureMediaForHorizontal = (cardIdx: number, mediaIdx: number) => {
          const el =
            mediaRefsRef.current?.[cardIdx]?.[mediaIdx] ??
            (mediaIdx === 0 ? cardRefsRef.current?.[cardIdx] : null)
          if (!el) return null
          const r = el.getBoundingClientRect()
          if (r.width <= 0 && r.height <= 0) return null
          return { top: r.top, left: r.left, width: r.width, height: r.height }
        }
        const measureCardForHorizontal = (cardIdx: number) => {
          const n = currentLastByCard[cardIdx] - currentFirstByCard[cardIdx] + 1
          const m =
            cardIdx === currentCardIndex
              ? currentMediaIndex
              : Math.min(currentMediaIndex, Math.max(0, n - 1))
          return measureMediaForHorizontal(cardIdx, m) ?? measureMediaForHorizontal(cardIdx, 0)
        }
        const next = computeFocusMoveHorizontal(navCtx, goLeft, measureCardForHorizontal, measureMediaForHorizontal)
        if (next !== i) setActionsMenuOpenForIndex?.(null)
        setKeyboardFocusIndex(next)
        claim(e)
        return
      }

      if ((key === 'm' || key === '`') && i >= 0 && onToggleActionsMenu) {
        onToggleActionsMenu(currentCardIndex, actionsMenuOpenForIndexRef.current === currentCardIndex)
        claim(e)
        return
      }

      if ((key === 'e' || key === 'o' || key === 'enter') && focusedItem) {
        onOpenPost(focusedItem)
        claim(e)
        return
      }

      if (key === 'r' && onOpenReply && focusedItem) {
        onOpenReply(focusedItem)
        claim(e)
        return
      }

      if (key === 'c' && onOpenCollectionMenu && i >= 0) {
        onOpenCollectionMenu(currentCardIndex)
        claim(e)
        return
      }

      if (e.code === 'Space' && onToggleLike && focusedItem) {
        onToggleLike(focusedItem)
        claim(e)
        return
      }

      if (key === 'f' && onToggleFollow && focusedItem) {
        if (fromNone) return
        onToggleFollow(focusedItem)
        claim(e)
        return
      }
    }

    window.addEventListener('keydown', onKeyDown, useCapture)
    return () => window.removeEventListener('keydown', onKeyDown, useCapture)
  }, [
    enabled,
    keyboardShell,
    inModal,
    isModalOpen,
    itemsRef,
    keyboardFocusIndexRef,
    setKeyboardFocusIndex,
    focusTargetsRef,
    firstFocusIndexForCardRef,
    lastFocusIndexForCardRef,
    colsRef,
    getColumns,
    cardRefsRef,
    mediaRefsRef,
    scrollIntoViewFromKeyboardRef,
    beginKeyboardNavigation,
    actionsMenuOpenForIndexRef,
    setActionsMenuOpenForIndex,
    blockConfirmRef,
    setBlockConfirm,
    includeCollectionMenu,
    includeNotificationsMenu,
    shouldHandleKeyDown,
    onBeforeKey,
    onOpenPost,
    onOpenReply,
    onToggleActionsMenu,
    onOpenCollectionMenu,
    onToggleLike,
    onToggleFollow,
    skipWhenPageModalOpen,
  ])
}
