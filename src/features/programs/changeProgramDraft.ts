import type { DayOfWeek, PlanningType, WeeklySchedule, WeightUnit } from '../../types'
import { groupIntoUnits, isLinkedGap, moveUnit, planLinkToggle } from '../../lib/supersetGroups'
import { normaliseTempo, type RepTarget } from '../../lib/plannerVocabulary.js'
import type { SetType } from '../../components/pickers/pickerLogic'
import {
  daysOfWorkout,
  draftFromRunCopy,
  validateDays,
  type DraftBlock,
  type DraftExercise,
  type DraftRoutineItem,
  type DraftSet,
  type DraftWorkout,
  type ProgramChangeRunCopy,
  type ProgramEdit,
} from './programChange'
import { newSetAfter, withRepTarget, withSetType } from './changeProgramSets'
import { fullSchedule } from './runSchedule'

// Chunk 51a (TASKS-1.2, CHANGE THE PROGRAM) — the screen's local draft and every edit that changes it, as pure functions
// from one draft to the next. Nothing is written until SAVE hands `state.edit` to `planProgramChange` (chunk 45), which
// compares it with the run copy and writes the difference; a draft that equals the run copy writes nothing.
//
// What this adds to chunk 45's `ProgramEdit` is only what a screen needs and the module has no use for:
//   - a `key` on every exercise and warmup item, stable while the draft is edited (a React key, and the handle every edit
//     names the row by: a new exercise has no id of its own until SAVE draws one);
//   - the exercises the user removed, kept apart from the list (the screen draws them struck through with UNDO; the
//     module sees only the list, and a run-copy exercise that is not listed is removed);
//   - a counter for the keys of new rows and new superset blocks.
// The keys are never sent: `planProgramChange` reads the fields it knows and ignores the rest.
//
// Order is always the list's order, and a superset moves as one block (`supersetGroups.ts`, the helpers the planner's step 2
// and Plan's STRUCTURE view use): every edit below that moves or links keeps a block's members next to each other, which
// `planProgramChange` demands and refuses with a RangeError otherwise.
//
// Chunk 51b adds two more kinds of edit, in their own sections below: a stable run's default sets (an exercise's `sets`, which
// `initialDraft` fills from the run copy; `addSet`, `removeSet`, `setSetType`, the rep target edits, `setSetRestAfter`) and the
// weekdays of a weekday run (`dayToggle`, `toggleWorkoutDay`). `draftContent` holds both, so CANCEL and SAVE's changed-elsewhere
// check see them.

export type DraftEntry = DraftExercise & { key: string }
export type DraftRoutine = DraftRoutineItem & { key: string }

export interface DraftWorkoutState extends Omit<DraftWorkout, 'exercises' | 'routine'> {
  exercises: DraftEntry[]
  routine: DraftRoutine[]
}

// A removed exercise: where it stood, so UNDO puts it back there.
export interface RemovedEntry {
  workoutId: string
  entry: DraftEntry
  at: number
}

export interface DraftState {
  edit: Omit<ProgramEdit, 'workouts'> & { workouts: DraftWorkoutState[] }
  removed: RemovedEntry[]
  counter: number
}

// ─── The draft a screen starts from ──────────────────────────────────────────────────────────────────────────────────

export const exerciseKey = (rowId: string): string => `e:${rowId}`
export const routineKey = (itemId: string): string => `r:${itemId}`

export function initialDraft(runCopy: ProgramChangeRunCopy, planningType: PlanningType): DraftState {
  const edit = draftFromRunCopy(runCopy, planningType)
  return {
    edit: {
      ...edit,
      workouts: edit.workouts.map((w) => ({
        ...w,
        exercises: w.exercises.map((e) => ({ ...e, key: e.kind === 'kept' ? exerciseKey(e.id) : `e?${e.kind}` })),
        routine: w.routine.map((r, i) => ({ ...r, key: r.id ? routineKey(r.id) : `r?${i}` })),
      })),
    },
    removed: [],
    counter: 0,
  }
}

// ─── Plumbing ────────────────────────────────────────────────────────────────────────────────────────────────────────

