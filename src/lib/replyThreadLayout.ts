/** Per-level reply indent applied in PostDetailPage thread branches. */
export const REPLY_THREAD_INDENT_PER_LEVEL_PX = 8
/** Cap on indent margin for a single nested branch. */
export const REPLY_THREAD_MAX_INDENT_PX = 32
/** Nested collapse rail width (1rem button + 0.2rem margin in deep replies). */
export const REPLY_THREAD_NESTED_COLLAPSE_RAIL_PX = 19
/** Extra horizontal inset for the first nested replies block under a top-level comment. */
export const REPLY_THREAD_TOP_LEVEL_REPLIES_INSET_PX = 24
/** Minimum width reserved for readable comment text before showing "Read More". */
export const REPLY_THREAD_MIN_TEXT_WIDTH_PX = 200

export function getReplyThreadIndentPx(layoutDepth: number): number {
  return layoutDepth > 0 ? Math.min(layoutDepth * REPLY_THREAD_INDENT_PER_LEVEL_PX, REPLY_THREAD_MAX_INDENT_PX) : 0
}

/** Width available for comment text at a given nesting depth (cumulative layout consumption). */
export function getReplyTextAreaWidthPx(threadAreaWidth: number, layoutDepth: number): number {
  if (layoutDepth <= 0) return threadAreaWidth
  let width = threadAreaWidth - REPLY_THREAD_TOP_LEVEL_REPLIES_INSET_PX
  for (let depth = 1; depth <= layoutDepth; depth++) {
    width -= getReplyThreadIndentPx(depth)
    width -= REPLY_THREAD_NESTED_COLLAPSE_RAIL_PX
  }
  return width
}

export function shouldGateReplyThread(threadAreaWidth: number, layoutDepth: number): boolean {
  if (layoutDepth <= 0 || threadAreaWidth <= 0) return false
  return getReplyTextAreaWidthPx(threadAreaWidth, layoutDepth) < REPLY_THREAD_MIN_TEXT_WIDTH_PX
}
