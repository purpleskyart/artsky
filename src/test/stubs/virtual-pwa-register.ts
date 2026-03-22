/** Vitest stub for vite-plugin-pwa’s `virtual:pwa-register` dynamic import. */
export function registerSW(_options?: {
  onNeedRefresh?: () => void
  onOfflineReady?: () => void
}): (reloadPage?: boolean) => Promise<void> {
  return async (_reloadPage?: boolean) => {}
}