function mapWorkout(state: DraftState, workoutId: string, fn: (w: DraftWorkoutState) => DraftWorkoutState): DraftState {
  let found = false
  const workouts = state.edit.workouts.map((w) => {
    if (w.id !== workoutId) return w
    found = true
    return fn(w)
  })
  if (!found) throw new RangeError(`the draft has no workout ${workoutId}`)
  return { ...state, edit: { ...state.edit, workouts } }
}

function indexOfKey(w: DraftWorkoutState, key: string): number {
  const i = w.exercises.findIndex((e) => e.key === key)
  if (i < 0) throw new RangeError(`workout ${w.id} has no exercise ${key}`)
  return i
}

// `supersetGroups.ts` reads `id` and `supersetBlockId`; the entry rides along.
interface Linkable {
  id: string
  supersetBlockId: string | null
  entry: DraftEntry
}
const linkable = (entries: readonly DraftEntry[]): Linkable[] =>
  entries.map((entry) => ({ id: entry.key, supersetBlockId: entry.supersetBlockId, entry }))

function nextKey(state: DraftState, prefix: string): { key: string; state: DraftState } {
  return { key: `${prefix}+${state.counter}`, state: { ...state, counter: state.counter + 1 } }
}

// ─── Workout names ───────────────────────────────────────────────────────────────────────────────────────────────────

export function renameWorkout(state: DraftState, workoutId: string, name: string): DraftState {
  return mapWorkout(state, workoutId, (w) => ({ ...w, name }))
}

// ─── Exercises: add, swap, remove, undo ──────────────────────────────────────────────────────────────────────────────

/**
 * A new exercise at the end of the workout. Its unit is a resolved literal (RULES.md: "a program exercise's unit is written
 * as a resolved literal at creation", as `addProgramExercise` does); a week-dependent run holds no sets, and a stable
 * run's default starts with none: its card's "+ SET" builds it (chunk 51b; `addSet`), and SAVE lands those sets in every
 * session of the workout that hasn't started (SPEC, How a save lands: "Added exercise ... Stable: the default's sets").
 */
export function addExercise(state: DraftState, workoutId: string, exerciseId: string, weightUnit: WeightUnit): DraftState {
  const made = nextKey(state, 'e')
  const entry: DraftEntry = {
    kind: 'added',
    exerciseId,
    supersetBlockId: null,
    restSeconds: null,
    restAfterSeconds: null,
    tempo: null,
    weightUnit,
    key: made.key,
  }
  return mapWorkout(made.state, workoutId, (w) => ({ ...w, exercises: [...w.exercises, entry] }))
}

/**
 * The new exercise takes the old one's place and superset block, with no rest, tempo or unit of its own (1.1's swap kept the
 * slot's position and block and set nothing else; `programChange.ts` writes the same). Swapping a swapped entry again, or a
 * new one, changes only which exercise it is.
 *
 * On a stable run the new exercise takes the old one's sets too ("count, kinds, stages, rep targets": SPEC, How a save lands), and
 * the card draws them as set rows (chunk 51b), so the draft holds them: the old exercise's default as it stands in the draft. The
 * planner reads a swapped entry with no sets of its own as exactly this, so carrying them changes nothing it writes.
 */
export function swapExercise(state: DraftState, workoutId: string, key: string, exerciseId: string): DraftState {
  return mapWorkout(state, workoutId, (w) => {
    const i = indexOfKey(w, key)
    const old = w.exercises[i]
    const next: DraftEntry =
      old.kind === 'kept'
        ? {
            kind: 'swapped',
            replaces: old.id,
            exerciseId,
            supersetBlockId: old.supersetBlockId,
            restSeconds: null,
            restAfterSeconds: null,
            tempo: null,
            weightUnit: null,
            ...(old.sets ? { sets: old.sets } : {}),
            key: old.key,
          }
        : { ...old, exerciseId }
    return { ...w, exercises: w.exercises.map((e, j) => (j === i ? next : e)) }
  })
}

