import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MUSCLE_GROUPS } from '../lib/exerciseTags'
import type { Exercise, MuscleGroup } from '../types'
import {
  PICKER_TEXT,
  addConfirmTitle,
  creatableName,
  emptyKind,
  errorReason,
  exercisesInGroup,
  groupChips,
  groupEmptyLine,
  groupLabel,
  newExerciseButton,
  newExerciseCaption,
  offeredExercises,
  openingGroup,
  rowLabel,
  tapGroup,
} from './exercisePickerLogic'

// TASKS-1.2 chunk 41: the exercise picker's rules, pure. Each is asserted where ExercisePickerSheet.tsx uses
// it too (its own test draws them); here are the rules themselves, with a break proof per rule.

const here = dirname(fileURLToPath(import.meta.url))
const board = (name: string) => readFileSync(join(here, '..', '..', 'design', '1.2', 'source', name), 'utf8')

function ex(id: string, name: string, muscleGroup: MuscleGroup): Exercise {
  return { id, userId: 'u', name, muscleGroup, isArchived: false, createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null }
}

const LIBRARY = [
  ex('pull-up', 'Pull-Up', 'back'),
  ex('squat', 'Back Squat', 'quads'),
  ex('curl', 'cable curl', 'biceps'),
  ex('row', 'Chest-Supported Row', 'back'),
  ex('press', 'Incline Dumbbell Press', 'chest'),
]

describe('groupChips: ALL first, then the muscle groups in the app\'s own order', () => {
  it('is ALL and the twelve groups, labelled as the app labels them', () => {
    expect(groupChips().map((chip) => chip.label)).toEqual(['ALL', 'CHEST', 'BACK', 'SHOULDERS', 'BICEPS', 'TRICEPS', 'FOREARMS', 'QUADS', 'HAMSTRINGS', 'GLUTES', 'CALVES', 'CORE', 'OTHER'])
    expect(groupChips().map((chip) => chip.group)).toEqual(['all', ...MUSCLE_GROUPS])
  })

  it('is the chip row the boards draw (PP2d\'s list, PL4\'s buttons)', () => {
    const labels = groupChips().map((chip) => `'${chip.label}'`)
    expect(board('ProgramPlannerPicker.dc.html')).toContain(`[${labels.join(', ')}]`)
    const pl4 = board('PlannerPicker.dc.html')
    const row = [...pl4.matchAll(/aria-pressed="(?:true|false)"[^>]*>([A-Z]+)<\/button>/g)].map((m) => m[1]).slice(0, 13)
    expect(row).toEqual(groupChips().map((chip) => chip.label))
  })
})

describe('openingGroup: a swap opens on the group of the exercise it replaces', () => {
  it('is that group, whichever it is', () => {
    for (const group of MUSCLE_GROUPS) expect(openingGroup(group)).toBe(group)
  })

  it('is ALL when there is no group to open on: an add, or a group the chips don\'t have', () => {
    expect(openingGroup(undefined)).toBe('all')
    expect(openingGroup(null)).toBe('all')
    expect(openingGroup('legs' as MuscleGroup)).toBe('all')
  })
})

describe('tapGroup', () => {
  it('picks the chip that is tapped', () => {
    expect(tapGroup('all', 'back')).toBe('back')
    expect(tapGroup('back', 'chest')).toBe('chest')
    expect(tapGroup('back', 'all')).toBe('all')
  })

  it('goes back to ALL when the chip that is on is tapped again (the pickers this one replaces all did)', () => {
    expect(tapGroup('back', 'back')).toBe('all')
    expect(tapGroup('all', 'all')).toBe('all')
  })
})

describe('offeredExercises: what the picker may show', () => {
  it('leaves out the excluded ids and sorts by name', () => {
    expect(offeredExercises(LIBRARY, ['pull-up']).map((e) => e.name)).toEqual(['Back Squat', 'cable curl', 'Chest-Supported Row', 'Incline Dumbbell Press'])
  })

  it('leaves out nothing for no ids, and ignores an id the library doesn\'t have', () => {
    expect(offeredExercises(LIBRARY, [])).toHaveLength(5)
    expect(offeredExercises(LIBRARY, ['nobody'])).toHaveLength(5)
  })

  it('never changes the array it is given', () => {
    const copy = [...LIBRARY]
    offeredExercises(LIBRARY, ['pull-up'])
    expect(LIBRARY).toEqual(copy)
  })
})

describe('exercisesInGroup', () => {
  it('is every exercise on ALL, and only the group\'s under a chip', () => {
    expect(exercisesInGroup(LIBRARY, 'all')).toHaveLength(5)
    expect(exercisesInGroup(LIBRARY, 'back').map((e) => e.id)).toEqual(['pull-up', 'row'])
    expect(exercisesInGroup(LIBRARY, 'forearms')).toEqual([])
  })

  it('hands back a copy on ALL, so a caller can sort it', () => {
    expect(exercisesInGroup(LIBRARY, 'all')).not.toBe(LIBRARY)
  })
})

