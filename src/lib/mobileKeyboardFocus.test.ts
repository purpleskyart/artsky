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

  it('adds temporary padding when the scroll root cannot scroll the field above the keyboard', async () => {
    Object.defineProperty(scrollRoot, 'clientHeight', { value: 400, configurable: true })
    Object.defineProperty(scrollRoot, 'scrollHeight', { value: 400, configurable: true })
    scrollRoot.scrollTop = 0

    vi.spyOn(textarea, 'getBoundingClientRect').mockReturnValue({
      top: 320,
      bottom: 360,
      left: 0,
      right: 100,
      width: 100,
      height: 40,
      x: 0,
      y: 320,
      toJSON: () => ({}),
    })
    vi.spyOn(form, 'getBoundingClientRect').mockReturnValue({
      top: 300,
      bottom: 420,
      left: 0,
      right: 100,
      width: 100,
      height: 120,
      x: 0,
      y: 300,
      toJSON: () => ({}),
    })

    const dispose = scrollFieldAboveKeyboard(textarea)
    await flushRaf(3)

    expect(scrollRoot.dataset.keyboardScrollPad).toBeTruthy()
    expect(Number(scrollRoot.dataset.keyboardScrollPad)).toBeGreaterThan(0)
    expect(scrollRoot.style.paddingBottom).toMatch(/^\d+px$/)

    dispose()
    expect(scrollRoot.dataset.keyboardScrollPad).toBeUndefined()
    expect(scrollRoot.style.paddingBottom).toBe('')
  })
})
