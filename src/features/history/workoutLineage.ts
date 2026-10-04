// Pure lineage-group resolver (TASKS.md chunk 5 — "session type, all time"
// follows a workout across runs). Migration 027 added
// v2_workout_days.source_workout_day_id: on a run's copy of a saved
// program's workout, it points back at the workout it was copied from.
// "Lineage group" = that source workout (the root) plus every workout whose
// source_workout_day_id chain leads to the root — so a session-type history
// query keyed on any member of the group sees every occurrence, in whichever
// run it happened.
//
// Choices made here, spelled out because none of them is forced by the type
// signature alone:
//
// 1. Walk UP to the root first, rather than only collecting the given id's
//    direct children. This is what makes querying from a run's copy return
//    the same group as querying from the root — a copy has no children of
//    its own, so starting the walk at the copy and only looking downward
//    would find nothing.
// 2. The walk is transitive (keeps following source_workout_day_id, and
//    separately keeps collecting descendants however deep), not just one
//    hop. Today a copy is only ever one level below its saved-program
//    workout (copies are made from the saved program's workout, not from
//    another copy — see v2_programs.kind's comment in 027), so a one-hop
//    version would currently give the same answer. Transitive is still the
//    right rule to write: it costs nothing extra against today's one-level
//    data, and it is the rule TASKS.md actually states ("the root plus every
//    workout whose source is the root"), not an approximation of it that a
//    future deeper chain (e.g. a copy-of-a-copy) would silently split.
// 3. Dangling source (source_workout_day_id set, but that id isn't one of
//    the rows passed in — e.g. the row FK-nulled already, or belongs to a
//    program this caller didn't fetch) stops the upward walk: the workout
//    with the dangling pointer is treated as its own root, not as a member
//    of whatever it used to point at. We only know what `rows` tells us.
// 4. Cycle guard: source_workout_day_id should never form a cycle (it only
//    ever points from a run's copy to a saved program's workout — never the
//    reverse, and never between two copies), but a resolver that can hang on
//    bad data is worse than one that returns an imperfect answer. The walk
//    stops the moment the next hop would revisit a node already seen *on
//    this walk*, and the node it stopped at becomes the root. Both the
//    upward walk and the downward collection are iterative (explicit
//    stack/cursor, no recursion) and each only ever visits a node once, so
//    both terminate in at most O(rows) steps regardless of cycles.

export interface WorkoutLineageRow {
  id: string
  source_workout_day_id: string | null
}

// The id a workout's upward walk stops at: the first node with no source, a
// dangling source, or a source that would revisit a node already visited on
// this walk.
function findLineageRoot(workoutDayId: string, bySource: Map<string, string | null>): string {
  const visited = new Set<string>([workoutDayId])
  let current = workoutDayId
  for (;;) {
    const source = bySource.get(current) ?? null
    if (source == null) return current // no source recorded (or current isn't in `rows` at all) — stop here
    if (!bySource.has(source)) return current // dangling: source isn't one of the given rows
    if (visited.has(source)) return current // cycle: the next hop would revisit a node — stop before looping
    visited.add(source)
    current = source
  }
}

// Every id reachable from `root` by following source_workout_day_id
// backwards (i.e. root's children, their children, …), root included. BFS
// with a visited set so a cycle in the downward direction (only reachable if
// the upward walk above already stopped short of it) still terminates and
// never double-counts a node.
function collectLineageGroup(root: string, bySource: Map<string, string | null>): string[] {
  const childrenOf = new Map<string, string[]>()
  for (const [id, source] of bySource) {
    if (source == null) continue
    const list = childrenOf.get(source)
    if (list) list.push(id)
    else childrenOf.set(source, [id])
  }

  const group: string[] = []
  const visited = new Set<string>()
  const queue = [root]
  let head = 0
  while (head < queue.length) {
    const id = queue[head++]
    if (visited.has(id)) continue
    visited.add(id)
    group.push(id)
    for (const child of childrenOf.get(id) ?? []) {
      if (!visited.has(child)) queue.push(child)
    }
  }
  return group
}

// `rows` must be the user's own workout rows (the same scope
// fetchWorkoutLineageGroup in historyService.ts fetches) — a row not in this
// set is invisible to the walk, which is exactly choice 3 above (dangling).
export function resolveLineageGroup(workoutDayId: string, rows: WorkoutLineageRow[]): string[] {
  const bySource = new Map<string, string | null>()
  for (const row of rows) bySource.set(row.id, row.source_workout_day_id)

  const root = findLineageRoot(workoutDayId, bySource)
  return collectLineageGroup(root, bySource)
}
