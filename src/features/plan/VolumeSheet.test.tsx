// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import type { StageVolumeRule, WeeklySchedule } from '../../types'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'
import { captureRender } from '../../testing/captureRender'
import type { VolumeSessionsRead } from './useVolumeSessions'
import type { VolumeSheetProps } from './VolumeSheet'
import { weekPlan } from './volumePerMuscle.testutil'
import { UPPER_A, readOf, seededRead, seededWeek, sessionRead, UPPER_A_LOGS } from './volumeSheet.world.testutil'

// Chunk 55 (TASKS-1.2 "VOLUME"; SPEC [1.2] Volume per muscle (14), 14b, G51; board 3): the sheet, drawn from the seed's week 2 → week 3 (chunk 44
// counted it by hand: `volumePerMuscle.seed.test.ts`) and from small worlds that tell one source from another. The read behind it
// (`useVolumeSessions`) is mocked here, its shape the real one (`VolumeSessionsRead`), and proven on its own (`useVolumeSessions.test.ts`): the
// mock records the plan rows it is asked about, because a mock that returns fixed data hides which argument the sheet passed.

interface Read { data: VolumeSessionsRead | undefined; isError: boolean; error?: unknown; refetch: () => Promise<unknown> }
const h = vi.hoisted(() => ({
  read: { data: undefined, isError: false, refetch: () => Promise.resolve() } as Read,
  asked: [] as string[][],
}))
vi.mock('./useVolumeSessions', () => ({
  useVolumeSessions: (ids: readonly string[]) => {
    h.asked.push([...ids])
    return h.read
  },
}))

const { default: VolumeSheet } = await import('./VolumeSheet')

afterEach(() => {
  cleanup()
  useSettingsStore.setState(DEFAULT_SETTINGS)
  h.read = { data: undefined, isError: false, refetch: () => Promise.resolve() }
  h.asked = []
})

const props = (over: Partial<VolumeSheetProps> = {}): VolumeSheetProps => ({
  unit: 'week',
  weekNumber: 3,
  ended: true,
  thisWeek: seededWeek(3),
  lastWeek: seededWeek(2),
  thisWeekSchedule: null,
  lastWeekSchedule: null,
  onClose: vi.fn(),
  ...over,
})
const open = (over: Partial<VolumeSheetProps> = {}) => render(<VolumeSheet {...props(over)} />)

// What each row says: name, last week, this week, the change chip ('' for none) and the note under it.
function table(): string[][] {
  return screen.getAllByRole('row').filter((r) => r.hasAttribute('data-muscle')).map((r) => {
    const cells = within(r).getAllByRole('cell').map((c) => c.textContent ?? '')
    const note = [...r.querySelectorAll('span')].find((s) => s.textContent?.startsWith('YOU PLANNED'))?.textContent ?? ''
    return [...cells, note]
  })
}

// The seed's week 2 → week 3 counted by hand (chunk 44: volumePerMuscle.seed.test.ts), by the rule: [muscle, last week, this week, change, note].
const HALF = [
  ['Chest', '3', '3', '', ''],
  ['Back', '2', '7', '+5', 'YOU PLANNED 7 LAST WEEK · DID 2'],
  ['Shoulders', '3½', '6', '+2½', 'YOU PLANNED 6 LAST WEEK · DID 3½'],
  ['Biceps', '0', '2', '+2', 'YOU PLANNED 2 LAST WEEK · DID 0'],
  ['Triceps', '4', '3', '−1', 'YOU PLANNED 3 LAST WEEK · DID 4'],
  ['Quads', '3', '3', '', ''],
  ['Hamstrings', '5½', '5½', '', ''],
  ['Calves', '2½', '2½', '', ''],
]
const EACH = [
  ['Chest', '3', '3', '', ''],
  ['Back', '2', '8', '+6', 'YOU PLANNED 8 LAST WEEK · DID 2'],
  ['Shoulders', '4', '6', '+2', 'YOU PLANNED 6 LAST WEEK · DID 4'],
  ['Biceps', '0', '2', '+2', 'YOU PLANNED 2 LAST WEEK · DID 0'],
  ['Triceps', '5', '4', '−1', 'YOU PLANNED 4 LAST WEEK · DID 5'],
  ['Quads', '3', '3', '', ''],
  ['Hamstrings', '7', '7', '', ''],
  ['Calves', '3', '3', '', ''],
]
const WHOLE = [
  ['Chest', '3', '3', '', ''],
  ['Back', '2', '6', '+4', 'YOU PLANNED 6 LAST WEEK · DID 2'],
  ['Shoulders', '3', '6', '+3', 'YOU PLANNED 6 LAST WEEK · DID 3'],
  ['Biceps', '0', '2', '+2', 'YOU PLANNED 2 LAST WEEK · DID 0'],
  ['Triceps', '3', '2', '−1', 'YOU PLANNED 2 LAST WEEK · DID 3'],
  ['Quads', '3', '3', '', ''],
  ['Hamstrings', '4', '4', '', ''],
  ['Calves', '2', '2', '', ''],
]
// Names the row's cells as `table()` reads them: the name, last, this, the chip (the arrow is aria-hidden: not a cell).

