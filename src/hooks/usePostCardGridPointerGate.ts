import { useCallback, useEffect, useRef, useState } from 'react'
import { useIsDesktop } from '../context/ViewModeContext'

const REARM_PX = 12
const WHEEL_MOVE_SUPPRESS_MS = 160

export type CardHoverGateOptions = {
  /** e.g. profile/tag modal: no hover-driven focus changes */
  disabled?: boolean
  /** Feed: touch hover must not move keyboard selection (matches previous FeedColumn behavior). */
  applyOnTouch?: boolean
  onApplied?: () => void
}

/**
 * After W/S/A/D (or arrows), ignore :hover-driven focus until the user moves the pointer
 * deliberately. Wheel/trackpad scroll is not treated as pointer movement. Applies with
 * PostCard.module.css rules on [data-feed-cards].
 */
export function usePostCardGridPointerGate() {
  const isDesktop = useIsDesktop()
  const [keyboardNavActive, setKeyboardNavActive] = useState(false)
  const [hoverFocusEnabled, setHoverFocusEnabled] = useState(true)
  const hoverFocusEnabledRef = useRef(true)
  const mouseMovedRef = useRef(true)
  const lastMouseClientPosRef = useRef<{ x: number; y: number } | null>(null)
  const mouseRearmStartPosRef = useRef<{ x: number; y: number } | null>(null)
  const wheelSuppressUntilRef = useRef(0)

  useEffect(() => {
    const onWheel = () => {
      wheelSuppressUntilRef.current = performance.now() + WHEEL_MOVE_SUPPRESS_MS
    }
    window.addEventListener('wheel', onWheel, { passive: true })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (performance.now() < wheelSuppressUntilRef.current) return
      const prev = lastMouseClientPosRef.current
      const next = { x: Math.round(e.clientX), y: Math.round(e.clientY) }
      lastMouseClientPosRef.current = next
      if (prev && prev.x === next.x && prev.y === next.y) return
      if (!mouseMovedRef.current) {
        const start = mouseRearmStartPosRef.current
        if (start) {
          const dx = next.x - start.x
          const dy = next.y - start.y
          if (dx * dx + dy * dy < REARM_PX * REARM_PX) return
        }
        mouseMovedRef.current = true
      }
    }
    window.addEventListener('mousemove', onMouseMove)
    return () => window.removeEventListener('mousemove', onMouseMove)
  }, [])

  const beginKeyboardNavigation = useCallback(() => {
    if (hoverFocusEnabledRef.current) {
      hoverFocusEnabledRef.current = false
      setHoverFocusEnabled(false)
    }
    mouseMovedRef.current = false
    mouseRearmStartPosRef.current = lastMouseClientPosRef.current
    setKeyboardNavActive(true)
  }, [])

  const tryHoverSelectCard = useCallback(
    (
      cardIndex: number,
      getFocusedCardIndex: () => number,
      applyFocus: (cardIndex: number) => void,
      options?: CardHoverGateOptions,
    ) => {
      if (options?.disabled) return
      if (!isDesktop) {
        if (options?.applyOnTouch === false) return
        applyFocus(cardIndex)
        return
      }
      if (!mouseMovedRef.current) return
      if (getFocusedCardIndex() === cardIndex) return
      mouseMovedRef.current = false
      hoverFocusEnabledRef.current = true
      setHoverFocusEnabled(true)
      setKeyboardNavActive(false)
      applyFocus(cardIndex)
      options?.onApplied?.()
    },
    [isDesktop],
  )

  const gridPointerGateProps = {
    'data-feed-cards': true as const,
    'data-keyboard-nav': keyboardNavActive || undefined,
    'data-hover-focus-enabled': hoverFocusEnabled ? undefined : ('false' as const),
  }

  return {
    beginKeyboardNavigation,
    tryHoverSelectCard,
    gridPointerGateProps,
    lastMouseClientPosRef,
    mouseRearmStartPosRef,
    mouseMovedRef,
    hoverFocusEnabledRef,
  }
}
