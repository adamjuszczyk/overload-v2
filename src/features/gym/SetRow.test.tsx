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

// Chunk 11 (SPEC.md "Removals" — suggested reps per program exercise
// replaced by per-set rep targets). Mirrors the existing TARGET RIR hint's
// own render contract exactly (same pl-7 row, same "null/false -> nothing"
// rule) — see plannerVocabulary.ts's columnsToRepTarget for the 'none' case
// this builds on.
function makeWeekPlanSet(overrides: Partial<import('../../types').WeekPlanSet> = {}): import('../../types').WeekPlanSet {
  return {
    id: 'wps1',
    weekPlanId: 'wp1',
    userId: 'u1',
    programExerciseId: 'pe1',
    setNumber: 1,
    targetRir: null,
    isDropset: false,
    parentWeekPlanSetId: null,
    stageIndex: 0,
    isWarmup: false,
    ...overrides,
  }
}

describe('SetRow — planned rep target hint (chunk 11)', () => {
  // The hint lives in the "not yet logged" input row (the same row the
  // TARGET RIR hint and the LOG/SKIP buttons live in) — currentLog: null,
  // unlike the edit-mode tests above (which cover an ALREADY-logged set's
  // own edit form, a different render branch entirely).
  function unloggedProps() {
    return { ...baseSetRowProps(), currentLog: null }
  }

  it('no plannedSet at all -> no TARGET REPS text', () => {
    render(<SetRow {...unloggedProps()} plannedSet={null} />)
    expect(screen.queryByText(/TARGET REPS/)).toBeNull()
  })

  it('a plannedSet with no rep target (all null/false) -> no TARGET REPS text, same as no target today', () => {
    render(<SetRow {...unloggedProps()} plannedSet={makeWeekPlanSet({ repMin: null, repMax: null, isAmrap: false })} />)
    expect(screen.queryByText(/TARGET REPS/)).toBeNull()
  })

  it('a plain number (repMin === repMax) shows "TARGET REPS 8"', () => {
    render(<SetRow {...unloggedProps()} plannedSet={makeWeekPlanSet({ repMin: 8, repMax: 8 })} />)
    expect(screen.getByText('TARGET REPS 8')).toBeTruthy()
  })

  it('a range shows "TARGET REPS 8–12" (en dash)', () => {
    render(<SetRow {...unloggedProps()} plannedSet={makeWeekPlanSet({ repMin: 8, repMax: 12 })} />)
    expect(screen.getByText('TARGET REPS 8–12')).toBeTruthy()
  })

  it('AMRAP shows "TARGET REPS AMRAP"', () => {
    render(<SetRow {...unloggedProps()} plannedSet={makeWeekPlanSet({ isAmrap: true })} />)
    expect(screen.getByText('TARGET REPS AMRAP')).toBeTruthy()
  })

  it('renders alongside an existing TARGET RIR hint without replacing it', () => {
    render(<SetRow {...unloggedProps()} plannedSet={makeWeekPlanSet({ repMin: 8, repMax: 12, targetRir: 2 })} />)
    expect(screen.getByText('TARGET REPS 8–12')).toBeTruthy()
    expect(screen.getByText('TARGET RIR 2')).toBeTruthy()
  })
})

