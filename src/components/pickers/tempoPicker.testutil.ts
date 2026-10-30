import { fireEvent, within } from '@testing-library/react'

// A test helper for the screens that open the tempo picker (the planner's TEMPO row, CHANGE THE PROGRAM's exercise sheet): it drives the open picker the way a
// person does, through its own controls, so the tests of those screens read the write the picker's footer causes and never reach into the picker.
// `picker` is the element holding the picker's dialog (`document.body`, or the dialog itself).

const PHASES = ['Down', 'Bottom', 'Up', 'Top'] as const

/**
 * Sets the open picker to `tempo` and presses its footer. `''` is NONE ("SET NO TEMPO"); anything else is SET with the four boxes typed (and left, so
 * each is settled): `'3-1-X-0'` types 3, 1, X and 0.
 */
export function pickTempo(picker: HTMLElement, tempo: string): void {
  if (tempo === '') {
    fireEvent.click(within(picker).getByRole('button', { name: 'NONE' }))
  } else {
    fireEvent.click(within(picker).getByRole('button', { name: 'SET' }))
    tempo.split('-').forEach((field, i) => {
      const box = within(picker).getByRole('textbox', { name: `${PHASES[i]} seconds` })
      fireEvent.change(box, { target: { value: field } })
      fireEvent.blur(box)
    })
  }
  fireEvent.click(within(picker).getByRole('button', { name: /^SET (TEMPO|NO TEMPO)/ }))
}
