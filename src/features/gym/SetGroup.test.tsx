// @vitest-environment jsdom
//
// Chunk 3 — "Planned staged sets render (fix)" [P1] (SPEC.md): a dropset
// planned in the week plan shows its head and every planned stage row on
// the workout screen before anything is logged, each stage locked (visible
// with its planned value, not loggable) until the row before it is logged.
//
// SPEC's own words: each stage renders "as a row with weight and reps"
// from the start. A locked stage is therefore the SAME input row a
// loggable stage gets — same weight/reps fields, same ↳ marker, same
// TARGET RIR hint, same prefill — just disabled (native `disabled`, so it
// can't be focused, typed into, or submitted), not a different, inert
// shape. Three levels, deliberately:
//  - SetRow (first) pins down the disabled-row mechanism itself in
//    isolation: the inputs and the log control are present, disabled, and
//    fire nothing; the identical row minus isLocked is enabled.
//  - SetGroup (below that) pins down the actual rendering fix built on top
//    of it — row count and lock state across the log-the-head /
//    log-stage-1 / log-stage-2 progression — and that the unplanned/
//    skipped-head paths this fix must not touch are pixel-for-pixel what
//    they were before.
//  - ExerciseCard (bottom) mounts the real, unmodified write path
//    (handleLogStage) end to end, so a break in parentSetId/stageIndex
//    pass-through — not just in SetGroup's own call shape — fails a test
//    here too.
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ComponentProps } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SetRow from './SetRow'
import SetGroup from './SetGroup'
import ExerciseCard from './ExerciseCard'
import { groupSetLogs } from './setGroupLogic'
import { useRestTimerStore } from './restTimerStore'
import { useSetTimerStore } from './setTimerStore'
import type { ProgramExercise, WeekPlanSet, SetLog } from '../../types'

afterEach(() => {
  cleanup()
  // Both stores are module-global (zustand) and persist across tests in
  // this file; handleLogHead/handleLogStage call startTimer() on every log,
  // which this resets so no test's leftover rest/set-timer state can leak
  // into the next one's render.
  useRestTimerStore.getState().stop()
  useSetTimerStore.getState().stop()
})

const noop = () => {}
const asyncNoop = async () => {}

// Both HTMLInputElement and HTMLButtonElement carry `.disabled` — the
// element type returned by a role/text query is widened to plain
// HTMLElement, so this is just a narrow, shared accessor for it.
function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLInputElement | HTMLButtonElement).disabled
}

function makeProgramExercise(overrides: Partial<ProgramExercise> = {}): ProgramExercise {
  return {
    id: 'pe1',
    workoutDayId: 'wd1',
    userId: 'u1',
    exerciseId: 'e1',
    exercise: {
      id: 'e1',
      userId: 'u1',
      name: 'Leg Press',
      muscleGroup: 'quads',
      isArchived: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      muscleSubgroups: null,
      movementPattern: null,
      status: 'active',
      sourceLibraryId: null,
      lostAt: null,
    },
    position: 0,
    weightUnit: null,
    ...overrides,
  }
}

function makePlanSet(overrides: Partial<WeekPlanSet> = {}): WeekPlanSet {
  return {
    id: 'plan-head',
    weekPlanId: 'wp1',
    userId: 'u1',
    programExerciseId: 'pe1',
    setNumber: 1,
    targetRir: 2,
    isDropset: false,
    parentWeekPlanSetId: null,
    stageIndex: 0,
    isWarmup: false,
    ...overrides,
  }
}

function makeLog(overrides: Partial<SetLog> = {}): SetLog {
  return {
    id: 'log1',
    userId: 'u1',
    sessionId: 's1',
    exerciseId: 'e1',
    weekPlanSetId: null,
    setNumber: 1,
    weight: 100,
    reps: 10,
    rir: 2,
    note: null,
    isDropset: false,
    parentSetId: null,
    stageIndex: 0,
    isWarmup: false,
    setSeconds: null,
    enteredUnit: null,
    isSkipped: false,
    loggedAt: '2026-01-01T00:00:00.000Z',
    restSeconds: null,
    formRating: null,
    ...overrides,
  }
}

