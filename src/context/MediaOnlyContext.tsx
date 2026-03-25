import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useToast } from './ToastContext'
import { useSession } from './SessionContext'

const STORAGE_KEY = 'artsky-feed-media-only'

export type MediaMode = 'mediaText' | 'media' | 'text'

export const MEDIA_MODE_LABELS: Record<MediaMode, string> = {
  mediaText: 'All Posts',
  media: 'Media Posts',
  text: 'Text Posts',
}

type MediaOnlyContextValue = {
  /** Current mode: mediaText (show all with media+text), media (filter to posts with media), text (hide media in cards). */
  mediaMode: MediaMode
  /** @deprecated Use mediaMode === 'media' */
  mediaOnly: boolean
  setMediaMode: (value: MediaMode) => void
  /** Cycle: Media+Text → Media only → Text only → Media+Text. */
  cycleMediaMode: (options?: { showToast?: boolean }) => void
  /** @deprecated Use setMediaMode or cycleMediaMode */
  setMediaOnly: (value: boolean) => void
  /** @deprecated Use cycleMediaMode */
  toggleMediaOnly: (options?: { showToast?: boolean }) => void
}

const MediaOnlyContext = createContext<MediaOnlyContextValue | null>(null)

/** When nothing is stored: guests default to Media only; logged-in default to All Posts. */
function readStored(useLoggedInDefaults: boolean): MediaMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'media' || v === 'text' || v === 'mediaText') return v
    if (v === '1' || v === 'true') return 'media' // legacy
    return useLoggedInDefaults ? 'mediaText' : 'media'
  } catch {
    return useLoggedInDefaults ? 'mediaText' : 'media'
  }
}

export function MediaOnlyProvider({ children }: { children: ReactNode }) {
  const { session } = useSession()
  const did = session?.did
  const useLoggedInDefaults = Boolean(did)
  return (
    <MediaOnlyProviderInner key={did ?? '__guest__'} useLoggedInDefaults={useLoggedInDefaults}>
      {children}
    </MediaOnlyProviderInner>
  )
}

function MediaOnlyProviderInner({
  children,
  useLoggedInDefaults,
}: {
  children: ReactNode
  useLoggedInDefaults: boolean
}) {
  const toast = useToast()
  const [mediaMode, setMediaModeState] = useState<MediaMode>(() => readStored(useLoggedInDefaults))

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mediaMode)
    } catch {
      // ignore
    }
  }, [mediaMode])

  const setMediaMode = useCallback((value: MediaMode) => {
    setMediaModeState(value)
  }, [])

  const cycleMediaMode = useCallback((options?: { showToast?: boolean }) => {
    setMediaModeState((m) => {
      const next = m === 'mediaText' ? 'media' : m === 'media' ? 'text' : 'mediaText'
      if (options?.showToast !== false) toast?.showToast(MEDIA_MODE_LABELS[next])
      return next
    })
  }, [toast])

  const setMediaOnly = useCallback((value: boolean) => {
    setMediaModeState(value ? 'media' : 'mediaText')
  }, [])

  const toggleMediaOnly = useCallback((options?: { showToast?: boolean }) => {
    cycleMediaMode(options)
  }, [cycleMediaMode])

  const mediaOnly = mediaMode === 'media'

  return (
    <MediaOnlyContext.Provider value={{ mediaMode, mediaOnly, setMediaMode, cycleMediaMode, setMediaOnly, toggleMediaOnly }}>
      {children}
    </MediaOnlyContext.Provider>
  )
}

export function useMediaOnly() {
  const ctx = useContext(MediaOnlyContext)
  if (!ctx) {
    return {
      mediaMode: 'mediaText' as MediaMode,
      mediaOnly: false,
      setMediaMode: () => {},
      cycleMediaMode: () => {},
      setMediaOnly: () => {},
      toggleMediaOnly: () => {},
    }
  }
  return ctx
}
