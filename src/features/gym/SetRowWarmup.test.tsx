// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen, within } from '@testing-library/react'
import type { SetLog, WeekPlanSet } from '../../types'
import type { ResolvedRow } from './workoutRules'
import SetRowWarmup from './SetRowWarmup'
import type { RowMenu } from './SetRowCurrent'
import { toStorageWeight } from '../../lib/weightUnit'

// Chunk 15 (SPEC "Warmup sets": weight and reps, both optional; plus a rest timer, nothing else), as chunk 58a's row draws it (boards
// W1, W2b "WARMUPS AS ROWS" / "WARMUPS AS A TICK LIST"). The pins of the old SetRow's warmup branch, one by one.
// Chunk 78 (SPEC 1.2.1 [12], [13], [15]; DECISIONS 222 (b), 228 (a), 233 (a)): an open warmup is drawn like any open row that isn't the current set, in rows
// mode it has the set's ⋯ (SET TYPE and DELETE SET), a logged one has no ✕, and the tick list's untick is an unlog.
afterEach(cleanup)

const row = { key: 'set:w1', kind: 'warmup', state: 'unlogged', number: 1, block: null, exerciseName: 'Bench Press' } as unknown as ResolvedRow
const planned = { id: 'w1', programExerciseId: 'pe-1', setNumber: 1, isWarmup: true, targetRir: null } as unknown as WeekPlanSet
const logged = (over: Partial<SetLog> = {}): SetLog =>
  ({ id: 'log-w1', weight: 20, reps: 12, enteredUnit: null, isWarmup: true, ...over }) as SetLog

function mount(over: Partial<React.ComponentProps<typeof SetRowWarmup>> = {}) {
  const props = { onLog: vi.fn(), onUpdate: vi.fn(), onAskDelete: vi.fn() }
  const view = render(<SetRowWarmup row={row} planned={planned} log={null} unit="kg" display="rows" restElapsed={() => 41} {...props} {...over} />)
  return { ...view, ...props }
}

/** The row's menu as `WorkoutRow` builds it, each function a spy (only what a warmup's row reaches). */
const menuOf = (over: Partial<RowMenu> = {}): RowMenu & { openSetType: ReturnType<typeof vi.fn>; unlog: ReturnType<typeof vi.fn>; askDelete: ReturnType<typeof vi.fn> } =>
  ({ cuesText: null, openCues: vi.fn(), askDelete: vi.fn(), openSetType: vi.fn(), heldType: null, clearHeldType: vi.fn(), saveHeldType: vi.fn(), unlog: vi.fn(), unlogNote: null, ...over }) as never
const styleOf = (el: Element) => el.getAttribute('style') ?? ''

