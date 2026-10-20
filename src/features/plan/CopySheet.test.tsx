// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import type { WeekPlan } from '../../types'
import { copyRows } from './copySheetLogic'
import { pe, plan, wset } from './weekPlanning.testutil'

// Chunk 52 (TASKS-1.2 "Plan's header" → CopySheet; board 2). The sheet as a component, with the write behind it stood in for: what each
// of its controls draws in each state (the field chips ticked and not, the workout rows open and locked, the overwrite switch off and
// on, the button able and not), which the page-level tests (PlanPage.copySheet.test.tsx) do not read. What the sheet sends and when it
// closes are theirs, against the real hook.

const hook = vi.hoisted(() => ({ copy: { isPending: false, isError: false, error: null as unknown, mutateAsync: vi.fn() } }))
vi.mock('./useCopyNumbers', () => ({ useCopyNumbers: () => hook.copy }))

const { default: CopySheet } = await import('./CopySheet')

beforeEach(() => {
  hook.copy = { isPending: false, isError: false, error: null, mutateAsync: vi.fn().mockResolvedValue(undefined) }
})
afterEach(cleanup)

const BENCH = pe('pe-bench', 'bench', 0, { workoutDayId: 'wd-push' })
const ROW = pe('pe-row', 'row', 0, { workoutDayId: 'wd-pull' })
const SQUAT = pe('pe-squat', 'squat', 0, { workoutDayId: 'wd-legs' })

// Last week's plans have numbers; this week's boxes are empty (weight and RIR), so copying them changes something.
const lastWeek = (id: string, workoutDayId: string, exercise: typeof BENCH): WeekPlan =>
  plan(1, [exercise], [wset(`${id}-set`, exercise.id, 1)], { id: `${id}-1`, workoutDayId })
const thisWeek = (id: string, workoutDayId: string, exercise: typeof BENCH): WeekPlan =>
  plan(2, [exercise], [wset(`${id}-set-2`, exercise.id, 1, { targetWeight: null, targetRir: null })], { id: `${id}-2`, workoutDayId })

const LABELS: Record<string, { day: string; name: string }> = {
  'wd-push': { day: 'MON', name: 'Push Day' },
  'wd-pull': { day: 'WED', name: 'Pull Day' },
  'wd-legs': { day: 'FRI', name: 'Leg Day' },
}

/** Push (open), Pull (done: locked), Legs (open): the rows the sheet is given, as the page makes them. */
function sheet(over: Partial<Parameters<typeof CopySheet>[0]> = {}, doneIds: string[] = ['pull-2']) {
  const week = [thisWeek('push', 'wd-push', BENCH), thisWeek('pull', 'wd-pull', ROW), thisWeek('legs', 'wd-legs', SQUAT)]
  const all = [lastWeek('push', 'wd-push', BENCH), lastWeek('pull', 'wd-pull', ROW), lastWeek('legs', 'wd-legs', SQUAT), ...week]
  const rows = copyRows({ thisWeek: week, allWeekPlans: all, doneWeekPlanIds: new Set(doneIds), label: (wp) => LABELS[wp.workoutDayId] })
  return render(<CopySheet unit="week" weekNumber={2} planningType="week_dependent" rows={rows} thisWeek={week} onClose={vi.fn()} {...over} />)
}

const dialog = () => screen.getByRole('dialog')
const chip = (name: string) => within(dialog()).getByRole('checkbox', { name })
const rowOf = (name: string) => within(dialog()).getByText(name).closest('button') as HTMLButtonElement
const copyButton = () => within(dialog()).getByText(/^(COPY INTO|PICK|NOTHING|COPYING)/).closest('button') as HTMLButtonElement

describe('the field chips', () => {
  it('ticked: the accent outline on the muted accent, and the tick box filled; unticked: a plain hairline on the surface', () => {
    sheet()
    for (const name of ['WEIGHT', 'REPS', 'RIR']) {
      expect(chip(name).getAttribute('aria-checked')).toBe('true')
      expect([chip(name).style.borderColor, chip(name).style.background]).toEqual(['var(--accent)', 'var(--accent-muted)'])
    }
    fireEvent.click(chip('REPS'))
    expect(chip('REPS').getAttribute('aria-checked')).toBe('false')
    expect([chip('REPS').style.borderColor, chip('REPS').style.background]).toEqual(['var(--border)', 'var(--surface)'])
    // the others are as they were
    expect([chip('WEIGHT').style.borderColor, chip('WEIGHT').style.background]).toEqual(['var(--accent)', 'var(--accent-muted)'])
    fireEvent.click(chip('REPS'))
    expect(chip('REPS').style.borderColor).toBe('var(--accent)')
  })
})

