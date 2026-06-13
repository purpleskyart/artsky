import { useEffect, type MutableRefObject } from 'react'

export interface UseKeyboardScrollIntoViewOptions {
  keyboardFocusIndex: number
  scrollIntoViewFromKeyboardRef: MutableRefObject<boolean>
  lastScrollIntoViewIndexRef: MutableRefObject<number>
  /** Return the element to scroll into view for the current focus index. */
  getScrollTarget: () => HTMLElement | null | undefined
  block?: ScrollLogicalPosition
}

/** Scroll focused card/media into view only when focus changed via keyboard (not mouse hover). */
export function useKeyboardScrollIntoView({
  keyboardFocusIndex,
  scrollIntoViewFromKeyboardRef,
  lastScrollIntoViewIndexRef,
  getScrollTarget,
  block = 'center',
}: UseKeyboardScrollIntoViewOptions) {
  useEffect(() => {
    if (!scrollIntoViewFromKeyboardRef.current) return
    scrollIntoViewFromKeyboardRef.current = false
    if (keyboardFocusIndex === lastScrollIntoViewIndexRef.current) return
    lastScrollIntoViewIndexRef.current = keyboardFocusIndex
    const raf = requestAnimationFrame(() => {
      const el = getScrollTarget()
      if (el) el.scrollIntoView({ behavior: 'smooth', block, inline: 'nearest' })
    })
    return () => cancelAnimationFrame(raf)
  }, [keyboardFocusIndex, scrollIntoViewFromKeyboardRef, lastScrollIntoViewIndexRef, getScrollTarget, block])
}