describe('SetRowWarmup — rows mode (the default)', () => {
  it('shows two optional weight/reps boxes, a LOG button and the set\'s ⋯; no RIR, no skip on the row', () => {
    mount()
    expect(screen.getByLabelText('Weight')).toBeTruthy()
    expect(screen.getByLabelText('Reps')).toBeTruthy()
    expect(screen.getByText('LOG')).toBeTruthy()
    expect(screen.getByLabelText('Set options')).toBeTruthy() // chunk 78 (SPEC [13]): an open warmup row in rows mode has the ⋯
    expect(screen.queryByLabelText('RIR')).toBeNull()
    expect(screen.queryByText('SKIP THIS SET')).toBeNull()
  })

  it('an open warmup is drawn like any open row that is not the current set: a muted W, an outlined LOG (SPEC [12]; DECISIONS 222 (b))', () => {
    const { container } = mount()
    const label = screen.getByText('W')
    const log = screen.getByText('LOG')
    expect(styleOf(label)).toContain('color: var(--text-muted)')
    expect(styleOf(label)).not.toContain('var(--accent)')
    // the outlined LOG of an upcoming row (`SetRowCurrent`, not current): the surface, the text colour and an inset line; never the filled accent
    expect(styleOf(log)).toContain('background-color: var(--surface)')
    expect(styleOf(log)).toContain('color: var(--text-primary)')
    expect(styleOf(log)).toContain('box-shadow: inset 0 0 0 1px var(--border-strong)')
    expect(styleOf(log)).not.toContain('var(--accent)')
    expect(container.querySelector('[data-current-set]')).toBeNull() // a warmup never takes part in the current set (G54)
  })

  it('the ⋯ opens the set\'s sheet with SET TYPE (Warmup) and DELETE SET and nothing else: no CUES, FORM, unit row or SKIP THIS SET (SPEC [13]; DECISIONS 228 (a))', () => {
    mount({ menu: menuOf() })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByLabelText('Set options'))
    const sheet = within(screen.getByRole('dialog'))
    expect(sheet.getByText('BENCH PRESS · WARMUP')).toBeTruthy()
    expect(sheet.getByText('SET TYPE')).toBeTruthy()
    expect(sheet.getByText('Warmup')).toBeTruthy()
    expect(sheet.getByText('DELETE SET')).toBeTruthy()
    for (const absent of ['CUES', 'FORM', 'SKIP THIS SET']) expect(sheet.queryByText(absent)).toBeNull()
    expect(sheet.queryByText(/Log this set in/)).toBeNull()
    expect(sheet.queryByRole('switch')).toBeNull()
  })

  it('SET TYPE opens the type picker through the row\'s menu and closes the sheet; DELETE SET asks W9 through onAskDelete and closes it; neither logs, updates or deletes anything itself', () => {
    const menu = menuOf()
    const { onAskDelete, onLog, onUpdate } = mount({ menu })
    fireEvent.click(screen.getByLabelText('Set options'))
    fireEvent.click(within(screen.getByRole('dialog')).getByText('Warmup')) // the SET TYPE row
    expect(menu.openSetType).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByLabelText('Set options'))
    fireEvent.click(within(screen.getByRole('dialog')).getByText('DELETE SET'))
    expect(onAskDelete).toHaveBeenCalledTimes(1)
    expect(menu.askDelete).not.toHaveBeenCalled() // the row is handed onAskDelete; the menu\'s own copy is for the cards
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onLog).not.toHaveBeenCalled()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('without a menu the sheet still offers DELETE SET, and its SET TYPE row is drawn disabled (the row can only reach the type picker through the menu)', () => {
    const { onAskDelete } = mount()
    fireEvent.click(screen.getByLabelText('Set options'))
    const sheet = within(screen.getByRole('dialog'))
    expect((sheet.getByText('Warmup').closest('button') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(sheet.getByText('DELETE SET'))
    expect(onAskDelete).toHaveBeenCalledTimes(1)
  })

  it('a LOG on the row still logs the warmup as it did (the ⋯ and the restyle change no write)', () => {
    const { onLog } = mount({ menu: menuOf() })
    fireEvent.click(screen.getByText('LOG'))
    expect(onLog).toHaveBeenCalledTimes(1)
    expect(onLog.mock.calls[0][0]).toMatchObject({ weekPlanSetId: 'w1', setNumber: 1, isWarmup: true, restSeconds: 41 })
  })

  it('LOG with both boxes blank calls onLog with weight null, reps null and isWarmup true, and the rest elapsed when it is pressed', () => {
    const { onLog } = mount()
    fireEvent.click(screen.getByText('LOG'))
    expect(onLog).toHaveBeenCalledTimes(1)
    expect(onLog.mock.calls[0][0]).toEqual({
      weekPlanSetId: 'w1', setNumber: 1, weight: null, reps: null, rir: null, isDropset: false, isSkipped: false,
      restSeconds: 41, setSeconds: null, enteredUnit: null, formRating: null, stageKind: null, isWarmup: true,
    })
  })

  it('LOG with weight and reps typed converts the weight to kg and sends both, still isWarmup true', () => {
    const { onLog } = mount({ unit: 'lbs' })
    fireEvent.change(screen.getByLabelText('Weight'), { target: { value: '45' } })
    fireEvent.change(screen.getByLabelText('Reps'), { target: { value: '12' } })
    fireEvent.click(screen.getByText('LOG'))
    expect(onLog.mock.calls[0][0]).toMatchObject({ weight: toStorageWeight(45, 'lbs'), reps: 12, isWarmup: true })
  })

  it('the plan\'s weight and a number target are the boxes\' values, as on a working row (DECISIONS 162 (a))', () => {
    const { onLog } = mount({ planned: { ...planned, targetWeight: 20, repMin: 12, repMax: 12 } as WeekPlanSet })
    expect((screen.getByLabelText('Weight') as HTMLInputElement).value).toBe('20')
    fireEvent.click(screen.getByText('LOG'))
    expect(onLog.mock.calls[0][0]).toMatchObject({ weight: 20, reps: 12 })
  })

  it('a logged warmup reads weight × reps with a pen, and a numberless one reads DONE', () => {
    const { container } = mount({ log: logged() })
    expect(container.textContent).toContain('20')
    expect(container.textContent).toContain('× 12')
    expect(screen.getByLabelText('Edit set')).toBeTruthy()
    cleanup()
    const numberless = mount({ log: logged({ weight: null, reps: null }) })
    expect(numberless.container.textContent).toContain('DONE')
  })
})

describe('SetRowWarmup — tick mode (warmup_display = "tick")', () => {
  it('is one tick row, "WARMUP · TAP WHEN DONE": no boxes at all', () => {
    const { container } = mount({ display: 'tick' })
    expect(container.textContent).toContain('WARMUP · TAP WHEN DONE')
    expect(container.querySelector('input')).toBeNull()
  })

  it('tapping the row logs it with no numbers: tick-off only', () => {
    const { onLog } = mount({ display: 'tick' })
    fireEvent.click(screen.getByText('WARMUP · TAP WHEN DONE'))
    expect(onLog.mock.calls[0][0]).toMatchObject({ weight: null, reps: null, isWarmup: true, weekPlanSetId: 'w1' })
  })

  it('a ticked warmup reads "WARMUP · DONE", offers no pen, and unticking is an unlog: menu.unlog once, with no confirm and nothing deleted (SPEC [15]; DECISIONS 233 (a))', () => {
    const menu = menuOf()
    const { container, onAskDelete, onLog, onUpdate } = mount({ display: 'tick', log: logged({ weight: null, reps: null }), menu })
    expect(container.textContent).toContain('WARMUP · DONE')
    expect(screen.queryByLabelText('Edit set')).toBeNull()
    fireEvent.click(screen.getByLabelText('Untick warmup'))
    expect(menu.unlog).toHaveBeenCalledTimes(1)
    // no confirm: neither of the old inline buttons, and no W9
    expect(screen.queryByText('DELETE')).toBeNull()
    expect(screen.queryByText('CANCEL')).toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(onAskDelete).not.toHaveBeenCalled()
    expect(menu.askDelete).not.toHaveBeenCalled()
    expect(onLog).not.toHaveBeenCalled()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('an open tick row has no ⋯ (it is one button: DECISIONS 228 (a) gives the ⋯ to rows mode)', () => {
    mount({ display: 'tick', menu: menuOf() })
    expect(screen.queryByLabelText('Set options')).toBeNull()
  })
})

describe('SetRowWarmup — a logged warmup can be corrected and removed (chunk 15 review fix)', () => {
  it('the pen opens weight and reps only, filled from the log — no RIR and no FORM', () => {
    mount({ log: logged() })
    fireEvent.click(screen.getByLabelText('Edit set'))
    expect((screen.getByLabelText('Weight') as HTMLInputElement).value).toBe('20')
    expect((screen.getByLabelText('Reps') as HTMLInputElement).value).toBe('12')
    expect(screen.queryByLabelText('RIR')).toBeNull()
    expect(screen.queryByText('FORM')).toBeNull()
  })

  it('SAVE sends weight and reps only: no rir or formRating key at all', () => {
    const { onUpdate } = mount({ log: logged() })
    fireEvent.click(screen.getByLabelText('Edit set'))
    fireEvent.change(screen.getByLabelText('Reps'), { target: { value: '15' } })
    fireEvent.click(screen.getByText('SAVE'))
    expect(onUpdate).toHaveBeenCalledWith({ weight: 20, reps: 15 })
    expect(Object.keys(onUpdate.mock.calls[0][0])).toEqual(['weight', 'reps'])
  })

  it('an unchanged weight typed again keeps the stored kg, and a weight that is not a number blocks SAVE', () => {
    const { onUpdate } = mount({ log: logged({ weight: 9, enteredUnit: 'lbs' }) })
    fireEvent.click(screen.getByLabelText('Edit set'))
    expect((screen.getByLabelText('Weight') as HTMLInputElement).value).toBe('19.8')
    fireEvent.click(screen.getByText('SAVE'))
    expect(onUpdate.mock.calls[0][0].weight).toBe(9)
    fireEvent.click(screen.getByLabelText('Edit set'))
    fireEvent.change(screen.getByLabelText('Weight'), { target: { value: 'abc' } })
    fireEvent.click(screen.getByText('SAVE'))
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Enter a valid weight.')).toBeTruthy() // the panel's own words (board W2b)
  })

  it('CANCEL closes the edit without calling onUpdate', () => {
    const { onUpdate } = mount({ log: logged() })
    fireEvent.click(screen.getByLabelText('Edit set'))
    fireEvent.click(screen.getByText('CANCEL'))
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Edit set')).toBeTruthy()
  })

  it('a logged warmup has no ✕ (SPEC [15]; DECISIONS 233 (a)): the pen and the sync mark are all that follow its numbers, and removing it is the pen\'s panel', () => {
    const { container } = mount({ log: logged() })
    expect(screen.queryByLabelText('Delete set')).toBeNull()
    expect(container.textContent).not.toContain('✕')
    expect(screen.getByLabelText('Edit set')).toBeTruthy()
  })

  it('the panel (board W2b "EDITING A WARMUP"): its DELETE asks W9 through onAskDelete and deletes nothing itself; SET TYPE says Warmup and, with no menu to reach, UNLOG is disabled', () => {
    const { onAskDelete, onUpdate } = mount({ log: logged() })
    fireEvent.click(screen.getByLabelText('Edit set'))
    expect(screen.getByText('SET TYPE')).toBeTruthy()
    expect(screen.getByText('Warmup')).toBeTruthy()
    expect((screen.getByText('UNLOG') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByText('DELETE'))
    expect(onAskDelete).toHaveBeenCalledTimes(1)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('the panel\'s UNLOG is the menu\'s unlog (chunk 63) and closes the panel', () => {
    const menu = menuOf()
    mount({ log: logged(), menu })
    fireEvent.click(screen.getByLabelText('Edit set'))
    fireEvent.click(screen.getByText('UNLOG'))
    expect(menu.unlog).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('UNLOG')).toBeNull()
  })

  it('a warmup logged with no values (ticked) can still be edited in rows mode, the boxes starting blank', () => {
    mount({ log: logged({ weight: null, reps: null }) })
    fireEvent.click(screen.getByLabelText('Edit set'))
    expect((screen.getByLabelText('Weight') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Reps') as HTMLInputElement).value).toBe('')
  })
})