describe('groupLabel: the group under a name', () => {
  it('reads like the chip', () => {
    expect(groupLabel(ex('a', 'A', 'quads'))).toBe('QUADS')
    expect(groupLabel(ex('a', 'A', 'other'))).toBe('OTHER')
  })

  it('shows a value the app doesn\'t know as it is, upper-cased, never crashing', () => {
    expect(groupLabel({ muscleGroup: 'legs' as MuscleGroup })).toBe('LEGS')
  })
})

describe('emptyKind: what the list says when it has nothing to list', () => {
  // inLibrary: how many exercises the library has under the chip that is on, before the excluded are left out
  const base = { mode: 'add' as const, group: 'all' as const, inLibrary: 9, listed: 0, canCreate: false }

  it('says nothing while there is something to list', () => {
    expect(emptyKind({ ...base, listed: 1 })).toBeNull()
    expect(emptyKind({ ...base, group: 'back', inLibrary: 4, listed: 4, canCreate: true })).toBeNull()
    expect(emptyKind({ ...base, group: 'back', inLibrary: 0, listed: 1, canCreate: true })).toBeNull()
  })

  it('ALL EXERCISES ADDED: ALL, the library has exercises and every one is in the workout (PP2d2: "every exercise already in the workout")', () => {
    expect(emptyKind(base)).toBe('all-added')
    expect(emptyKind({ ...base, canCreate: true })).toBe('all-added')
  })

  it('NONE IN THIS GROUP: a chip with nothing under it, where nothing can be created, however it came to be empty (PL6, PP2d2)', () => {
    // nothing left: the group has exercises and they are all in the workout (PP2d2 "nothing left in the group")
    expect(emptyKind({ ...base, group: 'chest' })).toBe('none-in-group')
    expect(emptyKind({ ...base, mode: 'swap', group: 'back' })).toBe('none-in-group')
    // nothing there at all (PL6)
    expect(emptyKind({ ...base, group: 'forearms', inLibrary: 0 })).toBe('none-in-group')
  })

  it('NONE IN THIS GROUP also where one can be created, when the group has exercises and every one is in the workout: they exist, so "none yet" would be wrong (PP2d2)', () => {
    expect(emptyKind({ ...base, group: 'chest', inLibrary: 3, canCreate: true })).toBe('none-in-group')
    // a swap whose own exercise is the only one in its group
    expect(emptyKind({ ...base, mode: 'swap', group: 'back', inLibrary: 1, canCreate: true })).toBe('none-in-group')
  })

  it('"No forearms exercises yet.": a group the library has nothing in, where an exercise can be created (W15 "a group with nothing in it")', () => {
    expect(emptyKind({ ...base, group: 'forearms', inLibrary: 0, canCreate: true })).toBe('group-empty')
    expect(emptyKind({ ...base, mode: 'swap', group: 'forearms', inLibrary: 0, canCreate: true })).toBe('group-empty')
  })

  it('"No exercises yet…": the library has none at all, on ALL (W15 "empty library")', () => {
    expect(emptyKind({ ...base, inLibrary: 0 })).toBe('library-empty')
    expect(emptyKind({ ...base, inLibrary: 0, canCreate: true })).toBe('library-empty')
  })

  it('an empty library under a chip is a group with nothing in it, not the empty-library state', () => {
    expect(emptyKind({ ...base, inLibrary: 0, group: 'back', canCreate: true })).toBe('group-empty')
    expect(emptyKind({ ...base, inLibrary: 0, group: 'back' })).toBe('none-in-group')
  })

  it('a swap with nothing else to swap to says so, not that everything was added', () => {
    expect(emptyKind({ ...base, mode: 'swap' })).toBe('no-others')
  })
})

describe('the words the picker builds', () => {
  it('names the new exercise by the chip that is on', () => {
    expect(newExerciseCaption('back')).toBe('NEW BACK EXERCISE')
    expect(newExerciseButton('back')).toBe('+ NEW BACK EXERCISE')
    expect(newExerciseButton('hamstrings')).toBe('+ NEW HAMSTRINGS EXERCISE')
  })

  it('says a group has none yet', () => {
    expect(groupEmptyLine('forearms')).toBe('No forearms exercises yet.')
    expect(groupEmptyLine('hamstrings')).toBe('No hamstrings exercises yet.')
  })

  it('titles the add confirm with the exercise', () => {
    expect(addConfirmTitle('Hammer Curl')).toBe('Add Hammer Curl?')
  })

  it('names a row for assistive technology as the boards do: Swap to X (PL4), Add X (PP2d), a radio by its name', () => {
    expect(rowLabel('swap', 'Pull-Up')).toBe('Swap to Pull-Up')
    expect(rowLabel('add', 'Pull-Up')).toBe('Add Pull-Up')
    expect(rowLabel('radio', 'Pull-Up')).toBe('Pull-Up')
  })
})

describe('creatableName', () => {
  it('is the name, trimmed', () => {
    expect(creatableName('Kneeling Pulldown')).toBe('Kneeling Pulldown')
    expect(creatableName('  Kneeling Pulldown \n')).toBe('Kneeling Pulldown')
  })

  it('is nothing for a blank', () => {
    expect(creatableName('')).toBeNull()
    expect(creatableName('   \t')).toBeNull()
  })
})

