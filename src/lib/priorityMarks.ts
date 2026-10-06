import { MUSCLE_GROUPS, MUSCLE_GROUP_LABELS, MUSCLE_SUBGROUP_LABELS } from './exerciseTags.js'
import type { MuscleSubgroupTag } from './exerciseTags.js'
import { PRIORITY_TREE } from './priorityTags.js'
import type { MuscleGroup } from '../types/index.js'

// Priority Marks — v2_program_priorities' own vocabulary and pure structure
// (TASKS.md chunk 10 "Priorities: focus / don't care"; SPEC.md "Objects
// stored: Program" / "Stepped program planner step 1" / "Priorities
// migration"). Same precedent as priorityTags.ts itself (which this module
// deliberately reuses rather than re-derives: PRIORITY_TREE for the
// group->subgroup partition, MUSCLE_GROUPS/MUSCLE_GROUP_LABELS/
// MUSCLE_SUBGROUP_LABELS from exerciseTags.ts) — pure, no React, no
// Supabase, so it is unit-testable on its own and importable from anywhere
// a program's marks need summarising.
//
// Deliberately a new module rather than an extension of priorityTags.ts:
// the two systems' values don't line up. The old PriorityLevel is a
// 4-value, non-nullable scale where a missing row means the explicit
// default 'normal' (densifyPriorities). The new PriorityMark is a 2-value
// scale where there is no 'normal' value to store at all — "no row = normal"
// (TASKS.md's own data-model line for v2_program_priorities) is the only
// way to express it, so "normal" is modelled here as `null`, not as a third
// member of the type. Reusing densifyPriorities's Record<Group, Entry>
// shape would have given every untouched tag an isExplicit:false synthetic
// 'normal' PriorityEntry — fine for the old table, where a stored 'normal'
// row is a real, distinguishable thing (isExplicit), but meaningless here,
// where there is no such row to distinguish from.

export type PriorityMark = 'focus' | 'dont_care'
export type PriorityMarkTagType = 'muscle_group' | 'muscle_subgroup'

export const MARK_LABELS: Record<PriorityMark, string> = {
  focus: 'FOCUS',
  dont_care: "DON'T CARE",
}

// One row as read back from v2_program_priorities, already scoped to one
// user and one program by the caller (programPrioritiesService.ts) — this
// module never sees a program id, the same posture priorityTags.ts's own
// StoredPriority takes toward mesocycle_id.
export interface StoredMark {
  tagType: PriorityMarkTagType
  tagValue: string
  mark: PriorityMark
  updatedAt: string
}

// A subgroup's own mark (the row it may or may not have) next to the mark
// that actually applies to it once inheritance is resolved (SPEC "Stepped
// program planner step 1": "A subgroup with no mark of its own takes its
// group's mark... unless [it] is marked otherwise").
export interface SubgroupMarkEntry {
  tagType: 'muscle_subgroup'
  tagValue: MuscleSubgroupTag
  ownMark: PriorityMark | null
  effectiveMark: PriorityMark | null
}

export interface GroupMarkEntry {
  tagType: 'muscle_group'
  tagValue: MuscleGroup
  // A group is the ceiling of its own tree (SPEC §3) — it has no mark above
  // it to inherit from, so, unlike a subgroup, its own mark and its
  // effective mark are always the same thing; only one field is needed.
  ownMark: PriorityMark | null
  subgroups: SubgroupMarkEntry[]
  // Phrased from the group (SPEC "Stepped program planner step 1": "The
  // summary is phrased from the group: 'chest without upper chest'") — see
  // summarizeGroup below for exactly which cases this is null for.
  summary: string | null
}

// SPEC: "A subgroup with no mark of its own takes its group's mark." —
// "Chest marked focus covers upper chest unless upper chest is marked
// otherwise": an explicit subgroup mark always wins, whatever the group's
// mark is (including when the group itself has none).
export function effectiveSubgroupMark(
  groupMark: PriorityMark | null,
  subgroupOwnMark: PriorityMark | null,
): PriorityMark | null {
  return subgroupOwnMark ?? groupMark
}

