// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { Program, SequenceItem, WorkoutDay } from '../../types'

// Chunk 33 — useProgramHasSchedule gathers what hasSchedule.ts reads for a
// program: its workouts, and for a sequence program only, its sequence. null while
// either read has not answered, so a START waits and shows no reason meanwhile.

let workoutDaysData: WorkoutDay[] | undefined
let sequenceData: SequenceItem[] | undefined
const useWorkoutDays = vi.fn((_programId: string) => ({ data: workoutDaysData }))
const useSequenceItems = vi.fn((_programId: string) => ({ data: sequenceData }))

vi.mock('./usePrograms', () => ({
  useWorkoutDays: (programId: string) => useWorkoutDays(programId),
  useSequenceItems: (programId: string) => useSequenceItems(programId),
}))

const { useProgramHasSchedule } = await import('./useProgramHasSchedule')

const NO_DAYS = { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null }
const day = (id: string): WorkoutDay => ({ id, programId: 'prog-1', userId: 'user-1', name: id, position: 0, exercises: [] })
const slot = (position: number, workoutDayId: string | null): SequenceItem => ({ id: `si-${position}`, userId: 'user-1', programId: 'prog-1', position, workoutDayId })
function program(overrides: Partial<Program> = {}): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'P', schedule: NO_DAYS, workoutDays: [], createdAt: '', updatedAt: '',
    kind: 'saved', scheduleType: 'weekday', ...overrides,
  }
}

beforeEach(() => {
  workoutDaysData = [day('wd-1')]
  sequenceData = []
  useWorkoutDays.mockClear()
  useSequenceItems.mockClear()
})

describe('useProgramHasSchedule', () => {
  it('is null with no program (nothing selected, or programs still loading)', () => {
    expect(renderHook(() => useProgramHasSchedule(undefined)).result.current).toBeNull()
    expect(renderHook(() => useProgramHasSchedule(null)).result.current).toBeNull()
  })

  it('a weekday program: true with a workout on a weekday, false with none', () => {
    expect(renderHook(() => useProgramHasSchedule(program({ schedule: { ...NO_DAYS, monday: 'wd-1' } }))).result.current).toBe(true)
    expect(renderHook(() => useProgramHasSchedule(program())).result.current).toBe(false)
  })

  it('a weekday program makes no sequence read (the sequence query is asked for no program)', () => {
    renderHook(() => useProgramHasSchedule(program({ schedule: { ...NO_DAYS, monday: 'wd-1' } })))

    expect(useWorkoutDays).toHaveBeenCalledWith('prog-1')
    expect(useSequenceItems).toHaveBeenCalledWith('')
    expect(useSequenceItems).not.toHaveBeenCalledWith('prog-1')
  })

  it('a sequence program reads its own sequence: true with a workout slot, false with rests only', () => {
    const seq = program({ scheduleType: 'sequence' })
    sequenceData = [slot(0, null), slot(1, 'wd-1')]
    expect(renderHook(() => useProgramHasSchedule(seq)).result.current).toBe(true)
    expect(useSequenceItems).toHaveBeenCalledWith('prog-1')

    sequenceData = [slot(0, null)]
    expect(renderHook(() => useProgramHasSchedule(seq)).result.current).toBe(false)
  })

  it('is null until the program\'s workouts have answered', () => {
    workoutDaysData = undefined
    expect(renderHook(() => useProgramHasSchedule(program({ schedule: { ...NO_DAYS, monday: 'wd-1' } }))).result.current).toBeNull()
  })

  it('is null until a sequence program\'s sequence has answered (not false: an empty answer is a real answer)', () => {
    const seq = program({ scheduleType: 'sequence' })
    sequenceData = undefined
    expect(renderHook(() => useProgramHasSchedule(seq)).result.current).toBeNull()

    sequenceData = []
    expect(renderHook(() => useProgramHasSchedule(seq)).result.current).toBe(false)
  })

  it('a weekday program does not wait for a sequence it never reads', () => {
    sequenceData = undefined
    expect(renderHook(() => useProgramHasSchedule(program({ schedule: { ...NO_DAYS, friday: 'wd-1' } }))).result.current).toBe(true)
  })
})