describe('the workout rows', () => {
  it('ruled between rows and not above the first; an open row is on the surface with a pointer, a done one raised, muted and locked with no pointer', () => {
    sheet()
    const rows = ['Push Day', 'Pull Day', 'Leg Day'].map(rowOf)
    expect(rows.map((row) => parseFloat(row.style.borderTopWidth))).toEqual([0, 1, 1])
    expect(rows.map((row) => row.style.background)).toEqual(['var(--surface)', 'var(--surface-raised)', 'var(--surface)'])
    expect(rows.map((row) => row.style.cursor)).toEqual(['pointer', 'default', 'pointer'])
    expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual(['true', 'false', 'true'])
    expect(rows.map((row) => row.getAttribute('aria-disabled'))).toEqual(['false', 'true', 'false'])
    // the name: primary on an open row, muted on a locked one
    expect(within(dialog()).getByText('Push Day').style.color).toBe('var(--text-primary)')
    expect(within(dialog()).getByText('Pull Day').style.color).toBe('var(--text-muted)')
    expect(within(rows[1]).getByText('DONE')).toBeTruthy()
  })

  it('a tap unticks an open row and a tap on a locked one changes nothing', () => {
    sheet()
    fireEvent.click(rowOf('Push Day'))
    expect(rowOf('Push Day').getAttribute('aria-checked')).toBe('false')
    fireEvent.click(rowOf('Pull Day'))
    expect(rowOf('Pull Day').getAttribute('aria-checked')).toBe('false')
    expect(rowOf('Pull Day').style.background).toBe('var(--surface-raised)')
  })
})

describe('"Overwrite what\'s already there"', () => {
  const track = () => within(dialog()).getByRole('switch').querySelector(':scope > span[aria-hidden="true"]') as HTMLElement
  const knob = () => track().firstElementChild as HTMLElement

  it('off: a raised track with a strong outline and the knob at the left in the strong border colour; on: the accent track, the knob at the right in --on-accent', () => {
    sheet()
    const off = within(dialog()).getByRole('switch')
    expect(off.getAttribute('aria-checked')).toBe('false')
    expect([track().style.background, track().style.borderColor]).toEqual(['var(--surface-raised)', 'var(--border-strong)'])
    expect([knob().style.left, knob().style.background]).toEqual(['2px', 'var(--border-strong)'])
    expect(within(dialog()).getByText('Off: only empty boxes get filled.')).toBeTruthy()

    fireEvent.click(off)
    expect(off.getAttribute('aria-checked')).toBe('true')
    expect([track().style.background, track().style.borderColor]).toEqual(['var(--accent)', 'var(--accent)'])
    expect([knob().style.left, knob().style.background]).toEqual(['20px', 'var(--on-accent)'])
    expect(within(dialog()).getByText('On: numbers you already typed get replaced.')).toBeTruthy()
  })
})

describe('the button', () => {
  it('able: COPY INTO 2 WORKOUTS on the accent, with a pointer', () => {
    sheet()
    expect(copyButton().textContent).toBe('COPY INTO 2 WORKOUTS')
    expect(copyButton().disabled).toBe(false)
    expect([copyButton().style.background, copyButton().style.color, copyButton().style.cursor]).toEqual(['var(--accent)', 'var(--on-accent)', 'pointer'])
  })

  it('nothing picked: PICK A WORKOUT, raised and muted, disabled, no pointer', () => {
    sheet()
    fireEvent.click(rowOf('Push Day'))
    fireEvent.click(rowOf('Leg Day'))
    expect(copyButton().textContent).toBe('PICK A WORKOUT')
    expect(copyButton().disabled).toBe(true)
    expect([copyButton().style.background, copyButton().style.color, copyButton().style.cursor]).toEqual(['var(--surface-raised)', 'var(--text-muted)', 'default'])
  })

  it('no field ticked: PICK WHAT TO COPY, disabled, no pointer', () => {
    sheet()
    for (const name of ['WEIGHT', 'REPS', 'RIR']) fireEvent.click(chip(name))
    expect(copyButton().textContent).toBe('PICK WHAT TO COPY')
    expect(copyButton().disabled).toBe(true)
    expect(copyButton().style.cursor).toBe('default')
  })

  it('while the copy is out: COPYING…, disabled, no pointer (it is on the accent still: it can copy, it is busy)', () => {
    hook.copy.isPending = true
    sheet()
    expect(copyButton().textContent).toBe('COPYING…')
    expect(copyButton().disabled).toBe(true)
    expect([copyButton().style.background, copyButton().style.cursor]).toEqual(['var(--accent)', 'default'])
  })

  it('a press sends once, and a press on a button that cannot copy sends nothing', () => {
    sheet()
    fireEvent.click(copyButton())
    expect(hook.copy.mutateAsync).toHaveBeenCalledTimes(1)
    cleanup()
    hook.copy.mutateAsync.mockClear()
    sheet()
    for (const name of ['WEIGHT', 'REPS', 'RIR']) fireEvent.click(chip(name))
    fireEvent.click(copyButton())
    expect(hook.copy.mutateAsync).not.toHaveBeenCalled()
  })
})
