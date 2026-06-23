import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { scrollFieldAboveKeyboard } from './mobileKeyboardFocus'

async function flushRaf(times = 2) {
  for (let i = 0; i < times; i++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
}

describe('scrollFieldAboveKeyboard', () => {
  let scrollRoot: HTMLDivElement
  let form: HTMLFormElement
  let textarea: HTMLTextAreaElement

  beforeEach(() => {
    scrollRoot = document.createElement('div')
    scrollRoot.setAttribute('data-modal-scroll', '')
    Object.defineProperty(scrollRoot, 'clientHeight', { value: 400, configurable: true })
    Object.defineProperty(scrollRoot, 'scrollHeight', { value: 1400, configurable: true })
    scrollRoot.scrollTop = 800

    form = document.createElement('form')
    textarea = document.createElement('textarea')
    form.appendChild(textarea)
    scrollRoot.appendChild(form)
    document.body.appendChild(scrollRoot)

    vi.stubGlobal('visualViewport', {
      height: 300,
      offsetTop: 0,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('scrolls minimally when the field bottom is below the visible band', async () => {
    const fieldTopInContent = 1080
    const fieldBottomInContent = 1120
    const formBottomInContent = 1140
    vi.spyOn(textarea, 'getBoundingClientRect').mockImplementation(() => ({
      top: fieldTopInContent - scrollRoot.scrollTop,
      bottom: fieldBottomInContent - scrollRoot.scrollTop,
      left: 0,
      right: 100,
      width: 100,
      height: 40,
      x: 0,
      y: fieldTopInContent - scrollRoot.scrollTop,
      toJSON: () => ({}),
    }))
    vi.spyOn(form, 'getBoundingClientRect').mockImplementation(() => ({
      top: fieldTopInContent - 20 - scrollRoot.scrollTop,
      bottom: formBottomInContent - scrollRoot.scrollTop,
      left: 0,
      right: 100,
      width: 100,
      height: 100,
      x: 0,
      y: fieldTopInContent - 20 - scrollRoot.scrollTop,
      toJSON: () => ({}),
    }))

    scrollFieldAboveKeyboard(textarea)
    await flushRaf()

    // visibleBottom ≈ 288; one minimal scroll (+52) brings the form submit row into view
    expect(scrollRoot.scrollTop).toBe(852)
  })

  it('does not scroll when the field is already fully visible', async () => {
    vi.spyOn(textarea, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 140,
      left: 0,
      right: 100,
      width: 100,
      height: 40,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    })
    vi.spyOn(form, 'getBoundingClientRect').mockReturnValue({
      top: 80,
      bottom: 180,
      left: 0,
      right: 100,
      width: 100,
      height: 100,
      x: 0,
      y: 80,
      toJSON: () => ({}),
    })

    scrollFieldAboveKeyboard(textarea)
    await flushRaf()

    expect(scrollRoot.scrollTop).toBe(800)
  })

  it('does not call scrollIntoView for keyboard sheet fields on mobile', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    const sheet = document.createElement('div')
    sheet.setAttribute('data-keyboard-sheet', '')
    const input = document.createElement('input')
    sheet.appendChild(input)
    document.body.appendChild(sheet)

    scrollFieldAboveKeyboard(input)
    await flushRaf()

    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('does not call scrollIntoView for any field on mobile outside modals', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    const input = document.createElement('input')
    document.body.appendChild(input)

    scrollFieldAboveKeyboard(input)
    await flushRaf()

    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
