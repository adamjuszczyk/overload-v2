// @vitest-environment jsdom
// Chunk 64 — the finish screen (boards W18 and W19; SPEC [1.2] "Finishing (11, C6)"), drawn from the props GymSession hands it and the session it reads. What it asks of the
// workout's rows (the warning's text and its scroll target, the two ways back) is `GymSession.finish.test.tsx`'s, over the real rows; what COMPLETE writes into the session
// row through the real hook is `FinishScreen.write.test.tsx`'s. Here: the words and their order, the tiles, the box and its absence, the chips, the prefill and what COMPLETE
// sends compared with what the screen it replaces sent for the same steps (`__fixtures__/finish-payload-before.json`, captured by driving `SessionComplete` at `af35136`).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, act, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Session, SetLog } from '../../types'
import { captureRender } from '../../testing/captureRender'
import { ENERGY_SCALE, PUMP_SCALE } from './ratingScales'

afterEach(() => cleanup())

const here = dirname(fileURLToPath(import.meta.url))
type Capture = Record<string, { session: { note: string | null; energyRating: string | null; pumpRating: string | null }; steps: { note?: string; energy?: string[]; pump?: string[] }; payload: Record<string, unknown> }>
const BEFORE = JSON.parse(readFileSync(join(here, '__fixtures__', 'finish-payload-before.json'), 'utf8')) as Capture
const board = (name: string) => readFileSync(join(here, '..', '..', '..', 'design', '1.2', 'source', name), 'utf8')

const complete = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null as unknown }))
let session: Session | undefined
vi.mock('./useSession', () => ({
  useActiveSession: () => ({ data: session }),
  useCompleteSession: () => ({ mutateAsync: complete.mutateAsync, isPending: complete.isPending, isError: complete.isError, error: complete.error }),
}))
// the shared picker is cardOptions' import (its `ErrorLine` is the one the screen draws a failure with); the screen never opens it
vi.mock('../../components/ExercisePickerSheet', () => ({ default: () => null }))

const { default: FinishScreen } = await import('./FinishScreen')

const log = (id: string, over: Partial<SetLog> = {}): SetLog => ({
  id, userId: 'user-1', sessionId: 'session-1', exerciseId: 'ex-1', weekPlanSetId: null, setNumber: 1, weight: 60, reps: 8, rir: null, note: null, isDropset: false,
  parentSetId: null, stageIndex: 0, isWarmup: false, setSeconds: null, enteredUnit: null, isSkipped: false, loggedAt: '2026-01-06T10:00:00Z', restSeconds: null,
  formRating: null, stageKind: null, addedPlace: null, ...over,
})
const base: Session = {
  id: 'session-1', userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: 'wp-1', workoutDayId: 'wd-1', date: '2026-01-06', status: 'in_progress', note: null,
  startedAt: '2026-01-06T10:00:00Z', completedAt: null, createdAt: '2026-01-06T10:00:00Z', setLogs: [], energyRating: null, pumpRating: null,
}
// the board's own numbers: 13 working sets, none skipped, 2 warmups
const BOARD_LOGS = [...Array.from({ length: 13 }, (_, i) => log(`w${i}`, { setNumber: i + 1 })), log('wu1', { isWarmup: true }), log('wu2', { isWarmup: true })]
const WARNING = { text: "2 planned sets aren't logged yet: EZ Bar Curl 01 and 02.", firstKey: 'set:ez.2' }

const onBack = vi.fn()
const onGoBack = vi.fn()
function show(warning: { text: string; firstKey: string } | null = null) {
  return render(<FinishScreen sessionId="session-1" eyebrow="WEEK 2 · TUESDAY · 52:40" workoutName="Pull 1" warning={warning} onBack={onBack} onGoBack={onGoBack} />)
}
const chip = (c: HTMLElement, group: 'ENERGY' | 'PUMP', text: string) => within(within(c).getByRole('group', { name: group })).getByRole('button', { name: text })
const completeButton = (c: HTMLElement) => within(c).getByRole('button', { name: /^(COMPLETE|SAVING…)$/ })
const note = (c: HTMLElement) => c.querySelector('textarea') as HTMLTextAreaElement
const tile = (c: HTMLElement, label: string) => (c.querySelector(`[data-finish-tile="${label}"]`) as HTMLElement).textContent

beforeEach(() => {
  session = { ...base, setLogs: BOARD_LOGS }
  complete.mutateAsync.mockReset().mockResolvedValue(undefined)
  complete.isPending = false
  complete.isError = false
  complete.error = null
  onBack.mockReset()
  onGoBack.mockReset()
})

