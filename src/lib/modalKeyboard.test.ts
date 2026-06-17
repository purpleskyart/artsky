import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  gateKeyboardShortcutsForEditable,
  getFocusedEditableElement,
  isEditableElement,
  shouldBlockGridKeysForEditableTarget,
} from './modalKeyboard'

describe('modalKeyboard editable gating', () => {
  let input: HTMLInputElement
  let button: HTMLButtonElement

  beforeEach(() => {
    input = document.createElement('input')
    input.type = 'search'
    document.body.appendChild(input)
    button = document.createElement('button')
    document.body.appendChild(button)
  })

  afterEach(() => {
    input.remove()
    button.remove()
  })

  it('detects text inputs but not buttons', () => {
    expect(isEditableElement(input)).toBe(true)
    expect(isEditableElement(button)).toBe(false)
  })

  it('blocks shortcuts when an editable field is focused', () => {
    input.focus()
    expect(getFocusedEditableElement()).toBe(input)
    expect(shouldBlockGridKeysForEditableTarget(document.body)).toBe(true)
  })

  it('allows shortcuts when nothing editable is focused', () => {
    button.focus()
    expect(getFocusedEditableElement()).toBe(null)
    expect(shouldBlockGridKeysForEditableTarget(document.body)).toBe(false)
  })

  it('ignores editables outside the modal when inModal is true', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    document.body.appendChild(dialog)
    input.focus()
    expect(shouldBlockGridKeysForEditableTarget(document.body, true)).toBe(false)
    dialog.appendChild(input)
    input.focus()
    expect(shouldBlockGridKeysForEditableTarget(document.body, true)).toBe(true)
    dialog.remove()
  })

  it('blurs the focused field on Escape only', () => {
    input.focus()
    const blurSpy = vi.spyOn(input, 'blur')
    const wEvent = new KeyboardEvent('keydown', { key: 'w', bubbles: true })
    expect(gateKeyboardShortcutsForEditable(wEvent)).toBe(true)
    expect(blurSpy).not.toHaveBeenCalled()

    const escEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    expect(gateKeyboardShortcutsForEditable(escEvent)).toBe(true)
    expect(blurSpy).toHaveBeenCalled()
  })
})
