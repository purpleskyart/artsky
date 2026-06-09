/**
 * Phone/tablet vs desktop layout boundary.
 * Below DESKTOP_BREAKPOINT: floating nav, full-screen modals, no fixed header.
 * At/above: fixed header, modal cards, multi-column auto grid.
 *
 * Keep CSS @media values in sync: min-width 1280px, max-width 1279px.
 */
export const DESKTOP_BREAKPOINT = 1280

export function getDesktopSnapshot(): boolean {
  return typeof window !== 'undefined' ? window.innerWidth >= DESKTOP_BREAKPOINT : false
}

export function subscribeDesktop(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const mq = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

export function getMobileSnapshot(): boolean {
  return typeof window !== 'undefined' ? window.innerWidth < DESKTOP_BREAKPOINT : false
}

export function subscribeMobile(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const mq = window.matchMedia(`(max-width: ${DESKTOP_BREAKPOINT - 1}px)`)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
