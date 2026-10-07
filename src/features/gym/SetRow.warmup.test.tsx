// @vitest-environment jsdom
//
// Chunk 15 (SPEC "Warmup sets" — "Logged values: weight and reps, both
// optional; plus a rest timer. Nothing else. Display setting: rows
// (default; numbers optional) or tick (tick-off only)"). SetRow.tsx's
// isWarmup branch, in both display modes — the one place the brief asks
// for a dedicated test. D30 is a separate, untouched path: isWarmup is
// never true there, so none of this exercises the pre-chunk-15 render at
// all (see GymSession.d30.test.tsx / RestTimer.d30.test.tsx / the fixture
// md5 — unaffected by anything here).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import SetRow from './SetRow'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'
import { useRestTimerStore } from './restTimerStore'
import { useSetTimerStore } from './setTimerStore'
import type { ProgramExercise, SetLog, WeekPlanSet } from '../../types'

afterEach(() => {
  cleanup()
  useSettingsStore.setState({ ...DEFAULT_SETTINGS })
  useRestTimerStore.getState().stop()
  useSetTimerStore.getState().stop()
})

function makeProgramExercise(): ProgramExercise {
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
  }
}

function makePlannedWarmup(overrides: Partial<WeekPlanSet> = {}): WeekPlanSet {
  return {
    id: 'wps-warmup',
    weekPlanId: 'wp-1',
    userId: 'u1',
    programExerciseId: 'pe1',
    setNumber: 1,
    targetRir: null,
    isDropset: false,
    parentWeekPlanSetId: null,
    stageIndex: 0,
    isWarmup: true,
    ...overrides,
  }
}

function makeWarmupLog(overrides: Partial<SetLog> = {}): SetLog {
  return {
    id: 'log-warmup',
    userId: 'u1',
    sessionId: 's1',
    exerciseId: 'e1',
    weekPlanSetId: 'wps-warmup',
    setNumber: 1,
    weight: 40,
    reps: 10,
    rir: null,
    note: null,
    isDropset: false,
    parentSetId: null,
    stageIndex: 0,
    isWarmup: true,
    setSeconds: null,
    enteredUnit: null,
    isSkipped: false,
    loggedAt: '2026-01-05T10:00:00.000Z',
    restSeconds: null,
    formRating: null,
    ...overrides,
  }
}

function baseProps() {
  return {
    setNumber: 1,
    programExercise: makeProgramExercise(),
    plannedSet: makePlannedWarmup(),
    lastLog: null,
    lastLogsLoading: false,
    currentLog: null,
    isWarmup: true,
    onLog: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    restElapsed: 42,
  }
}

describe('SetRow — warmup, rows mode (default)', () => {
  it('shows two optional weight/reps inputs and a LOG button, no RIR/MORE/skip', () => {
    render(<SetRow {...baseProps()} />)
    expect(screen.getAllByPlaceholderText('0')).toHaveLength(2) // weight + reps
    expect(screen.getByRole('button', { name: 'LOG' })).toBeTruthy()
    expect(screen.queryByText('RIR')).toBeNull()
    expect(screen.queryByText(/MORE/)).toBeNull()
    expect(screen.queryByText('SKIP')).toBeNull()
  })

  it('LOG with both fields blank calls onLog with weight: null, reps: null, isWarmup: true', () => {
    const onLog = vi.fn()
    render(<SetRow {...baseProps()} onLog={onLog} />)
    fireEvent.click(screen.getByRole('button', { name: 'LOG' }))
    expect(onLog).toHaveBeenCalledTimes(1)
    const payload = onLog.mock.calls[0][0]
    expect(payload).toMatchObject({
      weekPlanSetId: 'wps-warmup',
      weight: null,
      reps: null,
      rir: null,
      isDropset: false,
      isSkipped: false,
      enteredUnit: null,
      formRating: null,
      stageKind: null,
      isWarmup: true,
    })
  })

  it('LOG with weight and reps entered converts and sends them, still isWarmup: true', () => {
    const onLog = vi.fn()
    render(<SetRow {...baseProps()} onLog={onLog} />)
    const [weightInput, repsInput] = screen.getAllByPlaceholderText('0')
    fireEvent.change(weightInput, { target: { value: '40' } })
    fireEvent.change(repsInput, { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'LOG' }))

    expect(onLog).toHaveBeenCalledTimes(1)
    const payload = onLog.mock.calls[0][0]
    expect(payload.weight).toBe(40)
    expect(payload.reps).toBe(12)
    expect(payload.isWarmup).toBe(true)
  })

  it('a logged warmup (both values present) renders weight × reps, with edit and delete (review fix)', () => {
    render(<SetRow {...baseProps()} currentLog={makeWarmupLog()} />)
    expect(screen.getByText('WARMUP')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit set' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete set' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'LOG' })).toBeNull()
  })

  it('a logged numberless warmup (weight/reps both null) renders DONE instead of a dash', () => {
    render(<SetRow {...baseProps()} currentLog={makeWarmupLog({ weight: null, reps: null })} />)
    expect(screen.getByText('DONE')).toBeTruthy()
  })
})

