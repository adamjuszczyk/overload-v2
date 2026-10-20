// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import type { Program, SequenceItem, WeeklySchedule } from '../../types'

// Chunk 65 — START (TASKS-1.2 "The PROGRAMS tab"; SPEC Programs and runs [1.2], Starting: "lands on Plan, week 1. The start sheet's optional
// name field defaults to the program's name. Starting while a program runs finishes the running one first and says so (PR9)"; Programs and
// runs [P1.1], "Starting a run needs a schedule"; Errors (15); boards PR8, PR9, PR10, PR11, PR12). The sheet at its own layer: what it starts
// (the program picked, the name typed or defaulted), where it goes, when it is off and why, what a failure says, and the colours it draws in
// each state. `useStartRun` is mocked at the seam; the schedule check is the real `useProgramHasSchedule` over mocked reads.

const state = vi.hoisted(() => ({
  isPending: false,
  workoutDays: {} as Record<string, unknown[]>,
  sequenceItems: {} as Record<string, unknown[]>,
}))
const startRunMock = vi.hoisted(() => vi.fn())

vi.mock('./useMesos', () => ({ useStartRun: () => ({ mutateAsync: startRunMock, isPending: state.isPending }) }))
vi.mock('./usePrograms', () => ({
  useWorkoutDays: (programId: string) => ({ data: programId ? state.workoutDays[programId] : undefined }),
  useSequenceItems: (programId: string) => ({ data: programId ? state.sequenceItems[programId] : undefined }),
}))

const { default: StartProgramSheet } = await import('./StartProgramSheet')

const onClose = vi.fn()
const onCreateProgram = vi.fn()

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  state.isPending = false
  state.workoutDays = { 'prog-ppl': [{ id: 'wd-ppl' }], 'prog-ul': [{ id: 'wd-ul' }], 'prog-none': [{ id: 'wd-none' }] }
  state.sequenceItems = {}
})
afterEach(() => {
  cleanup()
  onClose.mockReset()
  onCreateProgram.mockReset()
  startRunMock.mockReset()
  vi.restoreAllMocks()
})

const NO_DAYS: WeeklySchedule = { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null }
function program(over: Partial<Program> & Pick<Program, 'id' | 'name'>): Program {
  return { userId: 'user-1', schedule: NO_DAYS, workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'saved', planningType: 'stable', scheduleType: 'weekday', ...over }
}
const PPL = program({ id: 'prog-ppl', name: 'Push Pull Legs', schedule: { ...NO_DAYS, monday: 'wd-ppl' } })
const UL = program({ id: 'prog-ul', name: 'Upper / Lower', schedule: { ...NO_DAYS, tuesday: 'wd-ul' } })
// no workout on any weekday
const NO_SCHEDULE = program({ id: 'prog-none', name: 'Strength' })
const PROGRAMS = [PPL, UL, NO_SCHEDULE]

function Probe() {
  const location = useLocation()
  return <div data-testid="at">{`AT ${location.pathname}${location.search}`}</div>
}
const at = () => screen.getByTestId('at').textContent

function renderSheet(props: Partial<React.ComponentProps<typeof StartProgramSheet>> = {}) {
  return render(
    <MemoryRouter initialEntries={['/program']}>
      <Routes>
        <Route path="/program" element={<><StartProgramSheet programs={PROGRAMS} runningName={null} onClose={onClose} onCreateProgram={onCreateProgram} {...props} /><Probe /></>} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  )
}

const startButton = () => screen.getByRole('button', { name: /^(START PROGRAM|STARTING…)$/ }) as HTMLButtonElement
const nameInput = () => screen.getByLabelText(/^NAME/) as HTMLInputElement
const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLElement

// ─── PR8 and PR9: the sheet ──────────────────────────────────────────────────