/** Removes the exercise from the list; one that was only ever added in this draft is simply gone. */
export function removeExercise(state: DraftState, workoutId: string, key: string): DraftState {
  const w = state.edit.workouts.find((x) => x.id === workoutId)
  if (!w) throw new RangeError(`the draft has no workout ${workoutId}`)
  const i = indexOfKey(w, key)
  const entry = w.exercises[i]
  const next = mapWorkout(state, workoutId, (x) => ({ ...x, exercises: x.exercises.filter((_, j) => j !== i) }))
  return entry.kind === 'added' ? next : { ...next, removed: [...next.removed, { workoutId, entry, at: i }] }
}

/**
 * UNDO puts the exercise back where it stood (or at the end when the list is shorter now). One in a superset goes next to
 * the block's other members when they are still there, so the block stays in one piece.
 */
export function undoRemove(state: DraftState, key: string): DraftState {
  const gone = state.removed.find((r) => r.entry.key === key)
  if (!gone) throw new RangeError(`no removed exercise ${key}`)
  const rest = { ...state, removed: state.removed.filter((r) => r !== gone) }
  return mapWorkout(rest, gone.workoutId, (w) => {
    const block = gone.entry.supersetBlockId
    let at = Math.min(gone.at, w.exercises.length)
    if (block !== null) {
      const members = w.exercises.map((e, j) => (e.supersetBlockId === block ? j : -1)).filter((j) => j >= 0)
      if (members.length > 0) at = at <= members[0] ? members[0] : members[members.length - 1] + 1
    }
    return { ...w, exercises: [...w.exercises.slice(0, at), gone.entry, ...w.exercises.slice(at)] }
  })
}

// ─── Order ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** One step up or down; a superset is one step, as a block (SPEC Supersets: "every reorder moves a superset as one block"). */
export function moveExercise(state: DraftState, workoutId: string, key: string, direction: 'up' | 'down'): DraftState {
  return mapWorkout(state, workoutId, (w) => {
    const items = linkable(w.exercises)
    const moved = moveUnit(items, indexOfKey(w, key), direction)
    return moved === items ? w : { ...w, exercises: moved.map((m) => m.entry) }
  })
}

/** The unit (a single exercise, or a whole superset) that holds `key`, moved to be unit number `toUnit` (0-based) of the list. */
export function moveExerciseToUnit(state: DraftState, workoutId: string, key: string, toUnit: number): DraftState {
  return mapWorkout(state, workoutId, (w) => {
    const units = groupIntoUnits(linkable(w.exercises))
    const from = units.findIndex((u) => u.some((m) => m.id === key))
    if (from < 0) throw new RangeError(`workout ${w.id} has no exercise ${key}`)
    const target = Math.max(0, Math.min(units.length - 1, toUnit))
    if (target === from) return w
    const reordered = [...units]
    const [unit] = reordered.splice(from, 1)
    reordered.splice(target, 0, unit)
    return { ...w, exercises: reordered.flat().map((m) => m.entry) }
  })
}

// ─── Supersets (Defaults 5) ──────────────────────────────────────────────────────────────────────────────────────────

function applyLinkPlans(state: DraftState, workoutId: string, plans: ReturnType<typeof planLinkToggle>): DraftState {
  let next = state
  const blockOf = new Map<string, string | null>()
  const created: DraftBlock[] = []
  for (const plan of plans) {
    let blockId = plan.blockId
    if (plan.needsNewBlock) {
      const made = nextKey(next, 'b')
      next = made.state
      blockId = made.key
      created.push({ id: blockId, restWithinRoundSeconds: null, restAfterRoundSeconds: null })
    }
    for (const id of plan.ids) blockOf.set(id, blockId)
  }
  next = { ...next, edit: { ...next.edit, blocks: [...next.edit.blocks, ...created] } }
  return mapWorkout(next, workoutId, (w) => ({
    ...w,
    exercises: w.exercises.map((e) => (blockOf.has(e.key) ? { ...e, supersetBlockId: blockOf.get(e.key) ?? null } : e)),
  }))
}

