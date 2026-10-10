import { fireEvent, screen } from '@testing-library/react'

// Plan's week panel shows one week in two views (chunk 29, SPEC Plan screen
// [P1.1]): SETS (the default — set numbers, tags, `+` ADD SET, a working
// set's DELETE SET) and STRUCTURE (the exercise ⋯, ADD EXERCISE, and each
// set's kind controls). Tests open the view first, the way a user does.
export function openSetsView() {
  fireEvent.click(screen.getByText('SETS'))
}

export function openStructureView() {
  fireEvent.click(screen.getByText('STRUCTURE'))
}

// Plan's ⋯ menus (Adam's standing UI rule, 2026-10-10): swap/reorder/remove/
// add-warmup live behind the exercise's ⋯, and set kind/stages/tags/delete
// behind the set's own ⋯. Tests open the menu first, the way a user does.
// Since chunk 29 the exercise ⋯ and the kind controls are in the STRUCTURE
// view (open it first), and tags and a working set's delete are in SETS.
export function openExerciseMenu(exerciseName = 'Bench Press') {
  fireEvent.click(screen.getByLabelText(`${exerciseName} options`))
}

export function openSetMenu(setNumber: number) {
  fireEvent.click(screen.getByLabelText(`Options for set ${setNumber}`))
}

export function openStageMenu(index = 0) {
  fireEvent.click(screen.getAllByLabelText('Options for stage')[index])
}
