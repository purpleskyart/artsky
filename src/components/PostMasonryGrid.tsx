import type { ReactNode, Ref } from 'react'
import type { ViewMode } from '../context/ViewModeContext'
import type { TimelineItem } from '../lib/bsky'
import type { MasonryColumns } from '../lib/masonryLayout'
import { getPostGridClassName } from '../lib/gridClassName'
import ProfileColumn, { type ProfileColumnProps } from './ProfileColumn'

type ColumnEntry = { item: TimelineItem; originalIndex: number }

export interface PostMasonryGridProps {
  viewMode: ViewMode
  distributedColumns: MasonryColumns<TimelineItem>
  gridRef?: Ref<HTMLDivElement>
  gridPointerGateProps?: Record<string, unknown>
  cursor?: string
  bindLoadMoreSentinelRef: (colIndex: number) => (el: HTMLDivElement | null) => void
  modalScrollRef?: HTMLDivElement | null
  loadingMore?: boolean
  loadingMoreClassName?: string
  /** Props shared across all ProfileColumn instances (minus column-specific fields). */
  columnProps: Omit<
    ProfileColumnProps,
    'column' | 'colIndex' | 'loadMoreSentinelRef' | 'hasCursor' | 'scrollRef'
  >
  /** Optional wrapper around the grid (e.g. fragment vs div). */
  children?: ReactNode
}

/** Masonry grid shell: column layout, sentinels, and ProfileColumn mapping. */
export default function PostMasonryGrid({
  viewMode,
  distributedColumns,
  gridRef,
  gridPointerGateProps,
  cursor,
  bindLoadMoreSentinelRef,
  modalScrollRef = null,
  loadingMore,
  loadingMoreClassName,
  columnProps,
}: PostMasonryGridProps) {
  return (
    <>
      <div
        ref={gridRef}
        className={getPostGridClassName(viewMode)}
        {...gridPointerGateProps}
        data-view-mode={viewMode}
      >
        {distributedColumns.map((column: ColumnEntry[], colIndex: number) => (
          <ProfileColumn
            key={colIndex}
            column={column}
            colIndex={colIndex}
            scrollRef={modalScrollRef}
            loadMoreSentinelRef={cursor ? bindLoadMoreSentinelRef(colIndex) : undefined}
            hasCursor={!!cursor}
            {...columnProps}
          />
        ))}
      </div>
      {loadingMore && loadingMoreClassName && <div className={loadingMoreClassName}>Loading…</div>}
    </>
  )
}