describe('PR8 — start a program (none running)', () => {
  it('a titled dialog with NAME (OPTIONAL), the PROGRAM list and START PROGRAM; the first program is picked and no line about finishing one', () => {
    renderSheet()

    expect(screen.getByRole('dialog', { name: 'Start a program' })).toBeTruthy()
    expect(screen.getByText('(OPTIONAL)')).toBeTruthy()
    expect(nameInput().labels?.[0]?.textContent).toBe('NAME (OPTIONAL)')
    expect(screen.getByRole('radiogroup', { name: 'Program' })).toBeTruthy()
    expect(screen.getByText('PROGRAM')).toBeTruthy() // the list's label, in capitals, singular, as PR8 has it
    expect(screen.getAllByRole('radio').map((r) => [r.textContent, r.getAttribute('aria-checked')])).toEqual([['Push Pull Legs', 'true'], ['Upper / Lower', 'false'], ['Strength', 'false']])
    expect(startButton().textContent).toBe('START PROGRAM')
    expect(screen.queryByText(/Starting it finishes/)).toBeNull()
  })

  it('two saved programs with one name are two options: exactly one is checked, and the one picked is the one started', async () => {
    const TWIN = program({ id: 'prog-ppl-2', name: 'Push Pull Legs', schedule: { ...NO_DAYS, wednesday: 'wd-ppl-2' } })
    state.workoutDays['prog-ppl-2'] = [{ id: 'wd-ppl-2' }]
    startRunMock.mockResolvedValue('meso-new')
    renderSheet({ programs: [PPL, TWIN, UL], presetProgramId: 'prog-ppl-2' })

    const checked = () => screen.getAllByRole('radio').map((r) => r.getAttribute('aria-checked'))
    expect(checked()).toEqual(['false', 'true', 'false'])
    fireEvent.click(startButton())
    await waitFor(() => expect(startRunMock).toHaveBeenCalledWith({ name: 'Push Pull Legs', programId: 'prog-ppl-2' }))
    cleanup()
    startRunMock.mockClear()

    // picking the twin by a tap picks the twin, not the first of that name
    renderSheet({ programs: [PPL, TWIN, UL], presetProgramId: 'prog-ul' })
    fireEvent.click(screen.getAllByRole('radio')[1])
    expect(checked()).toEqual(['false', 'true', 'false'])
    fireEvent.click(startButton())
    await waitFor(() => expect(startRunMock).toHaveBeenCalledWith({ name: 'Push Pull Legs', programId: 'prog-ppl-2' }))
  })

  it('the program a row\'s START was tapped on starts picked', () => {
    renderSheet({ presetProgramId: 'prog-ul' })
    expect(radio('Upper / Lower').getAttribute('aria-checked')).toBe('true')
    expect(radio('Push Pull Legs').getAttribute('aria-checked')).toBe('false')
  })

  it('the name\'s placeholder is the picked program\'s name and follows the pick', () => {
    renderSheet({ presetProgramId: 'prog-ul' })
    expect(nameInput().placeholder).toBe('Upper / Lower')
    fireEvent.click(radio('Push Pull Legs'))
    expect(nameInput().placeholder).toBe('Push Pull Legs')
    expect(nameInput().value).toBe('')
  })

  it('the name is a 16 px field (a smaller one makes iOS zoom in on focus)', () => {
    renderSheet()
    expect(nameInput().style.fontSize).toBe('16px')
  })
})

describe('PR9 — a program is running', () => {
  it('"Start a new program", and a line that says starting finishes the running one, by its name', () => {
    renderSheet({ runningName: 'Push Pull Legs', presetProgramId: 'prog-ul' })

    expect(screen.getByRole('dialog', { name: 'Start a new program' })).toBeTruthy()
    expect(screen.getByText('Starting it finishes Push Pull Legs. Its weeks stay in History.')).toBeTruthy()
  })

  it('the name in the line is the RUN\'s, whichever program is picked', () => {
    renderSheet({ runningName: 'My Summer Block', presetProgramId: 'prog-ppl' })
    expect(screen.getByText('Starting it finishes My Summer Block. Its weeks stay in History.')).toBeTruthy()
  })
})

// ─── START ───────────────────────────────────────────────────────────────────

