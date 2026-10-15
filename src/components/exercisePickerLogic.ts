import type { Exercise, MuscleGroup } from '../types'
import { MUSCLE_GROUPS, MUSCLE_GROUP_LABELS } from '../lib/exerciseTags'

// The rules of the one exercise picker (TASKS-1.2 chunk 41), pure: which chips there are and which is on,
// which exercises are offered under it, what an empty list says, and the words the picker draws that no
// caller passes in. ExercisePickerSheet.tsx draws what these decide; nothing here knows about React.
//
// Every string below is on a board (design/1.2/source/*.dc.html: PL4-PL6, PP2d, PP2d2, W11, W13-W15) except
// the ones marked "ours": the words of a state no board draws (D31, provisional).

/** A muscle group chip, or ALL. */
export type PickerGroup = MuscleGroup | 'all'

/** A swap replaces one exercise with another; an add puts one more in. */
export type PickerMode = 'swap' | 'add'

export const PICKER_TEXT = {
  /** The chip row's name (PP2d: `aria-label="Muscle group"`). */
  groupsLabel: 'Muscle group',
  all: 'ALL',
  /** The list's name, for assistive technology (ours). */
  listLabel: 'Exercises',
  /** PL6, PP2d2: a chip with nothing under it. */
  noneInGroup: 'NONE IN THIS GROUP',
  /** PP2d2: every exercise is already in the workout. */
  allAdded: 'ALL EXERCISES ADDED',
  /** PP2d: said when the sheet stays open after a tap. */
  stayOpen: 'Tap to add. The list stays open for the next one.',
  /** W13: under the list on ALL, where an exercise can't be created. */
  pickGroupToCreate: 'Pick a muscle group to create a new exercise.',
  /** W15: nothing in the library at all, where creating is offered. */
  libraryEmptyCreate: 'No exercises yet. Pick a muscle group to create one.',
  /** W14 and W15's buttons. */
  back: 'BACK',
  cancel: 'CANCEL',
  create: 'CREATE',
  creating: 'CREATING…',
  /** Ours: nothing to swap to (the old week picker's words), nothing at all and no way to create, loading, failing to load, failing to create. */
  noOthers: 'NO OTHER EXERCISES',
  libraryEmpty: 'No exercises yet.',
  loading: 'LOADING…',
  loadFailed: "COULDN'T LOAD EXERCISES",
  createFailed: "Couldn't create the exercise.",
  /** Ours: the reason when an error carries no message (P1.2-5), and when that is because the phone is offline (Errors 15). */
  somethingWentWrong: 'Something went wrong.',
  offline: 'You may be offline.',
} as const

/** The chips, ALL first and then the muscle groups in the app's own order (`MUSCLE_GROUPS`). */
export function groupChips(): { group: PickerGroup; label: string }[] {
  return [{ group: 'all', label: PICKER_TEXT.all }, ...MUSCLE_GROUPS.map((group) => ({ group, label: MUSCLE_GROUP_LABELS[group] }))]
}

/** The chip a sheet opens on: a swap opens on the group of the exercise it replaces; anything else (an add, a group the chips don't have) opens on ALL. */
export function openingGroup(own: MuscleGroup | null | undefined): PickerGroup {
  return own != null && MUSCLE_GROUPS.includes(own) ? own : 'all'
}

/** A tap on a chip picks it; a tap on the one that is already on goes back to ALL (both pickers this one replaces did). */
export function tapGroup(current: PickerGroup, tapped: PickerGroup): PickerGroup {
  return tapped === current ? 'all' : tapped
}

/** The exercises the picker may show: every one but the excluded ids, by name. A new array; the caller's isn't touched. */
export function offeredExercises(exercises: readonly Exercise[], excludedIds: readonly string[]): Exercise[] {
  const excluded = new Set(excludedIds)
  return exercises.filter((exercise) => !excluded.has(exercise.id)).sort((a, b) => a.name.localeCompare(b.name))
}

