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

// Chunk 52 (TASKS-1.2 "Plan's header"): the week arrows are gone, and a week is opened by tapping its tile ("WEEK 3", "CYCLE 2": the
// tile's name, which is the label under which the strip draws it). A tile exists only for a week the strip reaches: from week 1
// through the current week, then the weeks planned ahead and the first unplanned one after the current one. A test that opens a
// week gives the run's plans (`useAllWeekPlans`) the weeks that make its tile exist, as a real run has them.
export function openWeekTile(label: string) {
  fireEvent.click(screen.getByText(label).closest('button') as HTMLButtonElement)
}

// WEEK ⋯ (CYCLE ⋯ on a sequence run), the button under the header that opens board 1e's sheet: where the week's deload and the
// Settings rules line now are. It is labelled "Week 3 options" / "Cycle 3 options".
export function openWeekMenu() {
  fireEvent.click(screen.getByLabelText(/^(Week|Cycle) \d+ options$/))
}

// The sheet's own close button (BottomSheet's ×).
export function closeSheet() {
  fireEvent.click(screen.getByLabelText('Close'))
}