describe('START — W: what is written, and where it goes', () => {
  it('starts the picked program with its own name when none is typed, then goes to Plan, week 1 (the real route and its one-shot)', async () => {
    startRunMock.mockResolvedValue('meso-new')
    renderSheet({ presetProgramId: 'prog-ul' })

    fireEvent.click(startButton())

    await waitFor(() => expect(startRunMock).toHaveBeenCalledTimes(1))
    expect(startRunMock).toHaveBeenCalledWith({ name: 'Upper / Lower', programId: 'prog-ul' })
    await waitFor(() => expect(at()).toBe('AT /plan?week=1'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a typed name is the run\'s name, trimmed; blank and spaces-only fall back to the program\'s', async () => {
    startRunMock.mockResolvedValue('meso-new')
    renderSheet({ presetProgramId: 'prog-ppl' })
    fireEvent.change(nameInput(), { target: { value: '  My Block  ' } })
    fireEvent.click(startButton())
    await waitFor(() => expect(startRunMock).toHaveBeenCalledWith({ name: 'My Block', programId: 'prog-ppl' }))
    cleanup()
    startRunMock.mockClear()

    renderSheet({ presetProgramId: 'prog-ppl' })
    fireEvent.change(nameInput(), { target: { value: '   ' } })
    fireEvent.click(startButton())
    await waitFor(() => expect(startRunMock).toHaveBeenCalledWith({ name: 'Push Pull Legs', programId: 'prog-ppl' }))
  })

  it('the program is the one PICKED when START is pressed, not the one the sheet opened on', async () => {
    startRunMock.mockResolvedValue('meso-new')
    renderSheet({ presetProgramId: 'prog-ppl' })

    fireEvent.click(radio('Upper / Lower'))
    fireEvent.click(startButton())

    await waitFor(() => expect(startRunMock).toHaveBeenCalledWith({ name: 'Upper / Lower', programId: 'prog-ul' }))
  })

  it('Enter in the name field starts it too (and starts nothing while START is off)', async () => {
    startRunMock.mockResolvedValue('meso-new')
    renderSheet({ presetProgramId: 'prog-ppl' })
    fireEvent.change(nameInput(), { target: { value: 'Typed' } })
    fireEvent.keyDown(nameInput(), { key: 'Enter' })
    await waitFor(() => expect(startRunMock).toHaveBeenCalledWith({ name: 'Typed', programId: 'prog-ppl' }))
    cleanup()
    startRunMock.mockClear()

    renderSheet({ presetProgramId: 'prog-none' })
    fireEvent.keyDown(nameInput(), { key: 'Enter' })
    await act(async () => { await Promise.resolve() })
    expect(startRunMock).not.toHaveBeenCalled()
  })

  it('two presses in the same instant start it once (the run is written once: a second start would finish the first at once)', async () => {
    startRunMock.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve('meso-new'), 20)))
    renderSheet({ presetProgramId: 'prog-ppl' })

    await act(async () => {
      startButton().click()
      startButton().click()
    })

    await waitFor(() => expect(startRunMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(at()).toBe('AT /plan?week=1'))
  })
})

// ─── PR11: a program with no schedule ────────────────────────────────────────

describe('PR11 — the picked program has no scheduled workout', () => {
  it('START PROGRAM is disabled and drawn disabled, the reason is under it (with its full stop), and nothing starts', async () => {
    renderSheet({ presetProgramId: 'prog-none' })

    expect(startButton().disabled).toBe(true)
    expect(screen.getByText('Schedule at least one workout to start.')).toBeTruthy()
    expect(startButton().style.background).toBe('var(--surface-raised)')
    expect(startButton().style.color).toBe('var(--text-dim)')
    fireEvent.click(startButton())
    await act(async () => { await Promise.resolve() })
    expect(startRunMock).not.toHaveBeenCalled()
    expect(at()).toBe('AT /program')
  })

  it('it is decided for the program picked NOW: picking another turns it on and off, and the reason goes and comes', async () => {
    startRunMock.mockResolvedValue('meso-new')
    renderSheet({ presetProgramId: 'prog-ppl' })
    expect(startButton().disabled).toBe(false)
    expect(screen.queryByText(/Schedule at least one workout/)).toBeNull()

    fireEvent.click(radio('Strength'))
    expect(startButton().disabled).toBe(true)
    expect(screen.getByText('Schedule at least one workout to start.')).toBeTruthy()

    fireEvent.click(radio('Upper / Lower'))
    expect(startButton().disabled).toBe(false)
    expect(screen.queryByText(/Schedule at least one workout/)).toBeNull()
    fireEvent.click(startButton())
    await waitFor(() => expect(startRunMock).toHaveBeenCalledWith({ name: 'Upper / Lower', programId: 'prog-ul' }))
  })

  it('a weekday that names a workout the program no longer has is not a scheduled workout', () => {
    state.workoutDays = { 'prog-gone': [{ id: 'wd-other' }] }
    renderSheet({ programs: [program({ id: 'prog-gone', name: 'Gone', schedule: { ...NO_DAYS, monday: 'wd-removed' } })] })
    expect(startButton().disabled).toBe(true)
    expect(screen.getByText('Schedule at least one workout to start.')).toBeTruthy()
  })

  describe('a sequence program (its sequence decides, never a weekday map left under it)', () => {
    const SEQUENCE = program({ id: 'prog-seq', name: 'Rotation', scheduleType: 'sequence', schedule: { ...NO_DAYS, monday: 'wd-seq' } })
    const item = (position: number, workoutDayId: string | null): SequenceItem => ({ id: `si-${position}`, userId: 'user-1', programId: 'prog-seq', position, workoutDayId })

    it('with only rest slots it is off, with the reason', () => {
      state.workoutDays = { 'prog-seq': [{ id: 'wd-seq' }] }
      state.sequenceItems = { 'prog-seq': [item(0, null), item(1, null)] }
      renderSheet({ programs: [SEQUENCE] })
      expect(startButton().disabled).toBe(true)
      expect(screen.getByText('Schedule at least one workout to start.')).toBeTruthy()
    })

    it('with one workout in the sequence it starts', async () => {
      state.workoutDays = { 'prog-seq': [{ id: 'wd-seq' }] }
      state.sequenceItems = { 'prog-seq': [item(0, null), item(1, 'wd-seq')] }
      startRunMock.mockResolvedValue('meso-new')
      renderSheet({ programs: [SEQUENCE] })
      expect(startButton().disabled).toBe(false)
      fireEvent.click(startButton())
      await waitFor(() => expect(startRunMock).toHaveBeenCalledWith({ name: 'Rotation', programId: 'prog-seq' }))
    })
  })

  it('while the program\'s workouts have not answered START waits, and no reason shows yet (it must not flash on a program that has a schedule)', async () => {
    state.workoutDays = {}
    renderSheet({ presetProgramId: 'prog-ppl' })

    expect(startButton().disabled).toBe(true)
    expect(screen.queryByText(/Schedule at least one workout/)).toBeNull()
    fireEvent.click(startButton())
    await act(async () => { await Promise.resolve() })
    expect(startRunMock).not.toHaveBeenCalled()
  })
})

// ─── PR10: a failed start ────────────────────────────────────────────────────

describe('PR10 — a start that failed shows the real reason', () => {
  it.each([
    ['an Error', new Error('v2_start_run: program prog-ul is not a saved program (kind=run)'), 'v2_start_run: program prog-ul is not a saved program (kind=run)'],
    ['a Supabase error, which is no Error object', { message: 'DELETE requires a WHERE clause', code: 'P0001' }, 'DELETE requires a WHERE clause'],
    ['a plain string', 'JWT expired', 'JWT expired'],
  ])('%s: "Couldn\'t start [name]." and the reason under it; the sheet stays open and nothing navigates', async (_name, rejection, reason) => {
    startRunMock.mockRejectedValue(rejection)
    renderSheet({ presetProgramId: 'prog-ul' })

    fireEvent.click(startButton())

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText("Couldn't start Upper / Lower.")).toBeTruthy()
    expect(within(alert).getByText(reason)).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Start a program' })).toBeTruthy()
    expect(at()).toBe('AT /program')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('the headline names the program that was being started, even if another is picked afterwards', async () => {
    startRunMock.mockRejectedValue(new Error('boom'))
    renderSheet({ presetProgramId: 'prog-ul' })
    fireEvent.click(startButton())
    await screen.findByRole('alert')

    fireEvent.click(radio('Push Pull Legs'))

    expect(within(screen.getByRole('alert')).getByText("Couldn't start Upper / Lower.")).toBeTruthy()
  })

  it('an error with no message says "Something went wrong." (P1.2-5), and "You may be offline." only when the phone is', async () => {
    startRunMock.mockRejectedValue({})
    renderSheet({ presetProgramId: 'prog-ul' })
    fireEvent.click(startButton())
    expect(within(await screen.findByRole('alert')).getByText('Something went wrong.')).toBeTruthy()
    cleanup()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    renderSheet({ presetProgramId: 'prog-ul' })
    fireEvent.click(startButton())
    expect(within(await screen.findByRole('alert')).getByText('You may be offline.')).toBeTruthy()
    cleanup()

    // a real message still wins over the offline wording
    startRunMock.mockRejectedValue(new Error('Failed to fetch'))
    renderSheet({ presetProgramId: 'prog-ul' })
    fireEvent.click(startButton())
    expect(within(await screen.findByRole('alert')).getByText('Failed to fetch')).toBeTruthy()
    expect(screen.queryByText('You may be offline.')).toBeNull()
  })

  it('the banner goes with the next attempt, and a new failure shows its own reason', async () => {
    startRunMock.mockRejectedValueOnce(new Error('first reason')).mockRejectedValueOnce(new Error('second reason'))
    renderSheet({ presetProgramId: 'prog-ul' })
    fireEvent.click(startButton())
    expect(within(await screen.findByRole('alert')).getByText('first reason')).toBeTruthy()

    fireEvent.click(startButton())
    await waitFor(() => expect(within(screen.getByRole('alert')).getByText('second reason')).toBeTruthy())
    expect(screen.queryByText('first reason')).toBeNull()
  })

  it('a start that works after a failure clears it and goes to Plan', async () => {
    startRunMock.mockRejectedValueOnce(new Error('first reason')).mockResolvedValueOnce('meso-new')
    renderSheet({ presetProgramId: 'prog-ul' })
    fireEvent.click(startButton())
    await screen.findByRole('alert')

    fireEvent.click(startButton())

    await waitFor(() => expect(at()).toBe('AT /plan?week=1'))
  })

  it('the banner is drawn above the sheet, at the top of the screen, where PR10 puts it (a layer of its own, not inside the dialog)', async () => {
    startRunMock.mockRejectedValue(new Error('boom'))
    renderSheet({ presetProgramId: 'prog-ul' })
    fireEvent.click(startButton())
    const alert = await screen.findByRole('alert')

    expect(screen.getByRole('dialog').contains(alert)).toBe(false)
    expect(alert.style.position).toBe('fixed')
    expect(alert.style.top).toBe('16px')
    expect(Number(alert.style.zIndex)).toBeGreaterThan(45) // above BottomSheet's layer
    // the board's alert icon, in the error colour, hidden from a screen reader (the words say it)
    const icon = alert.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon!.getAttribute('aria-hidden')).toBe('true')
    expect((icon!.parentElement as HTMLElement).style.color).toBe('var(--error)')
  })
})

// ─── PR12: nothing to start ──────────────────────────────────────────────────

describe('PR12 — no programs to start', () => {
  it('"Create a program first." and CREATE PROGRAM, which asks the tab for the New program sheet; no name field, no START PROGRAM', () => {
    renderSheet({ programs: [] })

    expect(screen.getByRole('dialog', { name: 'Start a program' })).toBeTruthy()
    expect(screen.getByText('Create a program first.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'START PROGRAM' })).toBeNull()
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.queryByLabelText(/^NAME/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'CREATE PROGRAM' }))
    expect(onCreateProgram).toHaveBeenCalledTimes(1)
    expect(startRunMock).not.toHaveBeenCalled()
  })

  it('says "Start a new program" when one runs, as the other states do', () => {
    renderSheet({ programs: [], runningName: 'Push Pull Legs' })
    expect(screen.getByRole('dialog', { name: 'Start a new program' })).toBeTruthy()
  })
})

// ─── Pending, colours, closing ───────────────────────────────────────────────

describe('what the sheet draws in each state (text on the accent is --on-accent: RULES)', () => {
  it('START PROGRAM ready: the accent, with the near-black on it', () => {
    renderSheet({ presetProgramId: 'prog-ppl' })
    expect(startButton().style.background).toBe('var(--accent)')
    expect(startButton().style.color).toBe('var(--on-accent)')
    expect(startButton().disabled).toBe(false)
  })

  it('PR11\'s disabled button is the raised surface with dim text; not the accent', () => {
    renderSheet({ presetProgramId: 'prog-none' })
    expect(startButton().style.background).toBe('var(--surface-raised)')
    expect(startButton().style.color).toBe('var(--text-dim)')
  })

  it('while the start is out it says STARTING…, cannot be pressed, and stays in the accent with the near-black on it', () => {
    state.isPending = true
    renderSheet({ presetProgramId: 'prog-ppl' })
    expect(startButton().textContent).toBe('STARTING…')
    expect(startButton().disabled).toBe(true)
    expect(startButton().style.background).toBe('var(--accent)')
    expect(startButton().style.color).toBe('var(--on-accent)')
  })

  it('PR12\'s CREATE PROGRAM is the accent with the near-black on it', () => {
    renderSheet({ programs: [] })
    const button = screen.getByRole('button', { name: 'CREATE PROGRAM' })
    expect(button.style.background).toBe('var(--accent)')
    expect(button.style.color).toBe('var(--on-accent)')
  })

  it('the picked program\'s row is the tinted accent with its name in the accent and a filled radio; the others are plain', () => {
    renderSheet({ presetProgramId: 'prog-ul' })
    const picked = radio('Upper / Lower')
    const other = radio('Push Pull Legs')
    expect(picked.style.background).toBe('var(--accent-muted)')
    expect(picked.style.borderColor).toBe('var(--accent)')
    expect((picked.firstElementChild as HTMLElement).style.color).toBe('var(--accent)')
    expect(picked.querySelectorAll('span[aria-hidden="true"] > span')).toHaveLength(1) // the dot
    expect(other.style.background).toBe('var(--surface)')
    expect(other.querySelectorAll('span[aria-hidden="true"] > span')).toHaveLength(0)
  })
})

describe('closing', () => {
  it('the close button, the scrim and Escape all ask to close', () => {
    renderSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.click(document.querySelector('[data-bottom-sheet-scrim]') as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})

describe('375 px', () => {
  it('long program names wrap inside their rows, and no element carries a fixed pixel width wider than the screen', () => {
    const LONG = 'B'.repeat(80)
    renderSheet({ programs: [{ ...PPL, name: LONG }, UL], presetProgramId: 'prog-ppl', runningName: LONG })
    const offenders: string[] = []
    for (const el of document.body.querySelectorAll<HTMLElement>('[style]')) {
      for (const prop of ['width', 'minWidth'] as const) {
        const m = /^(\d+(?:\.\d+)?)px$/.exec(el.style[prop])
        if (m && Number(m[1]) > 375) offenders.push(`${el.tagName}.${prop}=${el.style[prop]}`)
      }
    }
    expect(offenders).toEqual([])
    expect((radio(LONG).firstElementChild as HTMLElement).style.overflowWrap).toBe('anywhere')
    // the running program's name in PR9's line too: real Chromium found it running 697 px in a 341 px line (programs-pr9-long-name.html, the sheet check)
    expect(screen.getByText(`Starting it finishes ${LONG}. Its weeks stay in History.`).style.overflowWrap).toBe('anywhere')
  })
})