/** What a chip lists: the one group, or everything on ALL. */
export function exercisesInGroup(exercises: readonly Exercise[], group: PickerGroup): Exercise[] {
  return group === 'all' ? [...exercises] : exercises.filter((exercise) => exercise.muscleGroup === group)
}

/** The group under an exercise's name, as the chips read it (a value the app doesn't know is shown as it is, upper-cased). */
export function groupLabel(exercise: Pick<Exercise, 'muscleGroup'>): string {
  return MUSCLE_GROUP_LABELS[exercise.muscleGroup] ?? String(exercise.muscleGroup).toUpperCase()
}

/**
 * What the list says when it has nothing to list; null when it has something. Two different things can be
 * behind an empty list, and the boards word them apart: nothing left (the exercises are all in the workout:
 * PP2d2's "NOTHING LEFT IN THE GROUP") and nothing there at all (W15's "A GROUP WITH NOTHING IN IT").
 */
export type PickerEmpty =
  /** A group with nothing left in it, or with nothing in it where no exercise can be created (PL6, PP2d2). */
  | 'none-in-group'
  /** ALL, and every exercise in the library is already in the workout (PP2d2). */
  | 'all-added'
  /** ALL, in a swap, and the exercise being replaced is the only one there is (ours). */
  | 'no-others'
  /** A group the library has no exercise in, where one can be created there (W15). */
  | 'group-empty'
  /** No exercises in the library at all (W15; ours where nothing can be created). */
  | 'library-empty'

export function emptyKind(input: {
  mode: PickerMode
  group: PickerGroup
  /** How many exercises the library has under the chip that is on (on ALL: all of them), before the excluded ones are left out. */
  inLibrary: number
  /** How many the list shows under the chip that is on, after they are. */
  listed: number
  /** The host lets the user make a new exercise here (`onCreate`). */
  canCreate: boolean
}): PickerEmpty | null {
  if (input.listed > 0) return null
  if (input.group === 'all') {
    if (input.inLibrary === 0) return 'library-empty'
    return input.mode === 'add' ? 'all-added' : 'no-others'
  }
  return input.canCreate && input.inLibrary === 0 ? 'group-empty' : 'none-in-group'
}

/** `NEW BACK EXERCISE`: the caption over the name field (W15). */
export function newExerciseCaption(group: MuscleGroup): string {
  return `NEW ${MUSCLE_GROUP_LABELS[group]} EXERCISE`
}

/** `+ NEW BACK EXERCISE`: the dashed row that opens the field (W11, W15). */
export function newExerciseButton(group: MuscleGroup): string {
  return `+ ${newExerciseCaption(group)}`
}

/** `No forearms exercises yet.` (W15). */
export function groupEmptyLine(group: MuscleGroup): string {
  return `No ${MUSCLE_GROUP_LABELS[group].toLowerCase()} exercises yet.`
}

/** `Add Hammer Curl?`: the title of the add confirm (W14). */
export function addConfirmTitle(name: string): string {
  return `Add ${name}?`
}

/** The accessible name of a row: what the board labels it (PL4 `Swap to X`, PP2d `Add X`). A radio row is named by the exercise alone. */
export function rowLabel(kind: 'radio' | 'swap' | 'add', name: string): string {
  if (kind === 'swap') return `Swap to ${name}`
  if (kind === 'add') return `Add ${name}`
  return name
}

/** A name worth creating: not blank. The name is sent trimmed. */
export function creatableName(typed: string): string | null {
  const name = typed.trim()
  return name === '' ? null : name
}

/**
 * The reason an error line gives: the message the server or the client actually returned (SPEC, Errors (15)).
 * Supabase's errors aren't `Error` objects, so a message is read off any object that has one. With none,
 * "Something went wrong." (P1.2-5), or "You may be offline." when the phone is: the offline wording is only
 * ever the reason when it is the reason, and a real message still wins over it.
 */
export function errorReason(error: unknown, offline = false): string {
  let message = ''
  if (typeof error === 'string') message = error
  else if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') message = error.message
  message = message.trim()
  if (message !== '') return message
  return offline ? PICKER_TEXT.offline : PICKER_TEXT.somethingWentWrong
}
