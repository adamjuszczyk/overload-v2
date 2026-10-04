// @vitest-environment jsdom
//
// Chunk 4 — "Remove the note section from logged-set editing" [P1]
// (SPEC.md's "Removals" section): editing a logged set no longer shows a
// note field, and saving that edit must never put `note` back into the
// update payload (the `changes` object `onUpdate` is called with) — not
// `note: null`, not the old value, absent entirely. Two tests, matching
// chunk4-brief.md's verification list items 1-2 at the component boundary:
//  - render: an already-logged set's edit mode has no note input.
//  - payload: clicking SAVE calls onUpdate with a changes object that has
//    no `note` key at all ('note' in payload === false).
//
// `getByPlaceholderText('Note')` is the exact query the pre-chunk-4 note
// input (`<input placeholder="Note" ... />`, SetRow.tsx's isEditing block)
// was findable by — confirmed against the pre-change source before this
// file was written; see chunk 4's own commit/report for the break-it proof
// (temporarily restoring the input makes this exact query find it, and the
// render test fail).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import SetRow from './SetRow'
import { useRestTimerStore } from './restTimerStore'
import { useSetTimerStore } from './setTimerStore'
import type { ProgramExercise, SetLog } from '../../types'

afterEach(() => {
  cleanup()
  // Same module-global zustand reset SetGroup.test.tsx already does for
  // these same two stores — both persist across tests in this file
  // otherwise (handleStartSet/handleLog call startTimer()).
  useRestTimerStore.getState().stop()
  useSetTimerStore.getState().stop()
})

const noop = () => {}

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
    targetReps: null,
    weightUnit: null,
  }
}

// note is a real, non-null stored value here on purpose — it's the stored
// v2_set_logs.note this chunk's "critical property" guarantees an edit
// never disturbs. These tests only assert what the EDIT PATH sends; they
// don't (and can't, at this layer) assert the stored row is untouched —
// that's sessionService.test.ts's job, one layer down.
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
    note: 'a real stored note',
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

function baseSetRowProps() {
  return {
    setNumber: 1,
    programExercise: makeProgramExercise(),
    plannedSet: null,
    lastLog: null,
    lastLogsLoading: false,
    currentLog: makeLog(),
    onLog: noop,
    onUpdate: noop,
    onDelete: noop,
    restElapsed: null,
  }
}

function enterEditMode() {
  fireEvent.click(screen.getByRole('button', { name: 'Edit set' }))
}

describe('SetRow — edit mode has no note field (chunk 4)', () => {
  it('renders no note input at all', () => {
    render(<SetRow {...baseSetRowProps()} />)
    enterEditMode()

    // Sanity: this really is the edit form (SAVE/CANCEL only render once
    // isEditing is true), not still the read-only logged row.
    expect(screen.getByRole('button', { name: 'SAVE' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'CANCEL' })).toBeTruthy()

    // The exact query that found the old note input pre-chunk-4.
    expect(screen.queryByPlaceholderText('Note')).toBeNull()
  })

  it('SAVE calls onUpdate with a payload that has no "note" key', () => {
    const onUpdate = vi.fn()
    render(<SetRow {...baseSetRowProps()} onUpdate={onUpdate} />)
    enterEditMode()

    fireEvent.click(screen.getByRole('button', { name: 'SAVE' }))

    expect(onUpdate).toHaveBeenCalledTimes(1)
    const payload = onUpdate.mock.calls[0][0] as Record<string, unknown>
    // The critical property, at the component boundary: not absent-and-
    // therefore-undefined, genuinely absent as a key.
    expect('note' in payload).toBe(false)
    // Sanity: this is the real edit payload (weight/reps/rir/formRating),
    // not an empty or mis-shaped call that would make the assertion above
    // vacuous.
    expect(payload).toHaveProperty('weight')
    expect(payload).toHaveProperty('reps')
    expect(payload).toHaveProperty('rir')
    expect(payload).toHaveProperty('formRating')
  })
})
