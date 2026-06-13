import type { MasonryNavColumn } from './masonryHorizontalNav'
import { indexAbove, indexBelow, indexLeftByRow, indexRightByRow, pickAdjacentCardIndexByViewport, type ViewportRect } from './masonryHorizontalNav'

export interface GridNavContext {
  focusIndex: number
  cardCount: number
  cols: number
  columns: MasonryNavColumn[] | null
  focusTargetsLength: number
  firstByCard: number[]
  lastByCard: number[]
  currentCardIndex: number
  currentMediaIndex: number
}

export function computeFocusMoveUp(ctx: GridNavContext): number | null {
  const { focusIndex, firstByCard, lastByCard, currentCardIndex, cols, columns } = ctx
  const onFirstImageOfCard = focusIndex === firstByCard[currentCardIndex]
  if (!onFirstImageOfCard) return Math.max(0, focusIndex - 1)
  const nextCard = cols >= 2 && columns ? indexAbove(columns, currentCardIndex) : Math.max(0, currentCardIndex - 1)
  if (nextCard === currentCardIndex) return null
  return lastByCard[nextCard] ?? firstByCard[nextCard] ?? null
}

export function computeFocusMoveDown(ctx: GridNavContext): number | null {
  const { focusIndex, firstByCard, lastByCard, currentCardIndex, cardCount, cols, columns, focusTargetsLength } = ctx
  const onLastImageOfCard = focusIndex === lastByCard[currentCardIndex]
  if (!onLastImageOfCard) return Math.min(focusTargetsLength - 1, focusIndex + 1)
  const nextCard =
    cols >= 2 && columns ? indexBelow(columns, currentCardIndex) : Math.min(cardCount - 1, currentCardIndex + 1)
  if (nextCard === currentCardIndex) return null
  return firstByCard[nextCard] ?? null
}

export function computeFocusMoveHorizontal(
  ctx: GridNavContext,
  goLeft: boolean,
  measureCard: (cardIndex: number) => ViewportRect | null,
): number {
  const { focusIndex, firstByCard, lastByCard, currentCardIndex, currentMediaIndex, cols, columns } = ctx
  if (cols < 2 || !columns) return focusIndex
  const byView = pickAdjacentCardIndexByViewport(columns, goLeft ? -1 : 1, currentCardIndex, measureCard)
  const nextCard = byView ?? (goLeft ? indexLeftByRow(columns, currentCardIndex) : indexRightByRow(columns, currentCardIndex))
  if (nextCard === currentCardIndex) return focusIndex
  const n = lastByCard[nextCard] - firstByCard[nextCard] + 1
  const m = Math.min(currentMediaIndex, Math.max(0, n - 1))
  return firstByCard[nextCard] + m
}

/** True when an open menu should block W/S navigation keys. */
export function isGridNavBlockedByOpenMenus(options: {
  actionsMenuOpenForIndex: number | null
  /** Card index of the currently focused item (not flat focus index). */
  focusedCardIndex: number
  includeCollectionMenu?: boolean
  includeNotificationsMenu?: boolean
}): boolean {
  const {
    actionsMenuOpenForIndex,
    focusedCardIndex,
    includeCollectionMenu = true,
    includeNotificationsMenu = true,
  } = options
  const focusInActionsMenu = (document.activeElement as HTMLElement)?.closest?.('[role="menu"]')
  const focusInCollectionMenu = includeCollectionMenu
    ? (document.activeElement as HTMLElement)?.closest?.('[data-collection-menu="true"]')
    : null
  const collectionMenuOpen = includeCollectionMenu && document.querySelector('[data-collection-menu="true"]') != null
  const menuOpenForFocusedCard = actionsMenuOpenForIndex === focusedCardIndex
  const focusInNotificationsMenu = includeNotificationsMenu
    ? (document.activeElement as HTMLElement)?.closest?.('[data-notifications-list]')
    : null
  const notificationsMenuOpen =
    includeNotificationsMenu && document.querySelector('[data-notifications-list]') != null
  return !!(
    focusInActionsMenu ||
    focusInCollectionMenu ||
    collectionMenuOpen ||
    menuOpenForFocusedCard ||
    focusInNotificationsMenu ||
    notificationsMenuOpen
  )
}

export function isHorizontalKeyRepeat(e: KeyboardEvent): boolean {
  const key = e.key.toLowerCase()
  return (
    e.repeat &&
    (key === 'a' || key === 'd' || key === 'j' || key === 'l' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')
  )
}

export function isGridNavigationKey(key: string, _code: string, arrowKey: string): boolean {
  return (
    key === 'w' ||
    key === 's' ||
    key === 'a' ||
    key === 'd' ||
    key === 'i' ||
    key === 'j' ||
    key === 'k' ||
    key === 'l' ||
    arrowKey === 'ArrowUp' ||
    arrowKey === 'ArrowDown' ||
    arrowKey === 'ArrowLeft' ||
    arrowKey === 'ArrowRight'
  )
}

export function isGridActionKey(key: string, code: string): boolean {
  return (
    key === 'e' ||
    key === 'o' ||
    key === 'enter' ||
    key === 'r' ||
    key === 'c' ||
    code === 'Space' ||
    key === 'm' ||
    key === '`' ||
    key === 'f'
  )
}