describe('board 3: the sheet', () => {
  it('"WEEK 3 · SETS PER MUSCLE", Volume, the columns WEEK 2 and WEEK 3, every muscle in order with its change and its note, the footer', () => {
    h.read = { ...h.read, data: seededRead() }
    // Captured before it asserts (RULES: a broken rule still writes the fixture the Chromium check measures).
    open()
    captureRender('plan-3', document.body)
    expect(screen.getByRole('dialog', { name: 'Volume' })).toBeTruthy()
    expect(screen.getByText('WEEK 3 · SETS PER MUSCLE')).toBeTruthy()
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['MUSCLE', 'WEEK 2', 'WEEK 3'])
    expect(table()).toEqual(HALF)
    expect(screen.getByText("Week 2 counts the sets you actually did. Warmups don't count. A drop counts as ½ set — you can change that in Settings.")).toBeTruthy()
  })

  it('a change is a chip in the accent, a muscle that didn\'t change has none; the chip says + or − (U+2212)', () => {
    h.read = { ...h.read, data: seededRead() }
    open()
    const chips = screen.getAllByRole('cell').filter((c) => c.getAttribute('data-delta') === 'change')
    expect(chips.map((c) => c.textContent)).toEqual(['+5', '+2½', '+2', '−1'])
    expect((chips[3].textContent ?? '').charCodeAt(0)).toBe(0x2212)
    expect(chips.every((c) => c.style.background.includes('--accent-muted') && c.style.color === 'var(--accent)')).toBe(true)
    expect(screen.getAllByRole('cell').filter((c) => c.getAttribute('data-delta') === 'none')).toHaveLength(8 - 4)
  })

  it('the arrow between the weeks is decoration, not a cell', () => {
    h.read = { ...h.read, data: seededRead() }
    open()
    const first = screen.getAllByRole('row').find((r) => r.hasAttribute('data-muscle'))!
    expect(within(first).getAllByRole('cell')).toHaveLength(4)
    expect(first.querySelector('[aria-hidden="true"]')?.textContent).toBe('→')
  })

  it('closes with the × and with Escape', () => {
    h.read = { ...h.read, data: seededRead() }
    const onClose = vi.fn()
    open({ onClose })
    fireEvent.click(screen.getByLabelText('Close'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('the Settings rule is the sheet\'s alone (14b, G51): the store decides what a drop counts as', () => {
  const rows = (rule: StageVolumeRule) => {
    useSettingsStore.setState({ stageVolumeRule: rule })
    h.read = { ...h.read, data: seededRead() }
    open()
    return table()
  }

  it('each drop = ½ (the default), each drop = 1 and whole set = 1 give the three hand counts, and the footer names the rule\'s own fraction', () => {
    expect(useSettingsStore.getState().stageVolumeRule).toBe('half')
    expect(rows('half')).toEqual(HALF)
    expect(screen.getByText(/A drop counts as ½ set/)).toBeTruthy()
    cleanup()
    expect(rows('each')).toEqual(EACH)
    expect(screen.getByText(/A drop counts as 1 set/)).toBeTruthy()
    cleanup()
    expect(rows('whole')).toEqual(WHOLE)
    expect(screen.getByText(/A drop doesn't count/)).toBeTruthy()
  })

  it('changing the rule changes back, shoulders, triceps, hamstrings and calves, and not chest, biceps or quads', () => {
    const half = rows('half')
    cleanup()
    const each = rows('each')
    expect(half.filter((r, i) => r.join('|') !== each[i].join('|')).map((r) => r[0])).toEqual(['Back', 'Shoulders', 'Triceps', 'Hamstrings', 'Calves'])
  })
})

describe('what the sheet reads, and from where', () => {
  it('asks for the sessions of last week\'s plan rows, and for no other (this week\'s are not last week\'s)', () => {
    h.read = { ...h.read, data: seededRead() }
    open()
    expect(h.asked[0]).toEqual(['w2-ua', 'w2-la', 'w2-ub'])
    expect(h.asked.flat()).not.toContain('w3-ua')
  })

  it('this week is the plan rows it is given as its own, not last week\'s (a week with one more set reads one more)', () => {
    h.read = { ...h.read, data: seededRead() }
    const plus = weekPlan('w3-ua', [...UPPER_A.slice(0, 3), { ...UPPER_A[3], sets: 'n d2 n' }], { weekNumber: 3 }) // a third pushdown
    open({ thisWeek: [plus, seededWeek(3)[1], seededWeek(3)[2]] })
    // 1 + (1 + 2 × ½) + 1 = 4 planned this week; last week did 4 against a plan of 3 (the note stays: it is last week's own).
    expect(table().find((r) => r[0] === 'Triceps')).toEqual(['Triceps', '4', '4', '', 'YOU PLANNED 3 LAST WEEK · DID 4'])
  })

  it('a done session counts what it did (an added set in, a skipped one out), a skipped session nothing: Upper A\'s triceps 4, back 2; Upper B\'s biceps 0', () => {
    h.read = { ...h.read, data: seededRead() }
    open()
    const t = table()
    expect(t.find((r) => r[0] === 'Triceps')?.[1]).toBe('4') // 1 + (1 + 2 × ½) + 1 added
    expect(t.find((r) => r[0] === 'Back')?.[1]).toBe('2') // row set 3 skipped, Upper B skipped
    expect(t.find((r) => r[0] === 'Biceps')?.[1]).toBe('0')
  })

  it('a planned set the session deleted is out, though a log for it is still there (the read\'s `deleted` change)', () => {
    const sessions = seededRead().sessions.map((s) => (s.weekPlanId === 'w2-ua' ? { ...s, sessionSetChanges: [{ kind: 'deleted' as const, weekPlanSetId: 'w2-ua:bench:2' }] } : s))
    h.read = { ...h.read, data: readOf(sessions) }
    open()
    expect(table().find((r) => r[0] === 'Chest')).toEqual(['Chest', '2', '3', '+1', 'YOU PLANNED 3 LAST WEEK · DID 2'])
  })

  it('a swapped-in exercise counts under its own muscle, from the exercises the logs name; one nobody names is Other', () => {
    const copy = (exerciseId: string) => UPPER_A_LOGS.filter((l) => l.exerciseId === 'bench').map((l) => ({ ...l, id: `${l.id}-${exerciseId}`, exerciseId, weekPlanSetId: null }))
    const swapped = sessionRead('w2-ua', 'completed', [...UPPER_A_LOGS, ...copy('machine-press'), ...copy('mystery')])
    const base = seededRead()
    h.read = { ...h.read, data: { sessions: [swapped, ...base.sessions.slice(1)], exercises: [...base.exercises, { id: 'machine-press', muscleGroup: 'chest' }] } }
    open()
    // bench 3 + the machine press's 3 working logs (its warmup out): chest 6. The mystery exercise's 3 are Other (nothing names it).
    expect(table().find((r) => r[0] === 'Chest')).toEqual(['Chest', '6', '3', '−3', 'YOU PLANNED 3 LAST WEEK · DID 6'])
    expect(table()[table().length - 1]).toEqual(['Other', '3', '0', '−3', 'YOU PLANNED 0 LAST WEEK · DID 3'])
  })

  it('an exercise only one of the two weeks\' plans names counts under its own muscle, not under Other: a squat dropped this week, a curl added', () => {
    const lastLegs = weekPlan('w2-lg', [{ row: 'squat', exerciseId: 'squat', sets: 'n n n', joinedGroup: 'quads' }], { weekNumber: 2 })
    const thisArms = weekPlan('w3-ar', [{ row: 'curl', exerciseId: 'curl', sets: 'n n', joinedGroup: 'biceps' }], { weekNumber: 3 })
    h.read = { ...h.read, data: readOf([]) }
    // Last week still running with nothing started: its plan counts, so the squat's three sets are found through last week's own exercise list.
    open({ weekNumber: 3, ended: false, thisWeek: [thisArms], lastWeek: [lastLegs] })
    expect(table()).toEqual([
      ['Biceps', '0', '2', '+2', ''],
      ['Quads', '3', '0', '−3', ''],
    ])
  })

  it('a muscle group comes from the exercise the read names: a pushdown filed under biceps leaves triceps', () => {
    h.read = { ...h.read, data: { ...seededRead(), exercises: seededRead().exercises.map((e) => (e.id === 'pushdown' ? { ...e, muscleGroup: 'biceps' as const } : e)) } }
    open()
    // The plans' own joined exercise still says triceps; the read (the exercises row as of the sheet's opening) wins: the 4 done sets move.
    expect(table().find((r) => r[0] === 'Biceps')?.[1]).toBe('4')
  })
})

// Last week as a small world, to tell `ended` apart: Upper (bench 3 sets) done with one set skipped; Lower (squat 3 sets) never started.
describe('DECISIONS 133: a workout never done, once last week is over and while it still runs', () => {
  const planned = (id: string, exerciseId: string, group: 'chest' | 'quads', week: number) => weekPlan(id, [{ row: exerciseId, exerciseId, sets: 'n n n', joinedGroup: group }], { weekNumber: week })
  const logs = ['n', 'n', 'x'].map((t, i) => ({ ...UPPER_A_LOGS[0], id: `u${i}`, exerciseId: 'bench', isWarmup: false, isSkipped: t === 'x', weekPlanSetId: `p-up:bench:${i + 1}`, parentSetId: null }))
  const world = (ended: boolean) => {
    h.read = { ...h.read, data: readOf([sessionRead('p-up', 'completed', logs)]) }
    open({ weekNumber: 2, ended, thisWeek: [planned('q-up', 'bench', 'chest', 2), planned('q-lo', 'squat', 'quads', 2)], lastWeek: [planned('p-up', 'bench', 'chest', 1), planned('p-lo', 'squat', 'quads', 1)] })
    return table()
  }

  it('over (Plan on the current week): the workout never started counts 0, and the note says what was missed', () => {
    expect(world(true)).toEqual([
      ['Chest', '2', '3', '+1', 'YOU PLANNED 3 LAST WEEK · DID 2'],
      ['Quads', '0', '3', '+3', 'YOU PLANNED 3 LAST WEEK · DID 0'],
    ])
  })

  it('still running (Plan on a week planned ahead): the workout not done yet counts its plan, and no note for it', () => {
    expect(world(false)).toEqual([
      ['Chest', '2', '3', '+1', 'YOU PLANNED 3 LAST WEEK · DID 2'],
      ['Quads', '3', '3', '', ''],
    ])
  })
})

describe('one workout on several weekdays (G14), by the schedule in force in each week', () => {
  const planOn = (week: number) => ({ ...weekPlan(`fb-${week}`, [{ row: 'bench', exerciseId: 'bench', sets: 'n n', joinedGroup: 'chest' }], { weekNumber: week }), workoutDayId: 'wd-fb' })
  const days = (...held: Array<'monday' | 'tuesday' | 'thursday'>): WeeklySchedule => ({
    monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null,
    ...Object.fromEntries(held.map((d) => [d, 'wd-fb'])),
  })

  it('this week\'s plan counts once per weekday it is on (Tue and Thu: twice), last week\'s per the schedule of last week (one day: once)', () => {
    h.read = { ...h.read, data: readOf([]) }
    open({ weekNumber: 3, ended: false, thisWeek: [planOn(3)], lastWeek: [planOn(2)], thisWeekSchedule: days('tuesday', 'thursday'), lastWeekSchedule: days('tuesday') })
    // Last week still running, no session yet: its plan counts, once (one day). This week: twice (two days).
    expect(table()).toEqual([['Chest', '2', '4', '+2', '']])
  })

  it('a sequence run (no weekday schedule) counts every plan row once', () => {
    h.read = { ...h.read, data: readOf([]) }
    open({ weekNumber: 3, ended: false, thisWeek: [planOn(3)], lastWeek: [planOn(2)], thisWeekSchedule: null, lastWeekSchedule: null })
    expect(table()).toEqual([['Chest', '2', '2', '', '']])
  })

  it('a workout the week\'s schedule doesn\'t hold counts for nothing that week', () => {
    h.read = { ...h.read, data: readOf([]) }
    open({ weekNumber: 3, ended: false, thisWeek: [planOn(3)], lastWeek: [planOn(2)], thisWeekSchedule: days('monday'), lastWeekSchedule: { ...days(), monday: 'wd-other' } })
    expect(table()).toEqual([['Chest', '0', '2', '+2', '']])
  })
})

describe('P1.2-2 (D31): a week with nothing in it, last week', () => {
  it('the last week\'s column is a dash for every muscle, no change chip and no note, and nothing is read', () => {
    open({ weekNumber: 4, ended: true, thisWeek: seededWeek(3), lastWeek: [] })
    const t = table()
    expect(t.map((r) => r[0])).toEqual(['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Quads', 'Hamstrings', 'Calves'])
    expect(t.every((r) => r[1] === '—' && r[3] === '' && r[4] === '')).toBe(true)
    expect(t.map((r) => r[2])).toEqual(HALF.map((r) => r[2])) // this week's numbers, as before
    expect(screen.queryByRole('status')).toBeNull()
    expect(h.asked[h.asked.length - 1]).toEqual([]) // no plan row to read sessions by
  })

  it('a planned week nobody did anything in is not empty: numbers and notes, not dashes', () => {
    h.read = { ...h.read, data: readOf([]) }
    open({ weekNumber: 4, ended: true, thisWeek: seededWeek(3), lastWeek: seededWeek(2) })
    expect(table().find((r) => r[0] === 'Chest')).toEqual(['Chest', '0', '3', '+3', 'YOU PLANNED 3 LAST WEEK · DID 0'])
    expect(table().some((r) => r[1] === '—')).toBe(false)
  })

  it('last week\'s plan rows holding no set, but a session done in it: not empty, the session\'s numbers show', () => {
    const hollow = { ...weekPlan('w2-ua', [], { weekNumber: 2 }), sets: [] }
    h.read = { ...h.read, data: readOf([sessionRead('w2-ua', 'completed', UPPER_A_LOGS)]) }
    open({ weekNumber: 3, ended: true, thisWeek: seededWeek(3), lastWeek: [hollow] })
    expect(table().some((r) => r[1] === '—')).toBe(false)
    expect(table().find((r) => r[0] === 'Chest')?.[1]).toBe('3') // bench's three working sets, as the session did them
  })

  it('two empty weeks say so, and the footer stays', () => {
    open({ weekNumber: 4, ended: true, thisWeek: [], lastWeek: [] })
    expect(table()).toEqual([])
    expect(screen.getByText('Nothing is planned in either week.')).toBeTruthy()
    expect(screen.getByText(/^Week 3 counts the sets you actually did\./)).toBeTruthy()
  })
})

describe('the read\'s states', () => {
  it('while it is out: the column heads, the page\'s spinner, the footer, no rows', () => {
    open()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
    expect(screen.getAllByRole('columnheader')).toHaveLength(3)
    expect(table()).toEqual([])
    expect(screen.getByText(/counts the sets you actually did/)).toBeTruthy()
    expect(screen.queryByText('Nothing is planned in either week.')).toBeNull()
  })

  it('when it failed: "Couldn\'t load last week." and the real reason, TRY AGAIN reads again', () => {
    const refetch = vi.fn(() => Promise.resolve())
    h.read = { data: undefined, isError: true, error: { message: 'JWT expired' }, refetch }
    open()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain("Couldn't load last week.")
    expect(alert.textContent).toContain('JWT expired')
    expect(table()).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'TRY AGAIN' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('a failed read that has an earlier answer keeps drawing it', () => {
    h.read = { data: seededRead(), isError: true, error: new Error('late'), refetch: () => Promise.resolve() }
    open()
    expect(table()).toEqual(HALF)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('a sequence run says cycle', () => {
  it('CYCLE 3 · SETS PER MUSCLE, the columns CYCLE 2 and CYCLE 3, "Cycle 2 counts…", "last cycle" in the error', () => {
    h.read = { ...h.read, data: seededRead() }
    open({ unit: 'cycle' })
    expect(screen.getByText('CYCLE 3 · SETS PER MUSCLE')).toBeTruthy()
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['MUSCLE', 'CYCLE 2', 'CYCLE 3'])
    expect(screen.getByText(/^Cycle 2 counts the sets you actually did\./)).toBeTruthy()
    cleanup()
    h.read = { data: undefined, isError: true, error: new Error('x'), refetch: () => Promise.resolve() }
    open({ unit: 'cycle' })
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load last cycle.")
  })
})

// The pictures beside board 3: the states it has no frame for. Each is captured before it asserts (RULES).
describe('screenshots of the states', () => {
  it('the empty last week (P1.2-2): dashes, no chips', () => {
    open({ weekNumber: 4, ended: true, thisWeek: seededWeek(3), lastWeek: [] })
    captureRender('plan-3-empty-last', document.body)
    expect(table()[0][1]).toBe('—')
  })

  it('EACH DROP = 1 and the footer\'s own fraction', () => {
    useSettingsStore.setState({ stageVolumeRule: 'each' })
    h.read = { ...h.read, data: seededRead() }
    open()
    captureRender('plan-3-each', document.body)
    expect(table()).toEqual(EACH)
  })

  it('loading, then a failed read', () => {
    open()
    captureRender('plan-3-loading', document.body)
    cleanup()
    h.read = { data: undefined, isError: true, error: new Error('Failed to fetch'), refetch: () => Promise.resolve() }
    open()
    captureRender('plan-3-error', document.body)
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})
