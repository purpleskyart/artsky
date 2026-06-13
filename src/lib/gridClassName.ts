import type { ViewMode } from '../context/ViewModeContext'
import gridStyles from '../styles/postGrid.module.css'

/** CSS classes for the masonry grid container (`gridColumns` + view-mode column count). */
export function getPostGridClassName(viewMode: ViewMode): string {
  const viewClass = viewMode === 'a' ? gridStyles.gridView3 : gridStyles[`gridView${viewMode}`]
  return `${gridStyles.gridColumns} ${viewClass}`
}