function baseSetGroupProps() {
  return {
    displayNumber: 1,
    programExercise: makeProgramExercise(),
    lastLog: null,
    lastLogsLoading: false,
    isDeleting: false,
    onLogHead: noop,
    onLogStage: noop,
    onUpdate: noop,
    onDeleteHead: noop,
    onDeleteStage: noop,
    restElapsed: null,
  }
}

function baseSetRowProps() {
  return {
    setNumber: 1,
    programExercise: makeProgramExercise(),
    lastLog: null,
    lastLogsLoading: false,
    currentLog: null,
    onLog: noop,
    onUpdate: noop,
    onDelete: noop,
    restElapsed: null,
  }
}

// Shared fixture: a head plus two planned dropset stages, same shape a real
// week-plan dropset (parent_week_plan_set_id / stage_index) produces.
const planHead = makePlanSet({ id: 'plan-head', setNumber: 1, stageIndex: 0, targetRir: 3 })
const planStage1 = makePlanSet({
  id: 'plan-s1',
  setNumber: 1,
  stageIndex: 1,
  parentWeekPlanSetId: 'plan-head',
  isDropset: true,
  targetRir: 1,
})
// targetRir: 0 deliberately — 0 is a valid RIR and must still render (a
// `!= null` check, not a truthiness one, is what the fix requires).
const planStage2 = makePlanSet({
  id: 'plan-s2',
  setNumber: 1,
  stageIndex: 2,
  parentWeekPlanSetId: 'plan-head',
  isDropset: true,
  targetRir: 0,
})
const plannedStages = [planStage1, planStage2]

describe('SetRow — isLocked disables the real input row, not a different shape', () => {
  it('renders the weight field, the reps field and the ↳/TARGET RIR hint, all disabled', () => {
    render(<SetRow {...baseSetRowProps()} isStage isLocked plannedSet={planStage1} />)

    const inputs = screen.getAllByPlaceholderText('0')
    expect(inputs).toHaveLength(2)
    expect(isDisabled(inputs[0])).toBe(true) // weight
    expect(isDisabled(inputs[1])).toBe(true) // reps

    // Same row shape as a loggable stage: the ↳ marker and the TARGET RIR
    // hint render unconditionally on both, never specific to isLocked.
    expect(screen.getByText('↳')).toBeTruthy()
    expect(screen.getByText('TARGET RIR 1')).toBeTruthy()

    // The LOG slot — same position, same size — shows LOCKED and is
    // disabled, rather than being replaced or hidden.
    const lockedControl = screen.getByRole('button', { name: 'LOCKED' })
    expect(isDisabled(lockedControl)).toBe(true)
    expect(screen.queryByRole('button', { name: 'LOG' })).toBeNull()
  })

  it('clicking the disabled log control fires nothing', () => {
    const onLog = vi.fn()
    render(<SetRow {...baseSetRowProps()} isStage isLocked plannedSet={planStage1} onLog={onLog} />)

    fireEvent.click(screen.getByRole('button', { name: 'LOCKED' }))
    expect(onLog).not.toHaveBeenCalled()
  })

  it('the unit-toggle and ▼ MORE controls are disabled too — nothing on a locked row is a tap target', () => {
    render(<SetRow {...baseSetRowProps()} isStage isLocked plannedSet={planStage1} />)

    expect(isDisabled(screen.getByRole('button', { name: /Log this set in/ }))).toBe(true)
    expect(isDisabled(screen.getByRole('button', { name: '▼ MORE' }))).toBe(true)
  })

  it('the identical row with isLocked false: the same inputs and the same slot, now enabled — no change of shape', () => {
    const onLog = vi.fn()
    render(<SetRow {...baseSetRowProps()} isStage isLocked={false} plannedSet={planStage1} onLog={onLog} />)

    const inputs = screen.getAllByPlaceholderText('0')
    expect(inputs).toHaveLength(2)
    expect(isDisabled(inputs[0])).toBe(false)
    expect(isDisabled(inputs[1])).toBe(false)

    expect(screen.getByText('↳')).toBeTruthy()
    expect(screen.getByText('TARGET RIR 1')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'LOCKED' })).toBeNull()

    const logButton = screen.getByRole('button', { name: 'LOG' })
    expect(isDisabled(logButton)).toBe(false)
    fireEvent.change(inputs[0], { target: { value: '50' } })
    fireEvent.change(inputs[1], { target: { value: '5' } })
    fireEvent.click(logButton)
    expect(onLog).toHaveBeenCalledTimes(1)
  })
})

