// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, WeekPlanSet, Exercise } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 19 (SPEC "Tags" — preset list plus custom text, several allowed,
// each removable, "Apply to all sets" fills one tag across an exercise's
// sets, heads only — not warmups, not stages). Same mocking recipe as
// PlanPage.stageKind.test.tsx.
//
// Chunk 54a: a set's cues are edited in the cues sheet (board 8), reached from the set type picker's Cues row (the set's ⋯), and a set's
// cues show as chips under its row. The preset chips in the ⋯ menu, "+ CUSTOM" and the per-tag "apply to all" button are gone: the sheet has
// a tick box per cue, "+ NEW CUE", and one "Use for all N sets of [exercise]" for every cue the set has. What the PAGE writes for
// what the sheet returns (the set's own tags, null when none, and each other working head's missing cues) is what this file proves.

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

const startDate = format(new Date(), 'yyyy-MM-dd')

const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate, endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const workoutDay: WorkoutDay = {
  id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [],
}
const EX_A: Exercise = {
  id: 'ex-a', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false,
  createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
}
const pe1: ProgramExercise = {
  id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-a', position: 0,
  weightUnit: null, exercise: EX_A,
}

function makeProgram(): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1' },
    workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    kind: 'run', planningType: 'week_dependent',
  }
}

function makeSet(overrides: Partial<WeekPlanSet>): WeekPlanSet {
  return {
    id: 'set-1', weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: 'pe-1',
    setNumber: 1, targetRir: null, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false,
    ...overrides,
  }
}

function makePlan(sets: WeekPlanSet[]): WeekPlan {
  return {
    id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1',
    weekNumber: 1, isDeload: false, notes: null, sets, exercises: [pe1], createdAt: '2026-01-01T00:00:00Z',
  }
}

const mockState: { plans: WeekPlan[] } = { plans: [] }
const updateSetMutate = vi.fn()

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [activeMeso], isLoading: false }) }))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [makeProgram()], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: [] }),
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
// The set type picker (a set's ⋯) reads the exercise's program sets for its rest row; this file gives it none.
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./plannerHooks.testutil')).quietPlannerHooks,
}))
// Plan reads which sessions are done (useDoneWeekPlanIds); none here.
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => new Set<string>() }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() })) // the CHANGE THE PROGRAM button's statuses: none here
// Plan reads the run's schedule rows (useRunSchedule, chunk 50): this file's run has none, so every week is the run copy's.
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: () => ({ data: mockState.plans, isLoading: false }),
  useAllWeekPlans: () => ({ data: mockState.plans, isLoading: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  // Chunk 21 - the week-level mark/unmark action's own hook.
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSet: () => ({ mutate: updateSetMutate }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useChangeSetType: () => ({ mutate: vi.fn(), isPending: false }),
}))

// Chunk 24 — this component owns its own hooks (useSessionsInRange via
// gym/useSession.ts, which needs a real QueryClientProvider this file's
// own render() doesn't set up — every other PlanPage hook is mocked away
// the same way for the same reason). Stubbed to nothing: this file's own
// job is unrelated to session-moving: MoveSessionControl.test.tsx proves
// the real component.
vi.mock('./MoveSessionControl', () => ({ default: () => null }))

const { default: PlanPage } = await import('./PlanPage')
const { openSetMenu } = await import('./planMenus.testutil')

function renderPlanPage() {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <PlanPage />
    </MemoryRouter>,
  )
}

// The set's ⋯ → Cues → the cues sheet (stacked on the picker); its rows are tick boxes by the cue's label.
function openCues(setNumber = 1) {
  openSetMenu(setNumber)
  fireEvent.click(screen.getByText('Cues'))
  return within(screen.getByRole('dialog', { name: 'Cues for this set' }))
}
const tick = (sheet: ReturnType<typeof within>, label: string) => fireEvent.click(sheet.getByRole('checkbox', { name: label }))
const done = (sheet: ReturnType<typeof within>) => fireEvent.click(sheet.getByRole('button', { name: 'DONE' }))

