import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  applyModalKeyboardInset,
  estimateMobileKeyboardInset,
  inferMobileKeyboardInset,
  isEditableField,
  MOBILE_KEYBOARD_INSET_THRESHOLD,
} from '../lib/mobileKeyboardInset'

type UseMobileKeyboardInsetOptions = {
  /** When true, reserve estimated inset as soon as enabled (compose). When false, wait for first field focus (modal). */
  reserveImmediately?: boolean
  /** Container for focusin listener (modal overlay / compose sheet). */
  containerRef?: RefObject<HTMLElement | null>
  /** Skip visualViewport resize updates (e.g. while file picker is opening). */
  shouldSkipUpdate?: () => boolean
}

/**
 * Track mobile on-screen keyboard inset via visualViewport resize only.
 * Do not listen to visualViewport scroll — that tracks iOS viewport panning and
 * spikes bottom offsets so overlays jump too high.
 */
export function useMobileKeyboardInset(
  enabled: boolean,
  options: UseMobileKeyboardInsetOptions = {},
): number {
  const { reserveImmediately = false, containerRef, shouldSkipUpdate } = options
  const [inset, setInset] = useState(0)
  const keyboardUsedRef = useRef(false)
  const shouldSkipUpdateRef = useRef(shouldSkipUpdate)
  shouldSkipUpdateRef.current = shouldSkipUpdate

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      setInset(0)
      keyboardUsedRef.current = false
      applyModalKeyboardInset(containerRef?.current ?? null, 0)
      return
    }

    const vv = window.visualViewport
    if (!vv) return

    const viewport = vv
    const container = containerRef?.current ?? null

    function commit(nextInset: number) {
      setInset(nextInset)
      applyModalKeyboardInset(container, nextInset)
    }

    function update() {
      if (shouldSkipUpdateRef.current?.()) return
      const inferred = inferMobileKeyboardInset()
      if (inferred > MOBILE_KEYBOARD_INSET_THRESHOLD) {
        keyboardUsedRef.current = true
        commit(inferred)
      } else if (!keyboardUsedRef.current && reserveImmediately) {
        commit(estimateMobileKeyboardInset(viewport.height))
      } else if (!keyboardUsedRef.current) {
        commit(0)
      } else {
        keyboardUsedRef.current = false
        commit(0)
      }
    }

    function onFocusIn(e: FocusEvent) {
      if (reserveImmediately) return
      if (!isEditableField(e.target)) return
      if (container && !container.contains(e.target)) return
      if (keyboardUsedRef.current) return
      keyboardUsedRef.current = true
      commit(estimateMobileKeyboardInset(viewport.height))
    }

    update()

    viewport.addEventListener('resize', update)
    if (container && !reserveImmediately) {
      container.addEventListener('focusin', onFocusIn, true)
    }

    return () => {
      viewport.removeEventListener('resize', update)
      if (container && !reserveImmediately) {
        container.removeEventListener('focusin', onFocusIn, true)
      }
      keyboardUsedRef.current = false
      applyModalKeyboardInset(container, 0)
    }
  }, [enabled, reserveImmediately, containerRef])

  return inset
}
