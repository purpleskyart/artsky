import { flushSync } from 'react-dom'

export type ViewTransitionDirection = 'left' | 'right'

type StartViewTransition = (callback: () => void) => { finished: Promise<void> }

/**
 * Wrap a synchronous React state update in the View Transitions API where supported
 * (Chromium). The update is flushed synchronously inside the transition callback so the
 * old/new snapshots capture the DOM change. Falls back to applying the update directly.
 * `direction` slides content like a native page push (see index.css ::view-transition rules);
 * without it the change cross-fades.
 */
export function withViewTransition(
  apply: () => void,
  direction?: ViewTransitionDirection,
): void {
  if (typeof document === 'undefined') {
    apply()
    return
  }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    apply()
    return
  }
  const maybeStart = (document as unknown as { startViewTransition?: StartViewTransition })
    .startViewTransition
  if (typeof maybeStart !== 'function') {
    apply()
    return
  }
  if (direction) {
    document.documentElement.dataset.viewTransitionDirection = direction
  }
  const transition = maybeStart.call(document, () => {
    flushSync(apply)
  })
  void transition.finished.finally(() => {
    delete document.documentElement.dataset.viewTransitionDirection
  })
}