describe('SetRow — warmup, tick mode (v2_user_settings.warmup_display = "tick")', () => {
  afterEach(() => useSettingsStore.setState({ ...DEFAULT_SETTINGS }))

  it('shows a single tick button, no weight/reps inputs at all', () => {
    useSettingsStore.setState({ warmupDisplay: 'tick' })
    render(<SetRow {...baseProps()} />)
    expect(screen.queryByPlaceholderText('0')).toBeNull()
    expect(screen.getByText('WARMUP')).toBeTruthy()
  })

  it('tapping the row calls onLog with weight: null, reps: null, isWarmup: true (tick-off only)', () => {
    useSettingsStore.setState({ warmupDisplay: 'tick' })
    const onLog = vi.fn()
    render(<SetRow {...baseProps()} onLog={onLog} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onLog).toHaveBeenCalledTimes(1)
    const payload = onLog.mock.calls[0][0]
    expect(payload.weight).toBeNull()
    expect(payload.reps).toBeNull()
    expect(payload.isWarmup).toBe(true)
  })

  it('a ticked (logged) warmup offers delete but no edit — "unticking" is deleting it (review fix)', () => {
    useSettingsStore.setState({ warmupDisplay: 'tick' })
    render(<SetRow {...baseProps()} currentLog={makeWarmupLog()} />)
    expect(screen.getByText('WARMUP')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit set' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Delete set' })).toBeTruthy()
  })

  it('tapping Delete on a ticked warmup calls onDelete (untick)', () => {
    useSettingsStore.setState({ warmupDisplay: 'tick' })
    const onDelete = vi.fn()
    render(<SetRow {...baseProps()} currentLog={makeWarmupLog()} onDelete={onDelete} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete set' }))
    fireEvent.click(screen.getByRole('button', { name: 'DELETE' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})

// Review fix (reviewer, chunk 15) — "SPEC's 'nothing else' limits what a
// warmup records, not whether it can be corrected": a logged warmup gets
// the same edit (weight/reps only) and delete affordances a logged working
// set already has, reusing the existing onUpdate/onDelete props.
describe('SetRow — warmup, logged: edit and delete (review fix)', () => {
  it('Edit opens weight/reps inputs only, pre-filled from the logged values — no RIR, no FORM', () => {
    render(<SetRow {...baseProps()} currentLog={makeWarmupLog({ weight: 40, reps: 10 })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit set' }))

    expect(screen.getByRole('button', { name: 'SAVE' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'CANCEL' })).toBeTruthy()
    expect(screen.queryByText('RIR')).toBeNull()
    expect(screen.queryByText('FORM')).toBeNull()
    const [weightInput, repsInput] = screen.getAllByRole('textbox').concat(screen.getAllByRole('spinbutton'))
    expect((weightInput as HTMLInputElement).value).toBe('40')
    expect((repsInput as HTMLInputElement).value).toBe('10')
  })

  it('SAVE calls onUpdate with weight/reps only — no rir or formRating key at all', () => {
    const onUpdate = vi.fn()
    render(<SetRow {...baseProps()} currentLog={makeWarmupLog({ weight: 40, reps: 10 })} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit set' }))

    const weightInput = screen.getAllByRole('textbox')[0]
    const repsInput = screen.getAllByRole('spinbutton')[0]
    fireEvent.change(weightInput, { target: { value: '45' } })
    fireEvent.change(repsInput, { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: 'SAVE' }))

    expect(onUpdate).toHaveBeenCalledTimes(1)
    const payload = onUpdate.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toEqual({ weight: 45, reps: 8 })
    expect('rir' in payload).toBe(false)
    expect('formRating' in payload).toBe(false)
  })

  it('CANCEL closes the edit form without calling onUpdate', () => {
    const onUpdate = vi.fn()
    render(<SetRow {...baseProps()} currentLog={makeWarmupLog()} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit set' }))
    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }))
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Edit set' })).toBeTruthy()
  })

  it('Delete needs confirmation, then calls onDelete', () => {
    const onDelete = vi.fn()
    render(<SetRow {...baseProps()} currentLog={makeWarmupLog()} onDelete={onDelete} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete set' }))
    expect(onDelete).not.toHaveBeenCalled() // not yet — confirm step first
    fireEvent.click(screen.getByRole('button', { name: 'DELETE' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('Delete\'s CANCEL backs out without calling onDelete', () => {
    const onDelete = vi.fn()
    render(<SetRow {...baseProps()} currentLog={makeWarmupLog()} onDelete={onDelete} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete set' }))
    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }))
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Delete set' })).toBeTruthy()
  })

  it('break proof: a logged warmup with no values (tick-logged) can still be edited in rows mode, weight/reps starting blank', () => {
    render(<SetRow {...baseProps()} currentLog={makeWarmupLog({ weight: null, reps: null })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit set' }))
    const weightInput = screen.getAllByRole('textbox')[0] as HTMLInputElement
    const repsInput = screen.getAllByRole('spinbutton')[0] as HTMLInputElement
    expect(weightInput.value).toBe('')
    expect(repsInput.value).toBe('')
  })
})
