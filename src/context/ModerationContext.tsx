import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const STORAGE_KEY = 'artsky-moderation-nsfw'

export type NsfwPreference = 'nsfw' | 'sfw' | 'blurred'

export const NSFW_CYCLE: readonly NsfwPreference[] = ['sfw', 'blurred', 'nsfw'] as const
export const NSFW_LABELS: Record<NsfwPreference, string> = { sfw: 'SFW', blurred: 'Blurred', nsfw: 'NSFW' }

export type NsfwAnnouncement = {
  text: string
  /** Position of the button that triggered the change, used to anchor the tooltip. */
  anchorRect: { top: number; left: number; width: number; height: number; bottom: number }
}

type ModerationContextValue = {
  nsfwPreference: NsfwPreference
  setNsfwPreference: (p: NsfwPreference, anchor?: HTMLElement, options?: { showToast?: boolean }) => void
  /** Cycle: SFW → Blurred → NSFW → SFW. Pass the button element so the tooltip appears nearby. */
  cycleNsfwPreference: (anchor?: HTMLElement) => void
  /** URIs of posts the user has chosen to unblur (blurred mode). Cleared on page refresh. */
  unblurredUris: Set<string>
  setUnblurred: (uri: string, revealed: boolean) => void
  /** Brief tooltip shown near the toggle button when NSFW mode changes. */
  nsfwAnnouncement: NsfwAnnouncement | null
}

const ModerationContext = createContext<ModerationContextValue | null>(null)

function getStored(): NsfwPreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'nsfw' || v === 'sfw' || v === 'blurred') return v
  } catch {
    // ignore
  }
  return 'blurred'
}

export function ModerationProvider({ children }: { children: React.ReactNode }) {
  const [nsfwPreference, setNsfwPreferenceState] = useState<NsfwPreference>(getStored)
  const [unblurredUris, setUnblurredUris] = useState<Set<string>>(() => new Set())
  const [nsfwAnnouncement, setNsfwAnnouncement] = useState<NsfwAnnouncement | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, nsfwPreference)
    } catch {
      // ignore
    }
  }, [nsfwPreference])

  useEffect(() => {
    if (!nsfwAnnouncement) return
    const t = setTimeout(() => setNsfwAnnouncement(null), 1200)
    return () => clearTimeout(t)
  }, [nsfwAnnouncement])

  const showAnnouncement = useCallback((next: NsfwPreference, anchor?: HTMLElement) => {
    const rect = anchor?.getBoundingClientRect()
    setNsfwAnnouncement({
      text: NSFW_LABELS[next],
      anchorRect: rect
        ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom }
        : { top: 48, left: window.innerWidth / 2, width: 0, height: 0, bottom: 48 },
    })
  }, [])

  const setNsfwPreference = useCallback((p: NsfwPreference, anchor?: HTMLElement, options?: { showToast?: boolean }) => {
    setNsfwPreferenceState(p)
    if (options?.showToast !== false) showAnnouncement(p, anchor)
  }, [showAnnouncement])

  const cycleNsfwPreference = useCallback((anchor?: HTMLElement) => {
    setNsfwPreferenceState((prev) => {
      const i = NSFW_CYCLE.indexOf(prev)
      const next = NSFW_CYCLE[(i + 1) % NSFW_CYCLE.length]
      showAnnouncement(next, anchor)
      return next
    })
  }, [showAnnouncement])

  const setUnblurred = useCallback((uri: string, revealed: boolean) => {
    setUnblurredUris((prev) => {
      const next = new Set(prev)
      if (revealed) next.add(uri)
      else next.delete(uri)
      return next
    })
  }, [])

  const value: ModerationContextValue = {
    nsfwPreference,
    setNsfwPreference,
    cycleNsfwPreference,
    unblurredUris,
    setUnblurred,
    nsfwAnnouncement,
  }

  return (
    <ModerationContext.Provider value={value}>
      {children}
    </ModerationContext.Provider>
  )
}

export function useModeration() {
  const ctx = useContext(ModerationContext)
  if (!ctx) {
    return {
      nsfwPreference: 'blurred' as NsfwPreference,
      setNsfwPreference: () => {},
      cycleNsfwPreference: () => {},
      unblurredUris: new Set<string>(),
      setUnblurred: () => {},
      nsfwAnnouncement: null as NsfwAnnouncement | null,
    }
  }
  return ctx
}
