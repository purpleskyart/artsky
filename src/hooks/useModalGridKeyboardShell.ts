import { useCallback, useEffect } from 'react'
import {
  blurEditableOnEscape,
  claimModalGridKey,
  modalGridUsesCapture,
  shouldBlockGridKeysForEditableTarget,
  shouldRegisterModalGridKeys,
} from '../lib/modalKeyboard'

/** Pull focus into the modal scroll area so background inputs don't block grid shortcuts. */
export function useModalScrollKeyboardFocus(
  scrollElement: HTMLDivElement | null,
  enabled: boolean,
  focusKey: string | undefined,
): void {
  useEffect(() => {
    if (!enabled || !scrollElement) return
    scrollElement.setAttribute('tabindex', '-1')
    const id = requestAnimationFrame(() => {
      scrollElement.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(id)
  }, [enabled, focusKey, scrollElement])
}

export function useModalGridKeyboardShell(inModal: boolean, isTopModal = true) {
  const registerKeys = shouldRegisterModalGridKeys(inModal, isTopModal)
  const useCapture = modalGridUsesCapture(inModal, isTopModal)

  const claimKey = useCallback(
    (e: KeyboardEvent) => {
      claimModalGridKey(e, inModal, isTopModal)
    },
    [inModal, isTopModal],
  )

  const shouldBlockEditable = useCallback(
    (target: HTMLElement) => shouldBlockGridKeysForEditableTarget(target, inModal),
    [inModal],
  )

  return {
    registerKeys,
    useCapture,
    claimKey,
    shouldBlockEditable,
    blurEditableOnEscape,
  }
}
