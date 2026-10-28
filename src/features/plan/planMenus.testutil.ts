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

// The session ⋯ (chunk 54b; board 10): the open session's header has one button, "<workout name> options", that opens the session menu
// (MARK THIS SESSION AS DELOAD, MOVE THIS SESSION). A session that is done or skipped, in a past week or whose shared plan is locked has none.
// The WEEK ⋯ button is "Week 3 options" / "Cycle 3 options" and is not this one.
const SESSION_MENU_BUTTON = /^(?!(Week|Cycle) \d+ options$).+ options$/
// Marked, the row also holds the DELOAD chip, so its name is "UNMARK THIS SESSION DELOAD".
const SESSION_TOGGLE = /^(MARK THIS SESSION AS DELOAD|UNMARK THIS SESSION\s?(DELOAD)?|MARKING…|UNMARKING…)$/

export function sessionMenuButton(): HTMLElement | null {
  return screen.queryByLabelText(SESSION_MENU_BUTTON)
}

export function openSessionMenu() {
  fireEvent.click(screen.getByLabelText(SESSION_MENU_BUTTON))
}

// The menu's deload row, opening the menu first when it isn't open (the sheet stays open after a mark, as WEEK ⋯'s does).
export function sessionToggle(): HTMLButtonElement {
  if (!screen.queryByRole('button', { name: SESSION_TOGGLE })) openSessionMenu()
  return screen.getByRole('button', { name: SESSION_TOGGLE }) as HTMLButtonElement
}

// The same row once the page has it (a test that waits for the week to load): `label` is what it reads then.
export async function findSessionToggle(label: 'MARK THIS SESSION AS DELOAD' | 'UNMARK THIS SESSION', timeout = 3000): Promise<HTMLButtonElement> {
  await screen.findByLabelText(SESSION_MENU_BUTTON, {}, { timeout })
  if (!screen.queryByRole('button', { name: SESSION_TOGGLE })) openSessionMenu()
  return (await screen.findByRole('button', { name: new RegExp(`^${label}`) }, { timeout })) as HTMLButtonElement
}

// The page has drawn the open session (its ⋯ is there): a test that waits for the week to load.
export async function findSessionMenuButton(timeout = 3000): Promise<HTMLElement> {
  return screen.findByLabelText(SESSION_MENU_BUTTON, {}, { timeout })
}

// The DELOAD chip beside the open session's name: whether the session reads as marked, without opening a menu.
export function sessionDeloadChip(): Element | null {
  return document.querySelector('[data-session-deload]')
}
