import { useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

const STORAGE_KEY = 'artsky-scroll-positions-v1'
const MAX_ENTRIES = 200

function readStoredPositions(): Record<string, number> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function writeStoredPositions(positions: Map<string, number>) {
  if (typeof window === 'undefined') return
  try {
    const entries = Array.from(positions.entries())
    const sliced = entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries
    const serializable = Object.fromEntries(sliced)
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(serializable))
  } catch {
    // Ignore storage write failures (private mode / quota).
  }
}

function restoreScrollTop(targetTop: number) {
  const maxAttempts = 12
  let attempts = 0

  const apply = () => {
    attempts += 1
    window.scrollTo(0, targetTop)
    const closeEnough = Math.abs(window.scrollY - targetTop) <= 2
    if (closeEnough || attempts >= maxAttempts) return
    window.setTimeout(() => requestAnimationFrame(apply), 50)
  }

  requestAnimationFrame(() => requestAnimationFrame(apply))
}

export function useScrollRestoration() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const key = useMemo(
    () => location.key || `${location.pathname}${location.search}${location.hash}`,
    [location.hash, location.key, location.pathname, location.search]
  )
  const positionsRef = useRef<Map<string, number>>(new Map<string, number>(Object.entries(readStoredPositions())))
  const currentKeyRef = useRef(key)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const previous = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    return () => {
      window.history.scrollRestoration = previous
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const saveCurrent = () => {
      positionsRef.current.set(currentKeyRef.current, window.scrollY)
      writeStoredPositions(positionsRef.current)
    }

    const onScroll = () => {
      positionsRef.current.set(currentKeyRef.current, window.scrollY)
    }
    const onPageHide = () => saveCurrent()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') saveCurrent()
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      saveCurrent()
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    positionsRef.current.set(currentKeyRef.current, window.scrollY)
    writeStoredPositions(positionsRef.current)
    currentKeyRef.current = key

    if (navigationType === 'POP') {
      const stored = positionsRef.current.get(key)
      if (typeof stored === 'number') restoreScrollTop(stored)
    }
  }, [key, navigationType])
}