describe('PlanPage — cues editor, heads only (chunk 19; the cues sheet since chunk 54a)', () => {
  it('ticking a preset writes it as this set\'s first tag', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({})])]
    renderPlanPage()
    const sheet = openCues()

    tick(sheet, 'Push here')
    done(sheet)

    expect(updateSetMutate).toHaveBeenCalledTimes(1)
    expect(updateSetMutate).toHaveBeenCalledWith({ id: 'set-1', changes: { tags: ['push here'] } })
  })

  it('unticking an active preset removes it (the same "tap to clear" interaction as every other tick box in this app)', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({ tags: ['push here', 'push back'] })])]
    renderPlanPage()
    const sheet = openCues()
    expect(sheet.getByRole('checkbox', { name: 'Push here' }).getAttribute('aria-checked')).toBe('true')

    tick(sheet, 'Push here')
    done(sheet)

    expect(updateSetMutate).toHaveBeenCalledWith({ id: 'set-1', changes: { tags: ['push back'] } })
  })

  it('removing the last tag collapses to null, not an empty array', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({ tags: ['push here'] })])]
    renderPlanPage()
    const sheet = openCues()

    tick(sheet, 'Push here')
    done(sheet)

    expect(updateSetMutate).toHaveBeenCalledWith({ id: 'set-1', changes: { tags: null } })
  })

  it('DONE with nothing changed writes nothing, and closing the sheet any other way writes nothing', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({ tags: ['push here'] })])]
    renderPlanPage()
    let sheet = openCues()
    done(sheet)
    expect(updateSetMutate).not.toHaveBeenCalled()

    sheet = openCues()
    tick(sheet, 'Push back')
    fireEvent.click(sheet.getByLabelText('Close'))
    expect(updateSetMutate).not.toHaveBeenCalled()
  })

  it('custom text: "+ NEW CUE", typing and ADD adds it, trimmed', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({})])]
    renderPlanPage()
    const sheet = openCues()

    fireEvent.click(sheet.getByText('+ NEW CUE'))
    fireEvent.change(sheet.getByLabelText('New cue'), { target: { value: '  heavy day  ' } })
    fireEvent.click(sheet.getByRole('button', { name: 'ADD' }))
    expect(sheet.getByRole('checkbox', { name: /^Heavy day/ }).getAttribute('aria-checked')).toBe('true') // it joins the list, ticked
    done(sheet)

    expect(updateSetMutate).toHaveBeenCalledWith({ id: 'set-1', changes: { tags: ['heavy day'] } })
  })

  it('blank custom text is refused — nothing is added, nothing written', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({})])]
    renderPlanPage()
    const sheet = openCues()

    fireEvent.click(sheet.getByText('+ NEW CUE'))
    fireEvent.change(sheet.getByLabelText('New cue'), { target: { value: '   ' } })
    fireEvent.click(sheet.getByRole('button', { name: 'ADD' }))
    done(sheet)

    expect(updateSetMutate).not.toHaveBeenCalled()
  })

  it('a duplicate custom tag (exact match to one already on this set) is refused — no second copy', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([makeSet({ tags: ['focus on execution'] })])]
    renderPlanPage()
    const sheet = openCues()

    fireEvent.click(sheet.getByText('+ NEW CUE'))
    fireEvent.change(sheet.getByLabelText('New cue'), { target: { value: 'focus on execution' } })
    fireEvent.click(sheet.getByRole('button', { name: 'ADD' }))
    done(sheet)

    expect(updateSetMutate).not.toHaveBeenCalled()
  })

  it('a custom tag already on the set shows as its own row, ticked and marked YOURS, alongside the four presets', () => {
    mockState.plans = [makePlan([makeSet({ tags: ['triceps feel off today'] })])]
    renderPlanPage()
    const sheet = openCues()

    const names = sheet.getAllByRole('checkbox').map((row) => row.textContent)
    expect(names).toEqual(['Push here', 'Maintain strength', 'Focus on execution', 'Push back', 'Triceps feel off todayYOURS'])
    expect(sheet.getByRole('checkbox', { name: /^Triceps feel off today/ }).getAttribute('aria-checked')).toBe('true')
  })

  it('a stage row has no ⋯, so no cues sheet of its own; cues are the head\'s, shown once, under the head', () => {
    mockState.plans = [makePlan([
      makeSet({ id: 'head', setNumber: 1, tags: ['push here'] }),
      makeSet({ id: 'stage', setNumber: 1, isDropset: true, parentWeekPlanSetId: 'head', stageIndex: 1 }),
    ])]
    renderPlanPage()

    // Shown as a chip under the head only; the picker is opened from the head's ⋯, and it is the only one there is.
    expect(screen.getAllByText('Push here')).toHaveLength(1)
    expect(screen.getAllByLabelText(/^Options for /)).toHaveLength(1)
    const sheet = openCues()
    // Exactly one row of cues exists (the head's): if the stage also had a sheet there would be two ticked "Push here" rows.
    expect(sheet.getAllByRole('checkbox', { name: 'Push here' })).toHaveLength(1)
  })

  // UI rule (2026-10-10): cues show only on sets that have them, compactly;
  // a set without cues shows no empty field, chip row or placeholder.
  it('a set with no cues shows nothing cue-related; a set with cues shows only its own, compactly', () => {
    mockState.plans = [makePlan([
      makeSet({ id: 'head-1', setNumber: 1 }),
      makeSet({ id: 'head-2', setNumber: 2, tags: ['push here', 'focus on execution'] }),
    ])]
    renderPlanPage()

    expect(screen.queryByText('Cues')).toBeNull()
    expect(screen.queryByText('+ NEW CUE')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    // The two cues appear once each (set 2's chips); set 1 shows none.
    expect(screen.getAllByText('Push here')).toHaveLength(1)
    expect(screen.getAllByText('Focus on execution')).toHaveLength(1)
    expect(document.querySelectorAll('svg.lucide-tag')).toHaveLength(2)
  })

  it('the picker\'s Cues row says what the set has, and the cues sheet opens on it', () => {
    mockState.plans = [makePlan([makeSet({ tags: ['push here', 'heavy day'] })])]
    renderPlanPage()
    openSetMenu(1)
    const picker = within(screen.getByRole('dialog', { name: 'What is this set?' }))
    expect(picker.getByText('Push here, Heavy day')).toBeTruthy()
  })
})

