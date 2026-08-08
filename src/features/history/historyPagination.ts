// Pure pagination-safety helper for views where client-side grouping (e.g.
// setGroupLogic's groupByParent) depends on every row of a group being
// present in the same page. A raw offset/limit page can end mid-session,
// splitting a dropset's head from its stage — groupByParent's own
// precondition comment warns that once a caller passes a partial row set
// (exactly what pagination does), it "needs a rethink, not a silent gap."
//
// Fix: callers fetch one extra row past the page boundary. If that overflow
// row shares a group key (session_id, for v2_exercise_set_history) with the
// last row inside the page, the whole trailing run sharing that key is
// trimmed from this page — it reappears complete at the start of the next
// page instead, since the caller advances its offset by the trimmed count,
// not the raw page size.
export function trimPartialTrailingGroup<T>(
  rowsWithOverflow: T[],
  pageSize: number,
  getGroupKey: (row: T) => string,
): { pageRows: T[]; hasMore: boolean } {
  const hasMore = rowsWithOverflow.length > pageSize
  const page = rowsWithOverflow.slice(0, pageSize)
  if (!hasMore || page.length === 0) return { pageRows: page, hasMore }

  const overflowKey = getGroupKey(rowsWithOverflow[pageSize])
  const lastKey = getGroupKey(page[page.length - 1])
  if (overflowKey !== lastKey) return { pageRows: page, hasMore }

  let cut = page.length
  while (cut > 0 && getGroupKey(page[cut - 1]) === lastKey) cut--

  // A single group spanning the whole page (e.g. one session logging more
  // sets of this exercise than fit in a page) can't be trimmed without
  // returning nothing and stalling pagination forever. Accept the split
  // rather than loop — groupByParent already has documented, accepted
  // behaviour for a stage whose head lands outside the loaded rows (it's
  // silently omitted from that group, same class of edge already accepted
  // elsewhere for orphan dropsets).
  if (cut === 0) return { pageRows: page, hasMore }

  return { pageRows: page.slice(0, cut), hasMore: true }
}
