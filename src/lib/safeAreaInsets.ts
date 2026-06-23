/** CSS custom properties written to `document.documentElement`. */
export const SAFE_AREA_CSS_VARS = {
  top: '--app-safe-top',
  right: '--app-safe-right',
  bottom: '--app-safe-bottom',
  left: '--app-safe-left',
} as const

export type SafeAreaInsets = {
  top: number
  right: number
  bottom: number
  left: number
}

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof window.matchMedia === 'function') {
    if (window.matchMedia('(display-mode: standalone)').matches) return true
    if (window.matchMedia('(display-mode: fullscreen)').matches) return true
    if (window.matchMedia('(display-mode: minimal-ui)').matches) return true
  }
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPhone|iPad|iPod/i.test(navigator.userAgent || '')
}

/**
 * iOS home-screen PWAs often report env(safe-area-inset-top) as 0 despite viewport-fit=cover.
 * Estimate status-bar + notch height from the shorter screen edge (CSS px).
 */
export function estimateIosStandaloneTopInset(): number {
  if (typeof window === 'undefined') return 47
  const minSide = Math.min(window.screen.width, window.screen.height)
  const maxSide = Math.max(window.screen.width, window.screen.height)
  if (minSide >= 768) return 24
  if (minSide >= 393) return 59
  if (maxSide >= 812) return 47
  return 20
}

/**
 * iOS home-screen PWAs often report env(safe-area-inset-bottom) as 0 on first paint.
 * Home-indicator iPhones use ~34px; classic home-button phones use 0.
 */
export function estimateIosStandaloneBottomInset(): number {
  if (typeof window === 'undefined') return 0
  const minSide = Math.min(window.screen.width, window.screen.height)
  const maxSide = Math.max(window.screen.width, window.screen.height)
  if (maxSide >= 812 && minSide >= 375) return 34
  return 0
}

/** Read env(safe-area-inset-*) via a probe element (returns 0 when unsupported). */
export function measureEnvSafeAreaInsets(): SafeAreaInsets {
  if (typeof document === 'undefined') {
    return { top: 0, right: 0, bottom: 0, left: 0 }
  }
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;top:0;left:0;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);visibility:hidden;pointer-events:none;'
  document.documentElement.appendChild(probe)
  const cs = getComputedStyle(probe)
  const insets = {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  }
  document.documentElement.removeChild(probe)
  return insets
}

export function resolveSafeAreaInsets(measured: SafeAreaInsets): SafeAreaInsets {
  if (!isStandalonePwa() || !isIos()) return measured
  const top =
    measured.top >= 20 ? measured.top : Math.max(measured.top, estimateIosStandaloneTopInset())
  const bottom =
    measured.bottom >= 20
      ? measured.bottom
      : Math.max(measured.bottom, estimateIosStandaloneBottomInset())
  return { ...measured, top, bottom }
}

/** Largest insets seen this session — env() can report 0 while the keyboard is open. */
let sessionSafeAreaInsets: SafeAreaInsets | null = null

export function isLikelyKeyboardOpen(): boolean {
  if (typeof window === 'undefined') return false
  const vv = window.visualViewport
  if (!vv) return false
  return window.innerHeight - vv.offsetTop - vv.height > 120
}

function mergeMonotonicInsets(next: SafeAreaInsets): SafeAreaInsets {
  if (!sessionSafeAreaInsets) {
    sessionSafeAreaInsets = next
    return next
  }
  sessionSafeAreaInsets = {
    top: Math.max(next.top, sessionSafeAreaInsets.top),
    right: Math.max(next.right, sessionSafeAreaInsets.right),
    bottom: Math.max(next.bottom, sessionSafeAreaInsets.bottom),
    left: Math.max(next.left, sessionSafeAreaInsets.left),
  }
  return sessionSafeAreaInsets
}

export function resetSessionSafeAreaInsets(): void {
  sessionSafeAreaInsets = null
}

export function applySafeAreaInsets(insets: SafeAreaInsets): void {
  if (typeof document === 'undefined') return
  const stable = mergeMonotonicInsets(insets)
  const html = document.documentElement
  html.style.setProperty(SAFE_AREA_CSS_VARS.top, `${stable.top}px`)
  html.style.setProperty(SAFE_AREA_CSS_VARS.right, `${stable.right}px`)
  html.style.setProperty(SAFE_AREA_CSS_VARS.bottom, `${stable.bottom}px`)
  html.style.setProperty(SAFE_AREA_CSS_VARS.left, `${stable.left}px`)
}

/** Measure env() values and publish --app-safe-* (with iOS standalone top fallback). */
export function initSafeAreaInsets(): SafeAreaInsets {
  if (typeof document === 'undefined') {
    return { top: 0, right: 0, bottom: 0, left: 0 }
  }
  if (isLikelyKeyboardOpen() && sessionSafeAreaInsets) {
    applySafeAreaInsets(sessionSafeAreaInsets)
    return sessionSafeAreaInsets
  }
  const html = document.documentElement
  if (isStandalonePwa()) {
    html.setAttribute('data-standalone-pwa', '')
  } else {
    html.removeAttribute('data-standalone-pwa')
  }
  const resolved = resolveSafeAreaInsets(measureEnvSafeAreaInsets())
  applySafeAreaInsets(resolved)
  return resolved
}

let listenersBound = false

/**
 * Call once at startup. Safe-area insets only change on orientation change, so we re-measure on
 * `orientationchange` plus a few deferred passes after load (env() can report 0 on first paint).
 *
 * We deliberately do NOT re-measure on `visualViewport` resize: that event also fires when the
 * on-screen keyboard opens/closes and when the mobile browser toolbar shows/hides during scroll.
 * In those cases `env(safe-area-inset-bottom)` transiently changes (iOS reports ~0 while the
 * keyboard is up), which would shift fixed chrome that depends on `--app-safe-bottom` — e.g. the
 * bottom navbar visibly drifting while scrolling after a modal text field was focused.
 */
export function bindSafeAreaInsetListeners(): void {
  if (typeof window === 'undefined' || listenersBound) return
  listenersBound = true
  const remeasure = () => initSafeAreaInsets()
  window.addEventListener('orientationchange', () => {
    resetSessionSafeAreaInsets()
    setTimeout(remeasure, 100)
  })
  // Catch late env() availability without reacting to keyboard / toolbar viewport changes.
  setTimeout(remeasure, 300)
  setTimeout(remeasure, 1000)
}

/**
 * Re-stabilize fixed chrome after a modal/popup closes. iOS can leave the layout viewport
 * offset after keyboard use; restoring scroll + safe area once env() settles prevents the
 * bottom nav from drifting on subsequent feed scrolls.
 */
export function restoreMobileLayoutAfterPopup(scrollY?: number): void {
  if (typeof window === 'undefined') return
  const y = scrollY ?? window.scrollY
  window.scrollTo({ top: y, left: 0, behavior: 'instant' })
  requestAnimationFrame(() => {
    window.scrollTo({ top: y, left: 0, behavior: 'instant' })
  })
  setTimeout(() => {
    initSafeAreaInsets()
    window.scrollTo({ top: y, left: 0, behavior: 'instant' })
  }, 300)
}