describe('PlanPage — "Use for all N sets" in the cues sheet (chunk 19; the sheet since chunk 54a)', () => {
  it('broadcasts the set\'s cues to every OTHER working head of the same exercise, heads only, never touching a warmup or a stage', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([
      makeSet({ id: 'head-1', setNumber: 1, tags: ['push here'] }),
      makeSet({ id: 'head-1-drop', setNumber: 1, isDropset: true, parentWeekPlanSetId: 'head-1', stageIndex: 1 }),
      makeSet({ id: 'head-2', setNumber: 2 }),
      makeSet({ id: 'head-3-warmup', setNumber: 3, isWarmup: true }),
    ])]
    renderPlanPage()
    const sheet = openCues(1)

    const all = sheet.getByRole('checkbox', { name: 'Use for all 2 sets of Bench Press' }) // the two working heads
    expect(all.getAttribute('aria-checked')).toBe('false') // it starts unticked
    fireEvent.click(all)
    done(sheet)

    // Only head-2 needed the write (head-1 already has it and is unchanged, head-1-drop is a stage, head-3-warmup is a warmup).
    expect(updateSetMutate).toHaveBeenCalledTimes(1)
    expect(updateSetMutate).toHaveBeenCalledWith({ id: 'head-2', changes: { tags: ['push here'] } })
  })

  it('never removes another tag already on a set it reaches', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([
      makeSet({ id: 'head-1', setNumber: 1, tags: ['push here'] }),
      makeSet({ id: 'head-2', setNumber: 2, tags: ['maintain strength'] }),
    ])]
    renderPlanPage()
    const sheet = openCues(1)

    fireEvent.click(sheet.getByRole('checkbox', { name: 'Use for all 2 sets of Bench Press' }))
    done(sheet)

    expect(updateSetMutate).toHaveBeenCalledWith({ id: 'head-2', changes: { tags: ['maintain strength', 'push here'] } })
  })

  it('every cue of the set goes, each head getting all it lacks in ONE write (not one write per cue from the same old list)', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([
      makeSet({ id: 'head-1', setNumber: 1, tags: ['push here', 'heavy day'] }),
      makeSet({ id: 'head-2', setNumber: 2, tags: ['push here'] }),
      makeSet({ id: 'head-3', setNumber: 3 }),
    ])]
    renderPlanPage()
    const sheet = openCues(1)

    fireEvent.click(sheet.getByRole('checkbox', { name: 'Use for all 3 sets of Bench Press' }))
    done(sheet)

    expect(updateSetMutate.mock.calls.map(([v]) => v)).toEqual([
      { id: 'head-2', changes: { tags: ['push here', 'heavy day'] } },
      { id: 'head-3', changes: { tags: ['push here', 'heavy day'] } },
    ])
  })

  it('idempotent: once every working head already has the cues it writes nothing', () => {
    mockState.plans = [makePlan([
      makeSet({ id: 'head-1', setNumber: 1, tags: ['push here'] }),
      makeSet({ id: 'head-2', setNumber: 2, tags: ['push here'] }),
    ])]
    renderPlanPage()
    const sheet = openCues(1)
    updateSetMutate.mockClear()

    fireEvent.click(sheet.getByRole('checkbox', { name: 'Use for all 2 sets of Bench Press' }))
    done(sheet)

    expect(updateSetMutate).not.toHaveBeenCalled()
  })

  it('ticked but unchecked cues of the set go nowhere: "Use for all" with the set\'s cue removed writes only this set', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan([
      makeSet({ id: 'head-1', setNumber: 1, tags: ['push here'] }),
      makeSet({ id: 'head-2', setNumber: 2, tags: ['push here'] }),
    ])]
    renderPlanPage()
    const sheet = openCues(1)

    tick(sheet, 'Push here') // off, on this set
    fireEvent.click(sheet.getByRole('checkbox', { name: 'Use for all 2 sets of Bench Press' }))
    done(sheet)

    // No cue left to apply, so head-2 keeps its own; this set's tags are null.
    expect(updateSetMutate.mock.calls.map(([v]) => v)).toEqual([{ id: 'head-1', changes: { tags: null } }])
  })

  it('"Use for all" is only drawn where it has somewhere to go: one working head, or none besides warmups and stages, gives none', () => {
    mockState.plans = [makePlan([
      makeSet({ id: 'head-1', setNumber: 1 }),
      makeSet({ id: 'head-2', setNumber: 2, isWarmup: true }),
      makeSet({ id: 'stage', setNumber: 1, isDropset: true, parentWeekPlanSetId: 'head-1', stageIndex: 1 }),
    ])]
    renderPlanPage()
    const sheet = openCues(1)

    expect(sheet.queryByRole('checkbox', { name: /^Use for all/ })).toBeNull()
  })
})

