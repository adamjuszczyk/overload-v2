// Chunk 51a (CHANGE THE PROGRAM, "order by drag"): where a dragged card lands. Pure, so the rule is tested without a pointer.
//
// `centers` are the vertical centres of the list's units (a single exercise, or a whole superset), top to bottom, as they stood
// when the drag began; `from` is the dragged unit's place; `y` is where its centre is now. The unit lands in the place of the
// last unit whose centre it has passed, and stays where it is until it passes one.
export function dragTarget(centers: readonly number[], from: number, y: number): number {
  let target = from
  for (let i = from + 1; i < centers.length; i++) {
    if (y > centers[i]) target = i
    else break
  }
  for (let i = from - 1; i >= 0; i--) {
    if (y < centers[i]) target = i
    else break
  }
  return target
}