// Chunk 19 (SPEC "Targets"/"Tags" — "SetRow shows the weight target (in the
// exercise's unit) and the set's tags ... A set without a target shows no
// target: null weight, no tags ... render nothing (no label, no
// placeholder, no empty element). That is what keeps D30 intact." / "Tags
// are display-only on the workout screen. They're never written to
// v2_set_logs or the offline queue."). Same "not yet logged" input row as
// the rep-target hint above.
describe('SetRow — planned weight target + tags (chunk 19)', () => {
  function unloggedProps() {
    return { ...baseSetRowProps(), currentLog: null }
  }

  it('no plannedSet at all -> no TARGET WEIGHT text, no tag chips', () => {
    render(<SetRow {...unloggedProps()} plannedSet={null} />)
    expect(screen.queryByText(/TARGET WEIGHT/)).toBeNull()
  })

  it('a plannedSet with a null target_weight -> no TARGET WEIGHT text (same as no target today)', () => {
    render(<SetRow {...unloggedProps()} plannedSet={makeWeekPlanSet({ targetWeight: null })} />)
    expect(screen.queryByText(/TARGET WEIGHT/)).toBeNull()
  })

  it('a weight target shows in the exercise\'s resolved unit (kg default here)', () => {
    render(<SetRow {...unloggedProps()} plannedSet={makeWeekPlanSet({ targetWeight: 100 })} />)
    expect(screen.getByText('TARGET WEIGHT 100kg')).toBeTruthy()
  })

  it('renders alongside TARGET REPS/TARGET RIR without disturbing either', () => {
    render(<SetRow {...unloggedProps()} plannedSet={makeWeekPlanSet({ targetWeight: 100, repMin: 8, repMax: 12, targetRir: 2 })} />)
    expect(screen.getByText('TARGET WEIGHT 100kg')).toBeTruthy()
    expect(screen.getByText('TARGET REPS 8–12')).toBeTruthy()
    expect(screen.getByText('TARGET RIR 2')).toBeTruthy()
  })

  it('no tags (null or empty) -> no tag chip rendered at all', () => {
    render(<SetRow {...unloggedProps()} plannedSet={makeWeekPlanSet({ tags: null })} />)
    expect(screen.queryByText('push here')).toBeNull()
    render(<SetRow {...unloggedProps()} plannedSet={makeWeekPlanSet({ tags: [] })} />)
    expect(screen.queryByText('push here')).toBeNull()
  })

  it('two tags both show on the row', () => {
    render(<SetRow {...unloggedProps()} plannedSet={makeWeekPlanSet({ tags: ['push here', 'maintain strength'] })} />)
    expect(screen.getByText('push here')).toBeTruthy()
    expect(screen.getByText('maintain strength')).toBeTruthy()
  })

  it('tags are display-only: LOG\'s payload never carries a tags key', () => {
    const onLog = vi.fn()
    const { container } = render(
      <SetRow
        {...unloggedProps()}
        plannedSet={makeWeekPlanSet({ tags: ['push here'] })}
        onLog={onLog}
      />,
    )
    fireEvent.change(container.querySelector('input[inputmode="decimal"]')!, { target: { value: '100' } })
    fireEvent.change(container.querySelector('input[inputmode="numeric"]')!, { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: 'LOG' }))

    expect(onLog).toHaveBeenCalledTimes(1)
    expect('tags' in onLog.mock.calls[0][0]).toBe(false)
  })

  it('a weight target and two tags together both show on the same row (chunk 19 verification: "a set with a weight target and two tags shows both on its row")', () => {
    render(<SetRow {...unloggedProps()} plannedSet={makeWeekPlanSet({ targetWeight: 100, tags: ['push here', 'maintain strength'] })} />)
    expect(screen.getByText('TARGET WEIGHT 100kg')).toBeTruthy()
    expect(screen.getByText('push here')).toBeTruthy()
    expect(screen.getByText('maintain strength')).toBeTruthy()
  })
})