// A head that has stage rows writes its own tags (cues are the head's; a stage has none).
describe('PlanPage — a cue written on a head that HAS stages is that head\'s own, never a stage\'s', () => {
  const withStages = (tags?: string[]) => [
    makeSet({ id: 'head', setNumber: 1, tags, stageKind: 'dropset' }),
    makeSet({ id: 'stage-1', setNumber: 1, isDropset: true, parentWeekPlanSetId: 'head', stageIndex: 1 }),
    makeSet({ id: 'stage-2', setNumber: 1, isDropset: true, parentWeekPlanSetId: 'head', stageIndex: 2 }),
  ]

  it('a preset, and a custom cue, each written to the head', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan(withStages())]
    renderPlanPage()
    const sheet = openCues()
    tick(sheet, 'Push here')
    fireEvent.click(sheet.getByText('+ NEW CUE'))
    fireEvent.change(sheet.getByLabelText('New cue'), { target: { value: 'slow negatives' } })
    fireEvent.click(sheet.getByRole('button', { name: 'ADD' }))
    done(sheet)

    expect(updateSetMutate.mock.calls).toEqual([[{ id: 'head', changes: { tags: ['push here', 'slow negatives'] } }]])
  })

  it('removing the last cue from a head that has stages writes the head, collapsing to null', () => {
    updateSetMutate.mockClear()
    mockState.plans = [makePlan(withStages(['push here']))]
    renderPlanPage()
    const sheet = openCues()
    tick(sheet, 'Push here')
    done(sheet)

    expect(updateSetMutate.mock.calls).toEqual([[{ id: 'head', changes: { tags: null } }]])
  })
})