describe('SetGroup — planned staged sets render before anything is logged (chunk 3 fix)', () => {
  it('nothing logged: head is an enabled input row, both planned stages render as disabled rows — 3 rows total', () => {
    render(
      <SetGroup
        {...baseSetGroupProps()}
        plannedSet={planHead}
        plannedStages={plannedStages}
        group={null}
      />,
    )

    // Head row: the unlogged input row, marked '01' (not a stage marker),
    // enabled.
    expect(screen.getByText('01')).toBeTruthy()
    expect(isDisabled(screen.getByRole('button', { name: 'LOG' }))).toBe(false)

    // Both stage rows present (↳ marker ×2), each a disabled weight/reps
    // row with a disabled LOCKED control in the log slot.
    expect(screen.getAllByText('↳')).toHaveLength(2)
    const lockedControls = screen.getAllByRole('button', { name: 'LOCKED' })
    expect(lockedControls).toHaveLength(2)
    for (const c of lockedControls) expect(isDisabled(c)).toBe(true)

    const inputs = screen.getAllByPlaceholderText('0')
    expect(inputs).toHaveLength(6) // head (2) + stage 1 (2) + stage 2 (2)
    expect(isDisabled(inputs[0])).toBe(false) // head weight
    expect(isDisabled(inputs[1])).toBe(false) // head reps
    expect(isDisabled(inputs[2])).toBe(true) // stage 1 weight — locked
    expect(isDisabled(inputs[3])).toBe(true) // stage 1 reps — locked
    expect(isDisabled(inputs[4])).toBe(true) // stage 2 weight — locked
    expect(isDisabled(inputs[5])).toBe(true) // stage 2 reps — locked

    expect(screen.getByText('TARGET RIR 1')).toBeTruthy()
    expect(screen.getByText('TARGET RIR 0')).toBeTruthy()

    // No ADD STAGE affordance yet — the head itself isn't logged, so
    // there's nothing to add a stage to.
    expect(screen.queryByText('ADD STAGE')).toBeNull()
    expect(screen.queryByText('mark as dropset')).toBeNull()
  })

  it('head logged: stage 1 unlocked (enabled, loggable), stage 2 still locked (disabled)', () => {
    const headLog = makeLog({ id: 'head-log', weekPlanSetId: 'plan-head', setNumber: 1 })
    const group = groupSetLogs([headLog])[0]

    render(
      <SetGroup
        {...baseSetGroupProps()}
        plannedSet={planHead}
        plannedStages={plannedStages}
        group={group}
      />,
    )

    // Head now renders as a logged display row (no LOG button of its own).
    expect(screen.getAllByText('01')).toHaveLength(1)
    expect(screen.getAllByText('↳')).toHaveLength(2)

    const inputs = screen.getAllByPlaceholderText('0')
    expect(inputs).toHaveLength(4) // stage 1 (2, unlocked) + stage 2 (2, locked)
    expect(isDisabled(inputs[0])).toBe(false) // stage 1 weight — unlocked
    expect(isDisabled(inputs[1])).toBe(false) // stage 1 reps — unlocked
    expect(isDisabled(inputs[2])).toBe(true) // stage 2 weight — still locked
    expect(isDisabled(inputs[3])).toBe(true) // stage 2 reps — still locked

    expect(isDisabled(screen.getByRole('button', { name: 'LOG' }))).toBe(false)
    expect(isDisabled(screen.getByRole('button', { name: 'LOCKED' }))).toBe(true)

    // The unlocked row is stage 1 (TARGET RIR 1 hint); stage 2 (TARGET RIR
    // 0) is the one still showing locked.
    expect(screen.getByText('TARGET RIR 1')).toBeTruthy()
    expect(screen.getByText('TARGET RIR 0')).toBeTruthy()
  })

  it('stage 1 logged too: stage 2 unlocked (enabled), nothing locked remains', () => {
    const headLog = makeLog({ id: 'head-log', weekPlanSetId: 'plan-head', setNumber: 1 })
    const stage1Log = makeLog({
      id: 'stage1-log',
      weekPlanSetId: 'plan-s1',
      setNumber: 1,
      parentSetId: 'head-log',
      stageIndex: 1,
      isDropset: true,
    })
    const group = groupSetLogs([headLog, stage1Log])[0]

    render(
      <SetGroup
        {...baseSetGroupProps()}
        plannedSet={planHead}
        plannedStages={plannedStages}
        group={group}
      />,
    )

    expect(screen.queryByRole('button', { name: 'LOCKED' })).toBeNull()
    // Head and stage 1 are now both logged display rows — each marked with
    // its own padded setNumber (SetRow's already-logged row distinguishes a
    // stage from its head by colour only, not by swapping in '↳'; that
    // marker is only for the unlogged/locked renderings). Stage 2 is the
    // sole loggable (↳) row left, fully enabled.
    expect(screen.getAllByText('01')).toHaveLength(2)
    expect(screen.getAllByText('↳')).toHaveLength(1)

    const inputs = screen.getAllByPlaceholderText('0')
    expect(inputs).toHaveLength(2)
    expect(isDisabled(inputs[0])).toBe(false)
    expect(isDisabled(inputs[1])).toBe(false)
    expect(isDisabled(screen.getByRole('button', { name: 'LOG' }))).toBe(false)
  })

  it('logging the unlocked stage calls onLogStage with the head log, the right plan slot and isDropset true', () => {
    const headLog = makeLog({ id: 'head-log', weekPlanSetId: 'plan-head', setNumber: 1 })
    const group = groupSetLogs([headLog])[0]
    const onLogStage = vi.fn()

    render(
      <SetGroup
        {...baseSetGroupProps()}
        plannedSet={planHead}
        plannedStages={plannedStages}
        group={group}
        onLogStage={onLogStage}
      />,
    )

    const inputs = screen.getAllByPlaceholderText('0')
    expect(isDisabled(inputs[0])).toBe(false) // stage 1 — sanity: this is the unlocked one
    fireEvent.change(inputs[0], { target: { value: '50' } }) // weight
    fireEvent.change(inputs[1], { target: { value: '5' } }) // reps
    fireEvent.click(screen.getByRole('button', { name: 'LOG' }))

    expect(onLogStage).toHaveBeenCalledTimes(1)
    const [calledHeadLog, params] = onLogStage.mock.calls[0]
    // "The parent id comes from the tap" — this must be the exact head log
    // object SetGroup was given, not a re-derived/inferred one.
    expect(calledHeadLog).toBe(headLog)
    expect(params.weekPlanSetId).toBe('plan-s1')
    expect(params.isDropset).toBe(true)
    expect(params.weight).toBe(50)
    expect(params.reps).toBe(5)
  })

  it('clicking a locked stage row\'s log control through SetGroup fires nothing', () => {
    const headLog = makeLog({ id: 'head-log', weekPlanSetId: 'plan-head', setNumber: 1 })
    const group = groupSetLogs([headLog])[0]
    const onLogStage = vi.fn()

    render(
      <SetGroup
        {...baseSetGroupProps()}
        plannedSet={planHead}
        plannedStages={plannedStages}
        group={group}
        onLogStage={onLogStage}
      />,
    )

    // Stage 2's LOCKED control — attempting to tap it must call onLogStage
    // zero times, same as every other locked row.
    fireEvent.click(screen.getByRole('button', { name: 'LOCKED' }))
    expect(onLogStage).not.toHaveBeenCalled()
  })

  // ── Regression: unplanned dropsets and skipped heads behave exactly as
  // today — this fix must not change either path. ──────────────────────────

  it('no planned stages at all: unlogged head renders alone (today\'s shape, unchanged)', () => {
    render(
      <SetGroup
        {...baseSetGroupProps()}
        plannedSet={planHead}
        plannedStages={[]}
        group={null}
      />,
    )
    expect(screen.getByRole('button', { name: 'LOG' })).toBeTruthy()
    expect(screen.queryByText('↳')).toBeNull()
    expect(screen.queryByRole('button', { name: 'LOCKED' })).toBeNull()
  })

  it('head logged, no planned stages: shows the low-emphasis "mark as dropset" link, not an auto-unlocked row', () => {
    const headLog = makeLog({ id: 'head-log', setNumber: 1 })
    const group = groupSetLogs([headLog])[0]

    render(
      <SetGroup
        {...baseSetGroupProps()}
        plannedSet={planHead}
        plannedStages={[]}
        group={group}
      />,
    )

    expect(screen.getByText('mark as dropset')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'LOCKED' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'LOG' })).toBeNull()
  })

  it('head logged with one unplanned stage already added: shows the bold ADD STAGE button, no locked rows', () => {
    const headLog = makeLog({ id: 'head-log', setNumber: 1 })
    const unplannedStage = makeLog({
      id: 'stage1-log',
      setNumber: 1,
      parentSetId: 'head-log',
      stageIndex: 1,
      isDropset: true,
    })
    const group = groupSetLogs([headLog, unplannedStage])[0]

    render(
      <SetGroup
        {...baseSetGroupProps()}
        plannedSet={planHead}
        plannedStages={[]}
        group={group}
      />,
    )

    expect(screen.getByText('ADD STAGE')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'LOCKED' })).toBeNull()
  })

  it('skipped head with planned-but-unlogged stages: no stage affordance at all — identical to today', () => {
    const skippedHeadLog = makeLog({ id: 'head-log', weekPlanSetId: 'plan-head', setNumber: 1, isSkipped: true, weight: null, reps: null })
    const group = groupSetLogs([skippedHeadLog])[0]

    render(
      <SetGroup
        {...baseSetGroupProps()}
        plannedSet={planHead}
        plannedStages={plannedStages}
        group={group}
      />,
    )

    expect(screen.getByText('SKIPPED')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'LOCKED' })).toBeNull()
    expect(screen.queryByText('mark as dropset')).toBeNull()
    expect(screen.queryByRole('button', { name: 'ADD STAGE' })).toBeNull()
  })
})

