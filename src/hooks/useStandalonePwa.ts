import { useSyncExternalStore } from 'react'

/**
 * True when the app runs as an installed PWA (home screen / standalone), not in a normal browser tab.
 * Mobile Safari in-tab uses native pull-to-refresh; we only attach custom pull-to-refresh here.
 */
function subscribe(cb: () => void) {
  if (typeof window === 'undefined') return () => {}
  const mqStandalone = window.matchMedia('(display-mode: standalone)')
  const mqFullscreen = window.matchMedia('(display-mode: fullscreen)')
  const mqMinimal = window.matchMedia('(display-mode: minimal-ui)')
  mqStandalone.addEventListener('change', cb)
  mqFullscreen.addEventListener('change', cb)
  mqMinimal.addEventListener('change', cb)
  return () => {
    mqStandalone.removeEventListener('change', cb)
    mqFullscreen.removeEventListener('change', cb)
    mqMinimal.removeEventListener('change', cb)
  }
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  if (window.matchMedia('(display-mode: fullscreen)').matches) return true
  if (window.matchMedia('(display-mode: minimal-ui)').matches) return true
  const nav = window.navigator as Navigator & { standalone?: boolean }
  if (nav.standalone === true) return true
  return false
}

function getServerSnapshot() {
  return false
}

export function useStandalonePwa(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
