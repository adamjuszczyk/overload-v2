// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

// Chunk 65 — the New program sheet (TASKS-1.2 "The PROGRAMS tab"; SPEC Programs and runs [1.2], Creating a program (16a): "the New program
// sheet asks for the name, the schedule type and the planning type. Neither type is preselected; CREATE PROGRAM stays disabled until both are
// chosen, and the sheet says why. Each option carries a one-line description (PR13, PR13b). Both can be changed later in the stepped program
// planner, as today"; boards PR13, PR13b). The sheet at its own layer: what is asked, when CREATE is off and what says why, what is written
// (the name and BOTH types, as chosen: the writer's own break is a default standing in for the choice), where it goes, what a failure says,
// and what it draws in each state. `useCreateProgram` is mocked at the seam; programsTab.writers.test.tsx and programService.test.ts prove
// what the hook and the service do with what the sheet hands them.

const state = vi.hoisted(() => ({ isPending: false }))
const createProgramMock = vi.hoisted(() => vi.fn())

vi.mock('./usePrograms', () => ({ useCreateProgram: () => ({ mutateAsync: createProgramMock, isPending: state.isPending }) }))

const { default: NewProgramSheet } = await import('./NewProgramSheet')

const onClose = vi.fn()

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  state.isPending = false
})
afterEach(() => {
  cleanup()
  onClose.mockReset()
  createProgramMock.mockReset()
  vi.restoreAllMocks()
})

function Probe() {
  const location = useLocation()
  return <div data-testid="at">{`AT ${location.pathname}${location.search}`}</div>
}
const at = () => screen.getByTestId('at').textContent

function renderSheet() {
  return render(
    <MemoryRouter initialEntries={['/program']}>
      <Routes>
        <Route path="/program" element={<><NewProgramSheet onClose={onClose} /><Probe /></>} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  )
}

const createButton = () => screen.getByRole('button', { name: /^(CREATE PROGRAM|CREATING…)$/ }) as HTMLButtonElement
const nameInput = () => screen.getByLabelText('PROGRAM NAME') as HTMLInputElement
const radio = (name: string) => screen.getByRole('radio', { name: new RegExp(`^${name}`) })
const group = (label: string) => screen.getByRole('radiogroup', { name: label })
const type = (name: string) => fireEvent.change(nameInput(), { target: { value: name } })

const HINT_CHOOSE = 'Choose a schedule and a planning type to create it.'
const HINT_LATER = 'You can change both later in the program.'

describe('PR13 — nothing chosen yet', () => {
  it('the name, SCHEDULE and PLANNING with their options and descriptions, "CHOOSE ONE" on each group, CREATE PROGRAM and why it is off', () => {
    renderSheet()

    expect(screen.getByRole('dialog', { name: 'New program' })).toBeTruthy()
    expect(nameInput().placeholder).toBe('e.g. Hypertrophy Block')
    expect(within(group('SCHEDULE')).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'WeekdaysEach workout has its days, like Push on Monday.',
      'SequenceWorkouts in a set order. Do the next one whenever you train.',
    ])
    expect(within(group('PLANNING')).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'StableThe same sets every week. A change in one week lasts that week only.',
      'Week-dependentEach week starts as a copy of the last, and you change it as you go.',
    ])
    expect(screen.getAllByText('CHOOSE ONE')).toHaveLength(2)
    expect(createButton().textContent).toBe('CREATE PROGRAM')
    expect(createButton().disabled).toBe(true)
    expect(screen.getByText(HINT_CHOOSE)).toBeTruthy()
    expect(screen.queryByText(HINT_LATER)).toBeNull()
  })

  it('neither type is preselected: no option is checked, though a name was typed (SPEC: "Neither type is preselected")', () => {
    renderSheet()
    type('Upper / Lower')
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false', 'false'])
    expect(createButton().disabled).toBe(true)
  })

  it('the board\'s disabled button: the raised surface, a border, dim text; not the accent', () => {
    renderSheet()
    expect(createButton().style.background).toBe('var(--surface-raised)')
    expect(createButton().style.color).toBe('var(--text-dim)')
    expect(createButton().style.borderColor).toBe('var(--border)')
  })

  it('pressing the disabled CREATE, or Enter in the name field, writes nothing', async () => {
    renderSheet()
    type('Upper / Lower')
    fireEvent.click(createButton())
    fireEvent.keyDown(nameInput(), { key: 'Enter' })
    await act(async () => { await Promise.resolve() })
    expect(createProgramMock).not.toHaveBeenCalled()
    expect(at()).toBe('AT /program')
  })
})