describe('errorReason: the line under an error headline is the real reason (SPEC, Errors (15))', () => {
  it('is the message of an Error', () => {
    expect(errorReason(new Error('duplicate key value'))).toBe('duplicate key value')
  })

  it('is the message of an object that isn\'t an Error: Supabase\'s errors are plain objects', () => {
    expect(errorReason({ message: 'new row violates row-level security policy', code: '42501' })).toBe('new row violates row-level security policy')
  })

  it('is a string that was thrown, and is trimmed', () => {
    expect(errorReason('  boom  ')).toBe('boom')
    expect(errorReason({ message: '\n  Failed to fetch ' })).toBe('Failed to fetch')
  })

  it('is "Something went wrong." when there is no message (P1.2-5): nothing, an empty or blank message, a message that isn\'t text', () => {
    for (const error of [undefined, null, 42, {}, { message: '' }, { message: '   ' }, { message: 7 }, new Error('')]) {
      expect(errorReason(error), JSON.stringify(error)).toBe('Something went wrong.')
    }
  })

  it('is "You may be offline." only when the phone is offline and there is no message; a real message still wins', () => {
    expect(errorReason({ message: '' }, true)).toBe('You may be offline.')
    expect(errorReason(undefined, true)).toBe('You may be offline.')
    expect(errorReason(new Error('Failed to fetch'), true)).toBe('Failed to fetch')
    expect(errorReason({ message: '' }, false)).toBe('Something went wrong.')
  })
})

describe('wording: every string here is on the board it comes from, and ours are on none', () => {
  const pl4 = board('PlannerPicker.dc.html')
  const pp2d = board('ProgramPlannerPicker.dc.html')
  const pp2d2 = board('ProgramPlannerPickerEmpty.dc.html')
  const w11 = board('SwapSheet.dc.html')
  const w13 = board('WorkoutAddExercise.dc.html')
  const w14 = board('WorkoutAddConfirm.dc.html')
  const w15 = board('WorkoutPickerStates.dc.html')

  it('PL6 and PP2d2: NONE IN THIS GROUP; PP2d2: ALL EXERCISES ADDED', () => {
    expect(pl4).toContain(`>${PICKER_TEXT.noneInGroup}<`)
    expect(pp2d2).toContain(`caption: '${PICKER_TEXT.noneInGroup}'`)
    expect(pp2d2).toContain(`caption: '${PICKER_TEXT.allAdded}'`)
  })

  it('PP2d: the line for a list that stays open, and the chip row\'s name', () => {
    expect(pp2d).toContain(`>${PICKER_TEXT.stayOpen}<`)
    expect(pp2d).toContain(`aria-label="${PICKER_TEXT.groupsLabel}"`)
  })

  it('PL4 and PP2d: what a row is called for assistive technology', () => {
    expect(pl4).toContain(`aria-label="${rowLabel('swap', 'Chest-Supported Row')}"`)
    expect(pp2d).toContain("addLabel: 'Add ' + n")
    expect(pp2d).toContain("'Barbell Bench Press'")
  })

  it('W11: the dashed row', () => {
    expect(w11).toContain(`>${newExerciseButton('back')}<`)
  })

  it('W13: the line under the list on ALL', () => {
    expect(w13).toContain(`>${PICKER_TEXT.pickGroupToCreate}<`)
  })

  it('W14: the confirm\'s title and BACK', () => {
    expect(w14).toContain(`aria-label="${addConfirmTitle('Hammer Curl').replace('?', '')}"`)
    expect(w14).toContain(`>${addConfirmTitle('Hammer Curl')}<`)
    expect(w14).toContain(`>${PICKER_TEXT.back}<`)
    expect(w14).toContain('>ADD EXERCISE<')
  })

  it('W15: the field\'s caption, CANCEL, CREATE, CREATING…, the empty group, the dashed row and the empty library', () => {
    expect(w15).toContain(`>${newExerciseCaption('back')}<`)
    expect(w15).toContain(`>${PICKER_TEXT.cancel}<`)
    expect(w15).toContain(`>${PICKER_TEXT.create}<`)
    expect(w15).toContain(`>${PICKER_TEXT.creating}<`)
    expect(w15).toContain(`>${groupEmptyLine('forearms')}<`)
    expect(w15).toContain(`>${newExerciseButton('forearms')}<`)
    expect(w15).toContain(`>${PICKER_TEXT.libraryEmptyCreate}<`)
  })

  it('the words of the states no board draws are ours: on none of the boards this chunk builds', () => {
    const boards = [pl4, pp2d, pp2d2, w11, w13, w14, w15].join('\n')
    for (const ours of [PICKER_TEXT.noOthers, PICKER_TEXT.loading, PICKER_TEXT.loadFailed, PICKER_TEXT.createFailed, PICKER_TEXT.somethingWentWrong, PICKER_TEXT.offline]) {
      expect(boards, ours).not.toContain(ours)
    }
    expect(boards).not.toContain(`aria-label="${PICKER_TEXT.listLabel}"`)
    expect(boards).not.toContain(`>${PICKER_TEXT.libraryEmpty}<`)
  })
})