describe('W18: what the board draws, in its order and its words', () => {
  const ORDER = [
    'WEEK 2 · TUESDAY · 52:40', 'FINISH PULL 1', 'WORKING SETS', 'SKIPPED', 'WARMUPS', WARNING.text, 'GO BACK',
    'ENERGY', 'NONE', 'LOW', 'NORMAL', 'HIGH', 'SUPREME', 'PUMP', 'NONE', 'SOME', 'GOOD', 'EXTREME', 'NOTE', 'BACK TO SESSION', 'COMPLETE',
  ]

  it('each word is the board\'s (read from the board file), and the screen draws them in the board\'s order', () => {
    const w18 = board('SessionComplete.dc.html')
    for (const word of [...ORDER, 'How did it feel?']) expect(w18, word).toContain(word)
    // the chips are the scales' own labels (today's values), in the board's order
    expect(w18).toContain(`[${ENERGY_SCALE.values.map((v) => `'${ENERGY_SCALE.labels[v]}'`).join(', ')}]`)
    expect(w18).toContain(`[${PUMP_SCALE.values.map((v) => `'${PUMP_SCALE.labels[v]}'`).join(', ')}]`)
    const { container } = show(WARNING)
    const text = container.textContent!
    let at = -1
    for (const word of ORDER) {
      const next = text.indexOf(word, at + 1)
      expect(next, `"${word}" after position ${at}`).toBeGreaterThan(at)
      at = next
    }
    expect(note(container).placeholder).toBe('How did it feel?')
    expect(tile(container, 'WORKING SETS')).toBe('WORKING SETS13')
  })

  it('W19 draws the same words without the box: the reopened board has no GO BACK and no warning, and the screen of a reopened session has neither', () => {
    const w19 = board('WorkoutFinishReopened.dc.html')
    for (const word of ['WEEK 2 · TUESDAY · 52:40', 'FINISH PULL 1', 'WORKING SETS', 'SKIPPED', 'WARMUPS', 'ENERGY', 'PUMP', 'NOTE', 'BACK TO SESSION', 'SAVING…']) expect(w19, word).toContain(word)
    expect(w19).not.toContain('GO BACK')
    expect(w19).not.toContain('planned sets')
    session = { ...base, setLogs: BOARD_LOGS, note: 'Grip went on the last curl set.', energyRating: 'high', pumpRating: 'good' }
    const { container } = show(WARNING)
    expect(container.textContent).not.toContain('GO BACK')
    expect(container.textContent).not.toContain('planned sets')
  })
})

describe('the tiles count as today (SPEC G51; TASKS 64: `countCompletedSets` and the skipped count)', () => {
  it('WORKING SETS and SKIPPED leave the warmups out, WARMUPS counts them: 4 working, a drop, 1 skipped, 2 warmups and a skipped one read 5, 1, 2 (break: warmups in WORKING SETS, as the old SETS LOGGED counted them → 7)', () => {
    session = {
      ...base,
      setLogs: [
        log('a'), log('b'), log('c'), log('d'), log('d1', { parentSetId: 'd', isDropset: true, stageIndex: 1 }),
        log('s', { isSkipped: true, weight: null, reps: null }),
        log('w1', { isWarmup: true }), log('w2', { isWarmup: true }), log('w3', { isWarmup: true, isSkipped: true, weight: null, reps: null }),
      ],
    }
    const { container } = show()
    expect([tile(container, 'WORKING SETS'), tile(container, 'SKIPPED'), tile(container, 'WARMUPS')]).toEqual(['WORKING SETS5', 'SKIPPED1', 'WARMUPS2'])
  })

  it('a session that has not loaded yet reads 0, 0, 0, as the screen it replaces did', () => {
    session = undefined
    const { container } = show()
    expect([tile(container, 'WORKING SETS'), tile(container, 'SKIPPED'), tile(container, 'WARMUPS')]).toEqual(['WORKING SETS0', 'SKIPPED0', 'WARMUPS0'])
  })
})

