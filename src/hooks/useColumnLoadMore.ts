import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import {
  LOAD_MORE_COOLDOWN_MS,
  LOAD_MORE_RETRY_COOLDOWN_MS,
  getLoadMoreRootMargin,
  getLoadMoreRootMarginPx,
  getShortColumnThreshold,
  getViewportHeight,
  resolveModalScrollRoot,
} from '../lib/loadMoreScroll'

export interface UseColumnLoadMoreOptions {
  cursor: string | undefined
  cols: number
  /** Filtered/display item count (for empty-feed auto-load). */
  itemCount: number
  loadingMoreRef: MutableRefObject<boolean>
  loadMore: (cursor: string) => void
  /** One sentinel ref per column (index 0 even when cols === 1). */
  sentinelRefs: MutableRefObject<(HTMLDivElement | null)[]>
  /** Per-column card counts from masonry distribution. */
  columnLengthsRef: MutableRefObject<number[]>
  enabled?: boolean
  /** When true, observer root is the nearest [data-modal-scroll] ancestor of column 0's sentinel. */
  inModal?: boolean
}

/**
 * Per-column infinite scroll: large prefetch margin, per-column cooldown, and short-column retry
 * so uneven masonry columns load before the user hits blank space.
 */
export function useColumnLoadMore({
  cursor,
  cols,
  itemCount,
  loadingMoreRef,
  loadMore,
  sentinelRefs,
  columnLengthsRef,
  enabled = true,
  inModal = false,
}: UseColumnLoadMoreOptions) {
  const lastLoadMoreByColumnRef = useRef<number[]>([])
  const lastRetryLoadTimeRef = useRef(0)
  const loadMoreRef = useRef(loadMore)
  loadMoreRef.current = loadMore
  const cursorRef = useRef(cursor)
  cursorRef.current = cursor
  const scheduleRetryRef = useRef<(() => void) | null>(null)
  const observeSentinelRef = useRef<
    ((colIndex: number, el: HTMLDivElement | null, prev: HTMLDivElement | null) => void) | null
  >(null)

  useEffect(() => {
    const current = lastLoadMoreByColumnRef.current
    if (current.length !== cols) {
      lastLoadMoreByColumnRef.current = Array.from({ length: cols }, (_, i) => current[i] ?? 0)
    }
  }, [cols])

  useEffect(() => {
    if (!enabled || !cursor) return

    const sinceRetryLoad = Date.now() - lastRetryLoadTimeRef.current
    if (itemCount === 0 && !loadingMoreRef.current && sinceRetryLoad > LOAD_MORE_RETRY_COOLDOWN_MS) {
      const now = Date.now()
      const minColCooldown = Math.min(
        ...Array.from({ length: cols }, (_, i) => lastLoadMoreByColumnRef.current[i] ?? 0),
        now,
      )
      const wait = Math.max(50, LOAD_MORE_COOLDOWN_MS - (now - minColCooldown) + 50)
      const timeoutId = setTimeout(() => {
        if (!loadingMoreRef.current && itemCount === 0 && cursorRef.current) {
          loadingMoreRef.current = true
          lastLoadMoreByColumnRef.current[0] = Date.now()
          lastRetryLoadTimeRef.current = Date.now()
          loadMoreRef.current(cursorRef.current)
        }
      }, wait)
      return () => clearTimeout(timeoutId)
    }
  }, [enabled, cursor, cols, itemCount, loadingMoreRef])

  useEffect(() => {
    if (!enabled || !cursor) {
      scheduleRetryRef.current = null
      observeSentinelRef.current = null
      return
    }

    const refs = sentinelRefs.current
    let rafId = 0
    let retryId = 0
    let scrollRaf = 0
    let resizeTimeoutId = 0

    const anyColumnShort = () => {
      const lengths = columnLengthsRef.current
      const threshold = getShortColumnThreshold()
      for (let c = 0; c < cols; c++) {
        const el = refs[c]
        if (!el) continue
        if ((lengths[c] ?? 0) === 0) {
          if (el.getBoundingClientRect().bottom < threshold) return true
          continue
        }
        if (el.getBoundingClientRect().bottom < threshold) return true
      }
      return false
    }

    const findShortColumnIndex = () => {
      const threshold = getShortColumnThreshold()
      let best = 0
      let bestGap = -Infinity
      for (let c = 0; c < cols; c++) {
        const el = refs[c]
        if (!el) continue
        const gap = threshold - el.getBoundingClientRect().bottom
        if (gap > bestGap) {
          bestGap = gap
          best = c
        }
      }
      return best
    }

    const retryWaitMs = () =>
      Math.max(0, LOAD_MORE_RETRY_COOLDOWN_MS - (Date.now() - lastRetryLoadTimeRef.current) + 50)

    /** Cooldown wait for short columns only — don't block column 2 because column 0 just loaded. */
    const shortColumnWaitMs = () => {
      const now = Date.now()
      const threshold = getShortColumnThreshold()
      let wait = 50
      for (let c = 0; c < cols; c++) {
        const el = refs[c]
        if (!el || el.getBoundingClientRect().bottom >= threshold) continue
        const colCooldown = lastLoadMoreByColumnRef.current[c] ?? 0
        wait = Math.max(wait, LOAD_MORE_COOLDOWN_MS - (now - colCooldown) + 50)
      }
      return wait
    }

    const scheduleRetry = () => {
      clearTimeout(retryId)
      const wait = Math.max(50, retryWaitMs(), shortColumnWaitMs())
      retryId = window.setTimeout(() => {
        if (loadingMoreRef.current) {
          if (anyColumnShort()) scheduleRetry()
          return
        }
        if (anyColumnShort() && cursorRef.current) {
          loadingMoreRef.current = true
          lastRetryLoadTimeRef.current = Date.now()
          lastLoadMoreByColumnRef.current[findShortColumnIndex()] = Date.now()
          loadMoreRef.current(cursorRef.current)
        }
      }, wait)
    }

    scheduleRetryRef.current = scheduleRetry

    const root = inModal ? resolveModalScrollRoot(refs[0]) ?? undefined : undefined

    const handleIntersection = (entries: IntersectionObserverEntry[]) => {
      for (const e of entries) {
        if (!e.isIntersecting || loadingMoreRef.current) continue
        const colIndex = refs.findIndex((ref) => ref === e.target)
        if (colIndex < 0) continue
        const colCooldown = lastLoadMoreByColumnRef.current[colIndex] ?? 0
        if (Date.now() - colCooldown < LOAD_MORE_COOLDOWN_MS) {
          scheduleRetry()
          continue
        }
        loadingMoreRef.current = true
        lastLoadMoreByColumnRef.current[colIndex] = Date.now()
        const c = cursorRef.current
        if (!c) continue
        rafId = requestAnimationFrame(() => {
          rafId = 0
          loadMoreRef.current(c)
        })
        break
      }
    }

    const createObserver = () =>
      new IntersectionObserver(handleIntersection, {
        root,
        rootMargin: getLoadMoreRootMargin(),
        threshold: 0,
      })

    let observer = createObserver()

    let observed = new WeakSet<Element>()
    const observeSentinel = (_colIndex: number, el: HTMLDivElement | null, prev: HTMLDivElement | null) => {
      if (prev && prev !== el) {
        observer.unobserve(prev)
      }
      if (el && !observed.has(el)) {
        observer.observe(el)
        observed.add(el)
      }
    }
    observeSentinelRef.current = observeSentinel

    for (let c = 0; c < cols; c++) {
      observeSentinel(c, refs[c], null)
    }

    /** Scroll / viewport fallback when IO misses (mobile URL bar, uneven columns, virtualization). */
    const onScrollOrViewportChange = () => {
      if (scrollRaf) return
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0
        if (loadingMoreRef.current) {
          if (anyColumnShort()) scheduleRetry()
          return
        }

        if (anyColumnShort()) {
          scheduleRetry()
          return
        }

        const prefetchPx = getLoadMoreRootMarginPx()
        const nearEndThreshold = getViewportHeight() + prefetchPx
        for (let c = 0; c < cols; c++) {
          const el = refs[c]
          if (!el) continue
          if (el.getBoundingClientRect().top > nearEndThreshold) continue
          const colCooldown = lastLoadMoreByColumnRef.current[c] ?? 0
          if (Date.now() - colCooldown < LOAD_MORE_COOLDOWN_MS) {
            scheduleRetry()
            break
          }
          loadingMoreRef.current = true
          lastLoadMoreByColumnRef.current[c] = Date.now()
          const cur = cursorRef.current
          if (cur) loadMoreRef.current(cur)
          break
        }
      })
    }

    const scrollTarget: EventTarget = root ?? window
    scrollTarget.addEventListener('scroll', onScrollOrViewportChange, { passive: true })
    const vv = window.visualViewport
    vv?.addEventListener('scroll', onScrollOrViewportChange, { passive: true })
    vv?.addEventListener('resize', onScrollOrViewportChange, { passive: true })

    const refreshObserverMargins = () => {
      observer.disconnect()
      observer = createObserver()
      observed = new WeakSet<Element>()
      for (let c = 0; c < cols; c++) {
        observeSentinel(c, refs[c], null)
      }
      onScrollOrViewportChange()
    }

    const onViewportResize = () => {
      clearTimeout(resizeTimeoutId)
      resizeTimeoutId = window.setTimeout(refreshObserverMargins, 150)
    }
    window.addEventListener('resize', onViewportResize, { passive: true })
    vv?.addEventListener('resize', onViewportResize, { passive: true })

    scheduleRetry()

    return () => {
      scheduleRetryRef.current = null
      observeSentinelRef.current = null
      observer.disconnect()
      scrollTarget.removeEventListener('scroll', onScrollOrViewportChange)
      vv?.removeEventListener('scroll', onScrollOrViewportChange)
      vv?.removeEventListener('resize', onScrollOrViewportChange)
      window.removeEventListener('resize', onViewportResize)
      vv?.removeEventListener('resize', onViewportResize)
      if (scrollRaf) cancelAnimationFrame(scrollRaf)
      if (rafId) cancelAnimationFrame(rafId)
      clearTimeout(retryId)
      clearTimeout(resizeTimeoutId)
    }
  }, [enabled, cursor, cols, loadingMoreRef, sentinelRefs, columnLengthsRef, inModal])

  // After new items render, check whether a column is still short.
  useEffect(() => {
    if (!enabled || !cursor || itemCount === 0) return
    let cancelled = false
    const timeoutId = window.setTimeout(() => {
      if (cancelled || loadingMoreRef.current) return
      scheduleRetryRef.current?.()
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [enabled, cursor, itemCount, loadingMoreRef])

  return useCallback(
    (colIndex: number) => (el: HTMLDivElement | null) => {
      const prev = sentinelRefs.current[colIndex] ?? null
      sentinelRefs.current[colIndex] = el
      observeSentinelRef.current?.(colIndex, el, prev)
    },
    [sentinelRefs],
  )
}
