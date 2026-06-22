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

export function applySafeAreaInsets(insets: SafeAreaInsets): void {
  if (typeof document === 'undefined') return
  const html = document.documentElement
  html.style.setProperty(SAFE_AREA_CSS_VARS.top, `${insets.top}px`)
  html.style.setProperty(SAFE_AREA_CSS_VARS.right, `${insets.right}px`)
  html.style.setProperty(SAFE_AREA_CSS_VARS.bottom, `${insets.bottom}px`)
  html.style.setProperty(SAFE_AREA_CSS_VARS.left, `${insets.left}px`)
}

/** Measure env() values and publish --app-safe-* (with iOS standalone top fallback). */
export function initSafeAreaInsets(): SafeAreaInsets {
  if (typeof document === 'undefined') {
    return { top: 0, right: 0, bottom: 0, left: 0 }
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

/** Call once at startup; re-measures on orientation change in standalone mode. */
export function bindSafeAreaInsetListeners(): void {
  if (typeof window === 'undefined' || listenersBound) return
  listenersBound = true
  const remeasure = () => initSafeAreaInsets()
  window.addEventListener('orientationchange', () => {
    setTimeout(remeasure, 100)
  })
  window.visualViewport?.addEventListener('resize', remeasure)
}
