// @vitest-environment jsdom
//
// Chunk 3 — "Planned staged sets render (fix)" [P1] (SPEC.md): a dropset
// planned in the week plan shows its head and every planned stage row on
// the workout screen before anything is logged, each stage locked (visible
// with its planned value, not loggable) until the row before it is logged.
//
// Two levels, deliberately:
//  - SetGroup (below) pins down the actual rendering fix — row count, lock
//    state across the log-the-head / log-stage-1 / log-stage-2 progression,
//    and that the unplanned/skipped-head paths this fix must not touch are
//    pixel-for-pixel what they were before.
//  - ExerciseCard (bottom) mounts the real, unmodified write path
//    (handleLogStage) end to end, so a break in parentSetId/stageIndex
//    pass-through — not just in SetGroup's own call shape — fails a test
//    here too.
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ComponentProps } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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
    targetReps: null,
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

describe('SetGroup — planned staged sets render before anything is logged (chunk 3 fix)', () => {
  it('nothing logged: head is an input row, both planned stages render locked — 3 rows total', () => {
    render(
      <SetGroup
        {...baseSetGroupProps()}
        plannedSet={planHead}
        plannedStages={plannedStages}
        group={null}
      />,
    )

    // Head row: the unlogged input row, marked '01' (not a stage marker).
    expect(screen.getByText('01')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'LOG' })).toBeTruthy()

    // Both stage rows present (↳ marker ×2) and both locked.
    expect(screen.getAllByText('↳')).toHaveLength(2)
    expect(screen.getAllByText('LOCKED')).toHaveLength(2)
    expect(screen.getByText('TARGET RIR 1')).toBeTruthy()
    expect(screen.getByText('TARGET RIR 0')).toBeTruthy()

    // Nothing loggable for either stage, and no ADD STAGE affordance yet —
    // the head itself isn't logged, so there is nothing to add a stage to.
    expect(screen.queryAllByRole('button', { name: 'LOG' })).toHaveLength(1)
    expect(screen.queryByText('ADD STAGE')).toBeNull()
    expect(screen.queryByText('mark as dropset')).toBeNull()
  })

  it('head logged: stage 1 unlocked (loggable), stage 2 still locked', () => {
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
    // Exactly one stage row is loggable (stage 1) and exactly one is locked
    // (stage 2) — both carry the ↳ marker.
    expect(screen.getAllByText('↳')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'LOG' })).toHaveLength(1)
    expect(screen.getAllByText('LOCKED')).toHaveLength(1)
    // The unlocked row is stage 1 (TARGET RIR 1 hint); stage 2 (TARGET RIR 0)
    // is the one still showing locked.
    expect(screen.getByText('TARGET RIR 1')).toBeTruthy()
    expect(screen.getByText('TARGET RIR 0')).toBeTruthy()
  })

  it('stage 1 logged too: stage 2 unlocked, nothing locked remains', () => {
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

    expect(screen.queryByText('LOCKED')).toBeNull()
    // Head and stage 1 are now both logged display rows — each marked with
    // its own padded setNumber (SetRow's already-logged row distinguishes a
    // stage from its head by colour only, not by swapping in '↳'; that
    // marker is only for the unlogged/locked renderings). Stage 2 is the
    // sole loggable (↳) row left.
    expect(screen.getAllByText('01')).toHaveLength(2)
    expect(screen.getAllByText('↳')).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'LOG' })).toHaveLength(1)
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
    expect(screen.queryByText('LOCKED')).toBeNull()
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
    expect(screen.queryByText('LOCKED')).toBeNull()
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
    expect(screen.queryByText('LOCKED')).toBeNull()
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
    expect(screen.queryByText('LOCKED')).toBeNull()
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

    // 1. Log the head.
    let inputs = screen.getAllByPlaceholderText('0')
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

    // 2. Stage 1 is now auto-unlocked (no ADD STAGE tap) — log it.
    inputs = screen.getAllByPlaceholderText('0')
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

    // 3. Stage 2 is now auto-unlocked — log it.
    inputs = screen.getAllByPlaceholderText('0')
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