/** Whether SUPERSET on this exercise's card links it with the one below: there is one below, and they are not linked already. */
export function canLinkBelow(w: DraftWorkoutState, key: string): boolean {
  const i = w.exercises.findIndex((e) => e.key === key)
  return i >= 0 && i < w.exercises.length - 1 && !isLinkedGap(linkable(w.exercises), i)
}

/** SUPERSET: links the exercise with the one below it; below it a superset, it joins that superset (`planLinkToggle`). */
export function linkWithBelow(state: DraftState, workoutId: string, key: string): DraftState {
  const w = state.edit.workouts.find((x) => x.id === workoutId)
  if (!w) throw new RangeError(`the draft has no workout ${workoutId}`)
  if (!canLinkBelow(w, key)) return state
  return applyLinkPlans(state, workoutId, planLinkToggle(linkable(w.exercises), indexOfKey(w, key)))
}

/** The link toggle between two members: splits the superset after this exercise. A lone member left on a side goes free. */
export function splitAfter(state: DraftState, workoutId: string, key: string): DraftState {
  const w = state.edit.workouts.find((x) => x.id === workoutId)
  if (!w) throw new RangeError(`the draft has no workout ${workoutId}`)
  const i = indexOfKey(w, key)
  const items = linkable(w.exercises)
  if (!isLinkedGap(items, i)) return state
  return applyLinkPlans(state, workoutId, planLinkToggle(items, i))
}

/** UNLINK on a superset's header: every member goes free. */
export function unlinkBlock(state: DraftState, workoutId: string, blockId: string): DraftState {
  return mapWorkout(state, workoutId, (w) => ({
    ...w,
    exercises: w.exercises.map((e) => (e.supersetBlockId === blockId ? { ...e, supersetBlockId: null } : e)),
  }))
}

export function setBlockRest(
  state: DraftState,
  blockId: string,
  field: 'restWithinRoundSeconds' | 'restAfterRoundSeconds',
  seconds: number | null,
): DraftState {
  if (!state.edit.blocks.some((b) => b.id === blockId)) throw new RangeError(`the draft has no superset block ${blockId}`)
  return { ...state, edit: { ...state.edit, blocks: state.edit.blocks.map((b) => (b.id === blockId ? { ...b, [field]: seconds } : b)) } }
}

// ─── An exercise's rest, rest after, tempo and unit (behind its ⋯) ───────────────────────────────────────────────────

export function setExerciseRest(
  state: DraftState,
  workoutId: string,
  key: string,
  field: 'restSeconds' | 'restAfterSeconds',
  seconds: number | null,
): DraftState {
  return mapWorkout(state, workoutId, (w) => {
    indexOfKey(w, key)
    return { ...w, exercises: w.exercises.map((e) => (e.key === key ? { ...e, [field]: seconds } : e)) }
  })
}

/** `tempo` is already normalised (`normaliseTempo`) or null: the draft never holds text `planProgramChange` would refuse. */
export function setExerciseTempo(state: DraftState, workoutId: string, key: string, tempo: string | null): DraftState {
  if (tempo !== null && normaliseTempo(tempo) !== tempo) throw new RangeError(`"${tempo}" is not a tempo`)
  return mapWorkout(state, workoutId, (w) => {
    indexOfKey(w, key)
    return { ...w, exercises: w.exercises.map((e) => (e.key === key ? { ...e, tempo } : e)) }
  })
}

export function setExerciseUnit(state: DraftState, workoutId: string, key: string, unit: WeightUnit | null): DraftState {
  return mapWorkout(state, workoutId, (w) => {
    indexOfKey(w, key)
    return { ...w, exercises: w.exercises.map((e) => (e.key === key ? { ...e, weightUnit: unit } : e)) }
  })
}

// ─── The warmup routine ──────────────────────────────────────────────────────────────────────────────────────────────

export function addRoutineItem(state: DraftState, workoutId: string, body: string): DraftState {
  const made = nextKey(state, 'r')
  return mapWorkout(made.state, workoutId, (w) => ({ ...w, routine: [...w.routine, { id: null, body, key: made.key }] }))
}