describe('PR13b — both chosen', () => {
  it('both chosen and a name: CREATE PROGRAM is on, in the accent with the near-black on it, and the line says both can be changed later', () => {
    renderSheet()
    type('Upper / Lower')
    fireEvent.click(radio('Weekdays'))
    fireEvent.click(radio('Stable'))

    expect(createButton().disabled).toBe(false)
    expect(createButton().style.background).toBe('var(--accent)')
    expect(createButton().style.color).toBe('var(--on-accent)')
    expect(screen.getByText(HINT_LATER)).toBeTruthy()
    expect(screen.queryByText(HINT_CHOOSE)).toBeNull()
    expect(screen.queryByText('CHOOSE ONE')).toBeNull()
    expect(radio('Weekdays').getAttribute('aria-checked')).toBe('true')
    expect(radio('Stable').getAttribute('aria-checked')).toBe('true')
    expect(radio('Sequence').getAttribute('aria-checked')).toBe('false')
    expect(radio('Week-dependent').getAttribute('aria-checked')).toBe('false')
  })

  it('one type chosen is not enough: still off, the other group still says CHOOSE ONE, and the line is still the board\'s', () => {
    renderSheet()
    type('Block')
    fireEvent.click(radio('Sequence'))

    expect(createButton().disabled).toBe(true)
    expect(screen.getByText(HINT_CHOOSE)).toBeTruthy()
    expect(within(group('SCHEDULE')).queryByText('CHOOSE ONE')).toBeNull()
    expect(within(group('PLANNING')).getByText('CHOOSE ONE')).toBeTruthy()
  })

  it('the picked option is the tinted accent with a filled radio; picking another in its group moves it', () => {
    renderSheet()
    fireEvent.click(radio('Weekdays'))
    expect(radio('Weekdays').style.background).toBe('var(--accent-muted)')
    expect(radio('Weekdays').style.borderColor).toBe('var(--accent)')
    expect(radio('Weekdays').querySelectorAll('span[aria-hidden="true"] > span')).toHaveLength(1)
    expect(radio('Sequence').style.background).toBe('var(--surface)')

    fireEvent.click(radio('Sequence'))
    expect(radio('Weekdays').getAttribute('aria-checked')).toBe('false')
    expect(radio('Weekdays').style.background).toBe('var(--surface)')
    expect(radio('Sequence').getAttribute('aria-checked')).toBe('true')
  })
})

describe('a name is needed too (ours, D31)', () => {
  it('both types chosen and no name (blank or spaces): CREATE is off and the line says to name it; typing one turns it on', () => {
    renderSheet()
    fireEvent.click(radio('Weekdays'))
    fireEvent.click(radio('Stable'))
    expect(createButton().disabled).toBe(true)
    expect(screen.getByText('Name the program to create it.')).toBeTruthy()

    type('   ')
    expect(createButton().disabled).toBe(true)
    type('Block')
    expect(createButton().disabled).toBe(false)
    expect(screen.queryByText('Name the program to create it.')).toBeNull()
  })
})

