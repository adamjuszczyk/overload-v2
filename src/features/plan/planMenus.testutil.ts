import { fireEvent, screen } from '@testing-library/react'

// A set's ⋯ opens the set type picker (chunk 54a; SPEC Screens → Plan screen): the kind, the stage stepper, Cues and REMOVE THIS SET live
// behind it, and the exercise has no ⋯ of its own. A working set's ⋯ is called "Options for set N" (N counting the working sets from 1, as
// the rows number them) and a warmup's "Options for warmup set N". Tests open the picker first, the way a user does.
export function openSetMenu(setNumber: number) {
  fireEvent.click(screen.getByLabelText(`Options for set ${setNumber}`))
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