export function editRoutineItem(state: DraftState, workoutId: string, key: string, body: string): DraftState {
  return mapWorkout(state, workoutId, (w) => ({ ...w, routine: w.routine.map((r) => (r.key === key ? { ...r, body } : r)) }))
}

export function moveRoutineItem(state: DraftState, workoutId: string, key: string, direction: 'up' | 'down'): DraftState {
  return mapWorkout(state, workoutId, (w) => {
    const i = w.routine.findIndex((r) => r.key === key)
    const j = direction === 'up' ? i - 1 : i + 1
    if (i < 0 || j < 0 || j >= w.routine.length) return w
    const routine = [...w.routine]
    ;[routine[i], routine[j]] = [routine[j], routine[i]]
    return { ...w, routine }
  })
}

export function removeRoutineItem(state: DraftState, workoutId: string, key: string): DraftState {
  return mapWorkout(state, workoutId, (w) => ({ ...w, routine: w.routine.filter((r) => r.key !== key) }))
}

// ─── The default's sets (a stable run; chunk 51b) ────────────────────────────────────────────────────────────────────────
// A set is named by its place in its exercise's list of sets (`index`, heads only; a stage by its place in its head's `stages`). The
// screen draws the list it holds and every edit names a row it drew, so an index that isn't there is a mistake in the caller and an
// error, as an unknown exercise is. A week-dependent run draws no set rows and calls none of these.

const setsOf = (e: DraftEntry): readonly DraftSet[] => e.sets ?? []

function mapEntry(state: DraftState, workoutId: string, key: string, fn: (e: DraftEntry) => DraftEntry): DraftState {
  return mapWorkout(state, workoutId, (w) => {
    const i = indexOfKey(w, key)
    return { ...w, exercises: w.exercises.map((e, j) => (j === i ? fn(e) : e)) }
  })
}

function mapSets(state: DraftState, workoutId: string, key: string, fn: (sets: readonly DraftSet[]) => readonly DraftSet[]): DraftState {
  return mapEntry(state, workoutId, key, (e) => ({ ...e, sets: fn(setsOf(e)) }))
}

function mapSetAt(state: DraftState, workoutId: string, key: string, index: number, fn: (s: DraftSet) => DraftSet): DraftState {
  return mapSets(state, workoutId, key, (sets) => {
    if (!Number.isInteger(index) || index < 0 || index >= sets.length) throw new RangeError(`exercise ${key} has no set ${index}`)
    return sets.map((s, i) => (i === index ? fn(s) : s))
  })
}

/** "+ SET": a Normal set after the last one with that set's rep target (a staged set's own), none when there is no set (`newSetAfter`). */
export function addSet(state: DraftState, workoutId: string, key: string): DraftState {
  return mapSets(state, workoutId, key, (sets) => [...sets, newSetAfter(sets[sets.length - 1])])
}

/** REMOVE THIS SET (the set type picker's): the set leaves the list with its stages; `planProgramChange` soft-removes the default's row. */
export function removeSet(state: DraftState, workoutId: string, key: string, index: number): DraftState {
  return mapSets(state, workoutId, key, (sets) => {
    if (!Number.isInteger(index) || index < 0 || index >= sets.length) throw new RangeError(`exercise ${key} has no set ${index}`)
    return sets.filter((_, i) => i !== index)
  })
}

/** The set type picker's answer for one set (`withSetType`: type, DROPS and REST BETWEEN). */
export function setSetType(state: DraftState, workoutId: string, key: string, index: number, type: SetType): DraftState {
  return mapSetAt(state, workoutId, key, index, (s) => withSetType(s, type))
}

/** One set's rep target (the rep box). A staged set's stages keep their own. */
export function setSetRepTarget(state: DraftState, workoutId: string, key: string, index: number, target: RepTarget): DraftState {
  return mapSetAt(state, workoutId, key, index, (s) => withRepTarget(s, target))
}

