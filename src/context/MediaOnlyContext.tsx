import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { useToast } from './ToastContext'
import { useSession } from './SessionContext'
import { asyncStorage } from '../lib/AsyncStorage'

const STORAGE_KEY = 'artsky-feed-media-only'

export type MediaMode = 'mediaText' | 'media' | 'video' | 'text'

export const MEDIA_MODE_LABELS: Record<MediaMode, string> = {
  mediaText: 'All Posts',
  media: 'Media Posts',
  video: 'Video Posts',
  text: 'Text Posts',
}

type MediaOnlyContextValue = {
  /** Current mode: mediaText (show all with media+text), media (filter to posts with media), text (hide media in cards). */
  mediaMode: MediaMode
  setMediaMode: (value: MediaMode) => void
  /** Cycle: Media+Text → Media only → Video only → Text only → Media+Text. */
  cycleMediaMode: (options?: { showToast?: boolean }) => void
}

const MediaOnlyContext = createContext<MediaOnlyContextValue | null>(null)

/** When nothing is stored: guests default to Media only; logged-in default to All Posts. */
function getStored(useLoggedInDefaults: boolean): MediaMode {
  try {
    const v = asyncStorage.get<string>(STORAGE_KEY)
    if (v === 'media' || v === 'text' || v === 'mediaText' || v === 'video') return v as MediaMode
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
  const [mediaMode, setMediaModeState] = useState<MediaMode>(() => getStored(useLoggedInDefaults))

  const setMediaMode = useCallback((value: MediaMode) => {
    setMediaModeState(value)
    asyncStorage.set(STORAGE_KEY, value, 0)
  }, [])

  const cycleMediaMode = useCallback((options?: { showToast?: boolean }) => {
    setMediaModeState((m) => {
      const next = m === 'mediaText' ? 'media' : m === 'media' ? 'video' : m === 'video' ? 'text' : 'mediaText'
      if (options?.showToast !== false) toast?.showToast(MEDIA_MODE_LABELS[next])
      asyncStorage.set(STORAGE_KEY, next, 0)
      return next
    })
  }, [toast])

  return (
    <MediaOnlyContext.Provider value={{ mediaMode, setMediaMode, cycleMediaMode }}>
      {children}
    </MediaOnlyContext.Provider>
  )
}

export function useMediaOnly() {
  const ctx = useContext(MediaOnlyContext)
  if (!ctx) {
    return {
      mediaMode: 'mediaText' as MediaMode,
      setMediaMode: () => {},
      cycleMediaMode: () => {},
    }
  }
  return ctx
}
