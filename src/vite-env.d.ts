/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __GIT_COMMIT_DATE__: string

interface ImportMetaEnv {
  // No environment variables needed for client-side notification polling
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module 'virtual:pwa-register' {
  export interface RegisterSWOptions {
    immediate?: boolean
    onNeedRefresh?: () => void
    onOfflineReady?: () => void
    onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void
    onRegisterError?: (error: Error) => void
  }

  export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>
}

// Service Worker message types
interface ServiceWorkerMessage {
  type: 'NAVIGATE' | 'SKIP_WAITING' | 'GET_VERSION' | 'SHOW_NOTIFICATION'
  url?: string
  title?: string
  body?: string
  icon?: string
  data?: {
    url?: string
    type?: string
  }
}

interface ServiceWorkerResponse {
  type: 'VERSION'
  version: string
}