describe('ExerciseCard — logging an auto-unlocked planned stage reuses ADD STAGE\'s own write path', () => {
  type OnLogParams = Parameters<ComponentProps<typeof ExerciseCard>['onLog']>[0]

  it('writes parentSetId = the head\'s real log id and stageIndex = 1, then 2 — exactly what ADD STAGE writes today', () => {
    const programExercise = makeProgramExercise()
    const head = makePlanSet({ id: 'plan-head', setNumber: 1, stageIndex: 0, parentWeekPlanSetId: null })
    const stage1 = makePlanSet({ id: 'plan-s1', setNumber: 1, stageIndex: 1, parentWeekPlanSetId: 'plan-head', isDropset: true })
    const stage2 = makePlanSet({ id: 'plan-s2', setNumber: 1, stageIndex: 2, parentWeekPlanSetId: 'plan-head', isDropset: true })
    const plannedSets = [head, stage1, stage2]

    const onLog = vi.fn((params: OnLogParams) => Promise.resolve(makeLog({ ...params })))

    function renderCard(currentLogs: SetLog[]) {
      return (
        <MemoryRouter>
          <ExerciseCard
            programExercise={programExercise}
            plannedSets={plannedSets}
            currentLogs={currentLogs}
            lastLogs={[]}
            lastLogsLoading={false}
            referenceSessions={[]}
            referenceLoading={false}
            referenceMesocycleId={null}
            referenceIsError={false}
            referenceIsFromCache={false}
            onRetryReference={noop}
            today="2026-10-04"
            onLog={onLog}
            onUpdateSet={noop}
            onDeleteSet={asyncNoop}
            onSwap={noop}
          />
        </MemoryRouter>
      )
    }

    const { rerender } = render(renderCard([]))

    // 1. Nothing logged: head enabled, both stages present and disabled.
    let inputs = screen.getAllByPlaceholderText('0')
    expect(inputs).toHaveLength(6)
    expect(isDisabled(inputs[0])).toBe(false) // head
    expect(isDisabled(inputs[1])).toBe(false)
    expect(isDisabled(inputs[2])).toBe(true) // stage 1 — locked
    expect(isDisabled(inputs[3])).toBe(true)
    expect(isDisabled(inputs[4])).toBe(true) // stage 2 — locked
    expect(isDisabled(inputs[5])).toBe(true)

    // Log the head.
    fireEvent.change(inputs[0], { target: { value: '100' } })
    fireEvent.change(inputs[1], { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'LOG' }))

    expect(onLog).toHaveBeenCalledTimes(1)
    const headParams = onLog.mock.calls[0][0]
    expect(headParams.parentSetId).toBeNull()
    expect(headParams.weekPlanSetId).toBe('plan-head')

    // Simulate the parent's refetch handing back the real, server-assigned
    // head log — the same thing GymSession.tsx's query does after a write.
    const headLog = makeLog({
      id: 'real-head-id',
      exerciseId: headParams.exerciseId,
      weekPlanSetId: 'plan-head',
      setNumber: 1,
    })
    rerender(renderCard([headLog]))

    // 2. Stage 1 is now auto-unlocked (enabled, no ADD STAGE tap needed);
    // stage 2 is still locked (disabled).
    inputs = screen.getAllByPlaceholderText('0')
    expect(inputs).toHaveLength(4)
    expect(isDisabled(inputs[0])).toBe(false) // stage 1 — unlocked
    expect(isDisabled(inputs[1])).toBe(false)
    expect(isDisabled(inputs[2])).toBe(true) // stage 2 — still locked
    expect(isDisabled(inputs[3])).toBe(true)

    fireEvent.change(inputs[0], { target: { value: '80' } })
    fireEvent.change(inputs[1], { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: 'LOG' }))

    expect(onLog).toHaveBeenCalledTimes(2)
    const stage1Params = onLog.mock.calls[1][0]
    expect(stage1Params.parentSetId).toBe('real-head-id')
    expect(stage1Params.stageIndex).toBe(1)
    expect(stage1Params.weekPlanSetId).toBe('plan-s1')
    expect(stage1Params.isDropset).toBe(true)

    const stage1Log = makeLog({
      id: 'real-stage1-id',
      exerciseId: headParams.exerciseId,
      weekPlanSetId: 'plan-s1',
      setNumber: 1,
      parentSetId: 'real-head-id',
      stageIndex: 1,
      isDropset: true,
    })
    rerender(renderCard([headLog, stage1Log]))

    // 3. Stage 2 is now auto-unlocked (enabled) — the same row that was
    // disabled a moment ago, nothing left locked.
    inputs = screen.getAllByPlaceholderText('0')
    expect(inputs).toHaveLength(2)
    expect(isDisabled(inputs[0])).toBe(false)
    expect(isDisabled(inputs[1])).toBe(false)

    fireEvent.change(inputs[0], { target: { value: '60' } })
    fireEvent.change(inputs[1], { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: 'LOG' }))

    expect(onLog).toHaveBeenCalledTimes(3)
    const stage2Params = onLog.mock.calls[2][0]
    expect(stage2Params.parentSetId).toBe('real-head-id')
    expect(stage2Params.stageIndex).toBe(2)
    expect(stage2Params.weekPlanSetId).toBe('plan-s2')
    expect(stage2Params.isDropset).toBe(true)
  })
})