// Independent-review break T8 (carried): handing the cues handler the FIRST exercise's sets, whichever exercise applied the cue, passed every
// test, because every "Use for all" fixture had one exercise.
describe('PlanPage — "Use for all" stays inside its own exercise', () => {
  const EX_B: Exercise = { ...EX_A, id: 'ex-b', name: 'Squat', muscleGroup: 'quads' }
  const pe2: ProgramExercise = { ...pe1, id: 'pe-2', exerciseId: 'ex-b', position: 1, exercise: EX_B }
  const mk = (id: string, programExerciseId: string, setNumber: number, over: Partial<WeekPlanSet> = {}) =>
    makeSet({ id, programExerciseId, setNumber, ...over })
  // Bench Press: two working sets, the first cued. Squat: a warmup, then three working sets (the first cued, the second staged). Set numbers
  // repeat across the two exercises, so a set ⋯ is picked by its place on the page.
  const twoExercises = () => [
    mk('a1', 'pe-1', 1, { tags: ['push here'] }),
    mk('a2', 'pe-1', 2),
    mk('bw', 'pe-2', 1, { isWarmup: true }),
    mk('b1', 'pe-2', 2, { tags: ['push here'] }),
    mk('b2', 'pe-2', 3),
    mk('b2s', 'pe-2', 3, { isDropset: true, parentWeekPlanSetId: 'b2', stageIndex: 1 }),
    mk('b3', 'pe-2', 4),
  ]
  const written = () => updateSetMutate.mock.calls.map((c) => c[0] as { id: string; changes: unknown })
  const arrangeBoth = () => {
    mockState.plans = [{ ...makePlan(twoExercises()), exercises: [pe1, pe2] }]
    renderPlanPage()
  }

  it('from the second exercise: writes only ITS other working sets — not the warmup, not a stage, none of the first exercise\'s', () => {
    updateSetMutate.mockClear()
    arrangeBoth()

    // Squat's cued set is its first WORKING set (the warmup is W): the second "set 1" on the page.
    fireEvent.click(screen.getAllByLabelText('Options for set 1')[1])
    fireEvent.click(screen.getByText('Cues'))
    const sheet = within(screen.getByRole('dialog', { name: 'Cues for this set' }))
    fireEvent.click(sheet.getByRole('checkbox', { name: 'Use for all 3 sets of Squat' }))
    done(sheet)

    expect(written().map((w) => w.id)).toEqual(['b2', 'b3'])
    for (const w of written()) expect(w.changes).toEqual({ tags: ['push here'] })
  })

  it('from the first exercise: writes only ITS other working sets, none of the second\'s', () => {
    updateSetMutate.mockClear()
    arrangeBoth()

    fireEvent.click(screen.getAllByLabelText('Options for set 1')[0]) // Bench Press's cued set
    fireEvent.click(screen.getByText('Cues'))
    const sheet = within(screen.getByRole('dialog', { name: 'Cues for this set' }))
    fireEvent.click(sheet.getByRole('checkbox', { name: 'Use for all 2 sets of Bench Press' }))
    done(sheet)

    expect(written().map((w) => w.id)).toEqual(['a2'])
    expect(written()[0].changes).toEqual({ tags: ['push here'] })
  })
})
