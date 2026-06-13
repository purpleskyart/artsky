import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import {
  LOAD_MORE_COOLDOWN_MS,
  LOAD_MORE_RETRY_COOLDOWN_MS,
  getLoadMoreRootMargin,
  getShortColumnThreshold,
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
      return
    }

    const refs = sentinelRefs.current
    let rafId = 0
    let retryId = 0

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
      for (let c = 0; c < cols; c++) {
        const el = refs[c]
        if (!el) continue
        if (el.getBoundingClientRect().bottom < threshold) return c
      }
      return 0
    }

    const scheduleRetry = () => {
      clearTimeout(retryId)
      const now = Date.now()
      const retryWait = Math.max(0, LOAD_MORE_RETRY_COOLDOWN_MS - (now - lastRetryLoadTimeRef.current) + 50)
      const minColCooldown = Math.min(
        ...Array.from({ length: cols }, (_, i) => lastLoadMoreByColumnRef.current[i] ?? 0),
        now,
      )
      const colWait = Math.max(0, LOAD_MORE_COOLDOWN_MS - (now - minColCooldown) + 50)
      const wait = Math.max(50, retryWait, colWait)
      retryId = window.setTimeout(() => {
        if (loadingMoreRef.current) return
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

    const observer = new IntersectionObserver(
      (entries) => {
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
      },
      { root, rootMargin: getLoadMoreRootMargin(), threshold: 0 },
    )

    for (let c = 0; c < cols; c++) {
      const el = refs[c]
      if (el) observer.observe(el)
    }

    scheduleRetry()

    return () => {
      scheduleRetryRef.current = null
      observer.disconnect()
      if (rafId) cancelAnimationFrame(rafId)
      clearTimeout(retryId)
    }
  }, [enabled, cursor, cols, loadingMoreRef, sentinelRefs, columnLengthsRef, inModal])

  // After new items render, check once whether a column is still short (no scroll listener).
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
      sentinelRefs.current[colIndex] = el
    },
    [sentinelRefs],
  )
}