// SPEC: "The summary is phrased from the group: 'chest without upper
// chest'." Null in the two cases that example doesn't cover:
//   - the group itself carries no mark (groupMark null) — "without X" reads
//     as if the group had a stated mark when it doesn't, and there is
//     nothing else to phrase it from (a subgroup with its own mark while
//     the group has none is still shown, via its own chip/caption — see
//     PrioritiesEditor.tsx — just not folded into a group-level sentence
//     that presupposes a group mark to be an exception FROM).
//   - a marked group none of whose subgroups differs — every subgroup
//     silently inherits, so the plain group label already says everything;
//     repeating it as "chest without" (nothing) would be noise.
// `exceptions` is the already-resolved list of subgroup labels to name —
// built by buildGroupMarkEntries below using exactly SPEC's "marked
// differently" test (an explicit mark that doesn't match the group's), kept
// here as a plain string list so this function stays about wording, not
// about re-deriving who counts as an exception.
export function summarizeGroup(
  groupLabel: string,
  groupMark: PriorityMark | null,
  exceptions: readonly string[],
): string | null {
  if (!groupMark) return null
  if (exceptions.length === 0) return groupLabel
  // Plain ', ' join, no "and" — the same convention every other list-in-
  // prose in this codebase already uses (LibraryCatalog.tsx's muscle
  // subgroup list, ExerciseList.tsx's affected-program list, ReassignSheet
  // .tsx's affected-workout-day list): no precedent anywhere for an
  // Oxford-style join, so this doesn't invent one for a case (more than one
  // exception) SPEC's own example never shows.
  return `${groupLabel} without ${exceptions.join(', ')}`
}

// Turns a sparse row set (however few or many of the 34 tags actually have
// a row) into the complete, UI-ready 12-group tree — the one place a
// consumer (PrioritiesEditor.tsx) gets every group's own mark, every one of
// its subgroups' own AND effective marks, and the group's summary, built
// together so the "marked differently" test behind the summary and the
// effectiveMark shown per subgroup can never disagree with each other.
//
// Meso/program-agnostic by design, like densifyPriorities: the caller has
// already restricted rows to one program. An empty array is the ordinary
// case for a program nothing has been marked on yet, not an error path.
export function buildGroupMarkEntries(rows: readonly StoredMark[]): GroupMarkEntry[] {
  const own = new Map<string, PriorityMark>()
  for (const row of rows) {
    own.set(`${row.tagType}:${row.tagValue}`, row.mark)
  }

  return MUSCLE_GROUPS.map((group) => {
    const groupOwnMark = own.get(`muscle_group:${group}`) ?? null

    const subgroups: SubgroupMarkEntry[] = PRIORITY_TREE[group].map((subgroup) => {
      const subOwnMark = own.get(`muscle_subgroup:${subgroup}`) ?? null
      return {
        tagType: 'muscle_subgroup',
        tagValue: subgroup,
        ownMark: subOwnMark,
        effectiveMark: effectiveSubgroupMark(groupOwnMark, subOwnMark),
      }
    })

    // SPEC: "If a group and one of its subgroups are marked differently,
    // the subgroup's mark applies to that subgroup." An exception is a
    // subgroup with its OWN mark that differs from the group's — a
    // subgroup that merely inherits (ownMark null) is never one, and
    // neither is a subgroup whose own mark happens to equal the group's
    // (redundant, not something to call out as "without").
    const exceptionLabels = subgroups
      .filter((s) => s.ownMark !== null && s.ownMark !== groupOwnMark)
      .map((s) => MUSCLE_SUBGROUP_LABELS[s.tagValue].toLowerCase())

    return {
      tagType: 'muscle_group',
      tagValue: group,
      ownMark: groupOwnMark,
      subgroups,
      summary: summarizeGroup(MUSCLE_GROUP_LABELS[group].toLowerCase(), groupOwnMark, exceptionLabels),
    }
  })
}