describe('the warning box and its two ways back', () => {
  it('with unlogged planned sets the box names them and GO BACK hands the first one\'s row key on; BACK TO SESSION closes the screen where it was', () => {
    const { container } = show(WARNING)
    const box = container.querySelector('[data-finish-warning]') as HTMLElement
    expect(box.textContent).toBe(`${WARNING.text}GO BACK`)
    fireEvent.click(within(box).getByRole('button', { name: 'GO BACK' }))
    expect(onGoBack).toHaveBeenCalledTimes(1)
    expect(onGoBack).toHaveBeenCalledWith('set:ez.2')
    expect(onBack).not.toHaveBeenCalled()
    fireEvent.click(within(container).getByRole('button', { name: 'BACK TO SESSION' }))
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onGoBack).toHaveBeenCalledTimes(1)
  })

  it('with none there is no box (absence: not the box with an empty line)', () => {
    const { container } = show(null)
    expect(container.querySelector('[data-finish-warning]')).toBeNull()
    expect(within(container).queryByRole('button', { name: 'GO BACK' })).toBeNull()
  })

  it('a reopened session shows no box even when sets are unlogged: its planned sets are what they were (break: show it for a reopened session)', () => {
    for (const reopened of [{ note: 'Grip went.' }, { energyRating: 'low' as const }, { pumpRating: 'none' as const }]) {
      cleanup()
      session = { ...base, setLogs: BOARD_LOGS, ...reopened }
      const { container } = show(WARNING)
      expect(container.querySelector('[data-finish-warning]'), JSON.stringify(reopened)).toBeNull()
      expect(container.querySelector('[data-finish]')!.getAttribute('data-finish')).toBe('reopened')
    }
    cleanup()
    session = { ...base, setLogs: BOARD_LOGS }
    expect(show(WARNING).container.querySelector('[data-finish]')!.getAttribute('data-finish')).toBe('new')
  })

  it('BACK TO SESSION is never disabled, not even while the session is saving', () => {
    complete.isPending = true
    const { container } = show(null)
    expect((within(container).getByRole('button', { name: 'BACK TO SESSION' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('the chips: today\'s scales, one tap selects and a tap on the selected one clears it', () => {
  it('ENERGY and PUMP draw their scales\' labels, each chip says whether it is pressed, and the two rows are independent', () => {
    const { container } = show()
    const energy = within(container).getByRole('group', { name: 'ENERGY' })
    const pump = within(container).getByRole('group', { name: 'PUMP' })
    expect(Array.from(energy.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['NONE', 'LOW', 'NORMAL', 'HIGH', 'SUPREME'])
    expect(Array.from(pump.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['NONE', 'SOME', 'GOOD', 'EXTREME'])
    const pressed = (group: HTMLElement) => Array.from(group.querySelectorAll('button')).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)
    expect(pressed(energy)).toEqual([])
    fireEvent.click(chip(container, 'ENERGY', 'NONE'))
    expect([pressed(energy), pressed(pump)]).toEqual([['NONE'], []]) // the same word in the other row is not pressed with it
    fireEvent.click(chip(container, 'ENERGY', 'HIGH'))
    expect(pressed(energy)).toEqual(['HIGH'])
    fireEvent.click(chip(container, 'ENERGY', 'HIGH'))
    expect(pressed(energy)).toEqual([]) // back to "not rated" (SPEC §7: absence is data too)
    fireEvent.click(chip(container, 'PUMP', 'GOOD'))
    expect([pressed(energy), pressed(pump)]).toEqual([[], ['GOOD']])
  })
})

describe('W19: a reopened session\'s note and ratings are in the boxes, once', () => {
  it('prefills the note and both chips from the session, and a later read of the session does not take over what is being typed', () => {
    session = { ...base, setLogs: BOARD_LOGS, note: 'Grip went on the last curl set.', energyRating: 'high', pumpRating: 'good' }
    const { container, rerender } = show(null)
    expect(note(container).value).toBe('Grip went on the last curl set.')
    expect(chip(container, 'ENERGY', 'HIGH').getAttribute('aria-pressed')).toBe('true')
    expect(chip(container, 'PUMP', 'GOOD').getAttribute('aria-pressed')).toBe('true')
    fireEvent.change(note(container), { target: { value: 'Grip held after all.' } })
    fireEvent.click(chip(container, 'ENERGY', 'LOW'))
    session = { ...session, note: 'Grip went on the last curl set. (read again)', energyRating: 'supreme' }
    rerender(<FinishScreen sessionId="session-1" eyebrow="WEEK 2 · TUESDAY · 52:40" workoutName="Pull 1" warning={null} onBack={onBack} onGoBack={onGoBack} />)
    expect(note(container).value).toBe('Grip held after all.')
    expect(chip(container, 'ENERGY', 'LOW').getAttribute('aria-pressed')).toBe('true')
  })
})

describe('COMPLETE sends what the screen it replaces sent for the same steps (W: the parity capture, `finish-payload-before.json`)', () => {
  it('the capture is the one it claims to be: six scenarios, a trimmed note, a cleared chip, a prefilled session (a vacuous fixture proves nothing)', () => {
    expect(Object.keys(BEFORE)).toEqual(['plain', 'typed', 'cleared', 'blankNote', 'reopened', 'reopenedChanged'])
    expect(BEFORE.typed.payload).toEqual({ id: 'session-1', note: 'Grip went on the last curl set.', energyRating: 'high', pumpRating: 'good' })
    expect(BEFORE.cleared.payload.energyRating).toBeNull()
    expect(BEFORE.cleared.payload.pumpRating).toBe('some')
    expect(BEFORE.blankNote.payload.note).toBeNull()
    expect(BEFORE.reopened.payload).toEqual({ id: 'session-1', note: 'Grip went on the last curl set.', energyRating: 'high', pumpRating: 'good' })
  })

  it.each(Object.keys(BEFORE))('%s: the same typing and taps, the same patch (break: swap the two ratings; break: send the note untrimmed)', async (name) => {
    const scenario = BEFORE[name]
    session = { ...base, setLogs: BOARD_LOGS, ...scenario.session } as Session
    const { container } = show(WARNING)
    if (scenario.steps.note !== undefined) fireEvent.change(note(container), { target: { value: scenario.steps.note } })
    for (const text of scenario.steps.energy ?? []) fireEvent.click(chip(container, 'ENERGY', text))
    for (const text of scenario.steps.pump ?? []) fireEvent.click(chip(container, 'PUMP', text))
    await act(async () => {
      fireEvent.click(completeButton(container))
      await Promise.resolve()
    })
    expect(complete.mutateAsync).toHaveBeenCalledTimes(1)
    expect(complete.mutateAsync.mock.calls[0][0]).toEqual(scenario.payload)
  })

  it('the warning does not hold COMPLETE back: with sets unlogged the patch is the same (it is a notice, and BACK TO SESSION is the way to fix it)', async () => {
    const { container } = show(WARNING)
    await act(async () => {
      fireEvent.click(completeButton(container))
      await Promise.resolve()
    })
    expect(complete.mutateAsync.mock.calls[0][0]).toEqual(BEFORE.plain.payload)
  })
})

describe('saving and a refused save (SPEC Errors (15))', () => {
  it('while the write is out the button reads SAVING… and cannot be pressed twice (W19\'s button)', () => {
    complete.isPending = true
    const { container } = show(null)
    const button = within(container).getByRole('button', { name: 'SAVING…' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(within(container).queryByRole('button', { name: 'COMPLETE' })).toBeNull()
  })

  it('idle, the button reads COMPLETE and is not busy', () => {
    const { container } = show(null)
    const button = within(container).getByRole('button', { name: 'COMPLETE' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('aria-busy')).toBe('false')
    expect(container.querySelector('[role="alert"]')).toBeNull() // nothing failed: no line
  })

  it('a failed COMPLETE says so and gives the real reason the server sent (a Supabase error is no Error object), and the tap throws nothing', async () => {
    complete.mutateAsync.mockRejectedValue({ message: 'new row violates row-level security policy for table "v2_sessions"', code: '42501' })
    const { container, rerender } = show(null)
    await act(async () => {
      fireEvent.click(completeButton(container))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(complete.mutateAsync).toHaveBeenCalledTimes(1)
    // the mutation's own state, as TanStack sets it when the request is refused
    complete.isError = true
    complete.error = { message: 'new row violates row-level security policy for table "v2_sessions"', code: '42501' }
    rerender(<FinishScreen sessionId="session-1" eyebrow="WEEK 2 · TUESDAY · 52:40" workoutName="Pull 1" warning={null} onBack={onBack} onGoBack={onGoBack} />)
    const line = container.querySelector('[role="alert"]') as HTMLElement
    expect(line.textContent).toBe('Couldn\'t complete the session.new row violates row-level security policy for table "v2_sessions"')
    // the person can press it again
    expect((completeButton(container) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('the fixtures of boards W18 and W19 (`CAPTURE_RENDER=1 npx vitest run src/features/gym/FinishScreen.test.tsx`; captured after the assertions)', () => {
  it('W18: the unlogged-sets box, NORMAL and GOOD chosen, the note empty', () => {
    const { container } = show(WARNING)
    fireEvent.click(chip(container, 'ENERGY', 'NORMAL'))
    fireEvent.click(chip(container, 'PUMP', 'GOOD'))
    expect(container.textContent).toContain(WARNING.text)
    expect(chip(container, 'ENERGY', 'NORMAL').getAttribute('aria-pressed')).toBe('true')
    expect(tile(container, 'WARMUPS')).toBe('WARMUPS2')
    captureRender('w18', container)
  })

  it('W19: a reopened session, its note and HIGH and GOOD in the boxes, no box, the button saving', () => {
    session = { ...base, setLogs: BOARD_LOGS, note: 'Grip went on the last curl set.', energyRating: 'high', pumpRating: 'good' }
    complete.isPending = true
    const { container } = show(WARNING)
    expect(container.querySelector('[data-finish-warning]')).toBeNull()
    expect(note(container).value).toBe('Grip went on the last curl set.')
    expect(chip(container, 'ENERGY', 'HIGH').getAttribute('aria-pressed')).toBe('true')
    expect(within(container).getByRole('button', { name: 'SAVING…' })).toBeTruthy()
    // a box's value is no markup (a captured render loses it: RULES, `screenshot-fixture.mjs`'s dump holds no input's value): the note goes in as the textarea's text, after every assertion
    note(container).textContent = note(container).value
    captureRender('w19', container)
  })
})
