import { fireEvent, screen } from '@testing-library/react'

// Plan's ⋯ menus (Adam's standing UI rule, 2026-10-10): swap/reorder/remove/
// add-warmup live behind the exercise's ⋯, and set kind/stages/tags/delete
// behind the set's own ⋯. Tests open the menu first, the way a user does.
export function openExerciseMenu(exerciseName = 'Bench Press') {
  fireEvent.click(screen.getByLabelText(`${exerciseName} options`))
}

export function openSetMenu(setNumber: number) {
  fireEvent.click(screen.getByLabelText(`Options for set ${setNumber}`))
}

export function openStageMenu(index = 0) {
  fireEvent.click(screen.getAllByLabelText('Options for stage')[index])
}