// Chunk 14 — "Staged sets: all four stage kinds" (SPEC.md / TASKS.md).
// Same end-to-end shape as the dropset ExerciseCard test directly above
// (a planned 3-row staged set: head + 2 stages, logged head-first-then-
// stage-in-turn), for a planned REST-PAUSE set instead of a dropset — the
// reviewer's own "real session" proof: all rows render from the start,
// locked in turn, stage weights default to the previous row's own weight,
// and the head's write carries stage_kind = 'rest_pause' while both stages
// carry parentSetId + stageIndex 1/2, exactly as a dropset's stages always
// have.
describe('ExerciseCard — a planned rest-pause set of 3 stages (chunk 14)', () => {
  type OnLogParams = Parameters<ComponentProps<typeof ExerciseCard>['onLog']>[0]

  it('renders every stage from the start, carries weight stage to stage, and writes stage_kind "as planned"', () => {
    const programExercise = makeProgramExercise()
    const head = makePlanSet({ id: 'plan-head', setNumber: 1, stageIndex: 0, parentWeekPlanSetId: null, stageKind: 'rest_pause' })
    const stage1 = makePlanSet({ id: 'plan-s1', setNumber: 1, stageIndex: 1, parentWeekPlanSetId: 'plan-head', isDropset: true })
    const stage2 = makePlanSet({ id: 'plan-s2', setNumber: 1, stageIndex: 2, parentWeekPlanSetId: 'plan-head', isDropset: true })
    const plannedSets = [head, stage1, stage2]

    const onLog = vi.fn((params: OnLogParams) => Promise.resolve(makeLog({ ...params })))

    function renderCard(currentLogs: SetLog[]) {
      return (
        <MemoryRouter>
          <ExerciseCard
            programExercise={programExercise}
            plannedSets={plannedSets}
            currentLogs={currentLogs}
            lastLogs={[]}
            lastLogsLoading={false}
            referenceSessions={[]}
            referenceLoading={false}
            referenceMesocycleId={null}
            referenceIsError={false}
            referenceIsFromCache={false}
            onRetryReference={noop}
            today="2026-10-04"
            onLog={onLog}
            onUpdateSet={noop}
            onDeleteSet={asyncNoop}
            onSwap={noop}
          />
        </MemoryRouter>
      )
    }

    const { rerender } = render(renderCard([]))

    // 1. All three rows render from the start — head enabled, both stages
    // present and locked — same shape as a dropset's own 3-row case, plus
    // each locked stage now shows its kind.
    let inputs = screen.getAllByPlaceholderText('0')
    expect(inputs).toHaveLength(6)
    expect(isDisabled(inputs[0])).toBe(false) // head
    expect(isDisabled(inputs[2])).toBe(true) // stage 1 — locked
    expect(isDisabled(inputs[4])).toBe(true) // stage 2 — locked
    expect(screen.getAllByText('REST-PAUSE')).toHaveLength(2) // one per locked stage

    // Log the head at 100 kg.
    fireEvent.change(inputs[0], { target: { value: '100' } })
    fireEvent.change(inputs[1], { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'LOG' }))

    expect(onLog).toHaveBeenCalledTimes(1)
    const headParams = onLog.mock.calls[0][0]
    expect(headParams.parentSetId).toBeNull()
    // The core logging rule (TASKS.md "Logging"): the head's write carries
    // the planned kind, "as planned".
    expect(headParams.stageKind).toBe('rest_pause')

    const headLog = makeLog({
      id: 'real-head-id',
      exerciseId: headParams.exerciseId,
      weekPlanSetId: 'plan-head',
      setNumber: 1,
      weight: 100,
      stageKind: 'rest_pause',
    })
    rerender(renderCard([headLog]))

    // 2. Stage 1 auto-unlocks; its weight input defaults to the head's own
    // 100 (carry-over, SPEC "Staged sets" — "instead of being dropped").
    inputs = screen.getAllByPlaceholderText('0')
    expect(isDisabled(inputs[0])).toBe(false)
    expect(screen.getByDisplayValue('100')).toBeTruthy()
    expect(isDisabled(inputs[2])).toBe(true) // stage 2 — still locked

    // Keep the carried value — logging it unchanged proves the prefill is
    // real input state, not just a placeholder.
    fireEvent.change(inputs[1], { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: 'LOG' }))

    expect(onLog).toHaveBeenCalledTimes(2)
    const stage1Params = onLog.mock.calls[1][0]
    expect(stage1Params.parentSetId).toBe('real-head-id')
    expect(stage1Params.stageIndex).toBe(1)
    // A stage's own write never carries a kind of its own (the DB's check).
    expect(stage1Params.stageKind).toBeNull()
    expect(stage1Params.weight).toBe(100)

    const stage1Log = makeLog({
      id: 'real-stage1-id',
      exerciseId: headParams.exerciseId,
      weekPlanSetId: 'plan-s1',
      setNumber: 1,
      parentSetId: 'real-head-id',
      stageIndex: 1,
      isDropset: true,
      weight: 100,
    })
    rerender(renderCard([headLog, stage1Log]))

    // 3. Stage 2 auto-unlocks, now carrying stage 1's own weight (100 —
    // unchanged from the head in this run, same as the brief's own "stage
    // weights defaulting to the head's weight").
    inputs = screen.getAllByPlaceholderText('0')
    expect(inputs).toHaveLength(2)
    expect(screen.getByDisplayValue('100')).toBeTruthy()

    fireEvent.change(inputs[1], { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: 'LOG' }))

    expect(onLog).toHaveBeenCalledTimes(3)
    const stage2Params = onLog.mock.calls[2][0]
    expect(stage2Params.parentSetId).toBe('real-head-id')
    expect(stage2Params.stageIndex).toBe(2)
    expect(stage2Params.stageKind).toBeNull()
  })
})