// Chunk 14 — "Staged sets: all four stage kinds" (SPEC.md). Three things at
// this component's own boundary: a stage row is labelled by its resolved
// kind (dropset keeps today's plain "STAGE"/no-hint look, unchanged); a
// carrying kind's weight input defaults to the resolved carry value
// (stageCarryLogic.ts, exercised through the `carryWeightKg` prop SetGroup.tsx
// computes — this file tests the prop's effect in isolation, same precedent
// as every other SetGroup-computed prop here); and LOG/SKIP always resolve
// `stageKind` from this row's own `plannedSet`, never from the display-only
// `stageKind` prop.
describe('SetRow — stage kind label, carry-over weight, logged "as planned" (chunk 14)', () => {
  function unloggedStageProps(overrides: Partial<Parameters<typeof SetRow>[0]> = {}) {
    return { ...baseSetRowProps(), currentLog: null, isStage: true, ...overrides }
  }

  it('a dropset stage (explicit or absent) shows no new label — the locked/unlogged row looks exactly as before this chunk', () => {
    const { rerender } = render(<SetRow {...unloggedStageProps({ isLocked: true })} />)
    expect(screen.queryByText('DROPSET')).toBeNull()
    expect(screen.queryByText('REST-PAUSE')).toBeNull()
    rerender(<SetRow {...unloggedStageProps({ isLocked: true, stageKind: 'dropset' })} />)
    expect(screen.queryByText('DROPSET')).toBeNull()
  })

  it.each([
    ['rest_pause', 'REST-PAUSE'],
    ['myo_reps', 'MYO-REPS'],
    ['cluster', 'CLUSTER'],
  ] as const)('a locked %s stage shows its kind label %s', (stageKind, label) => {
    render(<SetRow {...unloggedStageProps({ isLocked: true, stageKind })} />)
    expect(screen.getByText(label)).toBeTruthy()
  })

  it('a non-stage (head) row never shows a kind label, even if stageKind is passed', () => {
    render(<SetRow {...baseSetRowProps()} currentLog={null} isStage={false} stageKind="rest_pause" />)
    expect(screen.queryByText('REST-PAUSE')).toBeNull()
  })

  it('an already-logged dropset stage keeps the plain "STAGE" badge; a rest-pause stage shows its kind instead', () => {
    const { rerender } = render(
      <SetRow {...baseSetRowProps()} isStage currentLog={makeLog({ isDropset: true, parentSetId: 'head1', stageIndex: 1 })} />,
    )
    expect(screen.getByText('STAGE')).toBeTruthy()
    expect(screen.queryByText('REST-PAUSE')).toBeNull()

    rerender(
      <SetRow
        {...baseSetRowProps()}
        isStage
        stageKind="rest_pause"
        currentLog={makeLog({ isDropset: true, parentSetId: 'head1', stageIndex: 1 })}
      />,
    )
    expect(screen.queryByText('STAGE')).toBeNull()
    expect(screen.getByText('REST-PAUSE')).toBeTruthy()
  })

  it('carryWeightKg prefills the weight input (converted to the active unit), same guard as the lastLog prefill', () => {
    render(<SetRow {...unloggedStageProps({ stageKind: 'rest_pause', carryWeightKg: 92.5 })} />)
    expect(screen.getByDisplayValue('92.5')).toBeTruthy()
  })

  it('carryWeightKg null (dropset, or nothing to carry yet) leaves the weight input blank, same as today', () => {
    render(<SetRow {...unloggedStageProps({ stageKind: 'dropset', carryWeightKg: null })} />)
    const weightInput = screen.getAllByRole('textbox')[0] as HTMLInputElement
    expect(weightInput.value).toBe('')
  })

  it("LOG resolves stageKind from THIS row's own plannedSet, not the display-only stageKind prop", () => {
    const onLog = vi.fn()
    render(
      <SetRow
        {...unloggedStageProps({ stageKind: 'rest_pause' })}
        plannedSet={makeWeekPlanSet({ id: 'stage-plan-1', stageKind: null })}
        onLog={onLog}
      />,
    )
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '100' } })
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: 'LOG' }))

    expect(onLog).toHaveBeenCalledTimes(1)
    // A stage's own plan row always carries a null stage_kind (the DB's own
    // check) — correctly null here even though the group's resolved
    // display kind (the prop above) is 'rest_pause'.
    expect(onLog.mock.calls[0][0].stageKind).toBeNull()
  })

  it('a HEAD\'s LOG writes its OWN plannedSet.stageKind — "as planned"', () => {
    const onLog = vi.fn()
    render(
      <SetRow
        {...baseSetRowProps()}
        currentLog={null}
        isStage={false}
        plannedSet={makeWeekPlanSet({ id: 'head-plan-1', stageKind: 'cluster' })}
        onLog={onLog}
      />,
    )
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '60' } })
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'LOG' }))

    expect(onLog).toHaveBeenCalledTimes(1)
    expect(onLog.mock.calls[0][0].stageKind).toBe('cluster')
  })

  it('a head with no plannedSet at all (an extra/unplanned set) writes stageKind: null', () => {
    const onLog = vi.fn()
    render(<SetRow {...baseSetRowProps()} currentLog={null} isStage={false} plannedSet={null} onLog={onLog} />)
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '60' } })
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'LOG' }))

    expect(onLog.mock.calls[0][0].stageKind).toBeNull()
  })

  it('SKIP also resolves stageKind "as planned", same as LOG', () => {
    const onLog = vi.fn()
    render(
      <SetRow
        {...baseSetRowProps()}
        currentLog={null}
        isStage={false}
        plannedSet={makeWeekPlanSet({ id: 'head-plan-2', stageKind: 'myo_reps' })}
        onLog={onLog}
      />,
    )
    fireEvent.click(screen.getByText('▼ MORE'))
    fireEvent.click(screen.getByRole('button', { name: 'SKIP' }))

    expect(onLog).toHaveBeenCalledTimes(1)
    expect(onLog.mock.calls[0][0].stageKind).toBe('myo_reps')
    expect(onLog.mock.calls[0][0].isSkipped).toBe(true)
  })
})
