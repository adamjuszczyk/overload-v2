// Chunk 13 (TASKS.md "Supersets" / SPEC.md "Supersets [P1]") — pure
// structural helpers shared by the planner's step 2 (StepExercises.tsx,
// also reused as-is by the program tab) and the week plan
// (PlanPage.tsx): grouping an ordered exercise list into contiguous
// superset units, moving a unit as one block on reorder, and planning the
// writes a grouping-editor toggle needs. No React, no Supabase — same
// "pure, independently testable" precedent as weekEdits.ts / setGroupLogic.ts.
//
// "Unit" vs "block": a block is the stored concept (`superset_block_id` on
// two or more v2_program_exercises rows). A "unit" here is the RUN of
// consecutive items in a given ordered list that currently share one block
// — i.e. a block, as it appears in THIS list, right now. A block is only
// ever a single run by construction (every write path in this file, and
// chunk 9's resolveSwapSlot, only ever keeps a block's members adjacent);
// groupIntoUnits does not attempt to repair a hypothetically non-adjacent
// same-block pair by merging them from a distance — that would reorder
// exercises no caller asked to move.

export interface SupersetLinkable {
  id: string
  // Optional, same convention as every other chunk-13 field on
  // ProgramExercise (Program.kind?, WorkoutDay.sourceWorkoutDayId?, …):
  // absent/undefined reads exactly like null (this exercise is in no
  // block), so a fixture or caller that predates this chunk keeps compiling
  // and behaving as a plain, ungrouped list.
  supersetBlockId?: string | null
}

// ─── Units — grouping and moving one as a block ────────────────────────────

// Contiguous runs of 2+ items sharing one non-null supersetBlockId become
// one unit; everything else (a null/undefined block, or a lone item whose
// block id happens not to match either neighbour) is its own single-item
// unit. A run of exactly 1 sharing a dangling block id (e.g. the one member
// left behind after a sibling was deleted) is deliberately NOT treated as a
// unit of its own kind here — it already IS a single-item unit, which is
// the correct, harmless rendering for "not really a superset any more".
export function groupIntoUnits<T extends SupersetLinkable>(items: T[]): T[][] {
  const units: T[][] = []
  for (const item of items) {
    const last = units[units.length - 1]
    if (last && item.supersetBlockId != null && last[0].supersetBlockId === item.supersetBlockId) {
      last.push(item)
    } else {
      units.push([item])
    }
  }
  return units
}

// Moves the unit containing items[index] past its NEIGHBOURING unit — SPEC
// "Supersets": "Every reorder (program, week plan, session) moves a
// superset as one block." Relative order within every unit (moved or not)
// is preserved; only the two neighbouring units swap places as wholes.
// Returns the SAME array reference when the move isn't possible (already
// at that edge), so callers can bail with a plain `===` check instead of a
// deep-equality one. With no grouping at all (every unit size 1 — every
// session and every fixture before this chunk), this is exactly "swap with
// the adjacent item", byte-identical to what both callers did before.
export function moveUnit<T extends SupersetLinkable>(
  items: T[],
  index: number,
  direction: 'up' | 'down',
): T[] {
  const units = groupIntoUnits(items)
  const unitIndex = units.findIndex((u) => u.includes(items[index]))
  if (unitIndex === -1) return items
  const swapWith = direction === 'up' ? unitIndex - 1 : unitIndex + 1
  if (swapWith < 0 || swapWith >= units.length) return items
  const reordered = [...units]
  ;[reordered[unitIndex], reordered[swapWith]] = [reordered[swapWith], reordered[unitIndex]]
  return reordered.flat()
}

// ─── Grouping editor — the program tab / planner step 2 only ──────────────
// SPEC "Supersets": grouping is changed "in the program tab, for both
// planning types" — the week plan (PlanPage.tsx) only ever calls moveUnit
// above, never the functions below.
//
// A "gap" is the boundary between items[gapIndex] and items[gapIndex + 1].
// It is "linked" exactly when both sides already share one non-null block.
// Toggling it is the one interaction the editor exposes — link merges the
// two neighbouring runs into one block; unlink splits one run into two at
// exactly this point. Repeating either lets "any number of exercises"
// (SPEC) form one block without a separate multi-select UI.

export function isLinkedGap<T extends SupersetLinkable>(items: T[], gapIndex: number): boolean {
  const a = items[gapIndex]
  const b = items[gapIndex + 1]
  return !!a && !!b && a.supersetBlockId != null && a.supersetBlockId === b.supersetBlockId
}

// The run (contiguous same-block slice) containing items[index], or the
// single-item run [items[index]] when it isn't in one. Internal to this
// module — callers only ever go through planLinkToggle below.
function runContaining<T extends SupersetLinkable>(items: T[], index: number): T[] {
  const blockId = items[index]?.supersetBlockId ?? null
  if (blockId == null) return [items[index]]
  let start = index
  while (start > 0 && items[start - 1].supersetBlockId === blockId) start -= 1
  let end = index
  while (end < items.length - 1 && items[end + 1].supersetBlockId === blockId) end += 1
  return items.slice(start, end + 1)
}

export interface LinkPlan {
  ids: string[]
  // The block id to write to every id above — null clears it (no longer in
  // a superset). Ignored (the caller must mint a fresh block and use ITS id
  // instead) when needsNewBlock is true.
  blockId: string | null
  needsNewBlock: boolean
}

function sidePlan<T extends SupersetLinkable>(
  side: T[],
  keepSharedId: boolean,
  sharedBlockId: string | null,
): LinkPlan {
  const ids = side.map((item) => item.id)
  if (side.length < 2) return { ids, blockId: null, needsNewBlock: false } // a lone exercise is never "in a superset"
  if (keepSharedId) return { ids, blockId: sharedBlockId, needsNewBlock: false }
  return { ids, blockId: null, needsNewBlock: true } // still 2+, but can't keep the id the OTHER side kept
}

// Toggling the gap after items[gapIndex]. Returns one plan (a plain merge —
// always exactly one fresh-or-reused block for everyone involved) or two
// (an unlink's left/right sides, each resolved independently by sidePlan
// above) for the caller to apply, each with one update per plan: create a
// block first when needsNewBlock, then write `blockId` to every id in
// `ids`. Deliberately does not clean up a block left with zero members
// after a split or a full unlink (e.g. splitting a 2-member block into two
// singles) — an orphaned v2_program_superset_blocks row is never read by
// anything (no exercise points at it any more), so it is harmless, not a
// correctness gap.
export function planLinkToggle<T extends SupersetLinkable>(items: T[], gapIndex: number): LinkPlan[] {
  if (isLinkedGap(items, gapIndex)) {
    const run = runContaining(items, gapIndex)
    const splitAt = run.findIndex((item) => item.id === items[gapIndex].id) + 1
    const left = run.slice(0, splitAt)
    const right = run.slice(splitAt)
    const sharedBlockId = run[0].supersetBlockId ?? null
    const leftKeeps = left.length >= 2 // left gets priority to keep the existing id when it's still eligible
    return [
      sidePlan(left, leftKeeps, sharedBlockId),
      sidePlan(right, !leftKeeps && right.length >= 2, sharedBlockId),
    ]
  }

  const left = runContaining(items, gapIndex)
  const right = runContaining(items, gapIndex + 1)
  const reuse = left[0].supersetBlockId ?? right[0].supersetBlockId ?? null
  return [{ ids: [...left, ...right].map((item) => item.id), blockId: reuse, needsNewBlock: reuse == null }]
}