/** A stage's own rep target (the rep box on a stage row). */
export function setStageRepTarget(state: DraftState, workoutId: string, key: string, index: number, stage: number, target: RepTarget): DraftState {
  return mapSetAt(state, workoutId, key, index, (s) => {
    if (!Number.isInteger(stage) || stage < 0 || stage >= s.stages.length) throw new RangeError(`set ${index} of ${key} has no stage ${stage}`)
    return { ...s, stages: s.stages.map((st, j) => (j === stage ? withRepTarget(st, target) : st)) }
  })
}

/** ALL, and "Use for all N sets": every head of the exercise, a warmup too (a rep target goes to every head); a stage keeps its own. */
export function setAllRepTargets(state: DraftState, workoutId: string, key: string, target: RepTarget): DraftState {
  return mapSets(state, workoutId, key, (sets) => sets.map((s) => withRepTarget(s, target)))
}

/** The REST AFTER stepper: `rest_seconds` of the default's set, null the chain. */
export function setSetRestAfter(state: DraftState, workoutId: string, key: string, index: number, seconds: number | null): DraftState {
  return mapSetAt(state, workoutId, key, index, (s) => ({ ...s, restSeconds: seconds }))
}

// ─── Weekdays (a weekday run; chunk 51b) ─────────────────────────────────────────────────────────────────────────────────

export type DayToggle =
  | { ok: true; schedule: WeeklySchedule }
  | { ok: false; reason: 'taken'; takenBy: string } // another workout's id: "Thu is Push 2's day"
  | { ok: false; reason: 'last' } // "At least one day stays on"

/**
 * What tapping a weekday on a workout's DAYS card does, by chunk 45's rule (`validateDays`; SPEC Defaults 2) against the schedule
 * the DRAFT holds: DECISIONS 169 (Adam, 2026-10-16), "the DAYS card checks the edit as it stands, so two workouts can trade days
 * in one save". A day another workout holds is refused and names that workout; the last day a workout has can't be turned off
 * (`hadDays`: the workout had a day when the screen opened; one that never had any isn't asked for one, as the planner's
 * `planSchedule` has it).
 */
export function dayToggle(state: DraftState, workoutId: string, day: DayOfWeek, hadDays: boolean): DayToggle {
  const current = daysOfWorkout(state.edit.schedule, workoutId)
  const days = current.includes(day) ? current.filter((d) => d !== day) : [...current, day]
  if (days.length === 0) {
    return hadDays ? { ok: false, reason: 'last' } : { ok: true, schedule: { ...fullSchedule(state.edit.schedule), [day]: null } }
  }
  const checked = validateDays({ schedule: state.edit.schedule, workoutId, days })
  return checked.ok ? { ok: true, schedule: checked.schedule } : checked.reason === 'taken' ? { ok: false, reason: 'taken', takenBy: checked.takenBy } : { ok: false, reason: 'last' }
}

/** The weekday toggled, or the draft as it was when the toggle is refused. */
export function toggleWorkoutDay(state: DraftState, workoutId: string, day: DayOfWeek, hadDays: boolean): DraftState {
  const toggle = dayToggle(state, workoutId, day, hadDays)
  return toggle.ok ? { ...state, edit: { ...state.edit, schedule: toggle.schedule } } : state
}

// ─── Does the draft differ from where it started? ────────────────────────────────────────────────────────────────────

// The draft without the screen's own handles: what CANCEL compares, and what SAVE checks the run copy against.
export function draftContent(state: DraftState): string {
  // A block nothing points at is not part of the program: linking two exercises and splitting them again leaves one behind.
  const referenced = new Set(state.edit.workouts.flatMap((w) => w.exercises.map((e) => e.supersetBlockId)))
  return JSON.stringify({
    workouts: state.edit.workouts.map((w) => ({
      id: w.id,
      name: w.name,
      exercises: w.exercises.map(({ key: _key, ...e }) => e),
      routine: w.routine.map(({ key: _key, ...r }) => r),
    })),
    // In id order: `fetchSupersetBlockRests` reads with no order, and SAVE compares this text from two reads of the same rows.
    blocks: state.edit.blocks.filter((b) => referenced.has(b.id)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    schedule: state.edit.schedule,
  })
}

export function draftDiffers(a: DraftState, b: DraftState): boolean {
  return draftContent(a) !== draftContent(b)
}