describe('CREATE — W: what is written, and where it goes', () => {
  it.each([
    ['Weekdays', 'Stable', 'weekday', 'stable'],
    ['Weekdays', 'Week-dependent', 'weekday', 'week_dependent'],
    ['Sequence', 'Stable', 'sequence', 'stable'],
    ['Sequence', 'Week-dependent', 'sequence', 'week_dependent'],
  ] as const)('%s + %s: the name (trimmed) and BOTH types as chosen reach the writer, then the stepped planner opens on the program it made', async (scheduleLabel, planningLabel, scheduleType, planningType) => {
    createProgramMock.mockResolvedValue({ id: 'prog-new-9', name: 'Block' })
    renderSheet()
    type('  Block  ')
    fireEvent.click(radio(scheduleLabel))
    fireEvent.click(radio(planningLabel))

    fireEvent.click(createButton())

    await waitFor(() => expect(createProgramMock).toHaveBeenCalledTimes(1))
    expect(createProgramMock).toHaveBeenCalledWith({ name: 'Block', scheduleType, planningType })
    await waitFor(() => expect(at()).toBe('AT /program/prog-new-9'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the choice at the moment of the tap is what is written: changing a pick before CREATE changes what goes', async () => {
    createProgramMock.mockResolvedValue({ id: 'prog-new-9', name: 'Block' })
    renderSheet()
    type('Block')
    fireEvent.click(radio('Weekdays'))
    fireEvent.click(radio('Stable'))
    fireEvent.click(radio('Sequence'))
    fireEvent.click(radio('Week-dependent'))

    fireEvent.click(createButton())

    await waitFor(() => expect(createProgramMock).toHaveBeenCalledWith({ name: 'Block', scheduleType: 'sequence', planningType: 'week_dependent' }))
  })

  it('Enter in the name field creates it too, once both are chosen', async () => {
    createProgramMock.mockResolvedValue({ id: 'prog-new-9', name: 'Block' })
    renderSheet()
    fireEvent.click(radio('Sequence'))
    fireEvent.click(radio('Stable'))
    type('Block')
    fireEvent.keyDown(nameInput(), { key: 'Enter' })
    await waitFor(() => expect(createProgramMock).toHaveBeenCalledWith({ name: 'Block', scheduleType: 'sequence', planningType: 'stable' }))
  })

  it('two presses in the same instant create one program', async () => {
    createProgramMock.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ id: 'prog-new-9', name: 'Block' }), 20)))
    renderSheet()
    type('Block')
    fireEvent.click(radio('Weekdays'))
    fireEvent.click(radio('Stable'))

    await act(async () => {
      createButton().click()
      createButton().click()
    })

    await waitFor(() => expect(createProgramMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(at()).toBe('AT /program/prog-new-9'))
  })

  it('while it is out: CREATING…, cannot be pressed, and still the accent with the near-black on it', () => {
    state.isPending = true
    renderSheet()
    type('Block')
    fireEvent.click(radio('Weekdays'))
    fireEvent.click(radio('Stable'))

    expect(createButton().textContent).toBe('CREATING…')
    expect(createButton().disabled).toBe(true)
    expect(createButton().style.background).toBe('var(--accent)')
    expect(createButton().style.color).toBe('var(--on-accent)')
  })
})

describe('a create that failed shows the real reason (SPEC Errors 15; the board draws no such state, so the words are ours)', () => {
  it.each([
    ['an Error', new Error('network down'), 'network down'],
    ['a Supabase error, which is no Error object', { message: 'duplicate key value violates unique constraint "v2_programs_pkey"' }, 'duplicate key value violates unique constraint "v2_programs_pkey"'],
  ])('%s: "Couldn\'t create the program." and the reason; the sheet stays open, with what was typed and chosen', async (_name, rejection, reason) => {
    createProgramMock.mockRejectedValue(rejection)
    renderSheet()
    type('Block')
    fireEvent.click(radio('Sequence'))
    fireEvent.click(radio('Week-dependent'))

    fireEvent.click(createButton())

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText("Couldn't create the program.")).toBeTruthy()
    expect(within(alert).getByText(reason)).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'New program' })).toBeTruthy()
    expect(nameInput().value).toBe('Block')
    expect(radio('Sequence').getAttribute('aria-checked')).toBe('true')
    expect(radio('Week-dependent').getAttribute('aria-checked')).toBe('true')
    expect(at()).toBe('AT /program')
    expect(onClose).not.toHaveBeenCalled()
    // and it can be tried again
    expect(createButton().disabled).toBe(false)
  })

  it('an error with no message says "Something went wrong."; a retry that works clears the error and opens the planner', async () => {
    createProgramMock.mockRejectedValueOnce({}).mockResolvedValueOnce({ id: 'prog-new-9', name: 'Block' })
    renderSheet()
    type('Block')
    fireEvent.click(radio('Weekdays'))
    fireEvent.click(radio('Stable'))
    fireEvent.click(createButton())
    expect(within(await screen.findByRole('alert')).getByText('Something went wrong.')).toBeTruthy()

    fireEvent.click(createButton())

    await waitFor(() => expect(at()).toBe('AT /program/prog-new-9'))
  })
})

describe('closing and 375 px', () => {
  it('the close button asks to close', () => {
    renderSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the name is a 16 px field, and no element carries a fixed pixel width wider than the screen', () => {
    renderSheet()
    expect(nameInput().style.fontSize).toBe('16px')
    const offenders: string[] = []
    for (const el of document.body.querySelectorAll<HTMLElement>('[style]')) {
      for (const prop of ['width', 'minWidth'] as const) {
        const m = /^(\d+(?:\.\d+)?)px$/.exec(el.style[prop])
        if (m && Number(m[1]) > 375) offenders.push(`${el.tagName}.${prop}=${el.style[prop]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
